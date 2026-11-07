import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { openDb } from "../lib/db.js";
import { createStorage } from "../lib/storage.js";
import { createApp } from "../lib/app.js";
import { workOnce, recoverJobs } from "../lib/worker.js";
import { command } from "../lib/media.js";
import { projectSchema } from "../domain.js";
import { prepareQuote, confirmQuote } from "../lib/generation.js";
import { timelinePlan, timelineXml } from "../lib/export.js";
import { modelInput, FalProvider } from "../lib/providers.js";
import { mediaUrl, isPublicAddress } from "../lib/download.js";
import { XMLValidator, XMLParser } from "fast-xml-parser";
let dir, db, storage, app, agent, env, audio, video, image;
const origin = "http://localhost:3000";
const document = () =>
  projectSchema.parse({
    title: "Test & Film",
    idea: "A story",
    ratio: "16:9",
    archived: false,
    scenes: [],
    characters: [],
    locations: [],
  });
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "clip-tests-"));
  env = {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: "test",
    LOCAL_DATA_DIR: path.join(dir, ".local"),
    STORAGE_MODE: "local",
    ADMIN_PASSWORD: randomUUID(),
    APP_ORIGIN: origin,
    FAL_KEY: "test-only-no-real-requests",
    OPENAI_MODEL: "configured-test-model",
  };
  db = await openDb(env);
  storage = createStorage(env);
  app = await createApp({ db, storage, env });
  agent = request.agent(app);
  await agent
    .post("/api/login")
    .set("Origin", origin)
    .send({ password: env.ADMIN_PASSWORD })
    .expect(200);
  audio = path.join(dir, "music.wav");
  video = path.join(dir, "clip.mp4");
  image = path.join(dir, "image.png");
  await command("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=2",
    "-y",
    audio,
  ]);
  await command("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x233b44:s=320x180:r=25:d=1",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ]);
  await command("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x233b44:s=320x180",
    "-frames:v",
    "1",
    "-y",
    image,
  ]);
});
after(async () => {
  await db?.close();
  await rm(dir, { recursive: true, force: true });
});
async function create() {
  return (
    await agent
      .post("/api/projects")
      .set("Origin", origin)
      .send(document())
      .expect(201)
  ).body;
}
async function save(p, d) {
  return (
    await agent
      .put("/api/projects/" + p.id)
      .set("Origin", origin)
      .send({ document: d, revision: p.revision })
      .expect(200)
  ).body;
}
async function upload(p, file, kind, target) {
  const r = await agent
    .post("/api/projects/" + p.id + "/assets")
    .set("Origin", origin)
    .field("kind", kind)
    .field("target", target)
    .attach("file", file)
    .expect(201);
  await workOnce({ db, storage, env });
  return r.body.id;
}
async function approve(id) {
  await agent
    .post("/api/assets/" + id + "/review")
    .set("Origin", origin)
    .send({ state: "approved", select: true })
    .expect(200);
}
test("authentication, origin checks, input validation, revision conflicts and persistence", async () => {
  await request(app).get("/api/projects").expect(401);
  await agent.post("/api/projects").send(document()).expect(403);
  await agent
    .post("/api/projects")
    .set("Origin", origin)
    .send({ ...document(), title: "" })
    .expect(400);
  const p = await create();
  const saved = await save(p, { ...p.document, title: "Changed" });
  assert.equal(saved.revision, 2);
  await agent
    .put("/api/projects/" + p.id)
    .set("Origin", origin)
    .send({ document: p.document, revision: 1 })
    .expect(409);
  assert.equal(
    (await agent.get("/api/projects/" + p.id)).body.document.title,
    "Changed",
  );
  assert.equal(
    (
      await db.query("SELECT * FROM project_history WHERE project_id=$1", [
        p.id,
      ])
    ).rows.length,
    1,
  );
});
test("file magic validation rejects renamed HTML and cross-project selections", async () => {
  const p = await create();
  const f = path.join(dir, "bad.png");
  await writeFile(f, "<html>bad</html>");
  await agent
    .post("/api/projects/" + p.id + "/assets")
    .set("Origin", origin)
    .field("kind", "image")
    .field("target", "style")
    .attach("file", f)
    .expect(400);
  const other = await create();
  const id = await upload(p, image, "image", "style");
  await approve(id);
  await agent
    .put("/api/projects/" + other.id)
    .set("Origin", origin)
    .send({
      revision: other.revision,
      document: { ...other.document, styleId: id },
    })
    .expect(400);
});
test("audio, waveform, approval, scene video and actual Premiere ZIP export", async () => {
  let p = await create();
  const audioId = await upload(p, audio, "audio", "audio");
  const a = (await db.query("SELECT * FROM assets WHERE id=$1", [audioId]))
    .rows[0];
  assert.equal(a.state, "review");
  assert.ok(a.metadata.duration >= 1.9);
  assert.ok(a.metadata.waveform.length > 10);
  await approve(audioId);
  p = (await agent.get("/api/projects/" + p.id)).body;
  const scene = {
    id: randomUUID(),
    title: "Opening & sunrise",
    start: 0,
    end: 1,
    description: "Scene",
    prompt: "Frame",
    approved: true,
  };
  p = await save(p, { ...p.document, scenes: [scene] });
  const videoId = await upload(p, video, "video", scene.id);
  await approve(videoId);
  p = (await agent.get("/api/projects/" + p.id)).body;
  p = await save(p, {
    ...p.document,
    conceptApproved: true,
    storyboardApproved: true,
  });
  const quote = await prepareQuote(db, env, storage, p.id, {
    kind: "export",
    targets: ["project"],
  });
  const jobs = await confirmQuote(db, p.id, quote.id, false);
  await workOnce({ db, storage, env });
  const result = (
    await db.query("SELECT * FROM jobs WHERE id=$1", [jobs[0].id])
  ).rows[0];
  assert.equal(result.state, "succeeded", result.error);
  const zip = (
    await db.query("SELECT * FROM assets WHERE id=$1", [result.result.assetId])
  ).rows[0];
  const bytes = await readFile(storage.path(zip.storage_key));
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  assert.ok(bytes.length > 10000);
  const manifest = zip.metadata;
  assert.equal(manifest.clips[0].start, 0);
  assert.equal(manifest.clips[0].end, 25);
  assert.equal(manifest.audio, "media/music.wav");
  const current = (await agent.get("/api/projects/" + p.id)).body;
  const xml = timelineXml(timelinePlan(current.document, current.assets));
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser().parse(xml);
  assert.equal(parsed.xmeml.sequence.media.video.track.clipitem.start, 0);
  assert.equal(parsed.xmeml.sequence.media.audio.track.length, 2);
  await request(app)
    .get("/api/assets/" + zip.id + "/file")
    .expect(401);
  await agent.get("/api/assets/" + zip.id + "/file").expect(200);
});
test("quote confirmation is idempotent and prevents unknown costs under budget", async () => {
  let p = await create();
  p = await save(p, {
    ...p.document,
    conceptApproved: true,
    stylePrompt: "Blue atmosphere",
  });
  const q = await prepareQuote(db, env, storage, p.id, {
    kind: "image",
    targets: ["style"],
  });
  await assert.rejects(() => confirmQuote(db, p.id, q.id, false), /Explicitly/);
  const jobs = await confirmQuote(db, p.id, q.id, true);
  assert.equal((await confirmQuote(db, p.id, q.id, true))[0].id, jobs[0].id);
  await db.query("UPDATE jobs SET state='cancelled' WHERE id=$1", [jobs[0].id]);
  p = (await agent.get("/api/projects/" + p.id)).body;
  p = await save(p, { ...p.document, budget: 1 });
  const q2 = await prepareQuote(db, env, storage, p.id, {
    kind: "image",
    targets: ["style"],
  });
  await assert.rejects(
    () => confirmQuote(db, p.id, q2.id, true),
    /requires configured/,
  );
});
test("provider outage never resubmits uncertain paid requests", async () => {
  let p = await create();
  p = await save(p, {
    ...p.document,
    conceptApproved: true,
    stylePrompt: "Style",
  });
  const q = await prepareQuote(db, env, storage, p.id, {
    kind: "image",
    targets: ["style"],
  });
  const [job] = await confirmQuote(db, p.id, q.id, true);
  let count = 0;
  const provider = {
    submit: async () => {
      count++;
      throw Error("timeout after remote acceptance");
    },
  };
  await workOnce({ db, storage, env, provider });
  await workOnce({ db, storage, env, provider });
  assert.equal(count, 1);
  assert.equal(
    (await db.query("SELECT state FROM jobs WHERE id=$1", [job.id])).rows[0]
      .state,
    "uncertain",
  );
  await agent
    .post("/api/jobs/" + job.id + "/retry")
    .set("Origin", origin)
    .send({})
    .expect(400);
});
test("successful provider polling persists versions without auto approval", async () => {
  let p = await create();
  p = await save(p, {
    ...p.document,
    conceptApproved: true,
    stylePrompt: "Style",
  });
  const q = await prepareQuote(db, env, storage, p.id, {
    kind: "image",
    targets: ["style"],
  });
  const [job] = await confirmQuote(db, p.id, q.id, true);
  const external = {
    request_id: randomUUID(),
    status_url: "https://queue.fal.run/test/status",
    response_url: "https://queue.fal.run/test/result",
  };
  let submits = 0;
  const provider = {
    submit: async () => {
      submits++;
      return external;
    },
    status: async () => ({ status: "COMPLETED" }),
    result: async () => ({ images: [{ url: "https://fal.media/test.png" }] }),
  };
  await workOnce({ db, storage, env, provider });
  await db.query("UPDATE jobs SET available_at=now() WHERE id=$1", [job.id]);
  await workOnce({
    db,
    storage,
    env,
    provider,
    download: async (u, d) => copyFile(image, d),
  });
  assert.equal(submits, 1);
  const a = (await db.query("SELECT * FROM assets WHERE id=$1", [job.id]))
    .rows[0];
  assert.equal(a.state, "review");
  assert.equal(a.metadata.model, "fal-ai/flux-pro/kontext/max/text-to-image");
  assert.equal(
    (await agent.get("/api/projects/" + p.id)).body.document.styleId,
    null,
  );
});
test("restart recovery marks interrupted submissions uncertain", async () => {
  const p = await create(),
    id = randomUUID();
  await db.query(
    "INSERT INTO jobs(id,project_id,target_id,kind,provider,payload,state,lease_until) VALUES($1,$2,'style','image','fal','{}','submitting',now()-interval '1 hour')",
    [id, p.id],
  );
  await recoverJobs(db);
  assert.equal(
    (await db.query("SELECT state FROM jobs WHERE id=$1", [id])).rows[0].state,
    "uncertain",
  );
});
test("provider contracts and media URL restrictions", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "198.18.0.1",
    "192.0.2.1",
    "::1",
  ])
    assert.equal(isPublicAddress(ip), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  const input = modelInput("kling", {
    prompt: "Orbit",
    duration: 5,
    referenceUrls: ["https://example.com/a.png"],
  });
  assert.equal(input.start_image_url, "https://example.com/a.png");
  assert.equal(input.generate_audio, false);
  assert.throws(() => modelInput("kling", { duration: 1 }), /Duration/);
  assert.throws(() => mediaUrl("http://127.0.0.1/private"));
  assert.throws(() => mediaUrl("https://fal.media.evil.test/a"));
  assert.throws(() => mediaUrl("https://storage.googleapis.com/private/a"));
  let calls = [];
  const provider = new FalProvider({ FAL_KEY: "test" }, async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ request_id: "test" }) };
  });
  await provider.submit("fal-ai/model", { prompt: "x" });
  assert.equal(calls[0].opts.headers.Authorization, "Key test");
  assert.equal(calls[0].opts.redirect, "error");
});
test("timeline rejects overlap and short footage unless freeze is explicit", () => {
  const d = document(),
    aid = randomUUID(),
    vid = randomUUID(),
    sid = randomUUID();
  d.audioId = aid;
  d.scenes = [{ id: sid, title: "Shot", start: 0, end: 2, videoId: vid }];
  const a = [
    { id: aid, kind: "audio", state: "approved", metadata: { duration: 5 } },
    {
      id: vid,
      target_id: sid,
      kind: "video",
      state: "approved",
      metadata: { duration: 1 },
    },
  ];
  assert.throws(() => timelinePlan(d, a), /too short/);
  assert.equal(timelinePlan(d, a, "freeze").clips[0].freeze, true);
  d.scenes.push({ ...d.scenes[0], start: 1, end: 3 });
  assert.throws(() => timelinePlan(d, a, "freeze"), /overlap/);
});
test("budget reservation counts already submitted jobs and rejects stale quotes", async () => {
  let p = await create();
  p = await save(p, {
    ...p.document,
    conceptApproved: true,
    stylePrompt: "Atmosphere",
    budget: 1,
  });
  const priced = {
    ...env,
    PROVIDER_ESTIMATES_JSON: JSON.stringify({
      "flux-text": { usd: 0.6, unit: "request" },
    }),
  };
  const q = await prepareQuote(db, priced, storage, p.id, {
    kind: "image",
    targets: ["style"],
  });
  const [j] = await confirmQuote(db, p.id, q.id, false);
  await db.query("UPDATE jobs SET state='failed' WHERE id=$1", [j.id]);
  const q2 = await prepareQuote(db, priced, storage, p.id, {
    kind: "image",
    targets: ["style"],
  });
  await assert.rejects(
    () => confirmQuote(db, p.id, q2.id, false),
    /limit would/,
  );
  p = await save(p, { ...p.document, title: "Revised" });
  await assert.rejects(() => confirmQuote(db, p.id, q2.id, false), /changed/);
});
test("media production mode rejects local storage", () =>
  assert.throws(
    () =>
      createStorage({
        NODE_ENV: "production",
        STORAGE_MODE: "local",
        LOCAL_DATA_DIR: dir,
      }),
    /requires S3/,
  ));
