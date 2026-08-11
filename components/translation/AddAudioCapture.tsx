'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { LiveTranslationSttProvider } from '@/lib/translation/capabilities';
import { isStreamingSttProvider } from '@/lib/translation/capabilities';

const TARGET_SAMPLE_RATE = 16000;
/** Streaming ASR: short frames for low latency. */
const STREAMING_CHUNK_MS = 250;
/** Groq chunked Whisper: longer windows to stay under free RPM. */
const GROQ_CHUNK_MS = 4000;
/** Inaudible but non-zero — Chromium can skip ScriptProcessor when gain is exactly 0. */
const MONITOR_GAIN = 0.0001;
/**
 * Peak below this → skip upload (Whisper invents “Thank you” on silence/cutoff).
 * Kept modest so quiet speech still goes through; server also gates RMS.
 */
const SILENCE_PEAK = 0.015;

/**
 * True when the device is the browser system-default input entry.
 * @param device - MediaDeviceInfo from enumerateDevices.
 * @returns Whether this is the system default device.
 */
function isSystemDefaultInput(device: MediaDeviceInfo): boolean {
  if (device.deviceId === 'default') return true;
  return device.label.toLowerCase().startsWith('default');
}

/**
 * Prefers the OS/browser system default input when present.
 * @param inputs - Audio input devices.
 * @returns Preferred deviceId, or empty string.
 */
function preferSystemDefaultInputId(inputs: MediaDeviceInfo[]): string {
  const systemDefault = inputs.find((d) => d.deviceId === 'default');
  if (systemDefault?.deviceId) return systemDefault.deviceId;
  const labeled = inputs.find((d) => isSystemDefaultInput(d));
  return labeled?.deviceId || inputs[0]?.deviceId || '';
}

/**
 * Peak absolute sample in a float buffer.
 * @param samples - Channel data.
 * @returns Peak in [0, 1].
 */
function peakAbs(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i] ?? 0);
    if (a > peak) peak = a;
  }
  return peak;
}

/**
 * Mix multi-channel ScriptProcessor input down to mono.
 * @param event - Audio processing event.
 * @returns Mono float samples for this frame.
 */
function monoFromProcessorEvent(event: AudioProcessingEvent): Float32Array {
  const channels = event.inputBuffer.numberOfChannels;
  const length = event.inputBuffer.length;
  if (channels <= 1) {
    return new Float32Array(event.inputBuffer.getChannelData(0));
  }
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = event.inputBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      out[i]! += data[i] ?? 0;
    }
  }
  const inv = 1 / channels;
  for (let i = 0; i < length; i += 1) {
    out[i]! *= inv;
  }
  return out;
}

/**
 * Browser microphone / input-device capture that streams PCM chunks to the owner ingest API.
 * @param props - Whether translation is ready, STT provider (controls chunk length), and optional status callback.
 * @returns Capture controls UI.
 */
