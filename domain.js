import { z } from "zod";
const text = z.string().max(20000),
  id = z.uuid(),
  optionalId = id.nullable().default(null);
export const sceneSchema = z
  .object({
    id,
    title: z.string().min(1).max(200),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    description: text,
    prompt: text,
    videoPrompt: text.default(""),
    framing: text.default(""),
    movement: text.default(""),
    characterIds: z.array(id).default([]),
    locationId: optionalId,
    approved: z.boolean(),
    imageId: optionalId,
    videoId: optionalId,
  })
  .refine((s) => s.end > s.start && s.end <= 3600, {
    message: "Scene end must follow start and be within one hour",
  });
const reference = z.object({
  id,
  name: z.string().min(1).max(200),
  description: text,
  appearance: text.default(""),
  clothing: text.default(""),
  notes: text.default(""),
  variants: z
    .array(z.object({ name: text, description: text }))
    .max(20)
    .default([]),
  approved: z.boolean(),
  assetId: optionalId,
});
export const projectSchema = z
  .object({
    title: z.string().min(1).max(200),
    idea: z.string().max(50000),
    lyrics: text.default(""),
    concept: text.default(""),
    conceptApproved: z.boolean().default(false),
    storyboardApproved: z.boolean().default(false),
    stylePrompt: text.default(""),
    styleId: optionalId,
    audioId: optionalId,
    ratio: z.enum(["16:9", "9:16", "1:1"]),
    resolution: z.enum(["720p", "1080p"]).default("1080p"),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(25),
    budget: z.number().positive().max(100000).nullable().default(null),
    paused: z.boolean().default(false),
    archived: z.boolean(),
    scenes: z.array(sceneSchema).max(200),
    characters: z.array(reference).max(100),
    locations: z.array(reference).max(100),
    beats: z.array(z.number().nonnegative().max(3600)).max(5000).default([]),
    sections: z
      .array(
        z
          .object({
            name: z.string().min(1).max(100),
            start: z.number().nonnegative(),
            end: z.number().positive(),
          })
          .refine((s) => s.end > s.start),
      )
      .max(100)
      .default([]),
  })
  .superRefine((d, ctx) => {
    for (const key of ["scenes", "characters", "locations"])
      if (new Set(d[key].map((x) => x.id)).size !== d[key].length)
        ctx.addIssue({ code: "custom", message: "Duplicate identifiers" });
    for (const s of d.scenes) {
      if (
        s.characterIds.some((i) => !d.characters.some((c) => c.id === i)) ||
        (s.locationId && !d.locations.some((l) => l.id === s.locationId))
      )
        ctx.addIssue({
          code: "custom",
          message: "Scene references missing profile",
        });
    }
  });
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status, public: true });
}
export function normalizeUpdate(old, next) {
  if (old.idea !== next.idea || old.concept !== next.concept)
    next.conceptApproved = false;
  if (old.stylePrompt !== next.stylePrompt) next.styleId = null;
  for (const kind of ["characters", "locations"])
    for (const r of next[kind]) {
      const prev = old[kind].find((x) => x.id === r.id);
      if (
        prev &&
        [
          "name",
          "description",
          "appearance",
          "clothing",
          "notes",
          "variants",
        ].some((k) => JSON.stringify(prev[k]) !== JSON.stringify(r[k]))
      )
        r.approved = false;
    }
  for (const s of next.scenes) {
    const prev = old.scenes.find((x) => x.id === s.id);
    if (
      prev &&
      [
        "title",
        "start",
        "end",
        "description",
        "prompt",
        "videoPrompt",
        "framing",
        "movement",
        "characterIds",
        "locationId",
      ].some((k) => JSON.stringify(prev[k]) !== JSON.stringify(s[k]))
    )
      s.approved = false;
  }
  if (
    JSON.stringify(old.scenes) !== JSON.stringify(next.scenes) ||
    old.audioId !== next.audioId
  )
    next.storyboardApproved = false;
  return next;
}
export function assertImageGate(d, s, assets) {
  if (!d.conceptApproved || !d.storyboardApproved)
    fail("Approve the concept and storyboard first");
  const approvedImage = (assetId) =>
    assets.some(
      (a) => a.id === assetId && a.state === "approved" && a.kind === "image",
    );
  if (!approvedImage(d.styleId)) fail("Select an approved visual style first");
  for (const r of [
    ...d.characters.filter((c) => s.characterIds.includes(c.id)),
    ...d.locations.filter((l) => l.id === s.locationId),
  ])
    if (!r.approved || !approvedImage(r.assetId))
      fail("Approve every assigned character and location reference first");
  if (!s.approved) fail("Approve this scene concept first");
}
export function sceneStatus(d, s, assets, jobs) {
  const active = jobs.find(
    (j) =>
      j.target_id === s.id &&
      ["queued", "submitting", "polling", "processing", "uncertain"].includes(
        j.state,
      ),
  );
  if (active)
    return active.state === "uncertain"
      ? "Submission needs reconciliation"
      : active.kind === "image"
        ? "Image generating"
        : "Video generating";
  if (assets.some((a) => a.id === s.videoId && a.state === "approved"))
    return "Video approved";
  if (
    assets.some(
      (a) => a.target_id === s.id && a.kind === "video" && a.state === "review",
    )
  )
    return "Video review";
  if (assets.some((a) => a.id === s.imageId && a.state === "approved"))
    return "Image approved";
  if (
    assets.some(
      (a) => a.target_id === s.id && a.kind === "image" && a.state === "review",
    )
  )
    return "Image review";
  try {
    assertImageGate(d, s, assets);
    return "Ready for image generation";
  } catch {
    return s.approved ? "Awaiting reference approval" : "Draft";
  }
}
