# Clip Maker

## Five-step studio migration (November 2026)

The project now opens in the five-stage wizard: **Ключ → Сюжет → Раскадровка → Генерация → Монтаж**. The previous editor panels are grouped inside those steps, using the same projects, assets, job queue, authentication, provider adapters and export format. `document.workflow` stores explicit stage approvals; old documents receive unapproved defaults when read. Editing an approved step requires an unlock action and marks downstream approvals stale while keeping old media versions and the project history.

The storyboard player switches the selected static image according to the actual audio player's current time. A local provisional shot split can be proposed from track length; it is a timing helper, not an AI interpretation of beats. AI screenplay generation can now start before the track is uploaded, with provisional timing. Voice uses OpenAI `gpt-transcribe` when `OPENAI_API_KEY` is configured. Without a key, browsers exposing SpeechRecognition can transcribe through their own speech service; availability and microphone permission depend on the browser. If neither route is available, the UI says so explicitly. See [official transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text). Browser speech startup was tested locally, but recognition of spoken words and paid generation remain unverified.

Current gaps: AI does not yet derive shot count or targeted natural-language storyboard edits; the provisional split is deterministic. Video feedback is appended to the generation prompt, not rewritten by a separate AI prompt engineer. The demo export still downloads a clearly labeled fixed sample ZIP. Import in the user's installed Premiere remains unverified. The five-stage demo path, uploaded key preview and browser speech start/stop have been visually tested locally; real provider credentials and speech input still need live acceptance testing.

Private music-video production studio: React/TypeScript, Express, PostgreSQL, private S3 storage and a separate FFmpeg worker. The interface is in Russian. The director explicitly approves concepts, references, storyboard and individual media versions.

## Run locally on Windows

Node.js 24 is required. Windows FFmpeg binaries are optional npm dependencies; on Linux install `ffmpeg` with your OS package manager.

```powershell
npm ci
npm run setup:local
npm run build
npm run local
```

Open `http://localhost:3000`. A generated private password is saved in `.local/login.txt`; `.env.local` contains local settings. Both are ignored by git. Use **Посмотреть демо** without signing in to explore the clearly labeled synthetic sample. Demo changes live only until reload, and its export is a fixed example package, not a rendering of current demo edits.

Local mode persists data in PGlite, an embedded PostgreSQL engine, under `.local/db`, and media under `.local/media`. Only one local server process may open it. The local launcher runs the queue coordinator in-process; FFmpeg runs as a child process. Production uses actual PostgreSQL and a separate worker service. The server refuses local media storage in production.

For regular PostgreSQL, copy `.env.example` to `.env`, configure it, then run `node --env-file=.env server.js` and `node --env-file=.env worker.js` in separate terminals. The web server binds loopback in development. Do not expose development mode publicly.

## Implemented workflow

1. Create a project, upload MP3/WAV, wait for analysis, then approve/select the track. Uploads are checked by file signatures, limited to 256 MB (images 20 MB), and analyzed by the worker. Audio must be at most one hour.
2. Write the concept or request an AI screenplay. AI results remain job results until explicitly applied. Applying a draft archives the previous project document and clears approvals.
3. Save edits before approving concept/style/storyboard checkpoints. Choose a style frame, then character/location images. Profiles include appearance, clothes, notes and text variants. A scene can reference multiple characters and one location. Variant-specific image selection is a future extension; current generation uses each profile's chosen reference and base clothing.
4. Edit scenes with timestamps, framing, movement and separate image/video prompts. Drag cards to change display order; explicit times remain unchanged. Use Timeline to scrub real audio, mark beats, define musical sections, and change boundaries. Automatic musical structure/beat detection is deliberately not claimed.
5. Generate single or selected batches of images/video after an explicit cost confirmation. Compare versions, approve/reject them, choose final versions, or approve selected media as a batch. Rejected and superseded assets remain available.
6. Queue work survives restarts. Pause blocks new processing/polling; already submitted remote work may still finish and charge at the provider. Resume retrieves it. Cancel only removes locally queued jobs. Provider cancellation exists in the adapter but is not exposed as guaranteed billing cancellation.
7. Export approved selected videos and music as a ZIP with frame-aligned FCP 7 XML, normalized clips, original music, editing WAV, manifest and a Windows path-relink script.

## Provider configuration

Set credentials only in environment variables, never the browser:

| Purpose    | Settings                                                                            | Implemented adapter                                                     |
| ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Images     | `FAL_KEY`                                                                           | FLUX Kontext Max text-to-image and experimental multi-reference editing |
| Video      | `FAL_KEY`                                                                           | Kling 3 Standard and Seedance 1 Pro through fal.ai                      |
| Screenplay | `OPENAI_API_KEY`, `OPENAI_MODEL`                                                    | OpenAI Chat Completions JSON mode; output validated before use          |
| Media      | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private S3-compatible bucket                                            |

The model must be accessible to your account. Configuration indicators report whether settings exist, **not** verified account access, credits or successful generation. No paid provider requests were made during implementation. Contracts were checked against [the documented APIs](docs/providers.md); network behavior is tested with injected adapters. These integrations still require live credential verification.

The bucket must be private and the server credential restricted to its object operations. Files are served through authenticated endpoints; S3 downloads use signed URLs valid for one hour. People holding a signed URL can access that object until it expires. Never log signed URLs. Local reference files are sent to fal as data URIs; S3 references use signed URLs.

