'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  LiveTranslationChannelOwnerView,
  LiveTranslationSttProvider,
  LiveTranslationTextTranslateProvider,
} from '@/types';
import { AddAudioCapture } from '@/components/translation/AddAudioCapture';
import { TranslationLanguageSearchList } from '@/components/translation/TranslationLanguageSearchList';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  TRANSLATION_LANGUAGES,
  compareTranslationLanguageOptions,
  normalizeTranslationLanguageCode,
  resolveTranslationLanguageOption,
} from '@/lib/translation/languages';
import {
  GCP_TTS_PRICING_URL,
  classifyGcpTtsVoiceFamily,
  gcpTtsVoiceFamiliesInCatalog,
  gcpTtsVoiceFamilyInfo,
  inferGcpTtsVoiceFamily,
  type GcpTtsVoiceFamilyId,
} from '@/lib/translation/gcp-tts-voice-families';
import {
  formatGcpTtsVoiceOptionLabel,
  gcpVoiceMatchesListenLanguage,
  languagesForTtsConfig,
} from '@/lib/translation/gcp-tts-voices';
import {
  GROQ_RATE_LIMITS_URL,
  STT_PROVIDER_PRICING,
  sttProviderPricing,
  translateProviderPricing,
} from '@/lib/translation/provider-pricing';
import { sttProvidesBuiltInTranslation } from '@/lib/translation/capabilities';

/** Radix Select sentinel so empty selection stays controlled (not `undefined`). */
const SELECT_UNSET = '__unset__';

/** Streaming / dedicated STT credential kinds that require remove confirmation. */
type SttCredentialKind =
  | 'deepgram'
  | 'assemblyai'
  | 'gladia'
  | 'speechmatics'
  | 'soniox'
  | 'modulate'
  | 'elevenlabs';

const STT_CREDENTIAL_LABELS: Record<SttCredentialKind, string> = {
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
  gladia: 'Gladia',
  speechmatics: 'Speechmatics',
  soniox: 'Soniox',
  modulate: 'Modulate',
  elevenlabs: 'ElevenLabs',
};

/**
 * In-flight translation config action.
 * Only the control(s) for that action should disable while it runs.
 */
type TranslationConfigPendingAction =
  | 'save-ai'
  | 'save-gcp'
  | 'save-languages'
  | 'save-public'
  | 'delete-channel'
  | 'rotate-stream-key'
  | 'delete-stream-key'
  | 'clear-openrouter'
  | 'clear-groq'
  | 'clear-gcp'
  | 'clear-deepgram'
  | 'clear-assemblyai'
  | 'clear-gladia'
  | 'clear-speechmatics'
  | 'clear-soniox'
  | 'clear-modulate'
  | 'clear-elevenlabs';

type GcpVoiceOption = {
  name: string;
  languageCodes: string[];
  ssmlGender?: 'male' | 'female' | 'neutral' | null;
};

/**
 * Owner dashboard UI for per-user live audio translation configuration and ingest.
 * Progressive disclosure: separate STT + caption-translate providers (with free-tier hints),
 * then optional GCP TTS, public page, audio, and RTMP.
 * @returns Translation settings page content.
 */
