# Live audio translation

Per-user feature: each VideoSphere user configures their own credentials. There are **no shared OpenRouter, Groq, or GCP env keys** for this feature.

A translation **channel** (including the public slug) is created only when you save AI settings. Opening the Translation page alone does not create one. Use **Delete translation channel** to remove the channel, keys, and slug.

## Enable translation (captions)

1. Open **Dashboard → Translation**.
2. Choose **Configure AI**, then pick an **STT provider**:
   - **Groq** — recommended for free/dev testing (Whisper, e.g. `whisper-large-v3-turbo`). Paste a Groq API key from [console.groq.com](https://console.groq.com/).
   - **OpenRouter** — use a paid transcription model id from the OpenRouter STT catalog.
3. Paste your **OpenRouter API key** (always required for **translation**; also used for STT when the provider is OpenRouter). Saving creates your channel after VideoSphere verifies the key and model ids with OpenRouter (and Groq when selected).
4. Enter your **STT model id** and **translation model id**. Free OpenRouter/Groq models are supported; shared free pools can still return 429 under load. VideoSphere uses longer mic chunks (~8s), keeps only the latest audio/caption when rate-limited, and backs off before retrying. Invalid keys or unknown model ids are rejected on save.
5. In **Languages**, set the **source** language and at least one **target** listen language, then save. (This is required before Google Cloud TTS.) Mandarin (`Chinese - Mandarin` / 普通话) and Cantonese (`Chinese - Cantonese` / 粤语) are separate targets so translation text and GCP voices stay aligned.
6. Optionally configure the **Public translation page** (enable + slug) when you are ready to share `/listen/{slug}`.
7. Use **Add audio** on the machine running the dashboard page. Capture starts on the **system default** input; watch the level meter while speaking. If captions are nonsense (e.g. only “Thank you”), switch to the named mic that matches your hardware. **Stop audio** tears down the mic graph immediately and drops any queued STT work (Groq free tiers are ~20 requests/minute — a backlog after stop used to keep calling the API).

Public listeners open `/listen/{slug}` (no login). Choosing the **source language** shows live **transcription only** (no translate API call). Other languages start translate(+optional TTS) only while at least one listener is connected; when the last listener leaves a language, pending work stops and that language’s caption cache is dropped after a short reconnect grace (a few seconds). Switching languages does not replay old captions — you only see new live segments.

## Enable listen (spoken translation)

1. Save **Languages** first (source + at least one target).
2. In Google Cloud: enable Cloud Text-to-Speech, create a service account, download the JSON key.
3. On the Translation page under **Google Cloud TTS**, upload/paste the JSON and **Load voices**. Choose a **voice model** first (Standard / WaveNet / Neural2 / Chirp 3 HD / etc.) — the dropdown shows each model’s **free monthly character limit** from [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing). Then pick a voice **per language** within that model. Saving validates credentials and voice names via Google `listVoices`.
4. On `/listen`, spoken audio is offered only for languages that have a configured voice; other languages stay captions-only. Channel “Listen ready” means SA + at least one language voice are set (and translation is already ready).

## Optional RTMP (MediaMTX)

Browser **Add audio** does not require MediaMTX. For OBS/RTMP:

1. Uncomment the `mediamtx` service in `portainer-stack.yml` or `docker-compose.yml`.
2. Set `TRANSLATION_RTMP_PUBLIC_HOST` (and optionally `TRANSLATION_RTMP_PATH_PREFIX`).
3. Rotate/generate a stream key on the Translation page and publish to the shown RTMP URL.
4. MediaMTX auth is validated via `POST /api/translation/rtmp/auth` against the owner’s stream key hash.
