'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import type { LiveTranslationChannelOwnerView, LiveTranslationSttProvider } from '@/types';
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
import { Textarea } from '@/components/ui/textarea';
import {
  TRANSLATION_LANGUAGES,
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

type GcpVoiceOption = {
  name: string;
  languageCodes: string[];
  ssmlGender?: 'male' | 'female' | 'neutral' | null;
};

/**
 * Owner dashboard UI for per-user live audio translation configuration and ingest.
 * Progressive disclosure: STT provider (OpenRouter or Groq) + OpenRouter translation,
 * then optional GCP TTS, public page, audio, and RTMP.
 * @returns Translation settings page content.
 */
export function TranslationConfigClient() {
  const [channel, setChannel] = useState<LiveTranslationChannelOwnerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [slug, setSlug] = useState('');
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [enabledLanguages, setEnabledLanguages] = useState<string[]>([]);
  const [streamKeyPlaintext, setStreamKeyPlaintext] = useState<string | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [gcpOpen, setGcpOpen] = useState(false);

  const [sttProvider, setSttProvider] = useState<LiveTranslationSttProvider>('openrouter');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [groqKey, setGroqKey] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [sttModel, setSttModel] = useState('');
  const [translateModel, setTranslateModel] = useState('');

  const [gcpJson, setGcpJson] = useState('');
  const [gcpJsonFileName, setGcpJsonFileName] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<Record<string, string>>({});
  const [gcpVoiceOptions, setGcpVoiceOptions] = useState<GcpVoiceOption[]>([]);
  const [ttsVoiceFamily, setTtsVoiceFamily] = useState<GcpTtsVoiceFamilyId | ''>('');
  const [loadingGcpVoices, setLoadingGcpVoices] = useState(false);
  const [previewingVoiceLang, setPreviewingVoiceLang] = useState<string | null>(null);
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
    setSttProvider(view.sttProvider ?? 'openrouter');
    setSttModel(view.sttModel ?? view.openRouterSttModel ?? '');
    setTranslateModel(view.openRouterTranslateModel ?? '');
    setTtsVoices(view.gcpTtsVoices ?? {});
    if (view.streamKeyPlaintext) {
      setStreamKeyPlaintext(view.streamKeyPlaintext);
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
    setSttProvider(channel?.sttProvider ?? 'openrouter');
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
    const stt = sttModel.trim();
    const translate = translateModel.trim();

    const errors: Record<string, string> = {};
    if (!channel?.hasOpenRouterKey && !orKey) {
      errors.openRouterKey = 'Paste your OpenRouter API key.';
    }
    if (sttProvider === 'groq' && !channel?.hasGroqKey && !gKey) {
      errors.groqKey = 'Paste your Groq API key.';
    }
    if (!stt) {
      errors.sttModel = 'Enter an STT model id.';
    }
    if (!translate) {
      errors.translateModel = 'Enter a translation model id.';
    }
    if (Object.keys(errors).length > 0) {
      setAiFieldErrors(errors);
      toast.error('Fill in the required fields highlighted in red');
      return;
    }
    setAiFieldErrors({});

    setSaving(true);
    try {
      const body: Record<string, string> = {
        sttProvider,
        sttModel: stt,
        openRouterTranslateModel: translate,
      };
      if (orKey) body.openRouterApiKey = orKey;
      if (gKey) body.groqApiKey = gKey;

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
      setShowOpenRouterKey(false);
      setShowGroqKey(false);
      setAiFieldErrors({});
      setAiOpen(false);
      toast.success('AI settings saved for your account only');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setSaving(false);
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

    setSaving(true);
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
      setSaving(false);
    }
  }

  async function clearCredential(kind: 'openrouter' | 'groq' | 'gcp') {
    setSaving(true);
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
      if (kind === 'openrouter' || kind === 'groq') {
        setAiOpen(false);
      }
      if (kind === 'openrouter') {
        setGcpOpen(false);
      }
      toast.success(
        kind === 'openrouter'
          ? 'OpenRouter key removed'
          : kind === 'groq'
            ? 'Groq key removed'
            : 'GCP credentials removed'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear');
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel() {
    setSaving(true);
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
      setSttProvider('openrouter');
      setSttModel('');
      setTranslateModel('');
      setTtsVoices({});
      setAiOpen(false);
      setGcpOpen(false);
      toast.success('Translation channel deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  }

  async function saveLanguagesSettings() {
    setSaving(true);
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
      setSaving(false);
    }
  }

  async function savePublicPageSettings() {
    setSaving(true);
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
      setSaving(false);
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
    return curated;
  }, [sourceCode]);

  const targetOptions = useMemo(() => {
    const curated = TRANSLATION_LANGUAGES.filter((lang) => lang.code !== sourceCode);
    const curatedCodes = new Set(curated.map((lang) => lang.code));
    const legacy = enabledLanguages
      .map(normalizeTranslationLanguageCode)
      .filter((code) => code && code !== sourceCode && !curatedCodes.has(code))
      .map((code) => resolveTranslationLanguageOption(code));
    return [...curated, ...legacy];
  }, [enabledLanguages, sourceCode]);

  async function rotateStreamKey() {
    setSaving(true);
    try {
      const res = await fetch('/api/translation/stream-key', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as LiveTranslationChannelOwnerView & {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || 'Failed to rotate stream key');
      applyChannel(data);
      toast.success('Stream key rotated — copy it now');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rotate key');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-shadow-bg">Loading translation settings…</p>;
  }

  const hasOpenRouter = channel?.hasOpenRouterKey ?? false;
  const sttLabel = channel?.sttProvider === 'groq' ? 'Groq' : 'OpenRouter';
  const sectionClassName = 'mt-8 space-y-4 rounded-xl border border-border bg-background p-6';
  const languagesReady = (channel?.enabledLanguages?.length ?? 0) > 0;
  const ttsModalLanguages = channel
    ? languagesForTtsConfig(channel.sourceLanguage, channel.enabledLanguages)
    : [];
  const configuredTtsVoices = channel?.gcpTtsVoices ?? {};
  const gcpVoiceFamilies = gcpTtsVoiceFamiliesInCatalog(gcpVoiceOptions.map((v) => v.name));
  const selectedFamilyInfo = ttsVoiceFamily ? gcpTtsVoiceFamilyInfo(ttsVoiceFamily) : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Live audio translation
        </h1>
        <p className="text-muted-foreground text-shadow-bg">
          Your keys and models stay on your account. Other users cannot use them. Choose OpenRouter
          or Groq for speech-to-text; translation always uses OpenRouter. Google Cloud TTS is
          optional for spoken audio. A channel is created only when you configure AI.
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

      <section className={sectionClassName}>
        <h2 className="text-xl font-semibold text-foreground">Speech-to-text &amp; translation</h2>
        <p className="text-muted-foreground text-sm">
          Pick an STT provider, then set model ids. Translation always needs an OpenRouter key and
          chat model (free models work). Groq Whisper is a good free option for STT testing. Saving
          AI settings creates your translation channel and public slug.
        </p>
        {channel && (channel.translationReady || hasOpenRouter || channel.hasGroqKey) ? (
          <div className="space-y-3">
            <p className="text-sm">
              STT: {sttLabel}
              {channel.sttModel ? (
                <>
                  {' '}
                  · <code className="text-xs">{channel.sttModel}</code>
                </>
              ) : null}
              {hasOpenRouter ? <> · OpenRouter key: configured</> : null}
              {channel.sttProvider === 'groq' && channel.hasGroqKey ? (
                <> · Groq key: configured</>
              ) : null}
              {channel.openRouterTranslateModel ? (
                <>
                  {' '}
                  · Translate: <code className="text-xs">{channel.openRouterTranslateModel}</code>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={openAiModal}>
                Edit AI settings
              </Button>
              {hasOpenRouter ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void clearCredential('openrouter')}
                >
                  Remove OpenRouter
                </Button>
              ) : null}
              {channel.hasGroqKey ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void clearCredential('groq')}
                >
                  Remove Groq
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <Button type="button" disabled={saving} onClick={openAiModal}>
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
          <Button type="button" disabled={saving} onClick={() => void saveLanguagesSettings()}>
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
              <p className="text-sm">Service account: configured</p>
              {Object.keys(configuredTtsVoices).length > 0 ? (
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
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={openGcpModal}>
                  Edit Google Cloud TTS
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void clearCredential('gcp')}
                >
                  Remove Google Cloud TTS
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" disabled={saving} onClick={openGcpModal}>
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
          <Button type="button" disabled={saving} onClick={() => void savePublicPageSettings()}>
            Save public page
          </Button>
        </section>
      ) : null}

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">Add audio</h2>
          <p className="text-muted-foreground text-sm">
            Choose a microphone or sound device on this computer to stream live audio for
            translation. No RTMP sidecar required.
          </p>
          <AddAudioCapture enabled={channel.translationReady} />
        </section>
      ) : null}

      {channel?.translationReady ? (
        <section className={sectionClassName}>
          <h2 className="text-xl font-semibold text-foreground">RTMP (optional)</h2>
          <p className="text-muted-foreground text-sm">
            Prefer browser Add audio above. RTMP needs the optional MediaMTX sidecar — uncomment the{' '}
            <code className="text-xs">mediamtx</code> service in{' '}
            <code className="text-xs">portainer-stack.yml</code> /{' '}
            <code className="text-xs">docker-compose.yml</code> and set{' '}
            <code className="text-xs">TRANSLATION_RTMP_PUBLIC_HOST</code>.
          </p>
          {channel.rtmpConfigured ? (
            <>
              {streamKeyPlaintext ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-sm font-medium">Stream key (copy now — shown once)</p>
                  <code className="block break-all text-xs">{streamKeyPlaintext}</code>
                  {channel.rtmpPublishUrl ? (
                    <p className="text-muted-foreground text-xs break-all">
                      Publish URL: {channel.rtmpPublishUrl}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {channel.hasStreamKey
                    ? 'A stream key is stored. Rotate to view a new plaintext key.'
                    : 'No stream key yet.'}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void rotateStreamKey()}
              >
                Generate / rotate stream key
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Stream key controls appear after MediaMTX is enabled in your stack and{' '}
              <code className="text-xs">TRANSLATION_RTMP_PUBLIC_HOST</code> is set.
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
              <Button type="button" variant="destructive" disabled={saving}>
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
                <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
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

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure speech-to-text &amp; translation</DialogTitle>
            <DialogDescription>
              Choose OpenRouter or Groq for STT. Translation always uses OpenRouter (free chat
              models are fine). Keys stay on your account only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="modal-stt-provider">STT provider</Label>
              <select
                id="modal-stt-provider"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={sttProvider}
                onChange={(e) => {
                  setSttProvider(e.target.value as LiveTranslationSttProvider);
                  clearAiFieldError('groqKey');
                }}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq (Whisper)</option>
              </select>
            </div>

            {sttProvider === 'groq' ? (
              <div className="space-y-2">
                <Label htmlFor="modal-groq-key">Groq API key</Label>
                <div className="relative">
                  <Input
                    id="modal-groq-key"
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

            <div className="space-y-2">
              <Label htmlFor="modal-or-key">OpenRouter API key</Label>
              <div className="relative">
                <Input
                  id="modal-or-key"
                  type={showOpenRouterKey ? 'text' : 'password'}
                  autoComplete="off"
                  aria-invalid={aiFieldErrors.openRouterKey ? true : undefined}
                  className={invalidInputClass(Boolean(aiFieldErrors.openRouterKey), 'pr-10')}
                  placeholder={hasOpenRouter ? '•••• configured — paste to replace' : 'sk-or-…'}
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
              ) : (
                <p className="text-muted-foreground text-xs">
                  {sttProvider === 'openrouter'
                    ? 'Used for both speech-to-text and translation.'
                    : 'Required for translation only when STT uses Groq.'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="modal-stt-model">STT model id</Label>
              <Input
                id="modal-stt-model"
                aria-invalid={aiFieldErrors.sttModel ? true : undefined}
                className={invalidInputClass(Boolean(aiFieldErrors.sttModel))}
                placeholder={
                  sttProvider === 'groq'
                    ? 'e.g. whisper-large-v3-turbo'
                    : 'e.g. openai/whisper-large-v3'
                }
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
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-tr-model">Translation model id (OpenRouter)</Label>
              <Input
                id="modal-tr-model"
                aria-invalid={aiFieldErrors.translateModel ? true : undefined}
                className={invalidInputClass(Boolean(aiFieldErrors.translateModel))}
                placeholder="e.g. openai/gpt-oss-20b:free"
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
              ) : (
                <p className="text-muted-foreground text-xs">
                  Free models are supported. Live translation may pause briefly when the shared free
                  pool returns 429; VideoSphere keeps only the latest audio/caption and retries.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setAiOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveAiModal()}>
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
              {channel?.hasGcpServiceAccount ? 'Edit Google Cloud TTS' : 'Add Google Cloud TTS'}
            </DialogTitle>
            <DialogDescription>
              Upload or paste a service account JSON key, load voices, choose a{' '}
              <strong className="font-medium text-foreground">voice model</strong> (see free monthly
              character limits), then pick one voice per language. At least one voice is required
              for spoken translation. Pricing:{' '}
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
                  disabled={saving}
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
                  disabled={saving || loadingGcpVoices}
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
                  <select
                    id="modal-tts-model"
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                    value={ttsVoiceFamily}
                    onChange={(e) => {
                      onTtsVoiceFamilyChange((e.target.value || '') as GcpTtsVoiceFamilyId | '');
                      clearGcpFieldError('ttsVoice');
                    }}
                  >
                    <option value="">Select a model…</option>
                    {gcpVoiceFamilies.map((family) => (
                      <option key={family.id} value={family.id}>
                        {family.freeUsageLimit
                          ? `${family.label} — ${family.freeUsageLimit}`
                          : family.label}
                      </option>
                    ))}
                  </select>
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
                            <select
                              id={fieldId}
                              aria-invalid={fieldError ? true : undefined}
                              className={invalidInputClass(
                                Boolean(fieldError),
                                'border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm'
                              )}
                              value={ttsVoices[lang] ?? ''}
                              onChange={(e) => {
                                const value = e.target.value;
                                setTtsVoices((prev) => {
                                  const next = { ...prev };
                                  if (value) next[lang] = value;
                                  else delete next[lang];
                                  return next;
                                });
                                clearGcpFieldError(fieldId);
                                clearGcpFieldError('ttsVoice');
                              }}
                            >
                              <option value="">
                                {options.length > 0
                                  ? 'Select a voice…'
                                  : 'No voices for this language in the selected model'}
                              </option>
                              {options.map((voice) => (
                                <option key={voice.name} value={voice.name}>
                                  {formatGcpTtsVoiceOptionLabel(voice)}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={saving || !ttsVoices[lang] || previewingVoiceLang === lang}
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
              disabled={saving}
              onClick={() => setGcpOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveGcpModal()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
