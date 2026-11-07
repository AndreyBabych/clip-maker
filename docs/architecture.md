# Architecture and extension points

Browser → authenticated Express API → PostgreSQL project documents, immutable asset metadata and durable jobs. Worker → provider queue / FFmpeg → S3. Browser accesses media through an authenticated route that issues short-lived S3 URLs.

`lib/app.js`: HTTP/authentication and owner workspace authorization. `domain.js`: validation and production gates. `lib/generation.js`: revision-bound estimates, confirmation and budget reservation. `lib/worker.js`: queue claims, lease recovery, provider polling and asset persistence. `lib/providers.js`: explicit provider contracts. `lib/export.js`: timebase normalization and xmeml package. `lib/storage.js`: S3 and development-only filesystem implementations. `lib/db.js`: migrations and production/local SQL adapters.

The source of truth for approvals is persistent project selection + asset approval state. Changing content clears concept/scene/reference approvals; it does not delete previous media. Updating a project requires the last revision number. Provider inputs are frozen into the confirmed job payload so the history records the exact creative request.

Runtime states: queued → submitting → polling → succeeded/failed. Local media work uses processing. Interrupted paid submission becomes uncertain; interrupted local work can safely resume. No automatic submission retries. Project pause stops claims/polling, not remote execution. There is no provider webhook surface in this version, so repeated webhook delivery cannot submit duplicate work.

Future Telegram/n8n integrations should call a separately authenticated, narrowly scoped API gateway that maps to the same project validation, quote and explicit approval operations. Never expose the admin session or accept direct provider submissions that bypass budget and approval gates. A future Windows companion should use revocable credentials and pull ZIP exports over HTTPS. No inbound ports on the user's PC are needed.

Operational limits: one owner; one web instance for current per-process rate limits; bounded provider concurrency; one export worker recommended initially. Export uses temporary disk and two FFmpeg threads per clip. PostgreSQL/S3 backups and lifecycle rules are deployment responsibilities. Avoid deleting source objects referenced by assets. Full project history restore and automatic billing reconciliation are not implemented.
