import { fail } from "../domain.js";
import { z } from "zod";
export const models = {
  "flux-text": {
    id: "fal-ai/flux-pro/kontext/max/text-to-image",
    kind: "image",
    name: "FLUX Kontext Max",
  },
  "flux-reference": {
    id: "fal-ai/flux-pro/kontext/max/multi",
    kind: "image",
    name: "FLUX Kontext Max · references (experimental)",
  },
  kling: {
    id: "fal-ai/kling-video/v3/standard/image-to-video",
    kind: "video",
    name: "Kling 3 · Standard",
    min: 3,
    max: 15,
  },
  seedance: {
    id: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    kind: "video",
    name: "Seedance 1 Pro",
    min: 2,
    max: 12,
  },
};
export function modelInput(
  key,
  { prompt, ratio, duration, resolution, referenceUrls = [] },
) {
  const m = models[key];
  if (!m) fail("Unsupported model");
  if (m.kind === "image")
    return {
      prompt,
      aspect_ratio: ratio,
      num_images: 1,
      output_format: "png",
      ...(key === "flux-reference" ? { image_urls: referenceUrls } : {}),
    };
  if (!Number.isInteger(duration) || duration < m.min || duration > m.max)
    fail(`Duration for ${m.name} must be ${m.min}–${m.max} seconds`);
  if (!referenceUrls[0]) fail("An approved source image is required");
  return key === "kling"
    ? {
        prompt,
        start_image_url: referenceUrls[0],
        duration: String(duration),
        generate_audio: false,
      }
    : {
        prompt,
        image_url: referenceUrls[0],
        duration: String(duration),
        aspect_ratio: ratio,
        resolution,
        enable_safety_checker: true,
      };
}
export function queueUrl(url) {
  const u = new URL(url);
  if (u.origin !== "https://queue.fal.run" || u.username || u.password)
    throw Error("Invalid provider queue URL");
  return u.href;
}
export class FalProvider {
  constructor(env = process.env, fetcher = fetch) {
    this.env = env;
    this.fetcher = fetcher;
  }
  async call(url, method = "GET", body) {
    const r = await this.fetcher(queueUrl(url), {
      method,
      headers: {
        Authorization: `Key ${this.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!r.ok)
      throw Object.assign(Error(`Provider request failed (${r.status})`), {
        httpStatus: r.status,
      });
    return r.json();
  }
  async submit(model, input) {
    if (!this.env.FAL_KEY) throw Error("FAL_KEY is not configured");
    return this.call("https://queue.fal.run/" + model, "POST", input);
  }
  status(external) {
    return this.call(external.status_url);
  }
  result(external) {
    return this.call(external.response_url);
  }
  cancel(external) {
    return this.call(external.cancel_url, "PUT");
  }
  getSupportedModels() {
    return models;
  }
}
export function estimate(env, key, duration = 1) {
  let prices;
  try {
    prices = JSON.parse(env.PROVIDER_ESTIMATES_JSON || "{}");
  } catch {
    return null;
  }
  const p = prices[key];
  if (
    !p ||
    !Number.isFinite(p.usd) ||
    p.usd < 0 ||
    !["request", "second"].includes(p.unit)
  )
    return null;
  return Math.round(p.usd * (p.unit === "second" ? duration : 1) * 1e6) / 1e6;
}
export const draftSchema = z.object({
  concept: z.string().min(1).max(20000),
  scenes: z
    .array(
      z
        .object({
          title: z.string().min(1).max(200),
          start: z.number().nonnegative(),
          end: z.number().positive(),
          description: z.string().max(20000),
          prompt: z.string().max(20000),
          videoPrompt: z.string().max(20000),
        })
        .refine((s) => s.end > s.start && s.end <= 3600),
    )
    .min(1)
    .max(200),
});
export async function screenplay(env, payload, fetcher = fetch) {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL)
    throw Error("Configure OPENAI_API_KEY and OPENAI_MODEL");
  const r = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a music video director. Return JSON with concept (string), scenes (array of title,start,end,description,prompt,videoPrompt). Times are seconds. Plan shots within the supplied track duration. Do not claim beat or musical structure analysis. Preserve supplied character and location descriptions. User must approve your draft. No markdown.",
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
    signal: AbortSignal.timeout(120000),
    redirect: "error",
  });
  if (!r.ok) throw Error(`Screenplay provider failed (${r.status})`);
  const data = await r.json();
  const draft = draftSchema.parse(
    JSON.parse(data.choices?.[0]?.message?.content || ""),
  );
  return { draft, usage: data.usage || null };
}
