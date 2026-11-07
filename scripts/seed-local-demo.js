import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { projectSchema } from "../domain.js";

// Uses the real HTTP API and running worker; never submits an AI request.
const origin = process.env.APP_ORIGIN;
if (
  process.env.NODE_ENV !== "development" ||
  origin !== "http://localhost:3000"
)
  throw Error(
    "This sample loader is restricted to the local development server",
  );
let cookie = "";
async function api(route, body, method = "POST") {
  const form = body instanceof FormData;
  const response = await fetch(origin + route, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(!form && body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  if (!response.ok)
    throw Error(`${route}: HTTP ${response.status} ${await response.text()}`);
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return response.json();
}
await api("/api/login", { password: process.env.ADMIN_PASSWORD });
const scenes = [0, 4, 8].map((start, i) => ({
  id: randomUUID(),
  title: `DEMO · сцена ${i + 1}`,
  start,
  end: start + 4,
  description: "Синтетическое тестовое видео, не AI-генерация",
  prompt: "Свет и движение",
  approved: true,
}));
const p = await api(
  "/api/projects",
  projectSchema.parse({
    title: "Локальное демо · реальная обработка",
    idea: "Проверка монтажа без платных API",
    concept: "Три сцены и синтетическая музыка",
    conceptApproved: true,
    ratio: "16:9",
    resolution: "720p",
    archived: false,
    scenes,
    characters: [],
    locations: [],
  }),
);
const route = `/api/projects/${p.id}`;
async function waitFor(check) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const current = await api(route, undefined, "GET");
    const failed = current.jobs.find((j) => j.state === "failed");
    if (failed) throw Error(failed.error);
    const result = check(current);
    if (result) return result;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Local processing timed out; inspect the project queue");
}
async function upload(file, kind, target) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("target", target);
  form.set(
    "file",
    new Blob([
      await readFile(new URL(`../public/demo/${file}`, import.meta.url)),
    ]),
    file,
  );
  const asset = await api(route + "/assets", form);
  await waitFor((current) =>
    current.assets.find((a) => a.id === asset.id && a.state === "review"),
  );
  await api(`/api/assets/${asset.id}/review`, {
    state: "approved",
    select: true,
  });
}
await upload("music.wav", "audio", "audio");
for (const scene of scenes) await upload("clip.mp4", "video", scene.id);
const current = await api(route, undefined, "GET");
const approved = await api(
  route,
  {
    revision: current.revision,
    document: {
      ...current.document,
      scenes: current.document.scenes.map((scene) => ({
        ...scene,
        approved: true,
      })),
      conceptApproved: true,
      storyboardApproved: true,
    },
  },
  "PUT",
);
// Approving scenes changes the storyboard; approve that resulting revision.
await api(
  route,
  {
    revision: approved.revision,
    document: { ...approved.document, storyboardApproved: true },
  },
  "PUT",
);
const quote = await api(route + "/quotes", {
  kind: "export",
  targets: ["project"],
});
const jobs = await api(route + "/generate", { quoteId: quote.id });
const result = await waitFor((current) =>
  current.jobs.find((j) => j.id === jobs[0].id && j.state === "succeeded"),
);
const response = await fetch(
  `${origin}/api/assets/${result.result.assetId}/file`,
  { headers: { Cookie: cookie } },
);
if (!response.ok) throw Error("Could not download the export");
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.subarray(0, 2).toString() !== "PK") throw Error("Invalid ZIP export");
await writeFile(".local/demo-export.zip", bytes);
console.log(
  `Created local project ${p.id}; four real media analyses and export succeeded. Package: .local/demo-export.zip`,
);
