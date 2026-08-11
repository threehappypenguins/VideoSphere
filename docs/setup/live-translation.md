# Live audio translation

Per-user feature: each VideoSphere user configures their own credentials. There are **no shared OpenRouter, Groq, or GCP env keys** for this feature.

A translation **channel** (including the public slug) is created only when you save AI settings. Opening the Translation page alone does not create one. Use **Delete translation channel** to remove the channel, keys, and slug.

## Enable translation (captions)

1. Open **Dashboard → Translation**.
2. Choose **Configure AI**, then pick providers **separately** (no automatic fallback):
   - **STT provider** — Groq (Whisper), OpenRouter, or Google Cloud Speech-to-Text.
   - **Caption translation provider** — Google Cloud Translation (NMT), Groq chat, or OpenRouter chat.
3. The modal shows each provider’s **free / rate limits**, **post-free pricing**, and a link to the vendor’s pricing or limits page (same idea as the GCP TTS voice-model dropdown).
4. Paste only the keys required for your choices:
   - Groq key when STT or translate uses Groq ([console.groq.com](https://console.groq.com/)).
   - OpenRouter key when STT or translate uses OpenRouter.
   - Google Cloud service account JSON when STT or translate uses GCP (or reuse one already saved under Google Cloud TTS). Enable **Cloud Speech-to-Text API** and/or **Cloud Translation API** on that project. For caption translation (Advanced / v3), also grant the service account **Cloud Translation API User** (`roles/cloudtranslate.user`) — enabling the API alone is not enough.
5. Enter the **STT model id** (e.g. `whisper-large-v3-turbo`, `latest_long` for GCP). For OpenRouter or Groq caption translation, also enter a **chat translation model id**. GCP NMT does not need a chat model.
6. In **Languages**, set the **source** language and at least one **target** listen language, then save. Mandarin (`Chinese - Mandarin` / 普通话) and Cantonese (`Chinese - Cantonese` / 粤语) are separate targets so translation text and GCP voices stay aligned.
7. Optionally configure the **Public translation page** (enable + slug) when you are ready to share `/listen/{slug}`.
8. Use **Add audio** on the machine running the dashboard page. Capture starts on the **system default** input; watch the level meter while speaking. Near-silent / cutoff chunks are skipped (and lone Whisper fillers like “Thank you” are dropped) so pauses do not become fake captions. **Stop audio** tears down the mic graph immediately and drops queued STT work.

### Recommended free path for full sermons (~2×50 min/week)

| Stage | Provider | Why |
| --- | --- | --- |
| STT | **Groq Whisper** | Free plan can cover sermon audio (RPM/RPD/audio-seconds); GCP STT free tier is only **~60 minutes/month**. |
| Captions | **Google Cloud Translation (NMT)** | First **~500,000 characters/month** free — usually enough for a few target languages at sermon volume. OpenRouter `:free` (~50 RPD) is not. |
| Spoken listen | **GCP TTS** (Standard / WaveNet) | Large free character allowances; configure voices after languages. |

Public listeners open `/listen/{slug}` (no login). Choosing the **source language** shows live **transcription only** (no translate API call). Other languages start translate(+optional TTS) only while at least one listener is connected; when the last listener leaves a language, pending work stops and that language’s caption cache is dropped after a short reconnect grace (a few seconds). Switching languages does not replay old captions — you only see new live segments.

## Enable listen (spoken translation)

1. Save **Languages** first (source + at least one target).
2. In Google Cloud: enable **Cloud Text-to-Speech** (and Translation/Speech APIs if you use those providers), create a service account, download the JSON key. If you use GCP caption translation, assign **Cloud Translation API User** to that service account.
3. On the Translation page under **Google Cloud TTS**, upload/paste the JSON and **Load voices**. Choose a **voice model** first (Standard / WaveNet / Neural2 / Chirp 3 HD / etc.) — the dropdown shows each model’s **free monthly character limit** from [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing). Then pick a voice **per language** within that model. Saving validates credentials and voice names via Google `listVoices`.
4. On `/listen`, spoken audio is offered only for languages that have a configured voice; other languages stay captions-only. Channel “Listen ready” means SA + at least one language voice are set (and translation is already ready).

## Optional RTMP (MediaMTX)

Browser **Add audio** does not require MediaMTX. For OBS/RTMP:

1. Uncomment the `mediamtx` service in `portainer-stack.yml` or `docker-compose.yml`.
2. Set `TRANSLATION_RTMP_PUBLIC_HOST` (and optionally `TRANSLATION_RTMP_PATH_PREFIX`).
3. Rotate/generate a stream key on the Translation page and publish to the shown RTMP URL.
4. MediaMTX auth is validated via `POST /api/translation/rtmp/auth` against the owner’s stream key hash.