Optional `PROVIDER_ESTIMATES_JSON` maps `flux-text`, `flux-reference`, `kling`, `seedance` and `screenplay` to `{ "usd": <verified-number>, "unit": "request" | "second" }`. No prices are supplied. Estimates are operator-maintained, not confirmed charges. Unavailable costs require explicit acknowledgment; a configured project spending limit blocks unpriced work. Budget checks reserve estimates transactionally and conservatively retain reservations for failed/uncertain paid jobs. This bounds estimated commitments, not a provider's final bill. Confirmed cost fields are reserved for a future verified billing reconciliation integration.

## Durable jobs and failure handling

The PostgreSQL queue uses row locks, leases, heartbeat and `SKIP LOCKED`; `PROVIDER_CONCURRENCY` defaults to 2 external requests. Each quote is tied to a project revision, expires after five minutes, and creates each target only once. Confirmation and budget reservation are one database transaction.

A worker persists `submitting` **before** contacting a paid service. If acceptance cannot be established (timeout, crash, malformed response), the job becomes `uncertain`; it is never automatically resubmitted. For fal, retrieve the correct Request ID from provider history and use **Сверить с провайдером**. The application then polls that existing request. This is intentionally conservative: without a provider-supported idempotency contract, automatic exactly-once paid submission cannot be guaranteed. Uncertain screenplay submissions require operator review; no automatic retry exists for them.

Known external IDs are polled and fetched again without generation resubmission. Download failures can be retried. Expired provider download links are handled by retrieving the existing result again; regeneration is never automatic. Media downloads allow only documented fal media hosts over HTTPS, validate redirects, pin DNS resolution to public IPv4, enforce size/time limits, and validate downloaded content. Webhooks are not used; polling avoids duplicate webhook side effects.

## Render deployment

**Deployment is on hold. Do not apply the existing Blueprint without explicit cost approval.** The `render.yaml` file describes the original always-on-worker option, not the recommended small-volume setup. See [hosting costs and alternatives](docs/hosting.md).

For an explicitly launched on-demand PostgreSQL worker, run `node worker-session.js`. It processes pending work, waits through provider polling delays, and exits when the queue is empty or after a 15-minute claim window (`WORKER_SESSION_SECONDS`, maximum 3600). A running task finishes gracefully after the window. Paused/archived projects do not keep the session alive. Remaining work stays in PostgreSQL for the next session. This command does not create Render resources or call Render's control API. Automatic on-demand job launch/relaunch is not implemented; the operator must explicitly launch another session for later work. Do not use the perpetual `worker.js` command for a billed one-off job.

### Persistent local demo with real processing

While `npm run local` is running, open a second terminal in the repository and run:

```powershell
node --env-file=.env.local scripts/seed-local-demo.js
```

It creates a new sample project through the authenticated API, uploads synthetic audio and three video clips, waits for actual analysis, selects approved media and produces a real ZIP from that project's timeline. It makes no AI requests. Sign in using `.local/login.txt` to edit this persistent project and export your changes. The generated package is also saved as `.local/demo-export.zip`. Each execution creates a separate sample project; existing work is preserved.

`render.yaml` creates **clip-maker-studio**, **clip-maker-worker**, **clip-maker-db** and **clip-maker-config**. It does not target `dukhy-lisu` or any existing website. Docker installs FFmpeg. Review Render's selected plans and cost before creating these resources. Start with one worker; rendering is CPU-intensive and uses temporary disk proportional to the export package. Keep persistent assets in S3.

Set the configuration values in Render and `APP_ORIGIN` to the exact new HTTPS service origin, without trailing slash. Set a strong `ADMIN_PASSWORD`. `TRUST_PROXY_HOPS` defaults to 1 for the Render proxy. If you change proxy topology, review this and rate limiting before public use. In-memory rate limits apply per web instance; keep one web instance or add a shared limiter before horizontal scaling.

After deployment verification, add `clips.andygraviton.com` to **this new service** and update `APP_ORIGIN`. Domain/DNS changes and production deployment have not been performed. See [Render Blueprint reference](https://render.com/docs/blueprint-spec).

Migrations run transactionally using `schema_migrations` and a table lock. Back up PostgreSQL and S3 before production migrations. Existing project documents are normalized with additive defaults; edits retain a revision snapshot in `project_history`. There is currently no history browser/restore UI. Archive is reversible. Cross-project duplication copies creative text and scenes, clears media selections/approvals, and keeps source media in its original project.

## Premiere export

See [Premiere import instructions](docs/premiere.md). XML structure and timing are tested, and an actual ZIP is generated from synthetic media in integration tests. **Import in Adobe Premiere Pro has not been tested here.** Verify the sample package in your installed Premiere version before relying on it for a full production. Native `.prproj`, transitions, multitrack effects and direct Premiere automation are not implemented.

## Verification

```text
npm run lint
npm run build
npm test
```

`lint` checks consistent formatting; the build type-checks the frontend. Integration tests use real embedded PostgreSQL SQL semantics, local HTTP endpoints, FFmpeg and filesystem storage. They cover authentication/CSRF, conflicting edits, file type checks, ownership boundaries, actual audio/video analysis and ZIP export, paid submission ambiguity, queue recovery, idempotent confirmation, budget reservation and XML timing. Provider calls are mocked; S3/Render/live AI services are not end-to-end verified. CI repeats the checks on Ubuntu with system FFmpeg.

Browser checks exercised the demo, batch confirmation, result selection, audio seeking, beat editing and responsive layouts at narrow and desktop widths. Paid AI output quality and reference consistency depend on the selected provider.

## Deliberate scope limits

This is a private single-owner studio. It does not yet include public signup, multiple tenants, Telegram, n8n automation, cross-project asset sharing, automatically verified billing, automatic beat detection, per-outfit reference generation, or a full Windows downloader app. The included `Relink.ps1` is a local package utility and opens no inbound connection. Further integration points are documented in [architecture notes](docs/architecture.md).
