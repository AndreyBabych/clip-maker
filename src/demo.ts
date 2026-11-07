import {
  empty,
  newScene,
  type Detail,
  type Doc,
  type Asset,
  type Quote,
} from "./types";
const now = () => new Date().toISOString();
let projects: Detail[] = [];
const quotes = new Map<string, { projectId: string; args: any }>();
export function initDemo() {
  if (projects.length) return;
  const id = crypto.randomUUID(),
    audioId = crypto.randomUUID(),
    styleId = crypto.randomUUID();
  const d = empty();
  Object.assign(d, {
    title: "После последнего света",
    idea: "Ночной город замирает. Одинокий музыкант идёт навстречу рассвету.",
    concept:
      "Три главы: тишина, движение и новый свет. Демонстрационный проект с синтетическим треком.",
    conceptApproved: true,
    storyboardApproved: true,
    stylePrompt: "Холодный неон, мягкий контровой свет, широкие планы",
    audioId,
    styleId,
  });
  d.scenes = [0, 4, 8].map((start, i) => ({
    ...newScene(start),
    title: ["Тишина города", "Движение", "Первый свет"][i],
    end: start + 4,
    description: "Демонстрационный кадр — геометрическая композиция",
    prompt: "Кинематографическая композиция, свет и пространство",
    videoPrompt: "Медленное движение камеры",
    approved: true,
  }));
  const assets: Asset[] = [
    {
      id: audioId,
      project_id: id,
      target_id: "audio",
      kind: "audio",
      source: "demo",
      state: "approved",
      name: "Синтетический трек · DEMO",
      mime: "audio/wav",
      bytes: 0,
      created_at: now(),
      metadata: {
        duration: 12,
        waveform: Array.from(
          { length: 160 },
          (_, i) =>
            0.15 +
            0.55 * Math.abs(Math.sin(i * 0.47)) * Math.abs(Math.sin(i * 0.1)),
        ),
      },
      demoUrl: "/demo/music.wav",
    },
    {
      id: styleId,
      project_id: id,
      target_id: "style",
      kind: "image",
      source: "demo",
      state: "approved",
      name: "DEMO · стиль",
      mime: "image/svg+xml",
      bytes: 0,
      created_at: now(),
      metadata: {},
      demoUrl: "/demo/frame.svg",
    },
  ];
  projects = [
    {
      id,
      revision: 1,
      updated_at: now(),
      document: d,
      assets,
      jobs: [],
      statuses: {},
    },
  ];
}
export function demoUrl(a: Asset) {
  return a.demoUrl || "/demo/frame.svg";
}
export async function demoApi(
  path: string,
  method = "GET",
  body?: any,
): Promise<any> {
  if (path === "config")
    return {
      storage: "Демо · данные до перезагрузки",
      fal: false,
      screenplay: false,
      local: true,
      models: {
        kling: { name: "Kling 3", min: 3, max: 15 },
        seedance: { name: "Seedance 1 Pro", min: 2, max: 12 },
      },
    };
  if (path === "projects" && method === "GET") return structuredClone(projects);
  if (path === "projects" && method === "POST") {
    const p = {
      id: crypto.randomUUID(),
      revision: 1,
      updated_at: now(),
      document: body,
      assets: [],
      jobs: [],
      statuses: {},
    };
    projects.unshift(p);
    return structuredClone(p);
  }
  if (path === "logout") return {};
  const segments = path.split("/"),
    p = projects.find((p) => p.id === segments[1]);
  if (segments[0] === "projects" && p) {
    if (method === "GET") return structuredClone(p);
    if (method === "PUT") {
      p.document = structuredClone(body.document);
      p.revision++;
      return structuredClone(p);
    }
    if (segments[2] === "quotes") {
      const id = crypto.randomUUID();
      quotes.set(id, { projectId: p.id, args: body });
      return {
        id,
        estimated: 0,
        count: body.targets.length,
        models: ["DEMO · имитация"],
        pricingSource: "Демо: платные запросы не отправляются",
      } satisfies Quote;
    }
    if (segments[2] === "generate") {
      const q = quotes.get(body.quoteId);
      if (!q) return [];
      quotes.delete(body.quoteId);
      for (const target of q.args.targets) {
        const job: any = {
          id: crypto.randomUUID(),
          target_id: target,
          kind: q.args.kind,
          state: "succeeded",
          provider: "demo",
          model: "DEMO",
          estimated: 0,
          confirmed: 0,
          attempts: 1,
          error: null,
          external_id: null,
          created_at: now(),
        };
        if (q.args.kind === "screenplay") {
          job.result = {
            draft: {
              concept: "Демонстрационный сценарий: путь из тени к свету.",
              scenes: [...p.document.scenes],
            },
          };
        } else {
          const kind = q.args.kind,
            asset: Asset = {
              id: crypto.randomUUID(),
              project_id: p.id,
              target_id: target,
              kind,
              source: "demo",
              state: kind === "export" ? "approved" : "review",
              name: `DEMO · ${kind}`,
              mime:
                kind === "video"
                  ? "video/mp4"
                  : kind === "export"
                    ? "application/zip"
                    : "image/svg+xml",
              bytes: 0,
              created_at: now(),
              metadata: kind === "video" ? { duration: 4 } : {},
              demoUrl:
                kind === "video"
                  ? "/demo/clip.mp4"
                  : kind === "export"
                    ? "/demo/package.zip"
                    : "/demo/frame.svg",
            };
          p.assets.unshift(asset);
          job.result = { assetId: asset.id };
        }
        p.jobs.unshift(job);
      }
      return structuredClone(p.jobs);
    }
  }
  if (segments[0] === "assets") {
    for (const p of projects) {
      const a = p.assets.find((a) => a.id === segments[1]);
      if (a) {
        a.state = body.state;
        if (body.select) {
          if (a.kind === "audio") p.document.audioId = a.id;
          else if (a.target_id === "style") p.document.styleId = a.id;
          else {
            const s = p.document.scenes.find((s) => s.id === a.target_id),
              r = [...p.document.characters, ...p.document.locations].find(
                (r) => r.id === a.target_id,
              );
            if (s) {
              if (a.kind === "image") s.imageId = a.id;
              else s.videoId = a.id;
            }
            if (r) r.assetId = a.id;
          }
        }
        p.revision++;
        return {};
      }
    }
  }
  if (segments[0] === "jobs") {
    for (const p of projects) {
      const j = p.jobs.find((j) => j.id === segments[1]);
      if (j?.result?.draft) {
        p.document.concept = j.result.draft.concept;
        p.document.conceptApproved = false;
        p.document.storyboardApproved = false;
        return p;
      }
    }
  }
  throw Error("Это действие недоступно в демо");
}
export function demoUpload(
  id: string,
  file: File,
  kind: string,
  target: string,
) {
  const p = projects.find((p) => p.id === id)!;
  p.assets.unshift({
    id: crypto.randomUUID(),
    project_id: id,
    target_id: target,
    kind,
    source: "demo upload",
    state: "review",
    name: file.name,
    mime: file.type,
    bytes: file.size,
    created_at: now(),
    metadata: {},
    demoUrl: URL.createObjectURL(file),
  });
}
