import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FalProvider, modelInput, screenplay } from "./providers.js";
import { project, assetsFor } from "./repository.js";
import { analyzeAudio, inspect, validateMedia } from "./media.js";
import { downloadProviderMedia } from "./download.js";
import { buildExport } from "./export.js";
export async function recoverJobs(db) {
  await db.query(
    "UPDATE jobs SET state='uncertain',error='Submission interrupted. Reconcile provider request before retrying.',lease_until=NULL WHERE state='submitting' AND lease_until<now()",
  );
  await db.query(
    "UPDATE jobs SET state=CASE WHEN external IS NOT NULL THEN 'polling' ELSE 'queued' END,lease_until=NULL WHERE state='processing' AND lease_until<now()",
  );
}
export async function workOnce({
  db,
  storage,
  env = process.env,
  provider = new FalProvider(env),
  download = downloadProviderMedia,
}) {
  await recoverJobs(db);
  const j = await db.transaction(async (c) => {
    await c.query("LOCK TABLE jobs IN SHARE ROW EXCLUSIVE MODE");
    const r = await c.query(
      "SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.state IN ('queued','polling') AND j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now()) AND COALESCE((p.document->>'paused')::boolean,false)=false AND COALESCE((p.document->>'archived')::boolean,false)=false AND (j.state='polling' OR j.provider='local' OR (SELECT count(*) FROM jobs WHERE provider!='local' AND state IN ('submitting','polling'))<$1) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1",
      [Math.max(1, Number(env.PROVIDER_CONCURRENCY) || 2)],
    );
    const j = r.rows[0];
    if (!j) return null;
    const state =
      j.state === "polling"
        ? "polling"
        : j.provider === "local"
          ? "processing"
          : "submitting";
    await c.query(
      "UPDATE jobs SET state=$1,attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$2",
      [state, j.id],
    );
    return { ...j, state, attempts: j.attempts + 1 };
  });
  if (!j) return false;
  const heartbeat = setInterval(
    () =>
      db
        .query(
          "UPDATE jobs SET lease_until=now()+interval '2 minutes' WHERE id=$1",
          [j.id],
        )
        .catch(() => {}),
    30000,
  );
  const dir = await mkdtemp(path.join(tmpdir(), "clip-worker-"));
  const update = async (state, result = null, error = null) =>
    db.query(
      "UPDATE jobs SET state=$1,result=$2,error=$3,lease_until=NULL,updated_at=now() WHERE id=$4",
      [state, result ? JSON.stringify(result) : null, error, j.id],
    );
  try {
    if (j.kind === "analyze") {
      const a = (
        await db.query("SELECT * FROM assets WHERE id=$1", [j.payload.assetId])
      ).rows[0];
      if (!a) throw Error("Asset no longer exists");
      const file = path.join(dir, "input");
      await storage.download(a.storage_key, file);
      await validateMedia(file, a.kind);
      const meta =
        a.kind === "audio" ? await analyzeAudio(file) : await inspect(file);
      if (
        a.kind === "video" &&
        (!meta.hasVideo || !meta.duration || meta.duration > 3600)
      )
        throw Error("Invalid video duration");
      if (
        a.kind === "image" &&
        (!meta.width || !meta.height || meta.width * meta.height > 40000000)
      )
        throw Error("Invalid or oversized image");
      await db.query(
        "UPDATE assets SET metadata=$1,state='review' WHERE id=$2",
        [JSON.stringify(meta), a.id],
      );
      await update("succeeded", { assetId: a.id });
    } else if (j.kind === "export") {
      const result = await buildExport(
        j.payload,
        await assetsFor(db, j.project_id),
        storage,
        dir,
      );
      const key = `${j.project_id}/${j.id}.zip`;
      await storage.put(key, result.file, "application/zip");
      await db.query(
        "INSERT INTO assets(id,project_id,target_id,kind,source,state,storage_key,name,mime,bytes,metadata) VALUES($1,$2,'project','export','export','approved',$3,'Premiere package.zip','application/zip',$4,$5) ON CONFLICT(id) DO NOTHING",
        [
          j.id,
          j.project_id,
          key,
          result.bytes,
          JSON.stringify(result.manifest),
        ],
      );
      await update("succeeded", { assetId: j.id });
    } else if (j.kind === "screenplay") {
      const result = await screenplay(env, j.payload);
      if (
        j.payload.duration &&
        result.draft.scenes.some((s) => s.end > j.payload.duration)
      )
        throw Error("AI returned scenes beyond the track; revise the request");
      await update("succeeded", result);
    } else if (j.state === "submitting") {
      const urls = [];
      for (const id of j.payload.referenceIds) {
        const a = (
          await db.query("SELECT * FROM assets WHERE id=$1 AND project_id=$2", [
            id,
            j.project_id,
          ])
        ).rows[0];
        if (!a) throw Error("Missing source asset");
        if (storage.local) {
          const file = path.join(dir, id);
          await storage.download(a.storage_key, file);
          urls.push(
            `data:${a.mime};base64,${(await readFile(file)).toString("base64")}`,
          );
        } else urls.push(await storage.signed(a.storage_key));
      }
      const input = modelInput(j.payload.modelKey, {
        ...j.payload,
        referenceUrls: urls,
      });
      const external = await provider.submit(j.model, input);
      if (
        !external.request_id ||
        !external.status_url ||
        !external.response_url
      )
        throw Error("Provider did not return durable job identifiers");
      await db.query(
        "UPDATE jobs SET external=$1,state='polling',lease_until=NULL,available_at=now()+interval '5 seconds',updated_at=now() WHERE id=$2",
        [JSON.stringify(external), j.id],
      );
    } else {
      const status = await provider.status(j.external);
      if (status.status !== "COMPLETED") {
        await db.query(
          "UPDATE jobs SET lease_until=NULL,available_at=now()+interval '10 seconds',updated_at=now() WHERE id=$1",
          [j.id],
        );
        return true;
      }
      if (status.error)
        throw Object.assign(
          Error("Provider generation failed; review provider history"),
          { permanent: true },
        );
      const result = await provider.result(j.external);
      const url =
        j.kind === "image" ? result.images?.[0]?.url : result.video?.url;
      if (!url)
        throw Object.assign(Error("Provider returned no media"), {
          permanent: true,
        });
      const file = path.join(dir, "result");
      await download(url, file);
      const type = await validateMedia(file, j.kind),
        meta = await inspect(file);
      if (j.kind === "video" && (!meta.hasVideo || !meta.duration))
        throw Error("Provider result is not a valid video");
      const key = `${j.project_id}/${j.id}.${type.ext}`;
      await storage.put(key, file, type.mime);
      await db.query(
        "INSERT INTO assets(id,project_id,target_id,kind,source,state,storage_key,name,mime,bytes,metadata) VALUES($1,$2,$3,$4,'fal','review',$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING",
        [
          j.id,
          j.project_id,
          j.target_id,
          j.kind,
          key,
          `${j.kind}-${j.id.slice(0, 8)}.${type.ext}`,
          type.mime,
          (await stat(file)).size,
          JSON.stringify({
            ...meta,
            prompt: j.payload.prompt,
            parameters: j.payload,
            model: j.model,
            externalId: j.external.request_id,
            seed: result.seed ?? null,
          }),
        ],
      );
      await update("succeeded", { assetId: j.id });
    }
  } catch (e) {
    const error = e.permanent
      ? e.message
      : j.state === "submitting"
        ? "Provider submission could not be confirmed. Check provider history and reconcile the request ID."
        : j.provider === "local"
          ? e.message
          : "Provider retrieval failed. Retry retrieves the same job without submitting again.";
    if (j.state === "polling" && !e.permanent && j.attempts < 100) {
      await db.query(
        "UPDATE jobs SET error=$1,lease_until=NULL,available_at=now()+interval '30 seconds' WHERE id=$2",
        [error, j.id],
      );
    } else {
      await update(
        j.state === "submitting" ? "uncertain" : "failed",
        null,
        error,
      );
      if (j.kind === "analyze")
        await db.query(
          "UPDATE assets SET state='failed',metadata=$1 WHERE id=$2",
          [JSON.stringify({ error }), j.payload.assetId],
        );
    }
  } finally {
    clearInterval(heartbeat);
    await rm(dir, { recursive: true, force: true });
  }
  return true;
}
export function startWorker(options) {
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      try {
        const worked = await workOnce(options);
        if (!worked) await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        console.error("Worker iteration failed:", e.code || e.name);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      await done;
    },
  };
}
