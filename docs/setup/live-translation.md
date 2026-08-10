# Live audio translation

Per-user feature: each VideoSphere user configures their own credentials. There are **no shared OpenRouter, Groq, or GCP env keys** for this feature.

A translation **channel** (including the public slug) is created only when you save AI settings. Opening the Translation page alone does not create one. Use **Delete translation channel** to remove the channel, keys, and slug.

## Enable translation (captions)

1. Open **Dashboard → Translation**.
2. Choose **Configure AI**, then pick an **STT provider**:
   - **Groq** — recommended for free/dev testing (Whisper, e.g. `whisper-large-v3-turbo`). Paste a Groq API key from [console.groq.com](https://console.groq.com/).
   - **OpenRouter** — use a paid transcription model id from the OpenRouter STT catalog.
3. Paste your **OpenRouter API key** (always required for **translation**; also used for STT when the provider is OpenRouter). Saving creates your channel after VideoSphere verifies the key and model ids with OpenRouter (and Groq when selected).
4. Enter your **STT model id** and **translation model id**. Free OpenRouter chat models (e.g. `openai/gpt-oss-20b:free`) are fine for light checks but sit on a **shared upstream rate pool** — live translate (~one request per ~4s audio chunk per active non-source language) can hit 429 quickly. Prefer a paid/BYOK model for sustained testing. Invalid keys or unknown model ids are rejected on save.
5. Set a public slug, enable the public page, and choose source + target languages from the curated dropdowns (ISO 639-1 codes aligned with Whisper STT and typical OpenRouter chat translate models such as `openai/gpt-oss-20b:free`).
6. Use **Add audio** on the machine running the dashboard page. Capture starts on the **system default** input; watch the level meter while speaking. If captions are nonsense (e.g. only “Thank you”), switch to the named mic that matches your hardware.

Public listeners open `/listen/{slug}` (no login). Choosing the **source language** shows live **transcription only** (no translate API call). Other languages start translate(+optional TTS) only while at least one listener is connected; when the last listener leaves a language, pending work stops and that language’s caption cache is dropped after a short reconnect grace (a few seconds). Switching languages does not replay old captions — you only see new live segments.

## Enable listen (spoken translation)

1. In Google Cloud: enable Cloud Text-to-Speech, create a service account, download the JSON key.
2. Paste the full JSON into the Translation page and set a **TTS voice name**.
3. Listen appears on the public page only when that user’s GCP credentials + voice are configured **and** translation is already ready.

## Optional RTMP (MediaMTX)

Browser **Add audio** does not require MediaMTX. For OBS/RTMP:

1. Uncomment the `mediamtx` service in `portainer-stack.yml` or `docker-compose.yml`.
2. Set `TRANSLATION_RTMP_PUBLIC_HOST` (and optionally `TRANSLATION_RTMP_PATH_PREFIX`).
3. Rotate/generate a stream key on the Translation page and publish to the shown RTMP URL.
4. MediaMTX auth is validated via `POST /api/translation/rtmp/auth` against the owner’s stream key hash.
