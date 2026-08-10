'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [ttsVoice, setTtsVoice] = useState('');
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
    setTtsVoice(view.gcpTtsVoice ?? '');
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
    return [
      extra,
      hasError ? 'border-destructive focus-visible:ring-destructive' : undefined,
    ]
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
    setTtsVoice(channel?.gcpTtsVoice ?? '');
    setGcpFieldErrors({});
    setGcpOpen(true);
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
    const voice = ttsVoice.trim();

    const errors: Record<string, string> = {};
    if (!channel?.hasGcpServiceAccount && !json) {
      errors.gcpJson = 'Paste your Google Cloud service account JSON.';
    }
    if (!voice) {
      errors.ttsVoice = 'Enter a GCP TTS voice name.';
    }
    if (Object.keys(errors).length > 0) {
      setGcpFieldErrors(errors);
      toast.error('Fill in the required fields highlighted in red');
      return;
    }
    setGcpFieldErrors({});

    setSaving(true);
    try {
      const body: Record<string, string> = { gcpTtsVoice: voice };
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
      };
      if (!res.ok) {
        const message = data.message || 'Failed to save Google Cloud TTS settings';
        const fromApi = fieldErrorsFromApi(data.fields, message);
        if (Object.keys(fromApi).length > 0) {
          setGcpFieldErrors(fromApi);
        }
        throw new Error(message);
      }
      applyChannel(data);
      setGcpJson('');
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
      setTtsVoice('');
      setAiOpen(false);
      setGcpOpen(false);
      toast.success('Translation channel deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  }

  async function savePublicPageSettings() {
    setSaving(true);
    try {
      const targets = [...new Set(enabledLanguages.map(normalizeTranslationLanguageCode))]
        .filter(Boolean)
        .filter((code) => code !== normalizeTranslationLanguageCode(sourceLanguage));

      const res = await fetch('/api/translation/channel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slug: publicEnabled ? slug : undefined,
          publicEnabled,
          sourceLanguage: normalizeTranslationLanguageCode(sourceLanguage) || 'en',
          enabledLanguages: targets,
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

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Live audio translation</h1>
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
          <h2 className="text-xl font-semibold text-foreground">Google Cloud TTS</h2>
          <p className="text-muted-foreground text-sm">
            Optional. Enables spoken translation on the public page. Requires a service account JSON
            and a TTS voice name.
          </p>
          {channel.hasGcpServiceAccount ? (
            <div className="space-y-3">
              <p className="text-sm">
                Service account: configured
                {channel.gcpTtsVoice ? (
                  <>
                    {' '}
                    · Voice: <code className="text-xs">{channel.gcpTtsVoice}</code>
                  </>
                ) : null}
              </p>
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
            A page where viewers can follow the translation in real time. Listening is optional when
            Google Cloud TTS is configured.
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
              {publicEnabled ? publicUrl || '—' : 'Enable the public page to edit the slug and share the URL.'}
            </p>
          </div>
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
              <p className="text-muted-foreground text-xs">
                Spoken language for STT. Curated for Whisper + OpenRouter chat translate models.
              </p>
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
                Listeners can pick these on the public page. Use checkboxes to select more than one.
              </p>
            </div>
          </div>
          <Button type="button" disabled={saving} onClick={() => void savePublicPageSettings()}>
            Save public page & languages
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
              Choose OpenRouter or Groq for STT. Translation always uses OpenRouter (free chat models
              are fine). Keys stay on your account only.
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
              ) : null}
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

      <Dialog open={gcpOpen} onOpenChange={setGcpOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {channel?.hasGcpServiceAccount ? 'Edit Google Cloud TTS' : 'Add Google Cloud TTS'}
            </DialogTitle>
            <DialogDescription>
              Paste a service account JSON key and the TTS voice name. Both are required for spoken
              translation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="modal-gcp-json">Service account JSON</Label>
              <Textarea
                id="modal-gcp-json"
                rows={8}
                aria-invalid={gcpFieldErrors.gcpJson ? true : undefined}
                className={invalidInputClass(Boolean(gcpFieldErrors.gcpJson), 'font-mono text-xs')}
                placeholder={
                  channel?.hasGcpServiceAccount
                    ? '{ /* configured — paste full JSON to replace */ }'
                    : '{ "type": "service_account", ... }'
                }
                value={gcpJson}
                onChange={(e) => {
                  setGcpJson(e.target.value);
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
              <Label htmlFor="modal-tts-voice">TTS voice name</Label>
              <Input
                id="modal-tts-voice"
                aria-invalid={gcpFieldErrors.ttsVoice ? true : undefined}
                className={invalidInputClass(Boolean(gcpFieldErrors.ttsVoice))}
                placeholder="e.g. es-US-Neural2-A"
                value={ttsVoice}
                onChange={(e) => {
                  setTtsVoice(e.target.value);
                  clearGcpFieldError('ttsVoice');
                }}
              />
              {gcpFieldErrors.ttsVoice ? (
                <p className="text-destructive text-xs" role="alert">
                  {gcpFieldErrors.ttsVoice}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setGcpOpen(false)}>
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
