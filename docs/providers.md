# Provider contracts checked 2026-11-07

Implemented via fal's authenticated queue, with separate submit/status/result methods and cancellation adapter:

- [FLUX Kontext Max text-to-image](https://fal.ai/models/fal-ai/flux-pro/kontext/max/text-to-image/api): `fal-ai/flux-pro/kontext/max/text-to-image`.
- [FLUX Kontext Max multi-reference](https://fal.ai/models/fal-ai/flux-pro/kontext/max/multi/api): `fal-ai/flux-pro/kontext/max/multi`; multiple `image_urls`, explicitly experimental. Style and assigned approved profile images are included.
- [Kling 3 Standard](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api): `fal-ai/kling-video/v3/standard/image-to-video`; `start_image_url`, string duration 3–15 seconds, native audio disabled so the music track controls the soundtrack.
- [Seedance 1 Pro](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/image-to-video/api): `fal-ai/bytedance/seedance/v1/pro/image-to-video`; `image_url`, string duration 2–12 seconds, aspect ratio and supported resolution.
- [Queue submission](https://fal.ai/docs/api-reference/inference-api/queue/submit), [status](https://fal.ai/docs/api-reference/inference-api/queue/status), [result](https://fal.ai/docs/api-reference/inference-api/queue/result), [cancellation](https://fal.ai/docs/api-reference/inference-api/queue/cancel). The worker saves returned queue URLs and request ID. `COMPLETED` can also represent failure, so the error field and result are checked.

Kling 2.1 Master is explicitly marked deprecated in its current API page and is not offered. Provider availability may change; a documented adapter is not evidence that a particular account can call it. Native Kling/ByteDance direct APIs have not been implemented. Additional models should be added to the explicit registry with documented request contracts, not accepted as arbitrary frontend endpoint strings.

The screenplay adapter uses [OpenAI JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) with an explicitly configured model. The prompt asks for JSON, then application validation rejects malformed scenes and timestamps outside analyzed audio duration. It receives duration and supplied creative text, not the audio waveform or an invented musical interpretation. There is no multi-turn conversation history UI yet; revision feedback is submitted with current project context.

No provider prices are hardcoded. No live generation was paid for or performed during development. Configure keys and test a small approved request before a batch.
