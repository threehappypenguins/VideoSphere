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
import {
  TRANSLATION_INGEST_INTENT_KEY,
  TRANSLATION_PREFERRED_AUDIO_INPUT_KEY,
} from '@/lib/translation/dev-session-flags';

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

type IngestIntent = {
  /** Selected audio input device id. */
  deviceId: string;
};

/**
 * Reads persisted ingest intent from sessionStorage.
 * @returns Intent when the owner had live ingest before a remount, otherwise null.
 */
function readIngestIntent(): IngestIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TRANSLATION_INGEST_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IngestIntent>;
    if (typeof parsed.deviceId !== 'string' || !parsed.deviceId) return null;
    return { deviceId: parsed.deviceId };
  } catch {
    return null;
  }
}

/**
 * Persists that the owner wants ingest kept alive across remounts.
 * @param deviceId - Active input device id.
 */
function writeIngestIntent(deviceId: string): void {
  if (typeof window === 'undefined') return;
  if (!deviceId) return;
  try {
    sessionStorage.setItem(TRANSLATION_INGEST_INTENT_KEY, JSON.stringify({ deviceId }));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Clears persisted ingest intent (explicit Stop audio).
 */
function clearIngestIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(TRANSLATION_INGEST_INTENT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Reads the last selected audio input from localStorage.
 * @returns Device id when previously chosen, otherwise null.
 */
function readPreferredAudioInputId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = localStorage.getItem(TRANSLATION_PREFERRED_AUDIO_INPUT_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

/**
 * Persists the last selected audio input across browser sessions.
 * @param deviceId - Chosen input device id.
 */
function writePreferredAudioInputId(deviceId: string): void {
  if (typeof window === 'undefined') return;
  if (!deviceId) return;
  try {
    localStorage.setItem(TRANSLATION_PREFERRED_AUDIO_INPUT_KEY, deviceId);
  } catch {
    // ignore quota / private mode
  }
}

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
 * Picks the audio input to use for this session.
 * Order: keep current (when asked) → live-ingest intent → last selected → system default.
 * @param inputs - Enumerated audioinput devices.
 * @param options - Preference sources.
 * @param options.preferExisting - Keep the currently selected device when still present.
 * @param options.currentDeviceId - Current React/device ref id.
 * @param options.intentDeviceId - Device from remount ingest intent, if any.
 * @returns Device id to select, or empty string when no inputs exist.
 */
function resolveAudioInputId(
  inputs: MediaDeviceInfo[],
  options: {
    preferExisting: boolean;
    currentDeviceId: string;
    intentDeviceId?: string | null;
  }
): string {
  const candidates = [
    options.preferExisting ? options.currentDeviceId : '',
    options.intentDeviceId ?? '',
    readPreferredAudioInputId() ?? '',
  ].filter(Boolean);

  for (const id of candidates) {
    if (inputs.some((d) => d.deviceId === id)) return id;
  }
  return preferSystemDefaultInputId(inputs);
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
 * Builds getUserMedia audio constraints for a selected device id.
 * @param selectedDeviceId - Enumerated deviceId (may be `default`).
 * @returns MediaTrackConstraints for the mic.
 */
function audioConstraintsForDevice(selectedDeviceId: string): MediaTrackConstraints {
  // Avoid forcing channelCount:1 — some devices go silent under that constraint.
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (selectedDeviceId && selectedDeviceId !== 'default') {
    audioConstraints.deviceId = { exact: selectedDeviceId };
  } else if (selectedDeviceId === 'default') {
    audioConstraints.deviceId = { ideal: 'default' };
  }
  return audioConstraints;
}

/**
 * Browser microphone / input-device capture that streams PCM chunks to the owner ingest API.
 * The mic MediaStream stays closed by default (no tab recording light). Use **Test mic** for
 * level checks without ingest, or **Add audio** to stream. Device switching works idle, in
 * test mode, or while live.
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
  const [deviceId, setDeviceId] = useState<string>(
    () => readIngestIntent()?.deviceId ?? readPreferredAudioInputId() ?? ''
  );
  const [ingesting, setIngesting] = useState(() => Boolean(readIngestIntent()));
  /** Level-only mic check — no PCM upload. */
  const [testingMic, setTestingMic] = useState(false);
  /** True while the mic MediaStream is open (test mode or ingest). */
  const [micLive, setMicLive] = useState(false);
  const [switchingDevice, setSwitchingDevice] = useState(false);
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
  /** Mic graph is open for metering (and possibly ingest). */
  const micOpenRef = useRef(false);
  /** When true, PCM frames are uploaded to the ingest API. */
  const ingestingRef = useRef(Boolean(readIngestIntent()));
  /** When true, mic is open for level test only. */
  const testingMicRef = useRef(false);
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const ingestAbortRef = useRef<AbortController | null>(null);
  const openGenerationRef = useRef(0);
  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const startIngestRef = useRef<() => Promise<void>>(async () => undefined);

  /**
   * Tears down the Web Audio graph and MediaStream without ending the server ingest session.
   * @param options - Optional flags.
   * @param options.silent - Skip React state updates (unmount cleanup).
   * @returns Void.
   */
  async function closeMicGraph(options?: { silent?: boolean }): Promise<void> {
    micOpenRef.current = false;
    pcmChunksRef.current = [];
    samplesCollectedRef.current = 0;

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
    if (!options?.silent) {
      setLevel(0);
      setMicLive(false);
    }
  }

  /**
   * Opens (or reopens) the selected mic for level metering and optional ingest.
   * @param selectedDeviceId - Device to open.
   * @returns Void.
   */
  async function openMic(selectedDeviceId: string): Promise<void> {
    if (!selectedDeviceId) return;
    const generation = ++openGenerationRef.current;
    await closeMicGraph();
    if (generation !== openGenerationRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraintsForDevice(selectedDeviceId),
    });
    if (generation !== openGenerationRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextCtor();
    contextRef.current = context;
    if (context.state === 'suspended') {
      await context.resume();
    }
    if (generation !== openGenerationRef.current) {
      await closeMicGraph();
      return;
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
    const samplesPerChunk = () => Math.floor((TARGET_SAMPLE_RATE * chunkMsRef.current) / 1000);

    const monitorGain = context.createGain();
    monitorGain.gain.value = MONITOR_GAIN;
    monitorGainRef.current = monitorGain;

    processor.onaudioprocess = (event) => {
      if (!micOpenRef.current) return;

      const mono = monoFromProcessorEvent(event);
      const framePeak = peakAbs(mono);
      const next =
        framePeak > levelRef.current ? framePeak : levelRef.current * 0.85 + framePeak * 0.15;
      levelRef.current = next;
      setLevel(next);

      if (!ingestingRef.current) return;

      pcmChunksRef.current.push(mono);
      samplesCollectedRef.current += Math.floor(
        mono.length * (TARGET_SAMPLE_RATE / context.sampleRate)
      );
      if (samplesCollectedRef.current >= samplesPerChunk()) {
        void flushPcm();
      }
    };

    source.connect(processor);
    processor.connect(monitorGain);
    monitorGain.connect(context.destination);
    micOpenRef.current = true;
    setMicLive(true);
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshDevices(preferExisting: boolean): Promise<string> {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return '';
        const inputs = list.filter((d) => d.kind === 'audioinput');
        setDevices(inputs);
        const nextId = resolveAudioInputId(inputs, {
          preferExisting,
          currentDeviceId: deviceIdRef.current,
          intentDeviceId: readIngestIntent()?.deviceId,
        });
        setDeviceId(nextId);
        if (nextId) {
          writePreferredAudioInputId(nextId);
          // Keep the mic closed unless test mode or ingest is already live.
          if (ingestingRef.current || testingMicRef.current) {
            await openMic(nextId);
          }
          if (!cancelled) setError(null);
        }
        return nextId;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not access audio devices');
        }
        return '';
      }
    }

    async function bootstrap() {
      try {
        // Permission prompt so device labels populate, then release tracks immediately.
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        if (cancelled) return;
        const nextId = await refreshDevices(true);
        // Survive dashboard remounts (common in next dev when /listen SSE first compiles).
        if (!cancelled && nextId && readIngestIntent() && enabledRef.current) {
          await startIngestRef.current();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not access audio devices');
        }
      }
    }

    void bootstrap();

    const onDeviceChange = () => {
      void refreshDevices(true);
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      openGenerationRef.current += 1;
      // Close the mic graph only — do NOT DELETE ingest or clear sessionStorage.
      // React remounts (HMR / dashboard reload) must be able to auto-resume.
      ingestingRef.current = false;
      testingMicRef.current = false;
      ingestAbortRef.current?.abort();
      void closeMicGraph({ silent: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount bootstrap only
  }, []);

  /**
   * Sends buffered PCM to the ingest API when ingest is still live.
   * @returns Void.
   */
  async function flushPcm() {
    if (!ingestingRef.current) return;
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
      if (!ingestingRef.current) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message || 'Failed to send audio chunk');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!ingestingRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to send audio chunk');
    } finally {
      if (ingestAbortRef.current === abort) ingestAbortRef.current = null;
      sendingRef.current = false;
    }
  }

  /**
   * Opens the mic for level metering only — does not upload PCM or start a session.
   * @returns Void.
   */
  async function startMicTest() {
    setError(null);
    if (!deviceIdRef.current) {
      setError('Select an audio input first.');
      return;
    }
    try {
      testingMicRef.current = true;
      await openMic(deviceIdRef.current);
      if (!micOpenRef.current) {
        testingMicRef.current = false;
        return;
      }
      writePreferredAudioInputId(deviceIdRef.current);
      setTestingMic(true);
    } catch (err) {
      testingMicRef.current = false;
      setTestingMic(false);
      setError(err instanceof Error ? err.message : 'Could not open microphone');
    }
  }

  /**
   * Ends mic test mode and releases the MediaStream.
   * @returns Void.
   */
  async function stopMicTest() {
    if (ingestingRef.current) return;
    testingMicRef.current = false;
    setTestingMic(false);
    await closeMicGraph();
  }

  /**
   * Starts uploading live PCM to the translation ingest API.
   * @returns Void.
   */
  async function startIngest() {
    setError(null);
    if (!enabledRef.current) {
      setError('Configure AI providers before adding audio.');
      return;
    }
    try {
      if (!micOpenRef.current) {
        await openMic(deviceIdRef.current);
      }
      pcmChunksRef.current = [];
      samplesCollectedRef.current = 0;
      testingMicRef.current = false;
      setTestingMic(false);
      ingestingRef.current = true;
      writeIngestIntent(deviceIdRef.current);
      writePreferredAudioInputId(deviceIdRef.current);
      setIngesting(true);
      onLiveChangeRef.current?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start audio capture');
    }
  }
  startIngestRef.current = startIngest;

  /**
   * Stops uploading PCM and releases the mic (clears the browser tab recording indicator).
   * @returns Void.
   */
  async function stopIngest() {
    ingestingRef.current = false;
    testingMicRef.current = false;
    clearIngestIntent();
    pcmChunksRef.current = [];
    samplesCollectedRef.current = 0;
    ingestAbortRef.current?.abort();
    ingestAbortRef.current = null;
    setIngesting(false);
    onLiveChangeRef.current?.(false);
    await closeMicGraph();

    try {
      await fetch('/api/translation/ingest/audio', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
  }

  /**
   * Switches the active input device, reopening the mic when test mode or ingest is live.
   * @param nextDeviceId - Newly selected device id.
   * @returns Void.
   */
  async function changeDevice(nextDeviceId: string) {
    if (!nextDeviceId || nextDeviceId === deviceIdRef.current) return;
    setDeviceId(nextDeviceId);
    writePreferredAudioInputId(nextDeviceId);
    if (!ingestingRef.current && !testingMicRef.current) {
      return;
    }
    setSwitchingDevice(true);
    setError(null);
    try {
      await openMic(nextDeviceId);
      if (ingestingRef.current) {
        writeIngestIntent(nextDeviceId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch audio input');
    } finally {
      setSwitchingDevice(false);
    }
  }

  // Sqrt scale so quiet speech still moves the bar visibly.
  const meterPercent = Math.min(100, Math.round(Math.sqrt(Math.max(0, level)) * 100));
  /** Radix Select sentinel so empty selection stays controlled. */
  const deviceUnset = '__unset__';
  const meterLooksLive = micLive && meterPercent > 2;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="translation-audio-device">Audio input</Label>
        <Select
          value={deviceId || deviceUnset}
          disabled={devices.length === 0 || switchingDevice}
          onValueChange={(next) => {
            if (next === deviceUnset) return;
            void changeDevice(next);
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
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1.5">
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
          <p className="text-muted-foreground min-h-4 text-xs tabular-nums" aria-live="polite">
            {switchingDevice
              ? 'Switching…'
              : micLive
                ? meterLooksLive
                  ? 'Hearing input'
                  : 'Silent — speak or pick another mic'
                : 'Mic idle'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ingesting ? (
            <>
              <Button type="button" variant="destructive" onClick={() => void stopIngest()}>
                Stop audio
              </Button>
              <span
                className="text-destructive inline-flex items-center gap-1.5 text-xs font-medium"
                aria-live="polite"
              >
                <span
                  className="bg-destructive size-2 animate-pulse rounded-full"
                  aria-hidden="true"
                />
                Live
              </span>
            </>
          ) : (
            <Button
              type="button"
              disabled={!enabled || !deviceId || switchingDevice}
              onClick={() => void startIngest()}
            >
              Add audio
            </Button>
          )}
          {ingesting ? null : testingMic ? (
            <Button type="button" variant="outline" onClick={() => void stopMicTest()}>
              Stop test
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={!deviceId || switchingDevice}
              onClick={() => void startMicTest()}
            >
              Test mic
            </Button>
          )}
        </div>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {!enabled ? (
        <p className="text-muted-foreground text-sm">
          Translation stays off until you configure streaming ASR (or Groq) and caption translation
          in Configure AI. You can still use Test mic to verify an input.
        </p>
      ) : null}
    </div>
  );
}
