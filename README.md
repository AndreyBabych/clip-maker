# Clip Maker — studio foundation

This milestone is a working project and storyboard editor, **not the complete Phase 1 or video-production MVP**. React/TypeScript frontend, Express backend, PostgreSQL persistence. It supports a private owner login with hashed opaque database sessions, project creation/duplication/archive, timed scene CRUD and concept approval, character/location text profiles and approvals, optimistic concurrency, and an explicitly temporary in-memory demo. No paid jobs are submitted.

## Local setup

Node 24 and PostgreSQL are required. Create an empty `clipmaker` database. Copy `.env.example` to `.env`, choose a random password of at least 16 characters, and set the database connection. Never commit `.env`.

```
npm ci
npm test
npm run build
node --env-file=.env server.js
```

Open http://localhost:3000. Database tables are created idempotently on startup from `migrations/001.sql`. This migration is additive; future schema changes need numbered migrations and a migration ledger. The private studio has one owner identity, no public registration. Sessions expire after 12 hours. Set `APP_ORIGIN` to the exact browser origin (no trailing slash). Demo data disappears on reload; authenticated projects persist in PostgreSQL. The demo can be previewed with `npm run dev`; authenticated development uses the built server.

## Render

Create a **new Blueprint** for this repository using `render.yaml`; it names only `clip-maker-studio` and `clip-maker-db`. Review Render's selected compute/database plans and costs before creation. Set ADMIN_PASSWORD and APP_ORIGIN to the new service's HTTPS origin. Never attach this application to `dukhy-lisu`. No service or DNS changes have been performed by this implementation. Once separately approved/configured, `clips.andygraviton.com` can be attached in Render and APP_ORIGIN updated. Reference: https://render.com/docs/blueprint-spec and https://render.com/docs/deploy-node-express-app.

## API and consistency

POST /api/login, POST /api/logout; GET/POST /api/projects; PUT /api/projects/:id. Writes require the exact Origin and an authenticated HttpOnly SameSite cookie. PUT includes `{revision,document}` and returns 409 on conflicting edits. Project bodies are validated by Zod. Editing a scene clears its concept approval in the UI. Scene ordering is independent of explicit timestamps; moving a scene does not silently move its timecodes. Timeline currently lists timestamps, not a media playback timeline. Projects use one private owner workspace.

## Remaining work, in order

1. Complete Phase 1: S3 private assets with validated upload limits and authorized download URLs; audio upload and worker-based ffprobe/waveform; real reference images, wardrobe variants, scene reference assignments, waveform playback/scrubbing, musical sections; richer pipeline approvals and drag reorder.
2. Add durable PostgreSQL job queue/independent worker and provider adapters. Preserve immutable asset versions. Require explicit user approval at each production checkpoint. Research official provider documentation before implementing OpenAI, Kling or Seedance. They are **not integrated** here.
3. Add generation idempotency and external job reconciliation, bounded concurrency, retry policy, project budget reservation and confirmed-cost ledger. Unknown pricing must remain unavailable.
4. Implement export worker with FFmpeg, selected video versions, media ZIP, manifest and validated FCP 7 XML. Test the actual import in Premiere on Windows. No XML or Premiere compatibility is claimed in this milestone.
5. Add end-to-end database/session tests and browser verification before production use. Current automated tests cover input validation only. Production authentication needs operational review of proxy configuration and deployment-level rate limits; current rate limits are per-process.

No media, queues, AI calls, exports, cost estimates or fake generated assets are presented as implemented. Google Fonts is optional presentation only; the interface falls back to system sans-serif.
