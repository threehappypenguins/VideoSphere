# Live audio translation

Per-user feature: each VideoSphere user configures their own credentials. There are **no shared OpenRouter, Groq, or GCP env keys** for this feature.

A translation **channel** (including the public slug) is created only when you save AI settings. Opening the Translation page alone does not create one. Use **Delete translation channel** to remove the channel, keys, and slug.

## Enable translation (captions)

1. Open **Dashboard → Translation**.
2. Choose **Configure AI**, then pick providers **separately** (no automatic fallback):
   - **STT provider** — streaming ASR: **Deepgram**, **AssemblyAI**, **Gladia**, **Speechmatics**, or **Soniox** (STT+translation). **Groq Whisper** remains a chunked free-tier fallback (~4s windows).
   - **Caption translation provider** — Google Cloud Translation (NMT), Groq chat, or OpenRouter chat. **Hidden when STT is Soniox** (Soniox returns translated captions directly).
3. The modal shows each provider’s **free / rate limits**, **post-free pricing**, and a link to the vendor’s pricing or limits page.
4. Paste only the keys required for your choices:
   - Streaming ASR key for the selected STT provider (Deepgram / AssemblyAI / Gladia / Speechmatics / Soniox).
   - Groq key when STT or translate uses Groq ([console.groq.com](https://console.groq.com/)).
   - OpenRouter key when translate uses OpenRouter.
   - Google Cloud service account JSON when translate uses GCP (or reuse one already saved under Google Cloud TTS). Enable **Cloud Translation API** on that project and grant the service account **Cloud Translation API User** (`roles/cloudtranslate.user`).
5. For **Groq** STT only, enter the **Whisper model id** (e.g. `whisper-large-v3-turbo`). Streaming ASR providers do not need a model id. For OpenRouter or Groq caption translation, also enter a **chat translation model id**. GCP NMT does not need a chat model.
6. In **Languages**, set the **source** language and at least one **target** listen language, then save. Mandarin (`Chinese - Mandarin` / 普通话) and Cantonese (`Chinese - Cantonese` / 粤语) are separate targets so translation text and GCP voices stay aligned.
   - **Deepgram** Mandarin uses `language=zh`.
   - **AssemblyAI** Mandarin uses Universal-3.5 Pro (`u3-rt-pro`) on the streaming WebSocket.
7. Optionally configure the **Public translation page** (enable + slug) when you are ready to share `/listen/{slug}`.
8. Use **Add audio** on the machine running the dashboard page. The input picker opens a **live level preview** first — speak and confirm the meter moves before adding audio. You can **switch inputs anytime**, including while live. Owner mic ingest alone does **not** open billable STT — upstream ASR starts only when at least one public listener has chosen a language (and stops when the last listener leaves). Streaming STT sends ~**250ms** PCM frames; Groq sends ~**4s** chunks. Near-silent / cutoff chunks are skipped (and lone Whisper fillers like “Thank you” are dropped) so pauses do not become fake captions. **Stop audio** ends ingest (preview stays open) and closes upstream ASR sockets / drops queued STT work.

   Local development: prefer `pnpm dev` (Turbopack). `pnpm dev:webpack` can full-reload other open tabs when `/listen/{slug}` first compiles (webpack HMR `sync` hash change). That does not happen under Turbopack or production `next start`. Ingest intent stays in `sessionStorage` so Add audio can auto-resume after a remount — use **Stop audio** so a later load does not resume unexpectedly.

   **Phone testing / keep screen on:** Chrome on Android only allows the Screen Wake Lock API in a **secure context** (HTTPS or `http://localhost`). Opening `http://192.168.x.x:9624` will dim and sleep as usual. For LAN phone tests run `pnpm dev:https`, then open `https://<your-LAN-IP>:9624/listen/...` and accept the self-signed certificate once. Production deployments behind HTTPS work without extra steps.

### How streaming vs Groq works

| Mode | Behavior |
| --- | --- |
| Streaming (Deepgram, AssemblyAI, Gladia, Speechmatics) | Session hub opens one long-lived provider WebSocket. Finals create caption segments and enqueue separate MT (+ optional async TTS). |
| Soniox | One Soniox WebSocket **per active listen language** (one-way translation to that target). Same PCM is fanned out. Translated finals skip the separate MT provider. |
| Groq (chunked) | Existing HTTP Whisper batch path (~4s windows) for free-tier fallback. |

Legacy channels that still have STT set to OpenRouter or GCP Speech-to-Text must **reconfigure AI** — those STT backends are no longer supported on the live path.

### Recommended path for full sermons (~2×50 min/week)

| Stage | Provider | Why |
| --- | --- | --- |
| STT | **Deepgram** (or another streaming ASR) | Low-latency captions; signup credits cover early services. Use **Groq Whisper** only if you need a free chunked fallback. |
| Captions | **Google Cloud Translation (NMT)** (unless Soniox STT) | First **~500,000 characters/month** free — usually enough for a few target languages at sermon volume. OpenRouter `:free` (~50 RPD) is not. |
| Spoken listen | **GCP TTS** (Standard / WaveNet) | Large free character allowances; configure voices after languages. |

Public listeners open `/listen/{slug}` (no login). Choosing a language (while the owner is capturing) opens STT for the channel; choosing the **source language** shows live **transcription only** (no translate API call) and, with spoken audio on, plays **live source PCM** (never GCP TTS). Other languages start translate(+optional TTS) only while at least one listener is connected; when the last listener leaves the channel, upstream STT closes immediately. When the last listener leaves a language, pending translate work stops and that language’s caption cache is dropped after a short reconnect grace (a few seconds). Switching languages does not replay old captions — you only see new live segments.

With streaming ASR, interim captions update in place; Deepgram also splits long continuous speech into sentence-sized finals (so captions/TTS do not wait for a multi-minute pause). Spoken listen for **targets** synthesizes TTS only after those finals. Captions are pushed as soon as STT (+ translation when needed) finish. TTS for upcoming lines starts in parallel and is delivered in order, and the listen client prefetches the next clip while the current one plays — short gaps can still happen when the speaker pauses or GCP synthesis lags a long line.

Caption translation clarifies a few ambiguous English sermon collocations in the source before every MT call (so “sinned against the Lord” is not read as fight/defy). OpenRouter / Groq also get a sermon-aware prompt, recent prior source finals, and a Mandarin/Cantonese safety repair if the model still emits 对抗 for that confession. Soniox built-in translation is unchanged.

## Enable listen (spoken translation)

1. Save **Languages** first (source + at least one target).
2. In Google Cloud: enable **Cloud Text-to-Speech** (and Translation API if you use GCP translate), create a service account, download the JSON key. If you use GCP caption translation, assign **Cloud Translation API User** to that service account.
3. On the Translation page under **Google Cloud TTS**, upload/paste the JSON and **Load voices**. Choose a **voice model** first (Standard / WaveNet / Neural2 / Chirp 3 HD / etc.) — the dropdown shows each model’s **free monthly character limit** from [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing). Then pick a voice **per target language** within that model (source is never listed — listeners hear live source PCM instead of TTS). Saving validates credentials and voice names via Google `listVoices`. Legacy source-language voice entries are pruned on save.
4. On `/listen`, **source** always offers spoken audio (live owner PCM). **Targets** offer spoken audio only when a TTS voice is configured; other targets stay captions-only. Channel “Listen ready” means SA + at least one **target** voice are set (and translation is already ready).

## Optional RTMP (MediaMTX)

Browser **Add audio** does not require MediaMTX (useful for local testing). For OBS/RTMP captions and source listen audio:

1. Uncomment the `mediamtx` service in `portainer-stack.yml` or `docker-compose.yml`.
2. Set on the app:
   - `TRANSLATION_RTMP_PUBLIC_HOST` (and optionally `TRANSLATION_RTMP_PATH_PREFIX`)
   - `TRANSLATION_MEDIAMTX_RTSP_BASE=rtsp://mediamtx:8554` (Docker DNS name of the MediaMTX service)
3. Rotate/generate a stream key on the Translation page and publish from OBS to the shown RTMP URL (e.g. `rtmp://host:1935/live/<streamKey>`).
4. MediaMTX auth is validated via `POST /api/translation/rtmp/auth` against the owner’s stream key hash. On successful **publish**, the app starts an ffmpeg RTSP pull into the same PCM path as Add audio (`enqueueOwnerPcm`). On unpublish / puller stop, ingest is marked stopped.
5. **STT billing gate is unchanged:** OBS (or Add audio) can be live without burning STT credits. Upstream ASR opens only while someone is on `/listen` with a language selected.
6. Optional: `TRANSLATION_RTMP_HOOK_SECRET` for an internal `POST /api/translation/rtmp/publisher` webhook. The primary start path is auth → puller (official MediaMTX images often lack `curl` for `runOnAvailable`).
