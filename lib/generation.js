import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, assertImageGate } from "../domain.js";
import { models, estimate } from "./providers.js";
import { project, assetsFor } from "./repository.js";
export const generationSchema = z.object({
  kind: z.enum(["image", "video", "screenplay", "export"]),
  targets: z.array(z.string().min(1).max(100)).min(1).max(30),
  model: z
    .enum(["flux-text", "flux-reference", "kling", "seedance"])
    .optional(),
  duration: z.number().int().min(2).max(15).default(5),
  feedback: z.string().max(20000).default(""),
  shortPolicy: z.enum(["reject", "freeze"]).default("reject"),
});
export async function prepareQuote(db, env, storage, projectId, input) {
  const p = await project(db, projectId),
    d = p.document;
  if (d.paused || d.archived) fail("Resume or unarchive the project first");
  const args = generationSchema.parse(input);
  if (new Set(args.targets).size !== args.targets.length)
    fail("Duplicate targets");
  const assets = await assetsFor(db, p.id),
    tasks = [];
  if (args.kind !== "export" && !storage.configured)
    fail("Configure media storage first");
  if (["image", "video"].includes(args.kind) && !env.FAL_KEY)
    fail("FAL_KEY is not configured", 503);
  if (args.kind === "screenplay" && (!env.OPENAI_API_KEY || !env.OPENAI_MODEL))
    fail("Configure the screenplay provider", 503);
  for (const target of args.targets) {
    let prompt = "",
      referenceIds = [],
      modelKey = args.model;
    if (args.kind === "screenplay") {
      if (target !== "project" || args.targets.length !== 1)
        fail("Invalid screenplay target");
      const audio = assets.find(
        (a) => a.id === d.audioId && a.state === "approved",
      );
      if (!audio?.metadata.duration)
        fail("Upload and select an analyzed music track first");
      tasks.push({
        target,
        kind: args.kind,
        model: env.OPENAI_MODEL,
        provider: "openai",
        estimated: estimate(env, "screenplay"),
        payload: {
          idea: d.idea,
          lyrics: d.lyrics,
          concept: d.concept,
          characters: d.characters,
          locations: d.locations,
          feedback: args.feedback,
          duration: audio.metadata.duration,
        },
      });
      continue;
    }
    if (args.kind === "export") {
      if (target !== "project" || args.targets.length !== 1)
        fail("Invalid export target");
      if (
        !d.conceptApproved ||
        !d.storyboardApproved ||
        d.scenes.some((s) => !s.approved)
      )
        fail("Approve the concept and storyboard before export");
      tasks.push({
        target,
        kind: "export",
        provider: "local",
        estimated: 0,
        payload: {
          document: d,
          revision: p.revision,
          shortPolicy: args.shortPolicy,
        },
      });
      continue;
    }
    const s = d.scenes.find((s) => s.id === target),
      r = [...d.characters, ...d.locations].find((r) => r.id === target);
    if (args.kind === "image") {
      if (target === "style") {
        if (!d.conceptApproved) fail("Approve the concept first");
        prompt = d.stylePrompt || d.idea;
      } else if (r) {
        if (
          !d.styleId ||
          !assets.some((a) => a.id === d.styleId && a.state === "approved")
        )
          fail("Approve a visual style first");
        referenceIds = [d.styleId];
        prompt = [
          r.name,
          r.description,
          r.appearance,
          r.clothing,
          r.notes,
        ].join("\n");
      } else if (s) {
        assertImageGate(d, s, assets);
        referenceIds = [
          d.styleId,
          ...d.characters
            .filter((c) => s.characterIds.includes(c.id))
            .map((c) => c.assetId),
          ...d.locations
            .filter((l) => l.id === s.locationId)
            .map((l) => l.assetId),
        ].filter(Boolean);
        prompt = [
          s.prompt || s.description,
          s.framing,
          s.movement,
          d.stylePrompt,
          ...d.characters
            .filter((c) => s.characterIds.includes(c.id))
            .map(
              (c) =>
                `${c.name}: ${c.description} ${c.appearance} ${c.clothing}`,
            ),
        ].join("\n");
      } else fail("Unknown image target");
      modelKey = referenceIds.length ? "flux-reference" : "flux-text";
    } else {
      if (!s) fail("Unknown scene");
      assertImageGate(d, s, assets);
      const image = assets.find(
        (a) =>
          a.id === s.imageId &&
          a.target_id === s.id &&
          a.kind === "image" &&
          a.state === "approved",
      );
      if (!image) fail("Select an approved scene image first");
      if (!["kling", "seedance"].includes(modelKey))
        fail("Choose a video model");
      const m = models[modelKey];
      if (args.duration < m.min || args.duration > m.max)
        fail(`Supported duration: ${m.min}–${m.max} seconds`);
      referenceIds = [image.id];
      prompt = s.videoPrompt || [s.description, s.movement].join("\n");
    }
    if (!prompt.trim()) fail("Enter a generation prompt");
    tasks.push({
      target,
      kind: args.kind,
      provider: "fal",
      model: models[modelKey].id,
      estimated: estimate(env, modelKey, args.duration),
      payload: {
        modelKey,
        prompt,
        referenceIds,
        ratio: d.ratio,
        resolution: d.resolution,
        duration: args.duration,
      },
    });
  }
  const estimated = tasks.some((t) => t.estimated === null)
      ? null
      : tasks.reduce((a, t) => a + t.estimated, 0),
    id = randomUUID();
  await db.query(
    "INSERT INTO quotes(id,project_id,revision,payload,estimated,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')",
    [id, p.id, p.revision, JSON.stringify(tasks), estimated],
  );
  return {
    id,
    estimated,
    currency: "USD",
    pricingSource:
      estimated === null
        ? "Cost unavailable"
        : "Operator-configured estimate; not a confirmed charge",
    count: tasks.length,
    models: tasks.map((t) => t.model).filter(Boolean),
    expiresIn: 300,
  };
}
export async function confirmQuote(db, projectId, quoteId, unknownAccepted) {
  return db.transaction(async (c) => {
    const p = await project(c, projectId, true),
      d = p.document;
    const q = (
      await c.query(
        "SELECT * FROM quotes WHERE id=$1 AND project_id=$2 FOR UPDATE",
        [quoteId, projectId],
      )
    ).rows[0];
    if (!q) fail("Quote not found", 404);
    if (q.used)
      return (await c.query("SELECT * FROM jobs WHERE quote_id=$1", [q.id]))
        .rows;
    if (new Date(q.expires_at) < new Date() || q.revision !== p.revision)
      fail("Project changed or quote expired. Request a new estimate.", 409);
    if (d.paused || d.archived) fail("Project paused or archived");
    if (q.estimated === null && !unknownAccepted)
      fail("Explicitly accept that the cost is unavailable");
    if (d.budget !== null) {
      if (q.estimated === null)
        fail("A spending limit requires configured price estimates");
      const prior = await c.query(
        "SELECT estimated,confirmed,state FROM jobs WHERE project_id=$1 AND provider!='local' AND state!='cancelled'",
        [p.id],
      );
      if (prior.rows.some((j) => j.estimated === null && j.confirmed === null))
        fail("Unpriced prior jobs prevent enforcing the spending limit");
      const reserved = prior.rows.reduce(
        (sum, j) => sum + Number(j.confirmed ?? j.estimated),
        0,
      );
      if (reserved + Number(q.estimated) > d.budget)
        fail("Project spending limit would be exceeded");
    }
    const results = [];
    for (const t of q.payload) {
      const pending = await c.query(
        "SELECT id FROM jobs WHERE project_id=$1 AND target_id=$2 AND kind=$3 AND state IN ('queued','submitting','polling','processing','uncertain')",
        [p.id, t.target, t.kind],
      );
      if (pending.rows.length)
        fail("This target already has an active job", 409);
      const id = randomUUID();
      results.push(
        (
          await c.query(
            "INSERT INTO jobs(id,project_id,target_id,kind,provider,model,payload,estimated,quote_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
            [
              id,
              p.id,
              t.target,
              t.kind,
              t.provider,
              t.model || null,
              JSON.stringify(t.payload),
              t.estimated,
              q.id,
            ],
          )
        ).rows[0],
      );
    }
    await c.query("UPDATE quotes SET used=true WHERE id=$1", [q.id]);
    return results;
  });
}