export function TranslationConfigClient() {
  const [channel, setChannel] = useState<LiveTranslationChannelOwnerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<TranslationConfigPendingAction | null>(null);

  const [slug, setSlug] = useState('');
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [enabledLanguages, setEnabledLanguages] = useState<string[]>([]);
  const [streamKeyPlaintext, setStreamKeyPlaintext] = useState<string | null>(null);
  const [showStreamKey, setShowStreamKey] = useState(false);
  /** True after Generate/Rotate in this session so the key starts revealed. */
  const streamKeyRevealOnApplyRef = useRef(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [gcpOpen, setGcpOpen] = useState(false);
  /** STT provider key pending remove confirmation (null when dialog closed). */
  const [sttRemoveKind, setSttRemoveKind] = useState<SttCredentialKind | null>(null);

  const [sttProvider, setSttProvider] = useState<LiveTranslationSttProvider | ''>('');
  const [textTranslateProvider, setTextTranslateProvider] = useState<
    LiveTranslationTextTranslateProvider | ''
  >('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [groqKey, setGroqKey] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [deepgramKey, setDeepgramKey] = useState('');
  const [showDeepgramKey, setShowDeepgramKey] = useState(false);
  const [assemblyaiKey, setAssemblyaiKey] = useState('');
  const [showAssemblyaiKey, setShowAssemblyaiKey] = useState(false);
  const [gladiaKey, setGladiaKey] = useState('');
  const [showGladiaKey, setShowGladiaKey] = useState(false);
  const [speechmaticsKey, setSpeechmaticsKey] = useState('');
  const [showSpeechmaticsKey, setShowSpeechmaticsKey] = useState(false);
  const [sonioxKey, setSonioxKey] = useState('');
  const [showSonioxKey, setShowSonioxKey] = useState(false);
  const [modulateKey, setModulateKey] = useState('');
  const [showModulateKey, setShowModulateKey] = useState(false);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [aiGcpJson, setAiGcpJson] = useState('');
  const [aiGcpJsonFileName, setAiGcpJsonFileName] = useState<string | null>(null);
  const [sttModel, setSttModel] = useState('');
  const [translateModel, setTranslateModel] = useState('');

  const [gcpJson, setGcpJson] = useState('');
  const [gcpJsonFileName, setGcpJsonFileName] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<Record<string, string>>({});
  const [gcpVoiceOptions, setGcpVoiceOptions] = useState<GcpVoiceOption[]>([]);
  const [ttsVoiceFamily, setTtsVoiceFamily] = useState<GcpTtsVoiceFamilyId | ''>('');
  const [loadingGcpVoices, setLoadingGcpVoices] = useState(false);
  const [previewingVoiceLang, setPreviewingVoiceLang] = useState<string | null>(null);
  const aiGcpJsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const gcpJsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  /** Field id → error message (client blank checks and server validation). */
  const [aiFieldErrors, setAiFieldErrors] = useState<Record<string, string>>({});
  const [gcpFieldErrors, setGcpFieldErrors] = useState<Record<string, string>>({});

  const publicUrl = useMemo(() => {
    if (!channel?.slug) return '';
    if (typeof window === 'undefined') return `/listen/${channel.slug}`;
    return `${window.location.origin}/listen/${channel.slug}`;
  }, [channel?.slug]);

  const applyChannel = useCallback((view: LiveTranslationChannelOwnerView) => {
    setChannel(view);
    setSlug(view.slug);
    setPublicEnabled(view.publicEnabled);
    setSourceLanguage(normalizeTranslationLanguageCode(view.sourceLanguage || 'en') || 'en');
    setEnabledLanguages(
      [...new Set((view.enabledLanguages ?? []).map(normalizeTranslationLanguageCode))].filter(
        Boolean
      )
    );
    setSttProvider(view.sttProvider ?? '');
    setTextTranslateProvider(view.textTranslateProvider ?? '');
    setSttModel(view.sttModel ?? view.openRouterSttModel ?? '');
    setTranslateModel(view.openRouterTranslateModel ?? '');
    setTtsVoices(view.gcpTtsVoices ?? {});
    setStreamKeyPlaintext(view.streamKeyPlaintext ?? null);
    if (streamKeyRevealOnApplyRef.current) {
      setShowStreamKey(Boolean(view.streamKeyPlaintext));
      streamKeyRevealOnApplyRef.current = false;
    } else {
      setShowStreamKey(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/translation/channel', { credentials: 'include' });
        if (res.status === 404) {
          if (!cancelled) setChannel(null);
          return;
        }
        if (!res.ok) throw new Error('Failed to load translation channel');
        const data = (await res.json()) as LiveTranslationChannelOwnerView;
        if (!cancelled) applyChannel(data);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [applyChannel]);

  function clearAiFieldError(field: string) {
    setAiFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  /**
   * Loads a service-account JSON file into the AI modal paste field.
   * @param file - Selected `.json` file from the file picker.
   */
  function loadAiGcpJsonFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const trimmed = text.trim();
      if (!trimmed) {
        setAiFieldErrors((prev) => ({
          ...prev,
          gcpJson: 'The selected file was empty.',
        }));
        return;
      }
      try {
        JSON.parse(trimmed);
      } catch {
        setAiFieldErrors((prev) => ({
          ...prev,
          gcpJson: 'The selected file is not valid JSON.',
        }));
        return;
      }
      setAiGcpJson(trimmed);
      setAiGcpJsonFileName(file.name);
      clearAiFieldError('gcpJson');
      toast.success(`Loaded ${file.name}`);
    };
    reader.onerror = () => {
      setAiFieldErrors((prev) => ({
        ...prev,
        gcpJson: 'Could not read the selected file.',
      }));
    };
    reader.readAsText(file);
  }

  /**
   * Renders the AI-modal GCP service-account upload + paste fields.
   * @param opts - Field ids and helper copy for STT vs translate.
   * @returns Form fields matching the TTS modal upload pattern.
   */
  function renderAiGcpJsonFields(opts: {
    fileInputId: string;
    textareaId: string;
    helpText: string;
  }) {
    return (
      <div className="space-y-2">
        <Label htmlFor={opts.fileInputId}>Service account JSON file</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={aiGcpJsonFileInputRef}
            id={opts.fileInputId}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              loadAiGcpJsonFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={pendingAction === 'save-ai'}
            onClick={() => aiGcpJsonFileInputRef.current?.click()}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Choose file
          </button>
          <span className="text-muted-foreground max-w-full truncate text-xs">
            {aiGcpJsonFileName ?? 'No file selected'}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          Choose the JSON key downloaded from Google Cloud, or paste it below.
        </p>
        <Label htmlFor={opts.textareaId}>Google Cloud service account JSON</Label>
        <Textarea
          id={opts.textareaId}
          rows={5}
          aria-invalid={aiFieldErrors.gcpJson ? true : undefined}
          className={invalidInputClass(Boolean(aiFieldErrors.gcpJson), 'font-mono text-xs')}
          placeholder='{ "type": "service_account", ... }'
          value={aiGcpJson}
          onChange={(e) => {
            setAiGcpJson(e.target.value);
            setAiGcpJsonFileName(null);
            clearAiFieldError('gcpJson');
          }}
        />
        {aiFieldErrors.gcpJson ? (
          <p className="text-destructive text-xs" role="alert">
            {aiFieldErrors.gcpJson}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{opts.helpText}</p>
        )}
      </div>
    );
  }

  function clearGcpFieldError(field: string) {
    setGcpFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  /**
   * Applies destructive border styling when a field failed validation.
   * @param hasError - Whether the field should show an error state.
   * @param extra - Optional extra class names.
   * @returns Combined className string.
   */
  function invalidInputClass(hasError: boolean, extra?: string): string {
    return [extra, hasError ? 'border-destructive focus-visible:ring-destructive' : undefined]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Maps an API validation error onto highlighted form fields.
   * @param fields - Field ids returned by the API.
   * @param message - User-facing error message.
   * @returns Field → message map.
   */
  function fieldErrorsFromApi(
    fields: string[] | undefined,
    message: string
  ): Record<string, string> {
    if (!fields?.length) return {};
    const next: Record<string, string> = {};
    for (const field of fields) {
      next[field] = message;
    }
    return next;
  }

  function openAiModal() {
    setOpenRouterKey('');
    setShowOpenRouterKey(false);
    setGroqKey('');
    setShowGroqKey(false);
    setDeepgramKey('');
    setShowDeepgramKey(false);
    setAssemblyaiKey('');
    setShowAssemblyaiKey(false);
    setGladiaKey('');
    setShowGladiaKey(false);
    setSpeechmaticsKey('');
    setShowSpeechmaticsKey(false);
    setSonioxKey('');
    setShowSonioxKey(false);
    setModulateKey('');
    setShowModulateKey(false);
    setElevenLabsKey('');
    setShowElevenLabsKey(false);
    setAiGcpJson('');
    setAiGcpJsonFileName(null);
    setSttProvider(channel?.sttProvider ?? '');
    setTextTranslateProvider(channel?.textTranslateProvider ?? '');
    setSttModel(channel?.sttModel ?? channel?.openRouterSttModel ?? '');
    setTranslateModel(channel?.openRouterTranslateModel ?? '');
    setAiFieldErrors({});
    setAiOpen(true);
  }

  function openGcpModal() {
    setGcpJson('');
    setGcpJsonFileName(null);
    const existing = channel?.gcpTtsVoices ?? {};
    setTtsVoices(existing);
    setGcpVoiceOptions([]);
    setTtsVoiceFamily(inferGcpTtsVoiceFamily(Object.values(existing)) ?? '');
    setGcpFieldErrors({});
    stopVoicePreview();
    setPreviewingVoiceLang(null);
    setGcpOpen(true);
  }

  /**
   * Voices for a listen language, optionally restricted to the selected model family.
   * @param lang - ISO language code.
   * @param voices - Full catalog from GCP.
   * @param family - Selected model family, or empty for language-only filter.
   * @returns Matching voice options.
   */
  function voiceOptionsForLanguage(
    lang: string,
    voices: GcpVoiceOption[],
    family: GcpTtsVoiceFamilyId | ''
  ): GcpVoiceOption[] {
    return voices.filter((voice) => {
      if (!gcpVoiceMatchesListenLanguage(voice, lang)) return false;
      if (!family) return true;
      return classifyGcpTtsVoiceFamily(voice.name) === family;
    });
  }

  function applyLoadedVoices(voices: GcpVoiceOption[], preferredVoices?: Record<string, string>) {
    setGcpVoiceOptions(voices);
    const families = gcpTtsVoiceFamiliesInCatalog(voices.map((v) => v.name));
    const configured = preferredVoices ?? ttsVoices;
    const inferred = inferGcpTtsVoiceFamily(Object.values(configured));
    // Prefer the family already configured; otherwise require an explicit model choice.
    const nextFamily = inferred && families.some((f) => f.id === inferred) ? inferred : '';
    setTtsVoiceFamily(nextFamily);
    if (nextFamily) {
      const kept: Record<string, string> = {};
      for (const [lang, voice] of Object.entries(configured)) {
        if (classifyGcpTtsVoiceFamily(voice) === nextFamily) kept[lang] = voice;
      }
      setTtsVoices(kept);
    } else {
      // Keep configured voices until the admin picks a model (then they are filtered).
      setTtsVoices(configured);
    }
  }

  function stopVoicePreview() {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }

  function onTtsVoiceFamilyChange(next: GcpTtsVoiceFamilyId | '') {
    setTtsVoiceFamily(next);
    stopVoicePreview();
    setPreviewingVoiceLang(null);
    if (!next) {
      setTtsVoices({});
      return;
    }
    setTtsVoices((prev) => {
      const kept: Record<string, string> = {};
      for (const [lang, voice] of Object.entries(prev)) {
        if (classifyGcpTtsVoiceFamily(voice) === next) kept[lang] = voice;
      }
      return kept;
    });
  }

  async function previewGcpVoice(lang: string, voiceName: string) {
    const voice = voiceName.trim();
    if (!voice) {
      toast.error('Select a voice to preview');
      return;
    }
    const json = gcpJson.trim();
    if (!channel?.hasGcpServiceAccount && !json) {
      setGcpFieldErrors((prev) => ({
        ...prev,
        gcpJson: 'Upload or paste your Google Cloud service account JSON.',
      }));
      toast.error('Upload or paste service account JSON first');
      return;
    }

    stopVoicePreview();
    setPreviewingVoiceLang(lang);
    try {
      const body: Record<string, string> = { voiceName: voice, language: lang };
      if (json) body.gcpServiceAccountJson = json;

      const res = await fetch('/api/translation/gcp-voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          fields?: string[];
        };
        const message = data.message || 'Failed to preview voice';
        const fromApi = fieldErrorsFromApi(data.fields, message);
        if (Object.keys(fromApi).length > 0) {
          setGcpFieldErrors((prev) => ({ ...prev, ...fromApi }));
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      previewObjectUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        stopVoicePreview();
      };
      await audio.play();
    } catch (error) {
      stopVoicePreview();
      toast.error(error instanceof Error ? error.message : 'Failed to preview voice');
    } finally {
      setPreviewingVoiceLang(null);
    }
  }

  async function loadGcpVoices(jsonOverride?: string) {
    const json = (jsonOverride ?? gcpJson).trim();
    if (!channel?.hasGcpServiceAccount && !json) {
      setGcpFieldErrors((prev) => ({
        ...prev,
        gcpJson: 'Upload or paste your Google Cloud service account JSON.',
      }));
      toast.error('Upload or paste service account JSON first');
      return;
    }

    setLoadingGcpVoices(true);
    try {
      const body: Record<string, string> = {};
      if (json) body.gcpServiceAccountJson = json;

      const res = await fetch('/api/translation/gcp-voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        voices?: GcpVoiceOption[];
        message?: string;
        fields?: string[];
      };
      if (!res.ok) {
        const message = data.message || 'Failed to load GCP voices';
        const fromApi = fieldErrorsFromApi(data.fields, message);
        if (Object.keys(fromApi).length > 0) {
          setGcpFieldErrors((prev) => ({ ...prev, ...fromApi }));
        }
        throw new Error(message);
      }
      applyLoadedVoices(
        data.voices ?? [],
        Object.keys(ttsVoices).length > 0 ? ttsVoices : (channel?.gcpTtsVoices ?? {})
      );
      clearGcpFieldError('gcpJson');
      toast.success('Voices loaded — choose a model, then a voice per language');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load voices');
    } finally {
      setLoadingGcpVoices(false);
    }
  }

  async function saveAiModal() {
    const orKey = openRouterKey.trim();
    const gKey = groqKey.trim();
    const dgKey = deepgramKey.trim();
    const aaiKey = assemblyaiKey.trim();
    const gladiaKeyTrimmed = gladiaKey.trim();
    const smKey = speechmaticsKey.trim();
    const sonioxKeyTrimmed = sonioxKey.trim();
    const modulateKeyTrimmed = modulateKey.trim();
    const elevenLabsKeyTrimmed = elevenLabsKey.trim();
    const gcpJsonTrimmed = aiGcpJson.trim();
    const stt = sttModel.trim();
    const translate = translateModel.trim();
    const sonioxStt = sttProvider === 'soniox';
    const needsOpenRouter = !sonioxStt && textTranslateProvider === 'openrouter';
    const needsGroq = sttProvider === 'groq' || (!sonioxStt && textTranslateProvider === 'groq');
    const needsGcp = !sonioxStt && textTranslateProvider === 'gcp';
    const hasGcp = Boolean(channel?.hasGcpServiceAccount || gcpJsonTrimmed);

    const errors: Record<string, string> = {};
    if (!sttProvider) {
      errors.sttProvider = 'Select an STT provider.';
    }
    if (!sonioxStt && !textTranslateProvider) {
      errors.textTranslateProvider = 'Select a caption translation provider.';
    }
    if (needsOpenRouter && !channel?.hasOpenRouterKey && !orKey) {
      errors.openRouterKey = 'Paste your OpenRouter API key.';
    }
    if (needsGroq && !channel?.hasGroqKey && !gKey) {
      errors.groqKey = 'Paste your Groq API key.';
    }
    if (sttProvider === 'deepgram' && !channel?.hasDeepgramKey && !dgKey) {
      errors.deepgramKey = 'Paste your Deepgram API key.';
    }
    if (sttProvider === 'assemblyai' && !channel?.hasAssemblyaiKey && !aaiKey) {
      errors.assemblyaiKey = 'Paste your AssemblyAI API key.';
    }
    if (sttProvider === 'gladia' && !channel?.hasGladiaKey && !gladiaKeyTrimmed) {
      errors.gladiaKey = 'Paste your Gladia API key.';
    }
    if (sttProvider === 'speechmatics' && !channel?.hasSpeechmaticsKey && !smKey) {
      errors.speechmaticsKey = 'Paste your Speechmatics API key.';
    }
    if (sttProvider === 'soniox' && !channel?.hasSonioxKey && !sonioxKeyTrimmed) {
      errors.sonioxKey = 'Paste your Soniox API key.';
    }
    if (sttProvider === 'modulate' && !channel?.hasModulateKey && !modulateKeyTrimmed) {
      errors.modulateKey = 'Paste your Modulate API key.';
    }
    if (sttProvider === 'elevenlabs' && !channel?.hasElevenLabsKey && !elevenLabsKeyTrimmed) {
      errors.elevenLabsKey = 'Paste your ElevenLabs API key.';
    }
    if (needsGcp && !hasGcp) {
      errors.gcpJson =
        'Upload or paste a Google Cloud service account JSON, or save one under Google Cloud TTS first.';
    }
    if (sttProvider === 'groq' && !stt) {
      errors.sttModel = 'Enter a Groq Whisper model id.';
    }
    if (!sonioxStt && textTranslateProvider && textTranslateProvider !== 'gcp' && !translate) {
      errors.translateModel = 'Enter a translation model id.';
    }
    if (Object.keys(errors).length > 0) {
      setAiFieldErrors(errors);
      toast.error('Fill in the required fields highlighted in red');
      return;
    }
    setAiFieldErrors({});

    if (!sttProvider || (!sonioxStt && !textTranslateProvider)) {
      return;
    }

    setPendingAction('save-ai');
    try {
      const body: Record<string, string> = {
        sttProvider,
      };
      if (!sonioxStt && textTranslateProvider) {
        body.textTranslateProvider = textTranslateProvider;
      }
      if (sttProvider === 'groq') {
        body.sttModel = stt;
      }
      if (!sonioxStt && textTranslateProvider && textTranslateProvider !== 'gcp') {
        body.openRouterTranslateModel = translate;
      }
      if (orKey) body.openRouterApiKey = orKey;
      if (gKey && (sttProvider === 'groq' || textTranslateProvider === 'groq')) {
        body.groqApiKey = gKey;
      }
      // Only send the STT key for the selected provider — leftover inputs from a
      // previous selection must not overwrite another vendor's stored credential.
      if (sttProvider === 'deepgram' && dgKey) body.deepgramApiKey = dgKey;
      if (sttProvider === 'assemblyai' && aaiKey) body.assemblyaiApiKey = aaiKey;
      if (sttProvider === 'gladia' && gladiaKeyTrimmed) body.gladiaApiKey = gladiaKeyTrimmed;
      if (sttProvider === 'speechmatics' && smKey) body.speechmaticsApiKey = smKey;
      if (sttProvider === 'soniox' && sonioxKeyTrimmed) body.sonioxApiKey = sonioxKeyTrimmed;
      if (sttProvider === 'modulate' && modulateKeyTrimmed)
        body.modulateApiKey = modulateKeyTrimmed;
      if (sttProvider === 'elevenlabs' && elevenLabsKeyTrimmed) {
        body.elevenLabsApiKey = elevenLabsKeyTrimmed;
      }
      if (gcpJsonTrimmed) body.gcpServiceAccountJson = gcpJsonTrimmed;

      const res = await fetch('/api/translation/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
        fields?: string[];
      };
      if (!res.ok) {
        const message = data.message || 'Failed to save AI settings';
        const fromApi = fieldErrorsFromApi(data.fields, message);
        if (Object.keys(fromApi).length > 0) {
          setAiFieldErrors(fromApi);
        }
        throw new Error(message);
      }
      applyChannel(data);
      setOpenRouterKey('');
      setGroqKey('');
      setDeepgramKey('');
      setAssemblyaiKey('');
      setGladiaKey('');
      setSpeechmaticsKey('');
      setSonioxKey('');
      setModulateKey('');
      setElevenLabsKey('');
      setAiGcpJson('');
      setShowOpenRouterKey(false);
      setShowGroqKey(false);
      setShowDeepgramKey(false);
      setShowAssemblyaiKey(false);
      setShowGladiaKey(false);
      setShowSpeechmaticsKey(false);
      setShowSonioxKey(false);
      setShowModulateKey(false);
      setShowElevenLabsKey(false);
      setAiFieldErrors({});
      setAiOpen(false);
      toast.success('AI settings saved for your account only');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setPendingAction(null);
    }
  }

  async function saveGcpModal() {
    const json = gcpJson.trim();

    const voicesToSave: Record<string, string> = {};
    for (const [lang, voice] of Object.entries(ttsVoices)) {
      const trimmed = voice.trim();
      if (trimmed) voicesToSave[lang] = trimmed;
    }

    const errors: Record<string, string> = {};
    if (!channel?.hasGcpServiceAccount && !json) {
      errors.gcpJson = 'Upload or paste your Google Cloud service account JSON.';
    }
    if (gcpVoiceOptions.length > 0 && !ttsVoiceFamily) {
      errors.ttsVoice = 'Choose a voice model before selecting voices.';
    }
    if (Object.keys(voicesToSave).length === 0) {
      errors.ttsVoice = errors.ttsVoice || 'Choose a TTS voice for at least one language.';
    }
    if (Object.keys(errors).length > 0) {
      setGcpFieldErrors(errors);
      toast.error('Fill in the required fields highlighted in red');
      return;
    }
    setGcpFieldErrors({});

    setPendingAction('save-gcp');
    try {
      const body: Record<string, unknown> = { gcpTtsVoices: voicesToSave };
      if (json) body.gcpServiceAccountJson = json;

      const res = await fetch('/api/translation/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
        fields?: string[];
        language?: string;
      };
      if (!res.ok) {
        const message = data.message || 'Failed to save Google Cloud TTS settings';
        const fromApi = fieldErrorsFromApi(data.fields, message);
        if (data.language) {
          fromApi[`ttsVoice-${data.language}`] = message;
          delete fromApi.ttsVoice;
        }
        if (Object.keys(fromApi).length > 0) {
          setGcpFieldErrors(fromApi);
        }
        throw new Error(message);
      }
      applyChannel(data);
      setGcpJson('');
      setGcpJsonFileName(null);
      setGcpVoiceOptions([]);
      setTtsVoiceFamily('');
      setGcpFieldErrors({});
      setGcpOpen(false);
      toast.success('Google Cloud TTS saved for your account only');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setPendingAction(null);
    }
  }

  async function clearCredential(
    kind:
      | 'openrouter'
      | 'groq'
      | 'gcp'
      | 'deepgram'
      | 'assemblyai'
      | 'gladia'
      | 'speechmatics'
      | 'soniox'
      | 'modulate'
      | 'elevenlabs'
  ) {
    setPendingAction(`clear-${kind}`);
    try {
      const res = await fetch(`/api/translation/credentials/${kind}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || 'Failed to clear credential');
      applyChannel(data);
      if (kind !== 'gcp') {
        setAiOpen(false);
      }
      if (kind === 'gcp') {
        setGcpOpen(false);
      }
      toast.success(
        kind === 'openrouter'
          ? 'OpenRouter key removed'
          : kind === 'groq'
            ? 'Groq key removed'
            : kind === 'gcp'
              ? 'GCP credentials removed'
              : `${kind} key removed`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear');
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteChannel() {
    setPendingAction('delete-channel');
    try {
      const res = await fetch('/api/translation/channel', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as { message?: string; deleted?: boolean };
      if (!res.ok) throw new Error(data.message || 'Failed to delete channel');
      setChannel(null);
      setSlug('');
      setPublicEnabled(false);
      setSourceLanguage('en');
      setEnabledLanguages([]);
      setStreamKeyPlaintext(null);
      setSttProvider('');
      setTextTranslateProvider('');
      setSttModel('');
      setTranslateModel('');
      setTtsVoices({});
      setAiOpen(false);
      setGcpOpen(false);
      toast.success('Translation channel deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    } finally {
      setPendingAction(null);
    }
  }

  async function saveLanguagesSettings() {
    setPendingAction('save-languages');
    try {
      const targets = [...new Set(enabledLanguages.map(normalizeTranslationLanguageCode))]
        .filter(Boolean)
        .filter((code) => code !== normalizeTranslationLanguageCode(sourceLanguage));

      if (targets.length === 0) {
        toast.error('Choose at least one target language');
        return;
      }

      const res = await fetch('/api/translation/channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sourceLanguage: normalizeTranslationLanguageCode(sourceLanguage) || 'en',
          enabledLanguages: targets,
        }),
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || 'Failed to save languages');
      applyChannel(data);
      toast.success('Languages saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setPendingAction(null);
    }
  }

  async function savePublicPageSettings() {
    setPendingAction('save-public');
    try {
      const res = await fetch('/api/translation/channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slug: publicEnabled ? slug : undefined,
          publicEnabled,
        }),
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || 'Failed to save settings');
      applyChannel(data);
      toast.success('Public page settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * Toggles a target language in the multi-select list.
   * @param code - Language code to add or remove.
   * @param checked - Whether the checkbox is checked.
   */
  function toggleTargetLanguage(code: string, checked: boolean) {
    const normalized = normalizeTranslationLanguageCode(code);
    if (!normalized || normalized === normalizeTranslationLanguageCode(sourceLanguage)) {
      return;
    }
    setEnabledLanguages((prev) => {
      const next = new Set(prev.map(normalizeTranslationLanguageCode));
      if (checked) next.add(normalized);
      else next.delete(normalized);
      return [...next];
    });
  }

  const sourceCode = normalizeTranslationLanguageCode(sourceLanguage) || 'en';
  const sourceOptions = useMemo(() => {
    const curated = [...TRANSLATION_LANGUAGES];
    if (!curated.some((lang) => lang.code === sourceCode) && sourceCode) {
      curated.push(resolveTranslationLanguageOption(sourceCode));
    }
    return curated.sort(compareTranslationLanguageOptions);
  }, [sourceCode]);

  const targetOptions = useMemo(() => {
    const curated = TRANSLATION_LANGUAGES.filter((lang) => lang.code !== sourceCode);
    const curatedCodes = new Set(curated.map((lang) => lang.code));
    const legacy = enabledLanguages
      .map(normalizeTranslationLanguageCode)
      .filter((code) => code && code !== sourceCode && !curatedCodes.has(code))
      .map((code) => resolveTranslationLanguageOption(code));
    return [...curated, ...legacy].sort(compareTranslationLanguageOptions);
  }, [enabledLanguages, sourceCode]);

  async function rotateStreamKey() {
    setPendingAction('rotate-stream-key');
    try {
      const res = await fetch('/api/translation/stream-key', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || 'Failed to rotate stream key');
      streamKeyRevealOnApplyRef.current = true;
      applyChannel(data);
      toast.success(streamKeyPlaintext ? 'Stream key rotated' : 'Stream key generated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rotate key');
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteStreamKey() {
    setPendingAction('delete-stream-key');
    try {
      const res = await fetch('/api/translation/stream-key', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || 'Failed to delete stream key');
      applyChannel(data);
      toast.success('Stream key deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete stream key');
    } finally {
      setPendingAction(null);
    }
  }

  async function copyStreamKey() {
    if (!streamKeyPlaintext) return;
    try {
      await navigator.clipboard.writeText(streamKeyPlaintext);
      toast.success('Stream key copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  async function copyRtmpServerUrl() {
    const url = channel?.rtmpServerUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Publish URL copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-shadow-bg">Loading translation settings…</p>;
  }

  const hasOpenRouter = channel?.hasOpenRouterKey ?? false;
  const sttPricing = sttProvider ? sttProviderPricing(sttProvider) : null;
  const translatePricing = textTranslateProvider
    ? translateProviderPricing(textTranslateProvider)
    : null;
  const sttLabel = channel?.sttProvider
    ? (STT_PROVIDER_PRICING[channel.sttProvider]?.label ?? channel.sttProvider)
    : 'Not set';
  const translateLabel = sttProvidesBuiltInTranslation(channel?.sttProvider)
    ? 'Built into Soniox'
    : channel?.textTranslateProvider === 'groq'
      ? 'Groq'
      : channel?.textTranslateProvider === 'gcp'
        ? 'Google Cloud'
        : channel?.textTranslateProvider === 'openrouter'
          ? 'OpenRouter'
          : 'Not set';
  const sectionClassName = 'mt-8 space-y-4 rounded-xl border border-border bg-background p-6';
  const languagesReady = (channel?.enabledLanguages?.length ?? 0) > 0;
  const ttsModalLanguages = channel
    ? languagesForTtsConfig(channel.sourceLanguage, channel.enabledLanguages)
    : [];
  const configuredTtsVoices = channel?.gcpTtsVoices ?? {};
  const gcpVoiceFamilies = gcpTtsVoiceFamiliesInCatalog(gcpVoiceOptions.map((v) => v.name));
  const selectedFamilyInfo = ttsVoiceFamily ? gcpTtsVoiceFamilyInfo(ttsVoiceFamily) : null;

  const sonioxSttSelected = sttProvider === 'soniox';
  /** Credential UI for STT follows the STT dropdown only. */
  const showSttGroqKey = sttProvider === 'groq';
  const showSttDeepgramKey = sttProvider === 'deepgram';
  const showSttAssemblyaiKey = sttProvider === 'assemblyai';
  const showSttGladiaKey = sttProvider === 'gladia';
  const showSttSpeechmaticsKey = sttProvider === 'speechmatics';
  const showSttSonioxKey = sttProvider === 'soniox';
  const showSttModulateKey = sttProvider === 'modulate';
  const showSttElevenLabsKey = sttProvider === 'elevenlabs';
  /** Credential UI for translate follows the translate dropdown; skip when Soniox embeds MT. */
  const showTranslateOpenRouterKey = !sonioxSttSelected && textTranslateProvider === 'openrouter';
  const showTranslateGroqKey =
    !sonioxSttSelected && textTranslateProvider === 'groq' && sttProvider !== 'groq';
  const showTranslateGcpSa = !sonioxSttSelected && textTranslateProvider === 'gcp';
  const translateReusesSttCredentials =
    !sonioxSttSelected &&
    Boolean(sttProvider) &&
    Boolean(textTranslateProvider) &&
    textTranslateProvider === sttProvider;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Live audio translation
        </h1>
        <p className="text-muted-foreground text-shadow-bg">
          Your keys stay on your account. Prefer streaming ASR (Deepgram, AssemblyAI, Gladia,
          Speechmatics, Modulate, ElevenLabs, or Soniox). Groq Whisper remains a free chunked
          fallback. Soniox includes translation — other STT providers need a separate caption
          translation backend (OpenRouter, Groq, or Google Cloud). A channel is created only when
          you configure AI.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <span
            className={`rounded-md border border-border px-2 py-1 ${channel?.translationReady ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-background text-muted-foreground'}`}
          >
            {channel?.translationReady ? 'Translation ready' : 'Translation not configured'}
          </span>
          {channel?.translationReady ? (
            <span
              className={`rounded-md border border-border px-2 py-1 ${channel.listenReady ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-background text-muted-foreground'}`}
            >
              {channel.listenReady ? 'Listen ready' : 'Listen not configured'}
            </span>
          ) : null}
        </div>
      </header>

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">Add audio</h2>
          <p className="text-muted-foreground text-sm">
            Choose a microphone or sound device on this computer to stream live audio for
            translation.
          </p>
          <AddAudioCapture enabled={channel.translationReady} sttProvider={channel.sttProvider} />
        </section>
      ) : null}

      <section className={sectionClassName}>
        <h2 className="text-xl font-semibold text-foreground">Speech-to-text &amp; translation</h2>
        <p className="text-muted-foreground text-sm">
          Choose providers independently. Free-tier limits and pricing links appear in Configure AI.
          Saving AI settings creates your translation channel and public slug.
        </p>
        {channel &&
        (channel.translationReady ||
          hasOpenRouter ||
          channel.hasGroqKey ||
          channel.hasDeepgramKey ||
          channel.hasAssemblyaiKey ||
          channel.hasGladiaKey ||
          channel.hasSpeechmaticsKey ||
          channel.hasSonioxKey ||
          channel.hasModulateKey ||
          channel.hasElevenLabsKey ||
          channel.hasGcpServiceAccount) ? (
          <div className="space-y-3">
            <p className="text-sm">
              STT: {sttLabel}
              {channel.sttProvider === 'groq' && channel.sttModel ? (
                <>
                  {' '}
                  · <code className="text-xs">{channel.sttModel}</code>
                </>
              ) : null}
              {' · '}
              Translate: {translateLabel}
              {channel.textTranslateProvider !== 'gcp' &&
              channel.sttProvider !== 'soniox' &&
              channel.openRouterTranslateModel ? (
                <>
                  {' '}
                  · <code className="text-xs">{channel.openRouterTranslateModel}</code>
                </>
              ) : null}
              {channel.hasDeepgramKey ? <> · Deepgram key: configured</> : null}
              {channel.hasAssemblyaiKey ? <> · AssemblyAI key: configured</> : null}
              {channel.hasGladiaKey ? <> · Gladia key: configured</> : null}
              {channel.hasSpeechmaticsKey ? <> · Speechmatics key: configured</> : null}
              {channel.hasSonioxKey ? <> · Soniox key: configured</> : null}
              {channel.hasModulateKey ? <> · Modulate key: configured</> : null}
              {channel.hasElevenLabsKey ? <> · ElevenLabs key: configured</> : null}
              {hasOpenRouter ? <> · OpenRouter key: configured</> : null}
              {channel.hasGroqKey ? <> · Groq key: configured</> : null}
              {channel.hasGcpServiceAccount ? <> · GCP SA: configured</> : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={openAiModal}>
                Edit AI settings
              </Button>
              {channel.hasDeepgramKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-deepgram'}
                  onClick={() => setSttRemoveKind('deepgram')}
                >
                  Remove Deepgram
                </Button>
              ) : null}
              {channel.hasAssemblyaiKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-assemblyai'}
                  onClick={() => setSttRemoveKind('assemblyai')}
                >
                  Remove AssemblyAI
                </Button>
              ) : null}
              {channel.hasGladiaKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-gladia'}
                  onClick={() => setSttRemoveKind('gladia')}
                >
                  Remove Gladia
                </Button>
              ) : null}
              {channel.hasSpeechmaticsKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-speechmatics'}
                  onClick={() => setSttRemoveKind('speechmatics')}
                >
                  Remove Speechmatics
                </Button>
              ) : null}
              {channel.hasSonioxKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-soniox'}
                  onClick={() => setSttRemoveKind('soniox')}
                >
                  Remove Soniox
                </Button>
              ) : null}
              {channel.hasModulateKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-modulate'}
                  onClick={() => setSttRemoveKind('modulate')}
                >
                  Remove Modulate
                </Button>
              ) : null}
              {channel.hasElevenLabsKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-elevenlabs'}
                  onClick={() => setSttRemoveKind('elevenlabs')}
                >
                  Remove ElevenLabs
                </Button>
              ) : null}
              {hasOpenRouter ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-openrouter'}
                  onClick={() => void clearCredential('openrouter')}
                >
                  Remove OpenRouter
                </Button>
              ) : null}
              {channel.hasGroqKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingAction === 'clear-groq'}
                  onClick={() => void clearCredential('groq')}
                >
                  Remove Groq
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <Button type="button" onClick={openAiModal}>
            Configure AI
          </Button>
        )}
      </section>

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">Languages</h2>
          <p className="text-muted-foreground text-sm">
            Set the spoken source language and at least one listen target. Save languages before
            configuring Google Cloud TTS voices.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source-lang-search">Source language</Label>
              <TranslationLanguageSearchList
                mode="single"
                id="source-lang-search"
                listLabel="Source languages"
                options={sourceOptions}
                value={sourceCode}
                onValueChange={(value) => {
                  setSourceLanguage(value);
                  setEnabledLanguages((prev) =>
                    prev
                      .map(normalizeTranslationLanguageCode)
                      .filter((code) => code && code !== value)
                  );
                }}
              />
              <p className="text-muted-foreground text-xs">Spoken language for speech-to-text.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-langs-search">Target languages</Label>
              <TranslationLanguageSearchList
                mode="multiple"
                id="target-langs-search"
                listLabel="Target languages"
                options={targetOptions}
                value={enabledLanguages.map(normalizeTranslationLanguageCode).filter(Boolean)}
                onToggle={toggleTargetLanguage}
              />
              <p className="text-muted-foreground text-xs">
                Languages listeners can follow on the public page. Select at least one.
              </p>
            </div>
          </div>
          <Button
            type="button"
            disabled={pendingAction === 'save-languages'}
            onClick={() => void saveLanguagesSettings()}
          >
            Save languages
          </Button>
        </section>
      ) : null}

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">Google Cloud TTS</h2>
          <p className="text-muted-foreground text-sm">
            Optional. After validating your service account JSON, choose a{' '}
            <span className="text-foreground">voice model</span> (with free monthly character
            limits), then one voice per language for spoken translation.
          </p>
          <p className="text-muted-foreground text-sm">
            See Google&apos;s{' '}
            <a
              href={GCP_TTS_PRICING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              Text-to-Speech pricing
            </a>{' '}
            for free usage limits and rates. Billing must be enabled on the GCP project; usage above
            the free allotment is charged automatically.
          </p>
          {!languagesReady ? (
            <p className="text-muted-foreground text-sm">
              Choose and save at least one target language before adding Google Cloud TTS.
            </p>
          ) : channel.hasGcpServiceAccount ? (
            <div className="space-y-3">
              {Object.keys(configuredTtsVoices).length > 0 ? (
                <>
                  <p className="text-sm">Spoken translation voices are configured.</p>
                  <ul className="space-y-1 text-sm">
                    {Object.entries(configuredTtsVoices).map(([lang, voice]) => (
                      <li key={lang}>
                        {resolveTranslationLanguageOption(lang).name}{' '}
                        <span className="text-muted-foreground">→</span>{' '}
                        <code className="text-xs">{voice}</code>
                        <span className="text-muted-foreground text-xs">
                          {' '}
                          ({gcpTtsVoiceFamilyInfo(classifyGcpTtsVoiceFamily(voice)).label})
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={openGcpModal}>
                      Edit Google Cloud TTS
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pendingAction === 'clear-gcp'}
                      onClick={() => void clearCredential('gcp')}
                    >
                      Remove Google Cloud TTS
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">TTS setup incomplete.</span>{' '}
                    <span className="text-muted-foreground">
                      A Google Cloud service account is already saved from STT or caption
                      translation, but Listen still needs a voice model and one voice per language.
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={openGcpModal}>
                      Finish TTS setup
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pendingAction === 'clear-gcp'}
                      onClick={() => void clearCredential('gcp')}
                    >
                      Remove Google Cloud credentials
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Removing credentials also clears the service account used for Google Cloud STT
                    or Translation on this channel.
                  </p>
                </>
              )}
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={openGcpModal}>
              Add Google Cloud TTS
            </Button>
          )}
        </section>
      ) : null}

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">Public translation page</h2>
          <p className="text-muted-foreground text-sm">
            Share a public URL where viewers follow translation in real time. Enable the page and
            choose a slug; language options come from your saved Languages settings.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publicEnabled}
              onChange={(e) => setPublicEnabled(e.target.checked)}
            />
            Enable public translation page
          </label>
          <div className="space-y-2">
            <Label htmlFor="slug">Public slug</Label>
            <Input
              id="slug"
              value={slug}
              disabled={!publicEnabled}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="text-muted-foreground text-sm break-all">
              {publicEnabled
                ? publicUrl || '—'
                : 'Enable the public page to edit the slug and share the URL.'}
            </p>
          </div>
          <Button
            type="button"
            disabled={pendingAction === 'save-public'}
            onClick={() => void savePublicPageSettings()}
          >
            Save public page
          </Button>
        </section>
      ) : null}

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">RTMP (optional)</h2>
          {channel.rtmpReachable ? (
            <>
              <p className="text-muted-foreground text-sm">
                MediaMTX is up. In OBS Custom, set Server to the Publish URL below and Stream Key to
                the key. Prefer browser{' '}
                <span className="font-medium text-foreground">Add audio</span> unless you need OBS.
              </p>
              {channel.rtmpServerUrl ? (
                <div className="space-y-2">
                  <Label htmlFor="rtmp-publish-url">Publish URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="rtmp-publish-url"
                      readOnly
                      value={channel.rtmpServerUrl}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => void copyRtmpServerUrl()}
                      aria-label="Copy publish URL"
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ) : null}
              {streamKeyPlaintext ? (
                <div className="space-y-2">
                  <Label htmlFor="rtmp-stream-key">Stream key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="rtmp-stream-key"
                      readOnly
                      type={showStreamKey ? 'text' : 'password'}
                      value={streamKeyPlaintext}
                      className="font-mono text-xs"
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setShowStreamKey((v) => !v)}
                      aria-label={showStreamKey ? 'Hide stream key' : 'Show stream key'}
                    >
                      {showStreamKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => void copyStreamKey()}
                      aria-label="Copy stream key"
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          disabled={pendingAction === 'delete-stream-key'}
                          aria-label="Delete stream key"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete stream key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            OBS will not be able to publish until you generate a new stream key.
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={pendingAction === 'delete-stream-key'}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            disabled={pendingAction === 'delete-stream-key'}
                            onClick={() => {
                              void deleteStreamKey();
                            }}
                          >
                            Delete stream key
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No stream key yet.</p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={pendingAction === 'rotate-stream-key'}
                onClick={() => void rotateStreamKey()}
              >
                {streamKeyPlaintext ? 'Rotate stream key' : 'Generate stream key'}
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              For RTMP, uncomment the <code className="text-xs">mediamtx</code> service in{' '}
              <code className="text-xs">portainer-stack.yml</code> /{' '}
              <code className="text-xs">docker-compose.yml</code>, set{' '}
              <code className="text-xs">TRANSLATION_RTMP_PUBLIC_HOST</code> and{' '}
              <code className="text-xs">TRANSLATION_MEDIAMTX_RTSP_BASE</code>, restart the app, and
              start MediaMTX. Stream key controls appear when MediaMTX is reachable.
            </p>
          )}
        </section>
      ) : null}

      {channel ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">Delete channel</h2>
          <p className="text-muted-foreground text-sm">
            Removes your translation channel, stored keys, public slug, and settings. You can
            configure AI again later to start fresh.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={pendingAction === 'delete-channel'}
              >
                Delete translation channel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete translation channel?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes your channel, credentials, and public slug
                  {channel.slug ? ` (/listen/${channel.slug})` : ''}. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pendingAction === 'delete-channel'}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={pendingAction === 'delete-channel'}
                  onClick={() => {
                    void deleteChannel();
                  }}
                >
                  Delete channel
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      ) : null}

      <AlertDialog
        open={sttRemoveKind !== null}
        onOpenChange={(open) => {
          if (!open) setSttRemoveKind(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {sttRemoveKind ? STT_CREDENTIAL_LABELS[sttRemoveKind] : 'STT'} key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the stored {sttRemoveKind ? STT_CREDENTIAL_LABELS[sttRemoveKind] : 'STT'}{' '}
              API key from your channel
              {sttRemoveKind && channel?.sttProvider === sttRemoveKind
                ? ' and clears it as the active speech-to-text provider'
                : ''}
              . You can add a new key later. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sttRemoveKind === null || pendingAction === `clear-${sttRemoveKind}`}
              onClick={() => {
                if (!sttRemoveKind) return;
                void clearCredential(sttRemoveKind);
                setSttRemoveKind(null);
              }}
            >
              Remove key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure speech-to-text &amp; translation</DialogTitle>
            <DialogDescription>
              Choose STT and caption translation separately. Each dropdown shows that provider’s
              credentials. VideoSphere does not fall back between providers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="modal-stt-provider">STT provider</Label>
                <Select
                  value={sttProvider || SELECT_UNSET}
                  onValueChange={(next) => {
                    if (next === SELECT_UNSET) {
                      setSttProvider('');
                      setSttModel('');
                      clearAiFieldError('sttProvider');
                      return;
                    }
                    const value = next as LiveTranslationSttProvider;
                    setSttProvider(value);
                    setSttModel('');
                    // Clear STT key drafts so a paste for provider A cannot be
                    // saved under provider B if the dropdown was changed.
                    setDeepgramKey('');
                    setAssemblyaiKey('');
                    setGladiaKey('');
                    setSpeechmaticsKey('');
                    setSonioxKey('');
                    setModulateKey('');
                    setElevenLabsKey('');
                    setShowDeepgramKey(false);
                    setShowAssemblyaiKey(false);
                    setShowGladiaKey(false);
                    setShowSpeechmaticsKey(false);
                    setShowSonioxKey(false);
                    setShowModulateKey(false);
                    setShowElevenLabsKey(false);
                    clearAiFieldError('sttProvider');
                    clearAiFieldError('groqKey');
                    clearAiFieldError('deepgramKey');
                    clearAiFieldError('assemblyaiKey');
                    clearAiFieldError('gladiaKey');
                    clearAiFieldError('speechmaticsKey');
                    clearAiFieldError('sonioxKey');
                    clearAiFieldError('modulateKey');
                    clearAiFieldError('elevenLabsKey');
                    clearAiFieldError('openRouterKey');
                    clearAiFieldError('gcpJson');
                    clearAiFieldError('sttModel');
                  }}
                >
                  <SelectTrigger
                    id="modal-stt-provider"
                    aria-invalid={aiFieldErrors.sttProvider ? true : undefined}
                    className={invalidInputClass(Boolean(aiFieldErrors.sttProvider))}
                  >
                    <SelectValue placeholder="Please select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_UNSET}>Please select…</SelectItem>
                    <SelectItem value="deepgram">Deepgram (streaming)</SelectItem>
                    <SelectItem value="assemblyai">AssemblyAI (streaming)</SelectItem>
                    <SelectItem value="gladia">Gladia (streaming)</SelectItem>
                    <SelectItem value="speechmatics">Speechmatics (streaming)</SelectItem>
                    <SelectItem value="soniox">Soniox (streaming + translation)</SelectItem>
                    <SelectItem value="modulate">Modulate (streaming)</SelectItem>
                    <SelectItem value="elevenlabs">ElevenLabs Scribe (streaming)</SelectItem>
                    <SelectItem value="groq">Groq Whisper (chunked free fallback)</SelectItem>
                  </SelectContent>
                </Select>
                {aiFieldErrors.sttProvider ? (
                  <p className="text-destructive text-xs" role="alert">
                    {aiFieldErrors.sttProvider}
                  </p>
                ) : sttPricing ? (
                  <p className="text-muted-foreground text-xs">
                    Free / limits: {sttPricing.freeUsageLimit} After free:{' '}
                    {sttPricing.priceAfterFree}{' '}
                    <a
                      href={sttPricing.pricingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Pricing
                    </a>
                    {sttProvider === 'groq' ? (
                      <>
                        {' · '}
                        <a
                          href={GROQ_RATE_LIMITS_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          Groq pricing
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>

              {showSttGroqKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-groq-key">Groq API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-groq-key"
                      type={showGroqKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.groqKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.groqKey), 'pr-10')}
                      placeholder={
                        channel?.hasGroqKey ? '•••• configured — paste to replace' : 'gsk_…'
                      }
                      value={groqKey}
                      onChange={(e) => {
                        setGroqKey(e.target.value);
                        clearAiFieldError('groqKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGroqKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={showGroqKey ? 'Hide Groq API key' : 'Show Groq API key'}
                      aria-pressed={showGroqKey}
                    >
                      {showGroqKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.groqKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.groqKey}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showSttDeepgramKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-deepgram-key">Deepgram API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-deepgram-key"
                      type={showDeepgramKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.deepgramKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.deepgramKey), 'pr-10')}
                      placeholder={
                        channel?.hasDeepgramKey ? '•••• configured — paste to replace' : 'API key'
                      }
                      value={deepgramKey}
                      onChange={(e) => {
                        setDeepgramKey(e.target.value);
                        clearAiFieldError('deepgramKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowDeepgramKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={
                        showDeepgramKey ? 'Hide Deepgram API key' : 'Show Deepgram API key'
                      }
                      aria-pressed={showDeepgramKey}
                    >
                      {showDeepgramKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.deepgramKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.deepgramKey}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showSttAssemblyaiKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-assemblyai-key">AssemblyAI API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-assemblyai-key"
                      type={showAssemblyaiKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.assemblyaiKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.assemblyaiKey), 'pr-10')}
                      placeholder={
                        channel?.hasAssemblyaiKey ? '•••• configured — paste to replace' : 'API key'
                      }
                      value={assemblyaiKey}
                      onChange={(e) => {
                        setAssemblyaiKey(e.target.value);
                        clearAiFieldError('assemblyaiKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAssemblyaiKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={
                        showAssemblyaiKey ? 'Hide AssemblyAI API key' : 'Show AssemblyAI API key'
                      }
                      aria-pressed={showAssemblyaiKey}
                    >
                      {showAssemblyaiKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.assemblyaiKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.assemblyaiKey}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showSttGladiaKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-gladia-key">Gladia API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-gladia-key"
                      type={showGladiaKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.gladiaKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.gladiaKey), 'pr-10')}
                      placeholder={
                        channel?.hasGladiaKey ? '•••• configured — paste to replace' : 'API key'
                      }
                      value={gladiaKey}
                      onChange={(e) => {
                        setGladiaKey(e.target.value);
                        clearAiFieldError('gladiaKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGladiaKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={showGladiaKey ? 'Hide Gladia API key' : 'Show Gladia API key'}
                      aria-pressed={showGladiaKey}
                    >
                      {showGladiaKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.gladiaKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.gladiaKey}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showSttSpeechmaticsKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-speechmatics-key">Speechmatics API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-speechmatics-key"
                      type={showSpeechmaticsKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.speechmaticsKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.speechmaticsKey), 'pr-10')}
                      placeholder={
                        channel?.hasSpeechmaticsKey
                          ? '•••• configured — paste to replace'
                          : 'API key'
                      }
                      value={speechmaticsKey}
                      onChange={(e) => {
                        setSpeechmaticsKey(e.target.value);
                        clearAiFieldError('speechmaticsKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSpeechmaticsKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={
                        showSpeechmaticsKey
                          ? 'Hide Speechmatics API key'
                          : 'Show Speechmatics API key'
                      }
                      aria-pressed={showSpeechmaticsKey}
                    >
                      {showSpeechmaticsKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.speechmaticsKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.speechmaticsKey}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showSttSonioxKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-soniox-key">Soniox API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-soniox-key"
                      type={showSonioxKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.sonioxKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.sonioxKey), 'pr-10')}
                      placeholder={
                        channel?.hasSonioxKey ? '•••• configured — paste to replace' : 'API key'
                      }
                      value={sonioxKey}
                      onChange={(e) => {
                        setSonioxKey(e.target.value);
                        clearAiFieldError('sonioxKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSonioxKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={showSonioxKey ? 'Hide Soniox API key' : 'Show Soniox API key'}
                      aria-pressed={showSonioxKey}
                    >
                      {showSonioxKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.sonioxKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.sonioxKey}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Soniox includes translation — caption translation settings are hidden.
                    </p>
                  )}
                </div>
              ) : null}

              {showSttModulateKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-modulate-key">Modulate API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-modulate-key"
                      type={showModulateKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.modulateKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.modulateKey), 'pr-10')}
                      placeholder={
                        channel?.hasModulateKey ? '•••• configured — paste to replace' : 'API key'
                      }
                      value={modulateKey}
                      onChange={(e) => {
                        setModulateKey(e.target.value);
                        clearAiFieldError('modulateKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowModulateKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={
                        showModulateKey ? 'Hide Modulate API key' : 'Show Modulate API key'
                      }
                      aria-pressed={showModulateKey}
                    >
                      {showModulateKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.modulateKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.modulateKey}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Create a key at{' '}
                      <a
                        href="https://platform.modulate.ai/dashboard/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        platform.modulate.ai
                      </a>{' '}
                      (free credits on signup).
                    </p>
                  )}
                </div>
              ) : null}

              {showSttElevenLabsKey ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-elevenlabs-key">ElevenLabs API key</Label>
                  <div className="relative">
                    <Input
                      id="modal-stt-elevenlabs-key"
                      type={showElevenLabsKey ? 'text' : 'password'}
                      autoComplete="off"
                      aria-invalid={aiFieldErrors.elevenLabsKey ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.elevenLabsKey), 'pr-10')}
                      placeholder={
                        channel?.hasElevenLabsKey ? '•••• configured — paste to replace' : 'xi-…'
                      }
                      value={elevenLabsKey}
                      onChange={(e) => {
                        setElevenLabsKey(e.target.value);
                        clearAiFieldError('elevenLabsKey');
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowElevenLabsKey((v) => !v)}
                      className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                      aria-label={
                        showElevenLabsKey ? 'Hide ElevenLabs API key' : 'Show ElevenLabs API key'
                      }
                      aria-pressed={showElevenLabsKey}
                    >
                      {showElevenLabsKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {aiFieldErrors.elevenLabsKey ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.elevenLabsKey}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Create a key at{' '}
                      <a
                        href="https://elevenlabs.io/app/settings/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        elevenlabs.io
                      </a>{' '}
                      (Scribe v2 realtime). Restricted keys need the{' '}
                      <code className="text-xs">speech_to_text</code> permission.
                    </p>
                  )}
                </div>
              ) : null}

              {sttProvider === 'groq' ? (
                <div className="space-y-2">
                  <Label htmlFor="modal-stt-model">Groq Whisper model id</Label>
                  <Input
                    id="modal-stt-model"
                    aria-invalid={aiFieldErrors.sttModel ? true : undefined}
                    className={invalidInputClass(Boolean(aiFieldErrors.sttModel))}
                    placeholder="e.g. whisper-large-v3-turbo"
                    value={sttModel}
                    onChange={(e) => {
                      setSttModel(e.target.value);
                      clearAiFieldError('sttModel');
                    }}
                  />
                  {aiFieldErrors.sttModel ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.sttModel}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Chunked free-tier fallback. Prefer streaming ASR for lower latency.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {sonioxSttSelected ? null : (
              <div className="border-border border-t pt-4 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="modal-translate-provider">Caption translation provider</Label>
                  <Select
                    value={textTranslateProvider || SELECT_UNSET}
                    onValueChange={(next) => {
                      if (next === SELECT_UNSET) {
                        setTextTranslateProvider('');
                        setTranslateModel('');
                        clearAiFieldError('textTranslateProvider');
                        return;
                      }
                      const value = next as LiveTranslationTextTranslateProvider;
                      setTextTranslateProvider(value);
                      setTranslateModel('');
                      clearAiFieldError('textTranslateProvider');
                      clearAiFieldError('groqKey');
                      clearAiFieldError('openRouterKey');
                      clearAiFieldError('translateModel');
                      clearAiFieldError('gcpJson');
                    }}
                  >
                    <SelectTrigger
                      id="modal-translate-provider"
                      aria-invalid={aiFieldErrors.textTranslateProvider ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.textTranslateProvider))}
                    >
                      <SelectValue placeholder="Please select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_UNSET}>Please select…</SelectItem>
                      <SelectItem value="gcp">Google Cloud Translation (NMT)</SelectItem>
                      <SelectItem value="groq">Groq (chat)</SelectItem>
                      <SelectItem value="openrouter">OpenRouter (chat)</SelectItem>
                    </SelectContent>
                  </Select>
                  {aiFieldErrors.textTranslateProvider ? (
                    <p className="text-destructive text-xs" role="alert">
                      {aiFieldErrors.textTranslateProvider}
                    </p>
                  ) : translatePricing ? (
                    <p className="text-muted-foreground text-xs">
                      Free / limits: {translatePricing.freeUsageLimit} After free:{' '}
                      {translatePricing.priceAfterFree}{' '}
                      <a
                        href={translatePricing.pricingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        Pricing
                      </a>
                    </p>
                  ) : null}
                </div>

                {translateReusesSttCredentials && textTranslateProvider ? (
                  <p className="text-muted-foreground text-xs">
                    Uses the same{' '}
                    {textTranslateProvider === 'groq'
                      ? 'Groq API key'
                      : textTranslateProvider === 'gcp'
                        ? 'Google Cloud service account'
                        : 'OpenRouter API key'}{' '}
                    as STT above.
                  </p>
                ) : null}

                {showTranslateGroqKey ? (
                  <div className="space-y-2">
                    <Label htmlFor="modal-tr-groq-key">Groq API key</Label>
                    <div className="relative">
                      <Input
                        id="modal-tr-groq-key"
                        type={showGroqKey ? 'text' : 'password'}
                        autoComplete="off"
                        aria-invalid={aiFieldErrors.groqKey ? true : undefined}
                        className={invalidInputClass(Boolean(aiFieldErrors.groqKey), 'pr-10')}
                        placeholder={
                          channel?.hasGroqKey ? '•••• configured — paste to replace' : 'gsk_…'
                        }
                        value={groqKey}
                        onChange={(e) => {
                          setGroqKey(e.target.value);
                          clearAiFieldError('groqKey');
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroqKey((v) => !v)}
                        className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                        aria-label={showGroqKey ? 'Hide Groq API key' : 'Show Groq API key'}
                        aria-pressed={showGroqKey}
                      >
                        {showGroqKey ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {aiFieldErrors.groqKey ? (
                      <p className="text-destructive text-xs" role="alert">
                        {aiFieldErrors.groqKey}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {showTranslateOpenRouterKey ? (
                  <div className="space-y-2">
                    <Label htmlFor="modal-tr-or-key">OpenRouter API key</Label>
                    <div className="relative">
                      <Input
                        id="modal-tr-or-key"
                        type={showOpenRouterKey ? 'text' : 'password'}
                        autoComplete="off"
                        aria-invalid={aiFieldErrors.openRouterKey ? true : undefined}
                        className={invalidInputClass(Boolean(aiFieldErrors.openRouterKey), 'pr-10')}
                        placeholder={
                          hasOpenRouter ? '•••• configured — paste to replace' : 'sk-or-…'
                        }
                        value={openRouterKey}
                        onChange={(e) => {
                          setOpenRouterKey(e.target.value);
                          clearAiFieldError('openRouterKey');
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenRouterKey((v) => !v)}
                        className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2"
                        aria-label={showOpenRouterKey ? 'Hide API key' : 'Show API key'}
                        aria-pressed={showOpenRouterKey}
                      >
                        {showOpenRouterKey ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {aiFieldErrors.openRouterKey ? (
                      <p className="text-destructive text-xs" role="alert">
                        {aiFieldErrors.openRouterKey}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {showTranslateGcpSa ? (
                  channel?.hasGcpServiceAccount ? (
                    <p className="text-muted-foreground text-xs">
                      Using the Google Cloud service account already saved on this channel. Enable
                      Cloud Translation API on that project.
                    </p>
                  ) : (
                    renderAiGcpJsonFields({
                      fileInputId: 'modal-tr-gcp-json-file',
                      textareaId: 'modal-tr-gcp-json',
                      helpText:
                        'Enable Cloud Translation API on this project. The same JSON can be reused for TTS voices.',
                    })
                  )
                ) : null}

                {textTranslateProvider === 'groq' || textTranslateProvider === 'openrouter' ? (
                  <div className="space-y-2">
                    <Label htmlFor="modal-tr-model">
                      Translation model id (
                      {textTranslateProvider === 'groq' ? 'Groq chat' : 'OpenRouter'})
                    </Label>
                    <Input
                      id="modal-tr-model"
                      aria-invalid={aiFieldErrors.translateModel ? true : undefined}
                      className={invalidInputClass(Boolean(aiFieldErrors.translateModel))}
                      placeholder={
                        textTranslateProvider === 'groq'
                          ? 'e.g. llama-3.1-8b-instant'
                          : 'e.g. openai/gpt-oss-20b:free'
                      }
                      value={translateModel}
                      onChange={(e) => {
                        setTranslateModel(e.target.value);
                        clearAiFieldError('translateModel');
                      }}
                    />
                    {aiFieldErrors.translateModel ? (
                      <p className="text-destructive text-xs" role="alert">
                        {aiFieldErrors.translateModel}
                      </p>
                    ) : textTranslateProvider === 'openrouter' ? (
                      <p className="text-muted-foreground text-xs">
                        OpenRouter <code className="text-xs">:free</code> models (~50 requests/day)
                        are not enough for a full sermon. Prefer Google Cloud Translation for live
                        services.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pendingAction === 'save-ai'}
              onClick={() => setAiOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pendingAction === 'save-ai'}
              onClick={() => void saveAiModal()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={gcpOpen}
        onOpenChange={(open) => {
          if (!open) {
            stopVoicePreview();
            setPreviewingVoiceLang(null);
          }
          setGcpOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {Object.keys(channel?.gcpTtsVoices ?? {}).length > 0
                ? 'Edit Google Cloud TTS'
                : channel?.hasGcpServiceAccount
                  ? 'Finish Google Cloud TTS setup'
                  : 'Add Google Cloud TTS'}
            </DialogTitle>
            <DialogDescription>
              {channel?.hasGcpServiceAccount &&
              Object.keys(channel?.gcpTtsVoices ?? {}).length === 0
                ? 'Your service account is already saved. Load voices, choose a voice model, then pick one voice per language.'
                : 'Upload or paste a service account JSON key, load voices, choose a voice model (see free monthly character limits), then pick one voice per language.'}{' '}
              At least one voice is required for spoken translation. Pricing:{' '}
              <a
                href={GCP_TTS_PRICING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                cloud.google.com/text-to-speech/pricing
              </a>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="modal-gcp-json-file">Service account JSON file</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={gcpJsonFileInputRef}
                  id="modal-gcp-json-file"
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const text = typeof reader.result === 'string' ? reader.result : '';
                      const trimmed = text.trim();
                      if (!trimmed) {
                        setGcpFieldErrors((prev) => ({
                          ...prev,
                          gcpJson: 'The selected file was empty.',
                        }));
                        return;
                      }
                      try {
                        JSON.parse(trimmed);
                      } catch {
                        setGcpFieldErrors((prev) => ({
                          ...prev,
                          gcpJson: 'The selected file is not valid JSON.',
                        }));
                        return;
                      }
                      setGcpJson(trimmed);
                      setGcpJsonFileName(file.name);
                      clearGcpFieldError('gcpJson');
                      toast.success(`Loaded ${file.name}`);
                      void loadGcpVoices(trimmed);
                    };
                    reader.onerror = () => {
                      setGcpFieldErrors((prev) => ({
                        ...prev,
                        gcpJson: 'Could not read the selected file.',
                      }));
                    };
                    reader.readAsText(file);
                    // Allow re-selecting the same file after a failed attempt.
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={pendingAction === 'save-gcp'}
                  onClick={() => gcpJsonFileInputRef.current?.click()}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  Choose file
                </button>
                <span className="max-w-full truncate text-xs text-muted-foreground">
                  {gcpJsonFileName ?? 'No file selected'}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                Choose the JSON key downloaded from Google Cloud, or paste it below.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-gcp-json">Service account JSON</Label>
              <Textarea
                id="modal-gcp-json"
                rows={8}
                aria-invalid={gcpFieldErrors.gcpJson ? true : undefined}
                className={invalidInputClass(Boolean(gcpFieldErrors.gcpJson), 'font-mono text-xs')}
                placeholder={
                  channel?.hasGcpServiceAccount
                    ? '{ /* configured — upload or paste full JSON to replace */ }'
                    : '{ "type": "service_account", ... }'
                }
                value={gcpJson}
                onChange={(e) => {
                  setGcpJson(e.target.value);
                  setGcpJsonFileName(null);
                  clearGcpFieldError('gcpJson');
                }}
              />
              {gcpFieldErrors.gcpJson ? (
                <p className="text-destructive text-xs" role="alert">
                  {gcpFieldErrors.gcpJson}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingAction === 'save-gcp' || loadingGcpVoices}
                  onClick={() => void loadGcpVoices()}
                >
                  {loadingGcpVoices ? 'Loading voices…' : 'Load voices'}
                </Button>
                <span className="text-muted-foreground text-xs">
                  {gcpVoiceOptions.length > 0
                    ? `${gcpVoiceOptions.length} voices available`
                    : 'Load voices after pasting or uploading JSON'}
                </span>
              </div>
            </div>
            {gcpVoiceOptions.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="modal-tts-model">Voice model</Label>
                  <Select
                    value={ttsVoiceFamily || SELECT_UNSET}
                    onValueChange={(value) => {
                      if (value === SELECT_UNSET) {
                        onTtsVoiceFamilyChange('');
                        clearGcpFieldError('ttsVoice');
                        return;
                      }
                      onTtsVoiceFamilyChange(value as GcpTtsVoiceFamilyId);
                      clearGcpFieldError('ttsVoice');
                    }}
                  >
                    <SelectTrigger id="modal-tts-model">
                      <SelectValue placeholder="Select a model…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_UNSET}>Select a model…</SelectItem>
                      {gcpVoiceFamilies.map((family) => (
                        <SelectItem key={family.id} value={family.id}>
                          {family.freeUsageLimit
                            ? `${family.label} — ${family.freeUsageLimit}`
                            : family.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedFamilyInfo ? (
                    selectedFamilyInfo.freeUsageLimit ? (
                      <p className="text-muted-foreground text-xs">
                        Included monthly: {selectedFamilyInfo.freeUsageLimit}. After that:{' '}
                        {selectedFamilyInfo.priceAfterFree}. Details:{' '}
                        <a
                          href={GCP_TTS_PRICING_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          Text-to-Speech pricing
                        </a>
                        .
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Unclassified voice type — check{' '}
                        <a
                          href={GCP_TTS_PRICING_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          Text-to-Speech pricing
                        </a>{' '}
                        for rates.
                      </p>
                    )
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      Choose a model first so voice lists stay short and match one pricing tier.
                    </p>
                  )}
                </div>
                {ttsVoiceFamily ? (
                  <>
                    <p className="text-muted-foreground text-xs">
                      Use Preview to hear a short sample (uses a few characters of your GCP TTS
                      quota).
                    </p>
                    {ttsModalLanguages.map((lang) => {
                      const fieldId = `ttsVoice-${lang}`;
                      const langLabel = resolveTranslationLanguageOption(lang).name;
                      const options = voiceOptionsForLanguage(
                        lang,
                        gcpVoiceOptions,
                        ttsVoiceFamily
                      );
                      const fieldError = gcpFieldErrors[fieldId] ?? gcpFieldErrors.ttsVoice;
                      return (
                        <div key={lang} className="space-y-2">
                          <Label htmlFor={fieldId}>{langLabel} voice</Label>
                          <div className="flex flex-wrap items-center gap-2">
                            <Select
                              value={ttsVoices[lang] || SELECT_UNSET}
                              onValueChange={(value) => {
                                setTtsVoices((prev) => {
                                  const next = { ...prev };
                                  if (value && value !== SELECT_UNSET) next[lang] = value;
                                  else delete next[lang];
                                  return next;
                                });
                                clearGcpFieldError(fieldId);
                                clearGcpFieldError('ttsVoice');
                              }}
                              disabled={options.length === 0}
                            >
                              <SelectTrigger
                                id={fieldId}
                                aria-invalid={fieldError ? true : undefined}
                                className={invalidInputClass(Boolean(fieldError), 'min-w-0 flex-1')}
                              >
                                <SelectValue
                                  placeholder={
                                    options.length > 0
                                      ? 'Select a voice…'
                                      : 'No voices for this language in the selected model'
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SELECT_UNSET}>
                                  {options.length > 0
                                    ? 'Select a voice…'
                                    : 'No voices for this language in the selected model'}
                                </SelectItem>
                                {options.map((voice) => (
                                  <SelectItem key={voice.name} value={voice.name}>
                                    {formatGcpTtsVoiceOptionLabel(voice)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                pendingAction === 'save-gcp' ||
                                !ttsVoices[lang] ||
                                previewingVoiceLang === lang
                              }
                              onClick={() => void previewGcpVoice(lang, ttsVoices[lang] ?? '')}
                            >
                              {previewingVoiceLang === lang ? 'Loading…' : 'Preview'}
                            </Button>
                          </div>
                          {fieldError ? (
                            <p className="text-destructive text-xs" role="alert">
                              {fieldError}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                ) : null}
              </div>
            ) : gcpFieldErrors.ttsVoice ? (
              <p className="text-destructive text-xs" role="alert">
                {gcpFieldErrors.ttsVoice}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pendingAction === 'save-gcp'}
              onClick={() => setGcpOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pendingAction === 'save-gcp'}
              onClick={() => void saveGcpModal()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
