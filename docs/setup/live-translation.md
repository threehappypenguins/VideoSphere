# Live audio translation

Per-user feature: each VideoSphere user configures their own credentials. There are **no shared OpenRouter, Groq, or GCP env keys** for this feature.

A translation **channel** (including the public slug) is created only when you save AI settings. Opening the Translation page alone does not create one. Use **Delete translation channel** to remove the channel, keys, and slug.

## Enable translation (captions)

1. Open **Dashboard → Translation**.
2. Choose **Configure AI**, then pick providers **separately** (no automatic fallback):
   - **STT provider** — streaming ASR: **Deepgram**, **AssemblyAI**, **Gladia**, **Speechmatics**, **Modulate**, **ElevenLabs** (Scribe v2 realtime), or **Soniox** (STT+translation).
   - **Caption translation provider** — Google Cloud Translation (NMT), Groq chat, or OpenRouter chat. **Hidden when STT is Soniox** (Soniox returns translated captions directly).
3. The modal shows each provider’s **free / rate limits**, **post-free pricing**, and a link to the vendor’s pricing or limits page.
4. Paste only the keys required for your choices:
   - Streaming ASR key for the selected STT provider (Deepgram / AssemblyAI / Gladia / Speechmatics / Modulate / ElevenLabs / Soniox).
   - Groq key when caption translation uses Groq ([console.groq.com](https://console.groq.com/)).
   - OpenRouter key when translate uses OpenRouter.
   - Google Cloud service account JSON when translate uses GCP (or reuse one already saved under Google Cloud TTS). Enable **Cloud Translation API** on that project and grant the service account **Cloud Translation API User** (`roles/cloudtranslate.user`).
5. For OpenRouter or Groq caption translation, enter a **chat translation model id**. Streaming ASR and GCP NMT do not need a chat model.
6. In **Languages**, set the **source** language and at least one **target** listen language, then save. Mandarin (`Chinese - Mandarin` / 普通话) and Cantonese (`Chinese - Cantonese` / 粤语) are separate targets so translation text and GCP voices stay aligned.
   - **Deepgram** Mandarin uses `language=zh`.
   - **AssemblyAI** Mandarin uses Universal-3.5 Pro (`u3-rt-pro`) on the streaming WebSocket.
7. Optionally configure the **Public translation page** (enable + slug) when you are ready to share `/listen/{slug}`.
8. Use **Add audio** on the machine running the dashboard page. Choose an input, optionally click **Test mic** to confirm the level meter moves (opens the mic without uploading), then **Add audio** to stream. Switch inputs anytime — including while testing or live. Owner mic ingest alone does **not** open billable STT — upstream ASR starts only when at least one public listener has chosen a language (and stops when the last listener leaves). Streaming STT sends ~**250ms** PCM frames. Near-silent / cutoff frames are skipped (and lone fillers like “Thank you” are dropped) so pauses do not become fake captions. **Stop audio** / **Stop test** releases the mic (and clears the browser tab recording indicator); **Stop audio** also closes upstream ASR sockets.

   Local development: prefer `pnpm dev` (Turbopack). `pnpm dev:webpack` can full-reload other open tabs when `/listen/{slug}` first compiles (webpack HMR `sync` hash change). That does not happen under Turbopack or production `next start`. Ingest intent stays in `sessionStorage` so Add audio can auto-resume after a remount — use **Stop audio** so a later load does not resume unexpectedly.

   **Phone testing / keep screen on:** Chrome on Android only allows the Screen Wake Lock API in a **secure context** (HTTPS or `http://localhost`). Opening `http://192.168.x.x:9624` will dim and sleep as usual. For LAN phone tests run `pnpm dev:https`, then open `https://<your-LAN-IP>:9624/listen/...` and accept the self-signed certificate once. Production deployments behind HTTPS work without extra steps.

### How streaming STT works

| Mode | Behavior |
| --- | --- |
| Streaming (Deepgram, AssemblyAI, Gladia, Speechmatics, Modulate, ElevenLabs) | Session hub opens one long-lived provider WebSocket. Finals create caption segments and enqueue separate MT (+ optional async TTS). |
| Soniox | One Soniox WebSocket **per active listen language** (one-way translation to that target). Same PCM is fanned out. Translated finals skip the separate MT provider. Incremental final tokens are accumulated and soft-split into sentence-sized captions (Latin `.?!` and CJK `。！？`); each committed caption gets its own segment id so prior lines stay on screen. |

### Recommended path for full sermons (~2×50 min/week)

| Stage | Provider | Why |
| --- | --- | --- |
| STT | **Deepgram** (or another streaming ASR) | Low-latency captions; signup credits cover early services. |
| Captions | **Google Cloud Translation (NMT)** (unless Soniox STT) | First **~500,000 characters/month** free — usually enough for a few target languages at sermon volume. OpenRouter `:free` (~50 RPD) is not. |
| Spoken listen | **GCP TTS** (Standard / WaveNet) | Large free character allowances; configure voices after languages. |

Public listeners open `/listen/{slug}` (no login). Choosing a language (while the owner is capturing) opens STT for the channel; choosing the **source language** shows live **transcription only** (no translate API call) and, with spoken audio on, plays **live source PCM** (never GCP TTS). Other languages start translate(+optional TTS) only while at least one listener is connected; when the last listener leaves the channel, upstream STT closes immediately. When the last listener leaves a language, pending translate work stops and that language’s caption cache is dropped after a short reconnect grace (a few seconds). Switching languages does not replay old captions — you only see new live segments.

**Production behind a reverse proxy:** captions and live status use SSE (`/api/translation/public/{slug}/events`). If listeners see long silence then a huge paragraph dump (or a stuck “not connected” banner until refresh), the proxy is buffering the stream. Disable buffering for that path — see [deployment-guide.md → Reverse Proxy Checklist](../deployment-guide.md#reverse-proxy-checklist).

With streaming ASR, interim captions update in place; Deepgram also splits long continuous speech into sentence-sized finals (so captions/TTS do not wait for a multi-minute pause). Spoken listen for **targets** synthesizes TTS only after those finals. Captions are pushed as soon as STT (+ translation when needed) finish. TTS for upcoming lines starts in parallel and is delivered in order, and the listen client prefetches the next clip while the current one plays — short gaps can still happen when the speaker pauses or GCP synthesis lags a long line.

Caption translation clarifies a few ambiguous English sermon collocations in the source before every MT call (so “sinned against the Lord” is not read as fight/defy). OpenRouter / Groq also get a sermon-aware prompt, recent prior source finals, and a Mandarin/Cantonese safety repair if the model still emits 对抗 for that confession. Soniox built-in translation is unchanged.

## Singing and music (automatic caption suppression)

A worship service is not all speech. Captioning hymns produces garbage — lyrics arrive as fragments, Whisper hallucinates on sustained notes, and every stray line costs a translate call plus a TTS clip. The pipeline therefore classifies the owner audio continuously and suppresses captions while music is playing. **There is no toggle for the A/V operator to remember**: OBS streams, the app decides.

What listeners see instead is a marker line in their own language — `♪ Music ♪`, `♪ Música ♪`, `♪ 音乐 ♪` — so the pause reads as intentional rather than as a broken stream. The marker is a fixed UI string, never sent to the translate provider or to TTS. Someone opening `/listen/{slug}` in the middle of a hymn sees the marker immediately.

Source-language listeners with spoken audio on **keep hearing the singing**; only text, translation, and TTS stop.

### How detection works

Analysis runs on the same 16 kHz mono PCM that both **Add audio** and the RTMP/MediaMTX path already produce, so one detector covers both ingest routes. It is pure signal processing — no model download, no native dependency, no per-minute cost:

| Feature | Speech | Singing |
| --- | --- | --- |
| Envelope modulation rate | 3–8 Hz (syllables) | 0.5–2.5 Hz (notes) |
| Sustained pitch runs | Rare — pitch glides continuously | Common — notes are held |
| Voiced share | ~50–65% (stops, plosives) | ~85%+ (near-continuous) |
| Quiet gaps within a window | Frequent | Few |
| Distance from a semitone grid | Large | Small |

Instrument-oriented music detectors look for sustained tones and a beat, which **unaccompanied congregational singing does not have** — it is voices producing words. The pitch-behaviour features above are what separate the two cases, which is why they carry the most weight.

Accompaniment makes the job easier, not harder. A sustained organ, keyboard, or guitar chord scores at the very top of the range, because it exhibits every one of those five traits more strongly than a human voice does. If your church has a band, unaccompanied singing is the case you should calibrate against — get that right and accompanied music follows.

The one **known limitation** is unpitched percussion. Every feature that argues for music describes pitch behaviour, so a drums-only passage with no sung or pitched line reads as speech and captions will resume through it. Worship music essentially always carries a melodic line alongside the percussion, so this shows up in drum breaks rather than in songs.

Transitions are deliberately slow, and deliberately **asymmetric**: entering music takes 2.5 s of sustained evidence, leaving it takes 3 s, and a minimum dwell time prevents flapping between verses. Silence is treated as **neutral**: a gap between verses does not resume captions, and a pause mid-sermon does not trigger the marker.

The asymmetry is the single most important tuning decision, because the two mistakes are not equally bad. Leaving music too early lets hymn lyrics through as captions; resuming a second late costs nothing, since audio from the seconds before the switch is retained and replayed to the provider so the first words after a hymn are not lost. Measured against a full service recording, the same asymmetry also suppresses false positives cheaply: real songs run for **minutes** while false alarms last a **window or two**, so requiring evidence to persist separates them far better than any score threshold can — the score ranges of true songs and false alarms overlap almost completely.

After 10 s of continuous music the upstream ASR socket is closed, which is a real saving across twenty-plus minutes of singing per service. It reopens automatically when speech returns.

**Speechmatics** users get a second opinion: `audio_events_config` reports `music` events on the realtime WebSocket. Speechmatics documents these as over-sensitive to music, so the hub treats them as a vote that can push a borderline window toward music — never as the deciding signal. No other supported provider classifies non-speech audio (Deepgram's `vad_events` only distinguishes sound from silence, and music triggers it).

### Calibrating for your room

Default thresholds are a starting point, not a guarantee — a stone sanctuary with one overhead mic behaves nothing like a padded room with a mixer feed. Tune against real audio rather than guessing. You already have a recording: the sermon capture from OBS.

```bash
pnpm translation:analyze-audio path/to/service-recording.mkv
```

This replays the recording through the detector and prints every transition with a timestamp, so you can compare the detected timeline against what actually happened. Add `--verbose` for per-window feature values, or `--csv out.csv` to plot them.

The script reads the same `.env` files the app does and prints the settings actually in effect, marking each as `env` or `default`. A one-off experiment can be passed inline without editing anything:

```bash
TRANSLATION_MUSIC_THRESHOLD=0.6 pnpm translation:analyze-audio service-recording.mkv
```

Read the **Music episodes** summary at the end before the transition list. It groups the timeline into stretches of music and flags any shorter than 15 s as suspect, because a real song is never that short — a five-second episode is the detector entering music and immediately wanting back out:

```
Music episodes: 3 (2 under 15s)
  0:09:20.8 .. 0:09:26.8  6.0s   <- suspect
  0:09:27.8 .. 0:09:42.3  14.5s  <- suspect
  0:09:43.3 .. 0:11:32.8  109.5s
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRANSLATION_MUSIC_DETECTION` | on | Set to `off` to caption everything, including music |
| `TRANSLATION_MUSIC_THRESHOLD` | `0.55` | Score at or above which a window votes music. Raise if speech is misread as music |
| `TRANSLATION_MUSIC_SPEECH_THRESHOLD` | `0.4` | Score at or below which a window votes speech. Scores in between abstain. Clamped to never exceed the music threshold |
| `TRANSLATION_MUSIC_WINDOW_MS` | `2000` | Analysis window length |
| `TRANSLATION_MUSIC_HOP_MS` | `500` | Interval between classifications |
| `TRANSLATION_MUSIC_ENTER_MS` | `2500` | Sustained music evidence required before suppressing captions |
| `TRANSLATION_MUSIC_EXIT_MS` | `3000` | Sustained speech evidence required before resuming |
| `TRANSLATION_MUSIC_MIN_DWELL_MS` | `5000` | Minimum time held in the music state |

Reach for the timing knobs before the thresholds. Short false episodes and flapping at the start of a song are hysteresis problems, and raising `TRANSLATION_MUSIC_ENTER_MS` / `TRANSLATION_MUSIC_EXIT_MS` fixes them without making the detector blind. Only move `TRANSLATION_MUSIC_THRESHOLD` when whole songs are missed (lower it) or long stretches of preaching are suppressed (raise it).

Leave a variable **unset** to inherit its default. Pinning all of them to their current values in `.env.local` means future default improvements will not reach you. Restart the app after changing any of these.

## Enable listen (spoken translation)

1. Save **Languages** first (source + at least one target).
2. In Google Cloud: enable **Cloud Text-to-Speech** (and Translation API if you use GCP translate), create a service account, download the JSON key. If you use GCP caption translation, assign **Cloud Translation API User** to that service account.
3. On the Translation page under **Google Cloud TTS**, upload/paste the JSON and **Load voices**. Choose a **voice model** first (Standard / WaveNet / Neural2 / Chirp 3 HD / etc.) — the dropdown shows each model’s **free monthly character limit** from [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing). Then pick a voice **per target language** within that model (source is never listed — listeners hear live source PCM instead of TTS). Saving validates credentials and voice names via Google `listVoices`. Legacy source-language voice entries are pruned on save.
4. On `/listen`, **source** always offers spoken audio (live owner PCM). **Targets** offer spoken audio only when a TTS voice is configured; other targets stay captions-only. Channel “Listen ready” means SA + at least one **target** voice are set (and translation is already ready).

### Measuring spoken lag

Some target languages need more time to say the same thing than English does, so their spoken audio can fall progressively further behind the preacher. Before changing anything about speaking rate or translation length, measure it. Set `TRANSLATION_TTS_TIMING_LOG=on`, restart, and run a service (or replay one); the server console prints one line per spoken caption and a summary every 20 clips:

```
[tts-timing fr] # 34  lag=  11.4s  pipeline=3.2s  backlog=8.2s  audio=6.1s  source=4.8s  expand=1.27
[tts-timing fr] 40 clips
  lag       p50 9.8s  p95 15.1s  max 16.4s
  pipeline  p50 3.2s  (fixed cost; not recoverable by speaking faster)
  backlog   p50 6.6s  p95 11.9s
  expansion 1.24x sustained  p50 1.26x  -> falls 14.4s further behind per minute of speech
```

Read it as two separate problems. **`pipeline`** is the fixed cost of transcribe → translate → synthesize. It stays flat, and every simultaneous interpreter has the same lag; speaking faster cannot recover it. **`backlog`** is time spent waiting behind audio still playing, and it is the part that grows.

**`expansion`** is the number that decides whether backlog grows at all: spoken audio duration over the source speech it covers. Below 1.0 the language keeps up and backlog stays at zero. Above 1.0 it grows for as long as the speaker keeps going, and the summary converts the ratio into seconds lost per minute. Long gaps in the source (over 10 s — hymns, pauses, technical breaks) are excluded from the ratio, because counting silence as source speech would make every language look comfortably fast. Those gaps do still drain the backlog, which is why `lag` recovers after a song.

Turn the flag back off afterwards. It logs a line per caption and measures every clip's duration, and it is diagnostic output rather than something to run in production.

### Keeping spoken audio in sync

Live timing showed two separate problems: a fixed ~6–8 s pipeline floor (STT → translate → synthesize), and a backlog that grows when the target language takes longer to speak than the source — or when slow clips arrive in bursts.

VideoSphere recovers the backlog automatically:

1. **Native speaking rate** — GCP TTS synthesizes slightly faster for languages that expand (French defaults to `1.12×` from calibration). Override with `TRANSLATION_TTS_SPEAKING_RATE` (global) or `TRANSLATION_TTS_SPEAKING_RATE_BY_LANG=fr:1.12,es:1.15`. Mandarin measured near `1.0×`, so it stays at native pace.
2. **Client playback recovery** — `/listen` nudges `HTMLAudioElement.playbackRate` up to `1.1×` when lag is well past the pipeline floor, and drops hopelessly stale queued clips (captions stay). The client rate is kept modest so it does not stack with GCP speakingRate into something that sounds rushed. Pitch is preserved by the browser.

Neither removes the fixed pipeline floor. Cutting that further (for example Chirp streaming TTS) is a separate change.

## Optional RTMP (MediaMTX)

Browser **Add audio** does not require MediaMTX (useful for local testing). For OBS/RTMP captions and source listen audio:

### Environment variables (local vs production)

| Variable | Purpose | Local (`pnpm dev` + MediaMTX container) | Production (Compose / Portainer) |
| -------- | ------- | ---------------------------------------- | -------------------------------- |
| `TRANSLATION_RTMP_PUBLIC_HOST` | Host:port OBS uses (Publish URL / Server). No `rtmp://` prefix needed. | LAN IP of this machine, e.g. `192.168.1.51:1935` (or `127.0.0.1:1935` if OBS is on the same machine) | Public or LAN hostname clients reach, e.g. `stream.example.com:1935` or `192.168.1.38:1935` |
| `TRANSLATION_RTMP_PATH_PREFIX` | Path segment before the stream key (`live/<key>`). | `live` (default; usually leave unset) | `live` (default) |
| `TRANSLATION_MEDIAMTX_RTSP_BASE` | Where **the app** pulls RTSP from MediaMTX (not what OBS uses). | `rtsp://127.0.0.1:8554` — app is on the host, MediaMTX ports are published | `rtsp://mediamtx:8554` — Docker DNS name of the `mediamtx` service |

`TRANSLATION_RTMP_PUBLIC_HOST` is for humans/OBS. `TRANSLATION_MEDIAMTX_RTSP_BASE` is for the app’s ffmpeg pull. They are usually different hosts in local dev and the same Docker network name in production.

Example `.env.local` for local OBS testing:

```bash
TRANSLATION_RTMP_PUBLIC_HOST=192.168.1.51:1935
TRANSLATION_RTMP_PATH_PREFIX=live
TRANSLATION_MEDIAMTX_RTSP_BASE=rtsp://127.0.0.1:8554
```

### Run MediaMTX locally (alongside `pnpm dev`)

With the app on the host and MediaMTX in Docker, auth must call the host app (not `http://app:9624`):

```bash
docker run -d --name videosphere-mediamtx \
  --add-host=host.docker.internal:host-gateway \
  -p 1935:1935 -p 8554:8554 \
  -e MTX_RTMP=yes \
  -e MTX_RTSP=yes \
  -e MTX_AUTHMETHOD=http \
  -e MTX_AUTHHTTPADDRESS=http://host.docker.internal:9624/api/translation/rtmp/auth \
  bluenviron/mediamtx:latest
```

On rootless Docker, if the container dies with an `nproc` / rlimit error, add `--pids-limit=-1` (or raise the user `nproc` limit).

Stop/remove: `docker rm -f videosphere-mediamtx`.

### Production / Compose / Portainer

1. Uncomment the `mediamtx` service in `portainer-stack.yml` or `docker-compose.yml`.
2. Set on the **app** (not only MediaMTX):
   - `TRANSLATION_RTMP_PUBLIC_HOST` (and optionally `TRANSLATION_RTMP_PATH_PREFIX`)
   - `TRANSLATION_MEDIAMTX_RTSP_BASE=rtsp://mediamtx:8554`
3. MediaMTX auth in those files points at `http://app:9624/api/translation/rtmp/auth` (same Compose network).

### After MediaMTX is up

1. Restart the app (or ensure env is loaded). On **Dashboard → Translation**, the **RTMP (optional)** section probes MediaMTX over TCP. Stream-key controls appear only while that check succeeds (refresh the page after starting the sidecar).
2. Generate a stream key (or rotate an existing one). In OBS Custom: **Server** = Publish URL (`rtmp://host:1935/live`), **Stream Key** = the key alone. The key is stored encrypted in MongoDB (`live_translation_channels`) so it remains available on later visits (hidden by default; reveal/copy/delete from the dashboard). Multiple users share the same Server URL; each has a unique stream key (`live/<key>`).
3. MediaMTX auth is validated via `POST /api/translation/rtmp/auth` against the owner’s stream key hash. On successful **publish**, the app starts an ffmpeg RTSP pull into the same PCM path as Add audio (`enqueueOwnerPcm`). On unpublish / puller stop, ingest is marked stopped.
4. **STT billing gate is unchanged:** OBS (or Add audio) can be live without burning STT credits. Upstream ASR opens only while someone is on `/listen` with a language selected.
5. Optional: `TRANSLATION_RTMP_HOOK_SECRET` for an internal `POST /api/translation/rtmp/publisher` webhook. The primary start path is auth → puller (official MediaMTX images often lack `curl` for `runOnAvailable`).
