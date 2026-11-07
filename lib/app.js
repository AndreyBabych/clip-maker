import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  projectSchema,
  normalizeUpdate,
  fail,
  sceneStatus,
} from "../domain.js";
import {
  project,
  assetsFor,
  jobsFor,
  saveProject,
  publicJob,
} from "./repository.js";
import { validateMedia } from "./media.js";
import { models, FalProvider } from "./providers.js";
import { prepareQuote, confirmQuote } from "./generation.js";
const derive = promisify(scrypt),
  hash = (t) => createHash("sha256").update(t).digest("hex");
export async function createApp({ db, storage, env = process.env }) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16 || !env.APP_ORIGIN)
    throw Error("Configure APP_ORIGIN and ADMIN_PASSWORD (16+ characters)");
  const passwordHash = await derive(env.ADMIN_PASSWORD, "clip-maker", 32),
    app = express();
  app.set("trust proxy", Number(env.TRUST_PROXY_HOPS || 1));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "blob:", "data:", "https:"],
          "media-src": ["'self'", "blob:", "https:"],
          "style-src": [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", rateLimit({ windowMs: 60000, limit: 300 }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin !== env.APP_ORIGIN
    )
      return res.status(403).json({ error: "Invalid origin" });
    next();
  });
  const session = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("session="))
      ?.slice(8);
  const cookie = (token, age) =>
    `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${env.NODE_ENV === "production" ? "; Secure" : ""}`;
  app.get("/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.post(
    "/api/login",
    rateLimit({ windowMs: 900000, limit: 10 }),
    async (req, res) => {
      const password = z.string().max(1024).parse(req.body.password);
      if (
        !timingSafeEqual(await derive(password, "clip-maker", 32), passwordHash)
      )
        fail("Incorrect password", 401);
      const token = randomBytes(32).toString("hex");
      await db.query("DELETE FROM sessions WHERE expires_at<now()");
      await db.query(
        "INSERT INTO sessions VALUES($1,now()+interval '12 hours')",
        [hash(token)],
      );
      res.setHeader("Set-Cookie", cookie(token, 43200));
      res.json({ ok: true });
    },
  );
  app.use("/api", async (req, res, next) => {
    const token = session(req);
    if (!token) fail("Please sign in", 401);
    if (
      !(
        await db.query(
          "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()",
          [hash(token)],
        )
      ).rows.length
    )
      fail("Session expired", 401);
    next();
  });
  app.post("/api/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(session(req)),
    ]);
    res.setHeader("Set-Cookie", cookie("", 0));
    res.json({ ok: true });
  });
  app.get("/api/config", (req, res) =>
    res.json({
      storage: storage.configured
        ? storage.local
          ? "local development"
          : "S3 configured"
        : "not configured",
      fal: Boolean(env.FAL_KEY),
      screenplay: Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL),
      models,
      local: Boolean(db.embedded),
    }),
  );
  app.get("/api/projects", async (req, res) =>
    res.json(
      (
        await db.query("SELECT * FROM projects ORDER BY updated_at DESC")
      ).rows.map((p) => ({ ...p, document: projectSchema.parse(p.document) })),
    ),
  );
  app.post("/api/projects", async (req, res) => {
    const d = projectSchema.parse(req.body);
    d.audioId = null;
    d.styleId = null;
    d.conceptApproved = false;
    d.storyboardApproved = false;
    for (const s of d.scenes) {
      s.imageId = null;
      s.videoId = null;
      s.approved = false;
    }
    for (const r of [...d.characters, ...d.locations]) {
      r.assetId = null;
      r.approved = false;
    }
    const result = await db.query(
      "INSERT INTO projects(id,document) VALUES($1,$2) RETURNING *",
      [randomUUID(), JSON.stringify(d)],
    );
    res.status(201).json(result.rows[0]);
  });
  app.param("id", (req, res, next, id) => {
    z.uuid().parse(id);
    next();
  });
  app.get("/api/projects/:id", async (req, res) => {
    const p = await project(db, req.params.id),
      assets = await assetsFor(db, p.id),
      jobs = await jobsFor(db, p.id);
    res.json({
      ...p,
      assets: assets.map(({ storage_key, ...a }) => a),
      jobs: jobs.map(publicJob),
      statuses: Object.fromEntries(
        p.document.scenes.map((s) => [
          s.id,
          sceneStatus(p.document, s, assets, jobs),
        ]),
      ),
    });
  });
  app.put("/api/projects/:id", async (req, res) => {
    const next = projectSchema.parse(req.body.document),
      revision = z.number().int().positive().parse(req.body.revision);
    const result = await db.transaction(async (c) => {
      const p = await project(c, req.params.id, true);
      if (p.revision !== revision)
        fail("Project changed in another window. Reload before editing.", 409);
      const d = normalizeUpdate(p.document, next),
        assets = await assetsFor(c, p.id);
      const selected = (id, kind, target) => {
        if (
          id &&
          !assets.some(
            (a) =>
              a.id === id &&
              a.kind === kind &&
              a.state === "approved" &&
              (!target || a.target_id === target),
          )
        )
          fail("Selected asset must be approved and belong to this target");
      };
      selected(d.audioId, "audio");
      selected(d.styleId, "image", "style");
      for (const r of [...d.characters, ...d.locations])
        selected(r.assetId, "image", r.id);
      for (const s of d.scenes) {
        selected(s.imageId, "image", s.id);
        selected(s.videoId, "video", s.id);
      }
      if (d.conceptApproved && !d.concept.trim() && !d.idea.trim())
        fail("Enter a concept before approval");
      if (
        d.storyboardApproved &&
        (!d.conceptApproved ||
          !d.scenes.length ||
          d.scenes.some((s) => !s.approved))
      )
        fail("Approve the concept and every scene first");
      return saveProject(c, p, d);
    });
    res.json(result);
  });
  const upload = multer({
    dest: tmpdir(),
    limits: { fileSize: 256 * 1024 * 1024, files: 1, fields: 3 },
  });
  app.post(
    "/api/projects/:id/assets",
    rateLimit({ windowMs: 60000, limit: 15 }),
    async (req, res, next) => {
      await project(db, req.params.id);
      if (!storage.configured) fail("Configure S3 storage first", 503);
      next();
    },
    upload.single("file"),
    async (req, res) => {
      if (!req.file) fail("Choose a file");
      try {
        const kind = z.enum(["audio", "image", "video"]).parse(req.body.kind),
          target = z.string().max(100).parse(req.body.target);
        const p = await project(db, req.params.id);
        if (
          ![
            "audio",
            "style",
            "reference",
            ...p.document.scenes.map((s) => s.id),
            ...p.document.characters.map((r) => r.id),
            ...p.document.locations.map((r) => r.id),
          ].includes(target)
        )
          fail("Unknown asset target");
        if (kind === "image" && req.file.size > 20 * 1024 * 1024)
          fail("Images must be under 20 MB");
        const type = await validateMedia(req.file.path, kind),
          id = randomUUID(),
          key = `${p.id}/${id}.${type.ext}`;
        await storage.put(key, req.file.path, type.mime);
        await db.transaction(async (c) => {
          await c.query(
            "INSERT INTO assets(id,project_id,target_id,kind,source,storage_key,name,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              id,
              p.id,
              target,
              kind,
              "upload",
              key,
              req.file.originalname.slice(0, 200),
              type.mime,
              req.file.size,
            ],
          );
          await c.query(
            "INSERT INTO jobs(id,project_id,target_id,kind,payload,estimated) VALUES($1,$2,$3,$4,$5,0)",
            [
              randomUUID(),
              p.id,
              id,
              "analyze",
              JSON.stringify({ assetId: id }),
            ],
          );
        });
        res.status(201).json({ id });
      } finally {
        await unlink(req.file.path).catch(() => {});
      }
    },
  );
  app.get("/api/assets/:id/file", async (req, res) => {
    const a = (
      await db.query("SELECT * FROM assets WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!a) fail("Asset not found", 404);
    res.set("Cache-Control", "private, no-store");
    if (storage.local)
      return res.sendFile(storage.path(a.storage_key), {
        headers: {
          "Content-Type": a.mime,
          "Content-Disposition": `${a.kind === "export" ? "attachment" : "inline"}; filename="${a.id}.${a.kind === "export" ? "zip" : a.storage_key.split(".").at(-1)}"`,
        },
      });
    res.redirect(await storage.signed(a.storage_key));
  });
  app.post("/api/assets/:id/review", async (req, res) => {
    const state = z
      .enum(["approved", "rejected", "review"])
      .parse(req.body.state);
    res.json(
      await db.transaction(async (c) => {
        const a = (
          await c.query("SELECT * FROM assets WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        if (!a) fail("Asset not found", 404);
        if (["processing", "failed"].includes(a.state))
          fail("Wait for successful media analysis");
        const p = await project(c, a.project_id, true),
          d = p.document;
        if (state !== "approved") {
          if (d.audioId === a.id) d.audioId = null;
          if (d.styleId === a.id) d.styleId = null;
          for (const r of [...d.characters, ...d.locations])
            if (r.assetId === a.id) {
              r.assetId = null;
              r.approved = false;
            }
          for (const s of d.scenes) {
            if (s.imageId === a.id) s.imageId = null;
            if (s.videoId === a.id) s.videoId = null;
          }
        }
        if (state === "approved" && req.body.select === true) {
          if (a.kind === "audio") {
            d.audioId = a.id;
            d.storyboardApproved = false;
          } else if (a.target_id === "style") d.styleId = a.id;
          else {
            const r = [...d.characters, ...d.locations].find(
                (r) => r.id === a.target_id,
              ),
              s = d.scenes.find((s) => s.id === a.target_id);
            if (r && a.kind === "image") {
              r.assetId = a.id;
            }
            if (s && a.kind === "image") s.imageId = a.id;
            if (s && a.kind === "video") s.videoId = a.id;
          }
        }
        await c.query("UPDATE assets SET state=$1 WHERE id=$2", [state, a.id]);
        await saveProject(c, p, d);
        return { ok: true };
      }),
    );
  });
  app.post(
    "/api/projects/:id/quotes",
    rateLimit({ windowMs: 60000, limit: 20 }),
    async (req, res) =>
      res.json(await prepareQuote(db, env, storage, req.params.id, req.body)),
  );
  app.post("/api/projects/:id/generate", async (req, res) =>
    res.json(
      (
        await confirmQuote(
          db,
          req.params.id,
          z.uuid().parse(req.body.quoteId),
          req.body.acceptUnknown === true,
        )
      ).map(publicJob),
    ),
  );
  app.post("/api/jobs/:id/retry", async (req, res) => {
    const j = (
      await db.query("SELECT * FROM jobs WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!j) fail("Job not found", 404);
    if (!["failed", "uncertain"].includes(j.state))
      fail("Job cannot be retried");
    if (j.provider !== "local" && !j.external)
      fail(
        "Unknown provider submission. Reconcile the request ID before retrying.",
      );
    await db.query(
      "UPDATE jobs SET state=$1,error=NULL,available_at=now(),lease_until=NULL,attempts=0 WHERE id=$2",
      [j.external ? "polling" : "queued", j.id],
    );
    res.json({ ok: true });
  });
  app.post("/api/jobs/:id/reconcile", async (req, res) => {
    const requestId = z.uuid().parse(req.body.requestId);
    const j = (
      await db.query("SELECT * FROM jobs WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!j || j.provider !== "fal" || j.state !== "uncertain")
      fail("Only uncertain fal submissions can be reconciled");
    const base =
      "https://queue.fal.run/" +
      j.model.split("/").slice(0, 2).join("/") +
      "/requests/" +
      requestId;
    const external = {
      request_id: requestId,
      status_url: base + "/status",
      response_url: base,
      cancel_url: base + "/cancel",
    };
    await new FalProvider(env).status(external);
    await db.query(
      "UPDATE jobs SET external=$1,state='polling',error=NULL,available_at=now() WHERE id=$2",
      [JSON.stringify(external), j.id],
    );
    res.json({ ok: true });
  });
  app.post("/api/jobs/:id/cancel", async (req, res) => {
    const r = await db.query(
      "UPDATE jobs SET state='cancelled' WHERE id=$1 AND state='queued' RETURNING id",
      [req.params.id],
    );
    if (!r.rows.length)
      fail("Only jobs not yet started can be cancelled safely");
    res.json({ ok: true });
  });
  app.post("/api/jobs/:id/apply-draft", async (req, res) =>
    res.json(
      await db.transaction(async (c) => {
        const j = (
          await c.query(
            "SELECT * FROM jobs WHERE id=$1 AND kind='screenplay' AND state='succeeded'",
            [req.params.id],
          )
        ).rows[0];
        if (!j) fail("Completed screenplay not found");
        const p = await project(c, j.project_id, true);
        if (p.revision !== req.body.revision)
          fail("Project changed. Reload first.", 409);
        const d = p.document;
        d.concept = j.result.draft.concept;
        d.conceptApproved = false;
        d.storyboardApproved = false;
        d.scenes = j.result.draft.scenes.map((s) => ({
          ...s,
          id: randomUUID(),
          approved: false,
          characterIds: [],
          locationId: null,
          imageId: null,
          videoId: null,
          framing: "",
          movement: "",
        }));
        return saveProject(c, p, projectSchema.parse(d));
      }),
    ),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(express.static(fileURLToPath(new URL("../dist/", import.meta.url))));
  app.get("/{*path}", (req, res) =>
    res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.name === "ZodError")
      return res
        .status(400)
        .json({ error: err.issues?.[0]?.message || "Invalid input" });
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(413).json({ error: "File exceeds 256 MB" });
    res.status(err.status || 500).json({
      error: err.public
        ? err.message
        : "Operation failed. Check configuration and retry.",
    });
  });
  return app;
}