export function AddAudioCapture(props: {
  enabled: boolean;
  /** Active STT provider — streaming uses ~250ms frames; Groq uses ~4s. */
  sttProvider?: LiveTranslationSttProvider | null;
  onLiveChange?: (live: boolean) => void;
}) {
  const { enabled, sttProvider, onLiveChange } = props;
  const chunkMs =
    sttProvider && isStreamingSttProvider(sttProvider) ? STREAMING_CHUNK_MS : GROQ_CHUNK_MS;
  const chunkMsRef = useRef(chunkMs);
  chunkMsRef.current = chunkMs;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [capturing, setCapturing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const samplesCollectedRef = useRef(0);
  const sendingRef = useRef(false);
  const levelRef = useRef(0);
  const capturingRef = useRef(false);
  const ingestAbortRef = useRef<AbortController | null>(null);
  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;

  useEffect(() => {
    let cancelled = false;
    async function loadDevices() {
      try {
        // Permission prompt so labels populate
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const inputs = list.filter((d) => d.kind === 'audioinput');
        setDevices(inputs);
        setDeviceId(preferSystemDefaultInputId(inputs));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not access audio devices');
        }
      }
    }
    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      // Only tear down an active session on real unmount.
      if (capturingRef.current) {
        void stopCapture();
      }
    };
  }, []);

  /**
   * Sends buffered PCM to the ingest API when capture is still live.
   * @returns Void.
   */
  async function flushPcm() {
    if (!capturingRef.current) return;
    if (sendingRef.current) return;
    const chunks = pcmChunksRef.current;
    if (chunks.length === 0) return;
    pcmChunksRef.current = [];
    samplesCollectedRef.current = 0;

    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    // Near-silent chunks still trigger Whisper filler captions — skip before upload.
    if (peakAbs(merged) < SILENCE_PEAK) return;

    // Downsample to 16k mono PCM16
    const context = contextRef.current;
    const inputRate = context?.sampleRate ?? TARGET_SAMPLE_RATE;
    const ratio = inputRate / TARGET_SAMPLE_RATE;
    const outLength = Math.floor(merged.length / ratio);
    if (outLength <= 0) return;
    const pcm = new Int16Array(outLength);
    for (let i = 0; i < outLength; i += 1) {
      const sample = merged[Math.floor(i * ratio)] ?? 0;
      const s = Math.max(-1, Math.min(1, sample));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const pcmBase64 = btoa(binary);

    const abort = new AbortController();
    ingestAbortRef.current = abort;
    sendingRef.current = true;
    try {
      const res = await fetch('/api/translation/ingest/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: abort.signal,
        body: JSON.stringify({ pcmBase64, sampleRate: TARGET_SAMPLE_RATE }),
      });
      if (!capturingRef.current) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message || 'Failed to send audio chunk');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!capturingRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to send audio chunk');
    } finally {
      if (ingestAbortRef.current === abort) ingestAbortRef.current = null;
      sendingRef.current = false;
    }
  }

  async function startCapture() {
    setError(null);
    if (!enabled) {
      setError('Configure OpenRouter key and models before adding audio.');
      return;
    }
    try {
      // Avoid forcing channelCount:1 — some devices go silent under that constraint.
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (deviceId && deviceId !== 'default') {
        audioConstraints.deviceId = { exact: deviceId };
      } else if (deviceId === 'default') {
        audioConstraints.deviceId = { ideal: 'default' };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;

      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextCtor();
      contextRef.current = context;
      if (context.state === 'suspended') {
        await context.resume();
      }
      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessor must be connected to context.destination or Chromium may never
      // fire onaudioprocess (MediaStreamDestination-only graphs are unreliable).
      const inputChannels = Math.min(
        2,
        Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1)
      );
      const processor = context.createScriptProcessor(4096, inputChannels, 1);
      processorRef.current = processor;
      const samplesPerChunk = Math.floor((TARGET_SAMPLE_RATE * chunkMsRef.current) / 1000);

      const monitorGain = context.createGain();
      monitorGain.gain.value = MONITOR_GAIN;
      monitorGainRef.current = monitorGain;

      processor.onaudioprocess = (event) => {
        // Stop can race ScriptProcessor callbacks; ignore anything after tear-down starts.
        if (!capturingRef.current) return;

        const mono = monoFromProcessorEvent(event);
        const framePeak = peakAbs(mono);
        const next =
          framePeak > levelRef.current ? framePeak : levelRef.current * 0.85 + framePeak * 0.15;
        levelRef.current = next;
        setLevel(next);

        pcmChunksRef.current.push(mono);
        samplesCollectedRef.current += Math.floor(
          mono.length * (TARGET_SAMPLE_RATE / context.sampleRate)
        );
        if (samplesCollectedRef.current >= samplesPerChunk) {
          void flushPcm();
        }
      };

      source.connect(processor);
      processor.connect(monitorGain);
      monitorGain.connect(context.destination);
      capturingRef.current = true;
      setCapturing(true);
      onLiveChangeRef.current?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start audio capture');
    }
  }

  async function stopCapture() {
    // Flip this first so in-flight onaudioprocess / flushPcm bail out immediately.
    capturingRef.current = false;
    pcmChunksRef.current = [];
    samplesCollectedRef.current = 0;
    ingestAbortRef.current?.abort();
    ingestAbortRef.current = null;

    const processor = processorRef.current;
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // already disconnected
      }
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      // already disconnected
    }
    try {
      monitorGainRef.current?.disconnect();
    } catch {
      // already disconnected
    }
    processorRef.current = null;
    sourceRef.current = null;
    monitorGainRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    levelRef.current = 0;
    setCapturing(false);
    setLevel(0);
    onLiveChangeRef.current?.(false);

    try {
      await fetch('/api/translation/ingest/audio', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
  }

  // Sqrt scale so quiet speech still moves the bar visibly.
  const meterPercent = Math.min(100, Math.round(Math.sqrt(Math.max(0, level)) * 100));
  /** Radix Select sentinel so empty selection stays controlled. */
  const deviceUnset = '__unset__';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="translation-audio-device">Audio input</Label>
        <Select
          value={deviceId || deviceUnset}
          disabled={capturing || devices.length === 0}
          onValueChange={(next) => {
            if (next === deviceUnset) return;
            setDeviceId(next);
          }}
        >
          <SelectTrigger id="translation-audio-device">
            <SelectValue placeholder={devices.length === 0 ? 'No devices found' : 'Select input'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={deviceUnset}>
              {devices.length === 0 ? 'No devices found' : 'Select input'}
            </SelectItem>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Starts on your system default. Quiet/cutoff chunks are skipped so Whisper does not invent
          filler like &quot;Thank you&quot;. If captions are still wrong, switch to the named mic
          that matches your hardware.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="bg-muted h-3 w-48 overflow-hidden rounded"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterPercent}
        >
          <div
            className="bg-primary h-full transition-[width] duration-75"
            style={{ width: `${meterPercent}%` }}
          />
        </div>
        {capturing ? (
          <Button type="button" variant="destructive" onClick={() => void stopCapture()}>
            Stop audio
          </Button>
        ) : (
          <Button type="button" disabled={!enabled} onClick={() => void startCapture()}>
            Add audio
          </Button>
        )}
      </div>
      {capturing ? (
        <p className="text-muted-foreground text-xs">
          Input level — speak and this bar should move. If it stays flat, pick another mic.
        </p>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {!enabled ? (
        <p className="text-muted-foreground text-sm">
          Translation stays off until you configure streaming ASR (or Groq) and caption translation
          in Configure AI.
        </p>
      ) : null}
    </div>
  );
}
