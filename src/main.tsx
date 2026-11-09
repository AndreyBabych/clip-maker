import { useState, useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  empty,
  newScene,
  newProfile,
  type Doc,
  type Detail,
  type Project,
  type Asset,
  type Config,
  type Quote,
  type Scene,
} from "./types";
import { initDemo, demoApi, demoUpload, demoUrl } from "./demo";
import "./style.css";
import "./studio.css";
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r
      .json()
      .catch(() => ({ error: "Нет соединения с сервером" }));
    throw Error(e.error);
  }
  return r.json();
}
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;
const labels: Record<string, string> = {
  Draft: "Черновик",
  "Awaiting reference approval": "Ожидает референсы",
  "Ready for image generation": "Можно генерировать",
  "Image generating": "Генерация кадра",
  "Image review": "Проверка кадра",
  "Image approved": "Кадр утверждён",
  "Video generating": "Генерация видео",
  "Video review": "Проверка видео",
  "Video approved": "Видео утверждено",
  "Submission needs reconciliation": "Нужна сверка запроса",
  queued: "В очереди",
  submitting: "Отправляется",
  polling: "Генерируется",
  processing: "Обработка",
  succeeded: "Готово",
  failed: "Ошибка",
  uncertain: "Нужна сверка",
  cancelled: "Отменено",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
type BrowserSpeech = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type BrowserSpeechConstructor = new () => BrowserSpeech;
const browserSpeech = () =>
  (
    window as Window & {
      SpeechRecognition?: BrowserSpeechConstructor;
      webkitSpeechRecognition?: BrowserSpeechConstructor;
    }
  ).SpeechRecognition ||
  (window as Window & { webkitSpeechRecognition?: BrowserSpeechConstructor })
    .webkitSpeechRecognition;
function App() {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const speech = useRef<BrowserSpeech | null>(null);
  const [approvalSelection, setApprovalSelection] = useState<string[]>([]);
  const [logged, setLogged] = useState(false),
    [demo, setDemo] = useState(false),
    [password, setPassword] = useState(""),
    [projects, setProjects] = useState<Project[]>([]),
    [active, setActive] = useState<Detail | null>(null),
    [tab, setTab] = useState("Ключ"),
    [panel, setPanel] = useState("Стиль"),
    [revisionUnlocked, setRevisionUnlocked] = useState(false),
    [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [archived, setArchived] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [quote, setQuote] = useState<Quote | null>(null),
    [videoModel, setVideoModel] = useState("kling"),
    [duration, setDuration] = useState(5),
    [feedback, setFeedback] = useState(""),
    [shortPolicy, setShortPolicy] = useState("reject"),
    [preview, setPreview] = useState<Asset | null>(null),
    [compare, setCompare] = useState<string[]>([]),
    [position, setPosition] = useState(0),
    [drag, setDrag] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null),
    activeRef = useRef(active),
    dirtyRef = useRef(dirty);
  activeRef.current = active;
  dirtyRef.current = dirty;
  const api = (path: string, method = "GET", body?: unknown) =>
    demo ? demoApi(path, method, body) : request(path, method, body);
  const VoiceButton = ({ onText }: { onText: (text: string) => void }) => (
    <div className="voice-control">
      <button
        type="button"
        className="secondary"
        disabled={!config?.transcription && !browserSpeech() && !recording}
        title={
          config?.transcription
            ? "Запись до 60 секунд · распознавание через OpenAI"
            : browserSpeech()
              ? "Распознавание средствами браузера · проверьте разрешение микрофона"
              : "Голос недоступен: нужен OPENAI_API_KEY или браузер с распознаванием речи"
        }
        onClick={async () => {
          if (recording) {
            recorder.current?.stop();
            speech.current?.stop();
            return;
          }
          try {
            if (!config?.transcription) {
              const SpeechRecognition = browserSpeech();
              if (!SpeechRecognition)
                throw Error(
                  "Для голоса нужен OPENAI_API_KEY или браузер с распознаванием речи",
                );
              const recognition = new SpeechRecognition();
              recognition.lang = "ru-RU";
              recognition.continuous = false;
              recognition.interimResults = false;
              recognition.onresult = (event) => {
                const text = Array.from(event.results)
                  .map((result) => result[0]?.transcript || "")
                  .join(" ")
                  .trim();
                if (text) onText(text);
                else setError("Речь не распознана. Попробуйте ещё раз.");
              };
              recognition.onerror = (event) => {
                setError(
                  event.error === "not-allowed"
                    ? "Разрешите доступ к микрофону для localhost:3000 в настройках браузера"
                    : `Не удалось распознать голос: ${event.error}`,
                );
                setRecording(false);
              };
              recognition.onend = () => {
                setRecording(false);
                speech.current = null;
              };
              speech.current = recognition;
              recognition.start();
              setRecording(true);
              return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
            });
            const mime = ["audio/webm", "audio/mp4"].find((v) =>
              MediaRecorder.isTypeSupported(v),
            );
            if (!mime) throw Error("Браузер не поддерживает запись голоса");
            const r = new MediaRecorder(stream, { mimeType: mime });
            const chunks: Blob[] = [];
            r.ondataavailable = (e) => chunks.push(e.data);
            r.onstop = async () => {
              setRecording(false);
              stream.getTracks().forEach((t) => t.stop());
              try {
                const body = new FormData();
                body.set(
                  "file",
                  new File(chunks, "voice." + mime.split("/")[1], {
                    type: mime,
                  }),
                );
                const result = await request("transcribe", "POST", body);
                onText(result.text);
              } catch (e) {
                setError((e as Error).message);
              }
            };
            recorder.current = r;
            r.start();
            setRecording(true);
            setTimeout(() => {
              if (r.state === "recording") r.stop();
            }, 60000);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {recording ? "■ Остановить запись" : "🎙 Надиктовать"}
      </button>
      {!config?.transcription && (
        <small>
          {browserSpeech()
            ? "Распознавание через браузер. При первом запуске разреши микрофон."
            : "Голос недоступен в этом браузере без OPENAI_API_KEY. Можно ввести текст вручную."}
        </small>
      )}
    </div>
  );
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    request("projects")
      .then(async (p) => {
        setProjects(p);
        setConfig(await request("config"));
        setLogged(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!logged) return;
    const timer = setInterval(async () => {
      const p = activeRef.current;
      if (!p) return;
      try {
        const next: Detail = await api("projects/" + p.id);
        setActive((old) => {
          if (!old || old.id !== next.id) return old;
          if (next.revision < old.revision) return old;
          return dirtyRef.current
            ? {
                ...old,
                assets: next.assets,
                jobs: next.jobs,
                statuses: next.statuses,
              }
            : next;
        });
      } catch {}
    }, 4000);
    return () => clearInterval(timer);
  }, [logged, demo]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const refresh = async () => {
    setProjects(await api("projects"));
    if (activeRef.current)
      setActive(await api("projects/" + activeRef.current.id));
  };
  const change = (patch: Partial<Doc>) => {
    setActive((p) => (p ? { ...p, document: { ...p.document, ...patch } } : p));
    setDirty(true);
  };
  const save = async () => {
    const p = activeRef.current;
    if (!p) return;
    if (
      p.document.scenes.some(
        (s) =>
          !Number.isFinite(s.start) ||
          !Number.isFinite(s.end) ||
          s.end <= s.start,
      )
    )
      throw Error("Конец сцены должен быть позже начала");
    const saved = await api("projects/" + p.id, "PUT", {
      revision: p.revision,
      document: p.document,
    });
    const current = activeRef.current;
    const edited = Boolean(
      current &&
      JSON.stringify(current.document) !== JSON.stringify(p.document),
    );
    const merged = {
      ...p,
      ...saved,
      document: edited ? current!.document : saved.document,
    };
    setActive(merged);
    activeRef.current = merged;
    setDirty(edited);
    dirtyRef.current = edited;
    setProjects(await api("projects"));
  };
  const requireSaved = () => {
    if (dirtyRef.current) throw Error("Сначала сохраните изменения");
  };
  const open = async (id: string) => {
    if (dirty && !confirm("Отменить несохранённые изменения?")) return;
    setActive(await api("projects/" + id));
    setDirty(false);
    setSelected([]);
    setCompare([]);
    setTab("Ключ");
    setPanel("Стиль");
    setRevisionUnlocked(false);
  };
  const create = async (doc = empty()) => {
    const p = await api("projects", "POST", doc);
    setProjects(await api("projects"));
    setActive(await api("projects/" + p.id));
    setDirty(false);
    setTab("Ключ");
    setPanel("Стиль");
    setRevisionUnlocked(false);
  };
  const url = (a: Asset) =>
    demo ? demoUrl(a) : "/api/assets/" + a.id + "/file";
  const upload = async (
    file: File | undefined,
    kind: string,
    target: string,
  ) => {
    if (!file || !active) return;
    if (dirtyRef.current) await save();
    requireSaved();
    if (demo) demoUpload(active.id, file, kind, target);
    else {
      const body = new FormData();
      body.set("kind", kind);
      body.set("target", target);
      body.set("file", file);
      await api("projects/" + active.id + "/assets", "POST", body);
    }
    await refresh();
  };
  const review = async (a: Asset, state: string, select = false) => {
    if (dirtyRef.current) await save();
    requireSaved();
    await api("assets/" + a.id + "/review", "POST", { state, select });
    await refresh();
  };
  const generate = async (kind: string, targets: string[]) => {
    if (dirtyRef.current) await save();
    requireSaved();
    if (!targets.length) throw Error("Выберите хотя бы одну сцену");
    setQuote(
      await api("projects/" + active!.id + "/quotes", "POST", {
        kind,
        targets,
        model: videoModel,
        duration,
        feedback,
        shortPolicy,
      }),
    );
  };
  const sceneEdit = (s: Scene, patch: Partial<Scene>) =>
    change({
      storyboardApproved: false,
      scenes: active!.document.scenes.map((v) =>
        v.id === s.id
          ? {
              ...v,
              ...patch,
              approved: "approved" in patch ? patch.approved! : false,
            }
          : v,
      ),
    });
  function Upload({
    kind,
    target,
    label,
  }: {
    kind: string;
    target: string;
    label: string;
  }) {
    return (
      <label className="upload">
        ↑ {label}
        <input
          disabled={busy}
          type="file"
          accept={
            kind === "audio"
              ? ".mp3,.wav"
              : kind === "video"
                ? ".mp4,.mov"
                : ".png,.jpg,.jpeg,.webp"
          }
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            run(() => upload(f, kind, target));
          }}
        />
      </label>
    );
  }
  function AssetGrid({ target, kind }: { target?: string; kind?: string }) {
    const assets = active!.assets.filter(
      (a) => (!target || a.target_id === target) && (!kind || a.kind === kind),
    );
    return (
      <div className="assetgrid">
        {assets.map((a, i) => (
          <article className="asset" key={a.id}>
            <div className="assetpreview" onClick={() => setPreview(a)}>
              {a.kind === "image" ? (
                <img src={url(a)} alt={a.name} />
              ) : a.kind === "video" ? (
                <video src={url(a)} muted preload="metadata" />
              ) : (
                <span>{a.kind === "audio" ? "♫" : "↗"}</span>
              )}
              <b className="version">v{assets.length - i}</b>
            </div>
            <div className="assetinfo">
              <b>{a.name}</b>
              {[
                active!.document.audioId,
                active!.document.styleId,
                ...active!.document.scenes.flatMap((s) => [
                  s.imageId,
                  s.videoId,
                ]),
                ...active!.document.characters.map((r) => r.assetId),
                ...active!.document.locations.map((r) => r.assetId),
              ].includes(a.id) && (
                <small className="badge">ФИНАЛЬНАЯ ВЕРСИЯ</small>
              )}
              <small>
                {a.source.includes("demo") ? "DEMO · имитация" : a.source} ·{" "}
                {a.state}{" "}
                {a.metadata.duration ? `· ${time(a.metadata.duration)}` : ""}
              </small>
              {a.metadata.error && <p className="error">{a.metadata.error}</p>}
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy || ["processing", "failed"].includes(a.state)}
                  onClick={() => run(() => review(a, "approved", true))}
                >
                  ✓ Выбрать
                </button>
                <button
                  className="ghost"
                  disabled={busy || ["processing", "failed"].includes(a.state)}
                  onClick={() => run(() => review(a, "rejected"))}
                >
                  Отклонить
                </button>
                {["image", "video"].includes(a.kind) && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={approvalSelection.includes(a.id)}
                      onChange={() =>
                        setApprovalSelection((v) =>
                          v.includes(a.id)
                            ? v.filter((id) => id !== a.id)
                            : [...v, a.id],
                        )
                      }
                    />
                    В пакет утверждения
                  </label>
                )}
                {["image", "video"].includes(a.kind) && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={compare.includes(a.id)}
                      onChange={() =>
                        setCompare((c) =>
                          c.includes(a.id)
                            ? c.filter((id) => id !== a.id)
                            : [...c.slice(-1), a.id],
                        )
                      }
                    />
                    Сравнить
                  </label>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }
  if (!logged)
    return (
      <div className="entry">
        <div className="entryart">
          <div className="orbit" />
          <div className="entrycaption">
            YOUR MUSIC. YOUR VISION.
            <br />
            EVERY FRAME, DIRECTED BY YOU.
          </div>
        </div>
        <main className="login">
          <div className="eyebrow">◈ CLIP MAKER / PRIVATE STUDIO</div>
          <h1>
            Звук становится
            <br />
            <em>историей.</em>
          </h1>
          <p>
            Твоя режиссура. Целая студия инструментов.
            <br />
            От первого образа до монтажной последовательности.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await request("login", "POST", { password });
                setPassword("");
                setProjects(await request("projects"));
                setConfig(await request("config"));
                setLogged(true);
              });
            }}
          >
            <Field label="Пароль студии">
              <input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button disabled={busy}>Войти в студию →</button>
          </form>
          <button
            className="secondary"
            onClick={() =>
              run(async () => {
                initDemo();
                setDemo(true);
                setProjects(await demoApi("projects"));
                setConfig(await demoApi("config"));
                setLogged(true);
              })
            }
          >
            Посмотреть демо
          </button>
          <small>
            Демо использует синтетические примеры. Платных запросов нет.
          </small>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </main>
      </div>
    );
  const d = active?.document,
    assets = active?.assets || [],
    audio = assets.find((a) => a.id === d?.audioId),
    cover = assets.find((a) => a.id === d?.styleId),
    latestStyle = assets.find(
      (a) => a.kind === "image" && a.target_id === "style",
    ),
    keyPreview = cover || latestStyle;
  const total =
      active?.jobs
        .filter((j) => j.state !== "cancelled")
        .reduce((sum, j) => sum + Number(j.confirmed ?? j.estimated ?? 0), 0) ||
      0,
    unknown = active?.jobs.some(
      (j) => j.estimated === null && j.confirmed === null,
    );
  const tabs = ["Ключ", "Сюжет", "Раскадровка", "Генерация", "Монтаж"];
  const panels: Record<string, string[]> = {
    Ключ: ["Стиль"],
    Сюжет: ["История", "Персонажи", "Локации"],
    Раскадровка: ["Таймлайн", "Раскадровка"],
    Генерация: ["Генерация", "Медиатека", "Очередь"],
    Монтаж: ["Экспорт", "Настройки"],
  };
  const approved = [
    Boolean(d?.workflow?.key),
    Boolean(d?.workflow?.story),
    Boolean(d?.workflow?.board),
    Boolean(d?.workflow?.generation),
    false,
  ];
  const stepIndex = tabs.indexOf(tab),
    stepApproved = approved[stepIndex];
  const stepStatus = (i: number) =>
    approved[i]
      ? "Утверждено"
      : i > 0 && !approved[i - 1]
        ? "Закрыто"
        : active?.jobs.some((j) =>
              ["queued", "polling", "processing", "submitting"].includes(
                j.state,
              ),
            ) && i === stepIndex
          ? "В работе"
          : i === stepIndex
            ? "Ожидает утверждения"
            : "Не начато";
  const approveStep = async () => {
    const p = activeRef.current!;
    const document = { ...p.document, workflow: { ...p.document.workflow } };
    if (tab === "Ключ") {
      if (
        !document.styleId ||
        !p.assets.some(
          (a) => a.id === document.styleId && a.state === "approved",
        )
      )
        throw Error("Сначала выбери утверждённое ключевое изображение");
      document.workflow.key = true;
    }
    if (tab === "Сюжет") {
      if (!document.idea.trim() && !document.concept.trim())
        throw Error("Сначала опиши сюжет");
      document.conceptApproved = true;
      document.workflow.story = true;
    }
    if (tab === "Раскадровка") {
      if (!document.audioId) throw Error("Загрузи и выбери музыку");
      const length =
        p.assets.find((a) => a.id === document.audioId)?.metadata.duration || 0;
      const shots = [...document.scenes].sort((a, b) => a.start - b.start);
      if (
        !shots.length ||
        Math.abs(shots[0].start) > 0.04 ||
        Math.abs(shots.at(-1)!.end - length) > 0.1 ||
        shots.some(
          (s, i) =>
            !s.approved ||
            !s.imageId ||
            !p.assets.some(
              (a) => a.id === s.imageId && a.state === "approved",
            ) ||
            (i > 0 && Math.abs(shots[i - 1].end - s.start) > 0.04),
        )
      )
        throw Error(
          "Нужны утверждённые кадры без пропусков на всю длину музыки",
        );
      document.scenes = document.scenes.map((s) => ({ ...s, approved: true }));
      document.storyboardApproved = true;
      document.workflow.board = true;
    }
    if (tab === "Генерация") {
      if (
        !document.scenes.length ||
        document.scenes.some(
          (s) =>
            !s.videoId ||
            !p.assets.some((a) => a.id === s.videoId && a.state === "approved"),
        )
      )
        throw Error("Утверди видео для каждой сцены");
      document.workflow.generation = true;
    }
    const saved = await api("projects/" + p.id, "PUT", {
      revision: p.revision,
      document,
    });
    setActive({ ...p, ...saved });
    setDirty(false);
    setRevisionUnlocked(false);
    setTab(tabs[Math.min(stepIndex + 1, 4)]);
    setPanel(panels[tabs[Math.min(stepIndex + 1, 4)]][0]);
  };
  return (
    <div className="shell">
      <aside>
        <b className="brand">◈ CLIP MAKER</b>
        <small>ТВОЯ ПРОДАКШН-СТУДИЯ</small>
        <button
          className={!active ? "selected" : ""}
          onClick={() =>
            run(async () => {
              if (dirty && !confirm("Отменить изменения?")) return;
              setActive(null);
              setDirty(false);
              setProjects(await api("projects"));
            })
          }
        >
          ▦ Проекты
        </button>
        <div className="navlabel">ПРОИЗВОДСТВО</div>
        {tabs.map((t, i) => (
          <button
            key={t}
            disabled={!active || (i > 0 && !approved[i - 1] && !approved[i])}
            className={active && tab === t ? "selected" : ""}
            onClick={() => {
              setTab(t);
              setPanel(panels[t][0]);
              setRevisionUnlocked(false);
              window.scrollTo({ top: 0 });
            }}
          >
            <span className="navicon">{["◈", "✧", "▤", "◐", "↗"][i]}</span>
            {t} {approved[i] ? "✓" : ""}
            <small className="step-status">{active && stepStatus(i)}</small>
          </button>
        ))}
        <footer>
          <span className="badge">
            {demo
              ? "DEMO · БЕЗ ОПЛАТЫ"
              : config?.local
                ? "ЛОКАЛЬНАЯ СТУДИЯ"
                : "PRIVATE WORKSPACE"}
          </span>
          <button
            onClick={() =>
              run(async () => {
                if (dirty && !confirm("Выйти без сохранения?")) return;
                await api("logout", "POST");
                setLogged(false);
                setDemo(false);
                setActive(null);
                setProjects([]);
                setDirty(false);
              })
            }
          >
            Выйти
          </button>
        </footer>
      </aside>
      <main>
        <header>
          <span>Студия / {active ? d!.title : "Проекты"}</span>
          <span className="badge">
            {demo ? "ДЕМОНСТРАЦИОННЫЙ РЕЖИМ" : "DIRECTOR’S WORKSPACE"}
          </span>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="ghost" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {demo && (
          <div className="notice">
            Демо · результаты синтетические, данные хранятся до перезагрузки.
            Экспорт — фиксированный пример, не монтаж текущего демопроекта.
          </div>
        )}
        {!active ? (
          <>
            <div className="heading">
              <div>
                <div className="eyebrow">THE DIRECTOR’S DESK</div>
                <h1>Твои истории</h1>
                <p>От первого образа до последнего кадра.</p>
              </div>
              <button disabled={busy} onClick={() => run(() => create())}>
                + Новый клип
              </button>
            </div>
            <div className="actions">
              <button
                className={!archived ? "pill active" : "pill"}
                onClick={() => setArchived(false)}
              >
                В работе
              </button>
              <button
                className={archived ? "pill active" : "pill"}
                onClick={() => setArchived(true)}
              >
                Архив
              </button>
              <span>
                {
                  projects.filter((p) => p.document.archived === archived)
                    .length
                }{" "}
                проектов
              </span>
            </div>
            <div className="grid">
              {projects
                .filter((p) => p.document.archived === archived)
                .map((p, i) => (
                  <article className="projectcard" key={p.id}>
                    <div className={"cover cover" + (i % 3)}>
                      {p.document.styleId ? (
                        <img
                          className="projectcover"
                          src={
                            demo
                              ? "/demo/frame.svg"
                              : "/api/assets/" + p.document.styleId + "/file"
                          }
                          alt="Стиль проекта"
                        />
                      ) : (
                        <div className="coverorb" />
                      )}
                      <span>
                        {p.document.ratio} /{" "}
                        {p.document.scenes.some((s) => s.videoId)
                          ? "VIDEO REVIEW"
                          : p.document.storyboardApproved
                            ? "PRODUCTION"
                            : "DEVELOPMENT"}
                      </span>
                      <b>{String(i + 1).padStart(2, "0")}</b>
                    </div>
                    <div className="cardbody">
                      <h2>{p.document.title}</h2>
                      <p>
                        {p.document.scenes.length} сцен ·{" "}
                        {p.document.scenes.length
                          ? time(
                              Math.max(...p.document.scenes.map((s) => s.end)),
                            )
                          : "Таймлайн не задан"}
                      </p>
                      <div className="progress">
                        <i
                          style={{
                            width: `${p.document.scenes.length ? (100 * p.document.scenes.filter((s) => s.videoId).length) / p.document.scenes.length : 0}%`,
                          }}
                        />
                      </div>
                      <small>
                        {new Date(p.updated_at).toLocaleDateString("ru")} ·
                        стоимость внутри проекта
                      </small>
                      <div className="actions">
                        <button onClick={() => run(() => open(p.id))}>
                          Открыть →
                        </button>
                        <button
                          className="ghost"
                          onClick={() =>
                            run(() =>
                              create({
                                ...p.document,
                                title: p.document.title + " · копия",
                                archived: false,
                                audioId: null,
                                styleId: null,
                                conceptApproved: false,
                                storyboardApproved: false,
                                scenes: p.document.scenes.map((s) => ({
                                  ...s,
                                  imageId: null,
                                  videoId: null,
                                  approved: false,
                                })),
                                characters: p.document.characters.map((r) => ({
                                  ...r,
                                  assetId: null,
                                  approved: false,
                                })),
                                locations: p.document.locations.map((r) => ({
                                  ...r,
                                  assetId: null,
                                  approved: false,
                                })),
                              }),
                            )
                          }
                        >
                          Копия
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
            {!projects.filter((p) => p.document.archived === archived)
              .length && (
              <section className="empty">
                <h2>Здесь начинается твой следующий клип.</h2>
                <p>Создай проект, загрузи музыку и опиши идею.</p>
              </section>
            )}
          </>
        ) : (
          <>
            <div className="heading">
              <div>
                <div className="eyebrow">{tab.toUpperCase()}</div>
                <h1>{d!.title}</h1>
                <p>
                  {d!.scenes.length} сцен · {d!.ratio} · {d!.fps} fps
                  {d!.paused ? " · На паузе" : ""}
                </p>
              </div>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      requireSaved();
                      await api("projects/" + active.id, "PUT", {
                        revision: active.revision,
                        document: { ...d!, paused: !d!.paused },
                      });
                      await refresh();
                    })
                  }
                >
                  {d!.paused ? "Продолжить" : "Пауза"}
                </button>
                <button disabled={busy || !dirty} onClick={() => run(save)}>
                  {busy ? "Подождите…" : dirty ? "Сохранить" : "✓ Сохранено"}
                </button>
                {dirty && (
                  <button
                    className="ghost"
                    onClick={() =>
                      run(async () => {
                        if (confirm("Загрузить сохранённую версию?")) {
                          setDirty(false);
                          await refresh();
                        }
                      })
                    }
                  >
                    Отменить
                  </button>
                )}
              </div>
            </div>
            <div className="pipeline">
              {tabs.map((name, i) => (
                <div className={approved[i] ? "done" : ""} key={name}>
                  <span>{approved[i] ? "✓" : i + 1}</span>
                  {name}
                </div>
              ))}
            </div>
            <div className="wizard-actions">
              <div className="wizard-tabs">
                {panels[tab].map((name) => (
                  <button
                    key={name}
                    className={panel === name ? "selected" : "ghost"}
                    onClick={() => setPanel(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {stepApproved && !revisionUnlocked ? (
                <div className="notice">
                  Этап утверждён.{" "}
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Изменение этого этапа пометит следующие этапы как требующие проверки. Созданные версии медиа сохранятся. Продолжить?",
                        )
                      ) {
                        setRevisionUnlocked(true);
                        const workflow = { ...d!.workflow };
                        for (let i = stepIndex; i < 4; i++)
                          workflow[
                            ["key", "story", "board", "generation"][
                              i
                            ] as keyof typeof workflow
                          ] = false;
                        change({ workflow });
                      }
                    }}
                  >
                    Изменить этап
                  </button>
                </div>
              ) : (
                tab !== "Монтаж" && (
                  <button
                    className="primary"
                    disabled={busy || dirty}
                    onClick={() => run(approveStep)}
                  >
                    Утвердить{" "}
                    {
                      (
                        {
                          Ключ: "ключ",
                          Сюжет: "сюжет",
                          Раскадровка: "раскадровку",
                          Генерация: "генерацию",
                        } as Record<string, string>
                      )[tab]
                    }{" "}
                    →
                  </button>
                )
              )}
            </div>
            {(!stepApproved || revisionUnlocked) && (
              <>
                {panel === "История" && (
                  <div className="twocol">
                    <section>
                      <h2>Музыка и замысел</h2>
                      <Field label="Название">
                        <input
                          value={d!.title}
                          onChange={(e) => change({ title: e.target.value })}
                        />
                      </Field>
                      <Field label="Идея клипа">
                        <textarea
                          rows={5}
                          placeholder="Расскажи историю так, как ты её видишь…"
                          value={d!.idea}
                          onChange={(e) =>
                            change({
                              idea: e.target.value,
                              conceptApproved: false,
                            })
                          }
                        />
                      </Field>
                      <VoiceButton
                        onText={(text) =>
                          change({
                            idea: [d!.idea, text].filter(Boolean).join("\n"),
                            conceptApproved: false,
                          })
                        }
                      />
                      <Field label="Текст песни (необязательно)">
                        <textarea
                          value={d!.lyrics}
                          onChange={(e) => change({ lyrics: e.target.value })}
                        />
                      </Field>
                      <Field label="Сценарная концепция">
                        <textarea
                          rows={5}
                          value={d!.concept}
                          onChange={(e) =>
                            change({
                              concept: e.target.value,
                              conceptApproved: false,
                            })
                          }
                        />
                      </Field>
                    </section>
                    <div>
                      <section>
                        <h2>Музыкальный трек</h2>
                        <p>
                          MP3 или WAV, до 256 МБ и одного часа. Длительность и
                          waveform анализируются в фоне.
                        </p>
                        <Upload
                          kind="audio"
                          target="audio"
                          label="Загрузить трек"
                        />
                        {audio && <audio controls src={url(audio)} />}
                        <AssetGrid target="audio" />
                      </section>
                      <section>
                        <div className="eyebrow">AI СОАВТОР</div>
                        <h2>Развить историю</h2>
                        <p>
                          Ассистент предложит сценарий и план кадров. Применение
                          черновика всегда остаётся за тобой.
                        </p>
                        <textarea
                          placeholder="Пожелания или правки к следующему варианту…"
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                        <button
                          disabled={busy || (!demo && !config?.screenplay)}
                          onClick={() =>
                            run(() => generate("screenplay", ["project"]))
                          }
                        >
                          Предложить сценарий →
                        </button>
                        {!demo && !config?.screenplay && (
                          <small>Провайдер сценария не настроен.</small>
                        )}
                      </section>
                      <section>
                        <h2>Референсы проекта</h2>
                        <Upload
                          kind="image"
                          target="reference"
                          label="Изображение"
                        />
                        <Upload kind="video" target="reference" label="Видео" />
                        <AssetGrid target="reference" />
                      </section>
                    </div>
                  </div>
                )}
                {panel === "Стиль" && (
                  <>
                    <section>
                      <div className="twocol">
                        <div>
                          <h2>Визуальный язык</h2>
                          <p>
                            Сначала выбери направление. Этот кадр станет
                            референсом для персонажей, локаций и сцен.
                          </p>
                          <textarea
                            rows={5}
                            value={d!.stylePrompt}
                            placeholder="Свет, палитра, фактура, эпоха, настроение…"
                            onChange={(e) =>
                              change({
                                stylePrompt: e.target.value,
                                styleId: null,
                              })
                            }
                          />
                          <VoiceButton
                            onText={(text) =>
                              change({
                                stylePrompt: [d!.stylePrompt, text]
                                  .filter(Boolean)
                                  .join("\n"),
                                styleId: null,
                              })
                            }
                          />
                          <div className="actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(() => generate("image", ["style"]))
                              }
                            >
                              Создать вариант
                            </button>
                            <Upload
                              kind="image"
                              target="style"
                              label="Загрузить свой"
                            />
                          </div>
                        </div>
                        {keyPreview ? (
                          <div>
                            <img
                              className="heroimage"
                              src={url(keyPreview)}
                              alt={
                                cover
                                  ? "Выбранный ключ"
                                  : "Последняя версия ключа"
                              }
                            />
                            <p className="key-help">
                              {cover
                                ? "Выбранный ключевой кадр. Нажми «Утвердить ключ», чтобы перейти к сюжету."
                                : "Изображение загружено. Нажми «✓ Выбрать» под ним, затем «Утвердить ключ»."}
                            </p>
                          </div>
                        ) : (
                          <div className="frameplaceholder">
                            ◐<small>Утверждённый стиль появится здесь</small>
                          </div>
                        )}
                      </div>
                    </section>
                    <AssetGrid target="style" />
                  </>
                )}
                {(panel === "Персонажи" || panel === "Локации") && (
                  <>
                    {(() => {
                      const key =
                        panel === "Персонажи" ? "characters" : "locations";
                      return (
                        <>
                          <div className="actions">
                            <button
                              onClick={() =>
                                change({ [key]: [...d![key], newProfile()] })
                              }
                            >
                              + {key === "characters" ? "Персонаж" : "Локация"}
                            </button>
                            <span>
                              Референсы и описание сохраняются для всех
                              связанных сцен.
                            </span>
                          </div>
                          {d![key].map((r) => {
                            const edit = (patch: Partial<typeof r>) =>
                              change({
                                [key]: d![key].map((v) =>
                                  v.id === r.id
                                    ? {
                                        ...v,
                                        ...patch,
                                        approved:
                                          "approved" in patch
                                            ? patch.approved!
                                            : false,
                                      }
                                    : v,
                                ),
                              });
                            return (
                              <section key={r.id}>
                                <div className="twocol">
                                  <div>
                                    <Field label="Название">
                                      <input
                                        value={r.name}
                                        onChange={(e) =>
                                          edit({ name: e.target.value })
                                        }
                                      />
                                    </Field>
                                    <Field label="Описание">
                                      <textarea
                                        value={r.description}
                                        onChange={(e) =>
                                          edit({ description: e.target.value })
                                        }
                                      />
                                    </Field>
                                    <Field
                                      label={
                                        key === "characters"
                                          ? "Внешность"
                                          : "Свет и атмосфера"
                                      }
                                    >
                                      <textarea
                                        value={r.appearance}
                                        onChange={(e) =>
                                          edit({ appearance: e.target.value })
                                        }
                                      />
                                    </Field>
                                    <Field
                                      label={
                                        key === "characters"
                                          ? "Одежда"
                                          : "Палитра и фактуры"
                                      }
                                    >
                                      <input
                                        value={r.clothing}
                                        onChange={(e) =>
                                          edit({ clothing: e.target.value })
                                        }
                                      />
                                    </Field>
                                    <Field label="Заметки">
                                      <input
                                        value={r.notes}
                                        onChange={(e) =>
                                          edit({ notes: e.target.value })
                                        }
                                      />
                                    </Field>
                                    {r.variants.map((v, i) => (
                                      <div className="actions" key={i}>
                                        <input
                                          aria-label="Название варианта"
                                          value={v.name}
                                          onChange={(e) =>
                                            edit({
                                              variants: r.variants.map(
                                                (a, j) =>
                                                  j === i
                                                    ? {
                                                        ...a,
                                                        name: e.target.value,
                                                      }
                                                    : a,
                                              ),
                                            })
                                          }
                                        />
                                        <input
                                          aria-label="Описание варианта"
                                          value={v.description}
                                          onChange={(e) =>
                                            edit({
                                              variants: r.variants.map(
                                                (a, j) =>
                                                  j === i
                                                    ? {
                                                        ...a,
                                                        description:
                                                          e.target.value,
                                                      }
                                                    : a,
                                              ),
                                            })
                                          }
                                        />
                                      </div>
                                    ))}
                                    <button
                                      className="ghost"
                                      onClick={() =>
                                        edit({
                                          variants: [
                                            ...r.variants,
                                            {
                                              name: "Вариант",
                                              description: "",
                                            },
                                          ],
                                        })
                                      }
                                    >
                                      + Вариант образа
                                    </button>
                                    <div className="actions">
                                      <button
                                        className="secondary"
                                        onClick={() =>
                                          edit({ approved: !r.approved })
                                        }
                                      >
                                        {r.approved
                                          ? "✓ Описание утверждено"
                                          : "Утвердить описание"}
                                      </button>
                                      <button
                                        className="ghost"
                                        onClick={() => {
                                          if (
                                            confirm(
                                              "Удалить профиль и убрать его из сцен?",
                                            )
                                          )
                                            change({
                                              [key]: d![key].filter(
                                                (v) => v.id !== r.id,
                                              ),
                                              scenes: d!.scenes.map((s) => ({
                                                ...s,
                                                characterIds:
                                                  s.characterIds.filter(
                                                    (id) => id !== r.id,
                                                  ),
                                                locationId:
                                                  s.locationId === r.id
                                                    ? null
                                                    : s.locationId,
                                                approved: false,
                                              })),
                                              storyboardApproved: false,
                                            });
                                        }}
                                      >
                                        Удалить
                                      </button>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="actions">
                                      <button
                                        disabled={busy}
                                        onClick={() =>
                                          run(() => generate("image", [r.id]))
                                        }
                                      >
                                        Создать референс
                                      </button>
                                      <Upload
                                        kind="image"
                                        target={r.id}
                                        label="Загрузить"
                                      />
                                    </div>
                                    <AssetGrid target={r.id} />
                                  </div>
                                </div>
                              </section>
                            );
                          })}
                        </>
                      );
                    })()}
                  </>
                )}
                {panel === "Раскадровка" && (
                  <>
                    <div className="toolbar">
                      <button
                        onClick={() => {
                          const length = audio?.metadata.duration || 0;
                          if (!length) {
                            setError("Сначала загрузи и выбери музыку");
                            return;
                          }
                          if (
                            d!.scenes.length &&
                            !confirm(
                              "Заменить список кадров? Старые медиафайлы останутся в медиатеке.",
                            )
                          )
                            return;
                          const count = Math.ceil(length / 5);
                          change({
                            scenes: Array.from({ length: count }, (_, i) => ({
                              ...newScene((i * length) / count),
                              title: `Кадр ${i + 1}`,
                              end: ((i + 1) * length) / count,
                              description: d!.concept || d!.idea,
                              prompt: `${d!.stylePrompt}. ${d!.concept || d!.idea}`,
                              approved: true,
                            })),
                            storyboardApproved: false,
                          });
                        }}
                      >
                        Предложить разбивку по музыке
                      </button>
                      <button
                        onClick={() =>
                          change({
                            scenes: [
                              ...d!.scenes,
                              newScene(d!.scenes.at(-1)?.end || 0),
                            ],
                            storyboardApproved: false,
                          })
                        }
                      >
                        + Сцена
                      </button>
                      <button
                        className="ghost"
                        onClick={() =>
                          setSelected(
                            selected.length === d!.scenes.length
                              ? []
                              : d!.scenes.map((s) => s.id),
                          )
                        }
                      >
                        Выбрать все
                      </button>
                    </div>
                    <section className="batch">
                      <b>{selected.length} выбрано</b>
                      <button
                        disabled={busy || !selected.length}
                        onClick={() => run(() => generate("image", selected))}
                      >
                        Генерировать кадры
                      </button>
                    </section>
                    {d!.scenes.map((s, i) => (
                      <section
                        className="scene"
                        key={s.id}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (!drag || drag === s.id) return;
                          const list = [...d!.scenes],
                            from = list.findIndex((v) => v.id === drag),
                            to = list.findIndex((v) => v.id === s.id);
                          const [item] = list.splice(from, 1);
                          list.splice(to, 0, item);
                          change({ scenes: list, storyboardApproved: false });
                          setDrag(null);
                        }}
                      >
                        <div className="sceneNumber">
                          <span
                            draggable
                            onDragStart={() => setDrag(s.id)}
                            title="Перетащить сцену"
                          >
                            ⠿ {String(i + 1).padStart(2, "0")}
                          </span>
                          <input
                            aria-label="Выбрать сцену"
                            type="checkbox"
                            checked={selected.includes(s.id)}
                            onChange={() =>
                              setSelected((v) =>
                                v.includes(s.id)
                                  ? v.filter((id) => id !== s.id)
                                  : [...v, s.id],
                              )
                            }
                          />
                        </div>
                        <div>
                          <div className="scenetop">
                            <input
                              aria-label="Название сцены"
                              value={s.title}
                              onChange={(e) =>
                                sceneEdit(s, { title: e.target.value })
                              }
                            />
                            <span className="status">
                              {labels[active.statuses[s.id]] ||
                                active.statuses[s.id] ||
                                (s.videoId
                                  ? "Видео выбрано"
                                  : s.imageId
                                    ? "Кадр выбран"
                                    : "Черновик")}
                            </span>
                          </div>
                          <div className="actions">
                            <Field label="Начало, сек.">
                              <input
                                type="number"
                                min="0"
                                step="0.04"
                                value={s.start}
                                onChange={(e) =>
                                  sceneEdit(s, {
                                    start: Number(e.target.value),
                                  })
                                }
                              />
                            </Field>
                            <Field label="Конец, сек.">
                              <input
                                type="number"
                                min="0"
                                step="0.04"
                                value={s.end}
                                onChange={(e) =>
                                  sceneEdit(s, { end: Number(e.target.value) })
                                }
                              />
                            </Field>
                            <span>{(s.end - s.start).toFixed(2)} сек.</span>
                          </div>
                          <textarea
                            aria-label="Описание сцены"
                            placeholder="Что происходит в кадре?"
                            value={s.description}
                            onChange={(e) =>
                              sceneEdit(s, { description: e.target.value })
                            }
                          />
                          <details>
                            <summary>Режиссура и запросы</summary>
                            <div className="twocol">
                              <Field label="Крупность">
                                <input
                                  value={s.framing}
                                  onChange={(e) =>
                                    sceneEdit(s, { framing: e.target.value })
                                  }
                                />
                              </Field>
                              <Field label="Движение камеры">
                                <input
                                  value={s.movement}
                                  onChange={(e) =>
                                    sceneEdit(s, { movement: e.target.value })
                                  }
                                />
                              </Field>
                            </div>
                            <Field label="Запрос для изображения">
                              <textarea
                                value={s.prompt}
                                onChange={(e) =>
                                  sceneEdit(s, { prompt: e.target.value })
                                }
                              />
                            </Field>
                            <Field label="Запрос для анимации">
                              <textarea
                                value={s.videoPrompt}
                                onChange={(e) =>
                                  sceneEdit(s, { videoPrompt: e.target.value })
                                }
                              />
                            </Field>
                            <Field label="Локация">
                              <select
                                value={s.locationId || ""}
                                onChange={(e) =>
                                  sceneEdit(s, {
                                    locationId: e.target.value || null,
                                  })
                                }
                              >
                                <option value="">Без локации</option>
                                {d!.locations.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <div className="actions">
                              {d!.characters.map((r) => (
                                <label className="check" key={r.id}>
                                  <input
                                    type="checkbox"
                                    checked={s.characterIds.includes(r.id)}
                                    onChange={() =>
                                      sceneEdit(s, {
                                        characterIds: s.characterIds.includes(
                                          r.id,
                                        )
                                          ? s.characterIds.filter(
                                              (id) => id !== r.id,
                                            )
                                          : [...s.characterIds, r.id],
                                      })
                                    }
                                  />
                                  {r.name}
                                </label>
                              ))}
                            </div>
                          </details>
                          <div className="actions">
                            <button
                              className="secondary"
                              onClick={() =>
                                sceneEdit(s, { approved: !s.approved })
                              }
                            >
                              {s.approved
                                ? "✓ Сцена утверждена"
                                : "Утвердить сцену"}
                            </button>
                            <Upload kind="image" target={s.id} label="Кадр" />
                            <button
                              className="ghost"
                              disabled={s.end - s.start < 1}
                              onClick={() => {
                                const middle = (s.start + s.end) / 2;
                                const copy = {
                                  ...newScene(middle),
                                  title: s.title + " · продолжение",
                                  end: s.end,
                                  description: s.description,
                                  prompt: s.prompt,
                                };
                                change({
                                  scenes: d!.scenes.flatMap((v) =>
                                    v.id === s.id
                                      ? [
                                          {
                                            ...v,
                                            end: middle,
                                            approved: false,
                                          },
                                          copy,
                                        ]
                                      : [v],
                                  ),
                                  storyboardApproved: false,
                                });
                              }}
                            >
                              Разделить
                            </button>
                            <button
                              className="ghost"
                              disabled={i === 0}
                              onClick={() => {
                                const scenes = [...d!.scenes];
                                [scenes[i - 1], scenes[i]] = [
                                  scenes[i],
                                  scenes[i - 1],
                                ];
                                change({ scenes, storyboardApproved: false });
                              }}
                            >
                              ↑
                            </button>
                            <button
                              className="ghost"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Удалить сцену? Медиа останутся в библиотеке.",
                                  )
                                )
                                  change({
                                    scenes: d!.scenes.filter(
                                      (v) => v.id !== s.id,
                                    ),
                                    storyboardApproved: false,
                                  });
                              }}
                            >
                              Удалить
                            </button>
                          </div>
                          <AssetGrid target={s.id} />
                        </div>
                      </section>
                    ))}
                  </>
                )}
                {panel === "Таймлайн" && (
                  <>
                    <section className="story-preview">
                      {(() => {
                        const shot = d!.scenes.find(
                          (s) => position >= s.start && position < s.end,
                        );
                        const image = assets.find(
                          (a) => a.id === shot?.imageId,
                        );
                        return image ? (
                          <img
                            src={url(image)}
                            alt={shot?.title || "Кадр раскадровки"}
                          />
                        ) : (
                          <div className="frameplaceholder">
                            {shot
                              ? `Кадр «${shot.title}» ещё не выбран`
                              : "На этой секунде нет кадра"}
                          </div>
                        );
                      })()}
                      <p>
                        {d!.scenes.find(
                          (s) => position >= s.start && position < s.end,
                        )?.title || "Раскадровка"}{" "}
                        · {time(position)}
                      </p>
                    </section>
                    {!audio && (
                      <section>
                        <h2>Загрузи музыку</h2>
                        <Upload
                          kind="audio"
                          target="audio"
                          label="Загрузить MP3 или WAV"
                        />
                        <AssetGrid target="audio" />
                      </section>
                    )}
                    <section>
                      <div className="heading compact">
                        <h2>Музыка ведёт монтаж</h2>
                        <span>
                          {time(position)} /{" "}
                          {time(audio?.metadata.duration || 0)}
                        </span>
                      </div>
                      {audio ? (
                        <>
                          <audio
                            ref={player}
                            controls
                            src={url(audio)}
                            onTimeUpdate={(e) =>
                              setPosition(e.currentTarget.currentTime)
                            }
                          />
                          <div
                            className="waveform"
                            role="slider"
                            aria-label="Позиция аудио"
                            aria-valuemin={0}
                            aria-valuemax={audio.metadata.duration || 0}
                            aria-valuenow={position}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (
                                player.current &&
                                ["ArrowLeft", "ArrowRight"].includes(e.key)
                              )
                                player.current.currentTime = Math.max(
                                  0,
                                  Math.min(
                                    audio.metadata.duration || 0,
                                    position +
                                      (e.key === "ArrowRight" ? 1 : -1),
                                  ),
                                );
                            }}
                            onClick={(e) => {
                              const bounds =
                                e.currentTarget.getBoundingClientRect();
                              if (player.current)
                                player.current.currentTime =
                                  ((e.clientX - bounds.left) / bounds.width) *
                                  (audio.metadata.duration || 0);
                            }}
                          >
                            {(audio.metadata.waveform || []).map((v, i) => (
                              <i
                                key={i}
                                style={{ height: `${Math.max(3, v * 100)}%` }}
                              />
                            ))}
                            <b
                              className="playhead"
                              style={{
                                left: `${(position / (audio.metadata.duration || 1)) * 100}%`,
                              }}
                            />
                            {d!.beats.map((b, i) => (
                              <span
                                key={i}
                                className="beat"
                                style={{
                                  left: `${(b / (audio.metadata.duration || 1)) * 100}%`,
                                }}
                              />
                            ))}
                          </div>
                          <div className="timelinebar">
                            {d!.scenes.map((s, i) => (
                              <button
                                key={s.id}
                                style={{
                                  left: `${(s.start / (audio.metadata.duration || 1)) * 100}%`,
                                  width: `${((s.end - s.start) / (audio.metadata.duration || 1)) * 100}%`,
                                }}
                                onClick={() => {
                                  if (player.current)
                                    player.current.currentTime = s.start;
                                }}
                              >
                                {i + 1} · {s.title}
                              </button>
                            ))}
                          </div>
                          <small>
                            {demo
                              ? "Демонстрационный waveform. В рабочем режиме строится по загруженному аудио."
                              : "Waveform построен по аудио."}{" "}
                            Биты и музыкальные секции отмечаются вручную.
                          </small>
                          <div className="actions">
                            <button
                              className="secondary"
                              onClick={() =>
                                change({
                                  beats: [
                                    ...d!.beats,
                                    Math.round(position * 100) / 100,
                                  ].sort((a, b) => a - b),
                                })
                              }
                            >
                              + Бит в {time(position)}
                            </button>
                            <button
                              className="ghost"
                              onClick={() => change({ beats: [] })}
                            >
                              Очистить биты
                            </button>
                          </div>
                          <div className="beatlist">
                            {d!.beats.map((b, i) => (
                              <button
                                className="pill"
                                key={i}
                                onClick={() =>
                                  change({
                                    beats: d!.beats.filter((_, j) => j !== i),
                                  })
                                }
                              >
                                {time(b)} ×
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p>Выбери утверждённый трек на вкладке «История».</p>
                      )}
                    </section>
                    <section>
                      <h2>Музыкальные секции</h2>
                      {d!.sections.map((s, i) => (
                        <div className="sectionrow" key={i}>
                          <input
                            aria-label="Название секции"
                            value={s.name}
                            onChange={(e) =>
                              change({
                                sections: d!.sections.map((v, j) =>
                                  j === i ? { ...v, name: e.target.value } : v,
                                ),
                              })
                            }
                          />
                          <input
                            aria-label="Начало секции"
                            type="number"
                            value={s.start}
                            onChange={(e) =>
                              change({
                                sections: d!.sections.map((v, j) =>
                                  j === i
                                    ? { ...v, start: Number(e.target.value) }
                                    : v,
                                ),
                              })
                            }
                          />
                          <input
                            aria-label="Конец секции"
                            type="number"
                            value={s.end}
                            onChange={(e) =>
                              change({
                                sections: d!.sections.map((v, j) =>
                                  j === i
                                    ? { ...v, end: Number(e.target.value) }
                                    : v,
                                ),
                              })
                            }
                          />
                          <button
                            className="ghost"
                            onClick={() =>
                              change({
                                sections: d!.sections.filter((_, j) => j !== i),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        className="secondary"
                        onClick={() =>
                          change({
                            sections: [
                              ...d!.sections,
                              {
                                name: "Припев",
                                start: position,
                                end: position + 5,
                              },
                            ],
                          })
                        }
                      >
                        + Секция
                      </button>
                    </section>
                    <section>
                      <h2>Границы сцен</h2>
                      {d!.scenes.map((s) => (
                        <div className="sectionrow" key={s.id}>
                          <b>{s.title}</b>
                          <input
                            aria-label="Начало сцены"
                            type="number"
                            step="0.04"
                            value={s.start}
                            onChange={(e) =>
                              sceneEdit(s, { start: Number(e.target.value) })
                            }
                          />
                          <input
                            aria-label="Конец сцены"
                            type="number"
                            step="0.04"
                            value={s.end}
                            onChange={(e) =>
                              sceneEdit(s, { end: Number(e.target.value) })
                            }
                          />
                          <span>{time(s.end - s.start)}</span>
                        </div>
                      ))}
                    </section>
                  </>
                )}
                {panel === "Генерация" && (
                  <>
                    <section>
                      <h2>Анимировать раскадровку</h2>
                      <p>
                        Выбери провайдера и длительность, затем отправь все
                        кадры на генерацию. Стоимость показывается до
                        подтверждения.
                      </p>
                      <select
                        aria-label="Видеопровайдер"
                        value={videoModel}
                        onChange={(e) => setVideoModel(e.target.value)}
                      >
                        <option value="kling">Kling 3 Standard</option>
                        <option value="seedance">Seedance 1 Pro</option>
                      </select>
                      <input
                        aria-label="Длительность видео"
                        type="number"
                        min={videoModel === "kling" ? 3 : 2}
                        max={videoModel === "kling" ? 15 : 12}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      />
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            generate(
                              "video",
                              d!.scenes
                                .filter((s) => s.imageId && !s.videoId)
                                .map((s) => s.id),
                            ),
                          )
                        }
                      >
                        Сгенерировать все видео
                      </button>
                    </section>
                    <div className="generation-grid">
                      {d!.scenes.map((s, i) => {
                        const image = assets.find((a) => a.id === s.imageId),
                          video = assets.find((a) => a.id === s.videoId);
                        return (
                          <section key={s.id}>
                            <h3>
                              {i + 1}. {s.title}
                            </h3>
                            <small>
                              {time(s.start)}–{time(s.end)}
                            </small>
                            {image && (
                              <img
                                src={url(image)}
                                alt={`Исходный кадр ${i + 1}`}
                              />
                            )}{" "}
                            {video ? (
                              <video controls src={url(video)} />
                            ) : (
                              <p>Видео ожидается</p>
                            )}
                            <AssetGrid target={s.id} />
                            <textarea
                              aria-label={`Пожелание к сцене ${i + 1}`}
                              placeholder="Опиши, что изменить в движении"
                              value={feedback}
                              onChange={(e) => setFeedback(e.target.value)}
                            />
                            <VoiceButton
                              onText={(text) =>
                                setFeedback(
                                  [feedback, text].filter(Boolean).join("\n"),
                                )
                              }
                            />
                            <button
                              disabled={busy || !s.imageId}
                              onClick={() =>
                                run(() => generate("video", [s.id]))
                              }
                            >
                              Создать новую версию
                            </button>
                          </section>
                        );
                      })}
                    </div>
                  </>
                )}
                {panel === "Медиатека" && (
                  <>
                    <p>
                      Все загрузки и генерации, включая отклонённые версии.
                      Смена финального кадра не удаляет предыдущие варианты.
                    </p>
                    <AssetGrid />
                  </>
                )}
                {panel === "Очередь" && (
                  <>
                    <div className="stats">
                      <section>
                        <small>ОЦЕНКА / ПОДТВЕРЖДЁННЫЕ РАСХОДЫ</small>
                        <h2>
                          ${total.toFixed(2)}
                          {unknown ? " + неизвестная стоимость" : ""}
                        </h2>
                        <p>
                          Оценки задаются в конфигурации. Это не выписка
                          провайдера.
                        </p>
                      </section>
                      <section>
                        <small>ЛИМИТ ПРОЕКТА</small>
                        <h2>
                          {d!.budget === null
                            ? "Не установлен"
                            : `$${d!.budget}`}
                        </h2>
                        <p>
                          При лимите генерация без известной оценки блокируется.
                        </p>
                      </section>
                    </div>
                    {active.jobs.length === 0 && (
                      <section className="empty">
                        Очередь пуста. Ты управляешь моментом запуска каждой
                        генерации.
                      </section>
                    )}
                    {active.jobs.map((j) => (
                      <section key={j.id}>
                        <div className="jobtitle">
                          <b>
                            {j.kind} ·{" "}
                            {j.provider === "demo"
                              ? "DEMO"
                              : j.model || "Медиаобработка"}
                          </b>
                          <span className={"status " + j.state}>
                            {labels[j.state] || j.state}
                          </span>
                        </div>
                        <small>
                          {new Date(j.created_at).toLocaleString("ru")} ·
                          проверок/попыток: {j.attempts} ·{" "}
                          {j.estimated === null
                            ? "Стоимость недоступна"
                            : `Оценка $${Number(j.estimated).toFixed(2)}`}
                        </small>
                        {j.error && <p className="error">{j.error}</p>}
                        {j.prompt && (
                          <details>
                            <summary>Исходный запрос</summary>
                            <p>{j.prompt}</p>
                          </details>
                        )}
                        {j.result?.draft && (
                          <>
                            <p>{j.result.draft.concept}</p>
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  requireSaved();
                                  if (
                                    confirm(
                                      "Применить черновик? Текущая раскадровка будет заменена; история и медиа сохранятся.",
                                    )
                                  ) {
                                    await api(
                                      "jobs/" + j.id + "/apply-draft",
                                      "POST",
                                      { revision: active.revision },
                                    );
                                    await refresh();
                                    setTab("Сюжет");
                                    setPanel("История");
                                  }
                                })
                              }
                            >
                              Применить черновик
                            </button>
                          </>
                        )}
                        <div className="actions">
                          {j.state === "queued" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api("jobs/" + j.id + "/cancel", "POST");
                                  await refresh();
                                })
                              }
                            >
                              Отменить
                            </button>
                          )}
                          {j.state === "failed" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api("jobs/" + j.id + "/retry", "POST");
                                  await refresh();
                                })
                              }
                            >
                              Повторить получение / обработку
                            </button>
                          )}
                          {j.state === "uncertain" && j.provider === "fal" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  const requestId = prompt(
                                    "Request ID из истории fal.ai для этого запроса",
                                  );
                                  if (requestId) {
                                    await api(
                                      "jobs/" + j.id + "/reconcile",
                                      "POST",
                                      { requestId },
                                    );
                                    await refresh();
                                  }
                                })
                              }
                            >
                              Сверить с провайдером
                            </button>
                          )}
                        </div>
                      </section>
                    ))}
                  </>
                )}
                {panel === "Экспорт" && (
                  <section>
                    <div className="eyebrow">THE FINAL HANDOFF</div>
                    <h2>Твоя история. В Premiere.</h2>
                    <p>
                      Пакет включает выбранные видео по сценам, исходный трек,
                      WAV для монтажа, FCP 7 XML и манифест. Кадры приводятся к
                      частоте и разрешению проекта в фоновом обработчике.
                    </p>
                    <Field label="Если ролик короче сцены">
                      <select
                        value={shortPolicy}
                        onChange={(e) => setShortPolicy(e.target.value)}
                      >
                        <option value="reject">
                          Остановить экспорт и показать ошибку
                        </option>
                        <option value="freeze">
                          Продлить последним кадром
                        </option>
                      </select>
                    </Field>
                    <p>
                      Длинные ролики обрезаются; промежутки остаются пустыми.
                      Пересечения сцен блокируют экспорт.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => run(() => generate("export", ["project"]))}
                    >
                      Скачать проект для Premiere
                    </button>
                    <div className="notice">
                      Распакуй ZIP, запусти Relink.ps1 внутри папки и импортируй
                      timeline-local.xml через File → Import. Импорт в
                      установленной у тебя версии Premiere ещё требует проверки.
                    </div>
                    {assets
                      .filter((a) => a.kind === "export")
                      .map((a) => (
                        <p key={a.id}>
                          <a className="download" href={url(a)} download>
                            ↓ {a.name} ·{" "}
                            {new Date(a.created_at).toLocaleString("ru")}
                          </a>
                        </p>
                      ))}
                  </section>
                )}
                {panel === "Настройки" && (
                  <div className="twocol">
                    <section>
                      <h2>Формат производства</h2>
                      <Field label="Соотношение сторон">
                        <select
                          value={d!.ratio}
                          onChange={(e) => change({ ratio: e.target.value })}
                        >
                          {["16:9", "9:16", "1:1"].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Разрешение экспорта">
                        <select
                          value={d!.resolution}
                          onChange={(e) =>
                            change({ resolution: e.target.value })
                          }
                        >
                          <option>720p</option>
                          <option>1080p</option>
                        </select>
                      </Field>
                      <Field label="Частота кадров">
                        <select
                          value={d!.fps}
                          onChange={(e) =>
                            change({ fps: Number(e.target.value) })
                          }
                        >
                          {[24, 25, 30].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Лимит расходов, USD (пусто — без лимита)">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={d!.budget ?? ""}
                          onChange={(e) =>
                            change({
                              budget: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                      </Field>
                      <button
                        className="secondary"
                        onClick={() => change({ archived: !d!.archived })}
                      >
                        {d!.archived ? "Вернуть из архива" : "Архивировать"}
                      </button>
                    </section>
                    <section>
                      <h2>Подключения</h2>
                      <div className="connection">
                        <b>Хранилище</b>
                        <span>{config?.storage}</span>
                      </div>
                      <div className="connection">
                        <b>FLUX / Kling / Seedance</b>
                        <span>
                          {config?.fal
                            ? "Ключ настроен · доступ не проверен"
                            : "Нужен FAL_KEY"}
                        </span>
                      </div>
                      <div className="connection">
                        <b>AI-сценарист</b>
                        <span>
                          {config?.screenplay
                            ? "Ключ и модель настроены"
                            : "Нужны OPENAI_API_KEY и OPENAI_MODEL"}
                        </span>
                      </div>
                      <p>
                        Ключи задаются на сервере. Статус конфигурации не
                        означает, что баланс и доступ к каждой модели проверены.
                      </p>
                    </section>
                  </div>
                )}
              </>
            )}
            {stepApproved && !revisionUnlocked && (
              <section className="approved-summary">
                <h2>{tab} утверждён</h2>
                <p>
                  Чтобы изменить этот этап, нажми «Изменить этап». Созданные
                  версии сохранятся.
                </p>
                {tab === "Ключ" && cover && (
                  <img
                    className="heroimage"
                    src={url(cover)}
                    alt="Утверждённый ключ"
                  />
                )}
                {tab === "Сюжет" && <p>{d!.concept || d!.idea}</p>}
              </section>
            )}
          </>
        )}
        {approvalSelection.length > 0 && (
          <div className="approvalbar">
            <span>{approvalSelection.length} версий выбрано</span>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  requireSaved();
                  if (
                    !confirm(
                      "Утвердить выбранные версии? Они не заменят финальные версии автоматически.",
                    )
                  )
                    return;
                  for (const id of approvalSelection)
                    await api("assets/" + id + "/review", "POST", {
                      state: "approved",
                      select: false,
                    });
                  setApprovalSelection([]);
                  await refresh();
                })
              }
            >
              Утвердить пакет
            </button>
            <button className="ghost" onClick={() => setApprovalSelection([])}>
              Снять выбор
            </button>
          </div>
        )}
      </main>
      {quote && (
        <div className="modalback">
          <section className="modal">
            <div className="eyebrow">ПОДТВЕРЖДЕНИЕ ЗАПУСКА</div>
            <h2>{quote.count} задач</h2>
            <p>{quote.models.join(", ")}</p>
            <h2>
              {quote.estimated === null
                ? "Стоимость недоступна"
                : `Оценка: $${Number(quote.estimated).toFixed(2)}`}
            </h2>
            <p>{quote.pricingSource}</p>
            {quote.estimated === null && (
              <p>
                Запуск может привести к списанию средств у провайдера. Точная
                цена пока неизвестна.
              </p>
            )}
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("projects/" + active!.id + "/generate", "POST", {
                      quoteId: quote.id,
                      acceptUnknown: quote.estimated === null,
                    });
                    setQuote(null);
                    await refresh();
                    if (tab === "Генерация") setPanel("Очередь");
                  })
                }
              >
                {demo ? "Запустить имитацию" : "Подтверждаю запуск"}
              </button>
              <button className="secondary" onClick={() => setQuote(null)}>
                Отмена
              </button>
            </div>
          </section>
        </div>
      )}
      {preview && (
        <div className="modalback" onClick={() => setPreview(null)}>
          <section className="modal wide" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setPreview(null)}>
              ×
            </button>
            <h2>{preview.name}</h2>
            {preview.kind === "image" ? (
              <img
                className="fullpreview"
                src={url(preview)}
                alt={preview.name}
              />
            ) : preview.kind === "video" ? (
              <video className="fullpreview" controls src={url(preview)} />
            ) : preview.kind === "audio" ? (
              <audio controls src={url(preview)} />
            ) : (
              <a href={url(preview)} download>
                Скачать пакет
              </a>
            )}
            {preview.metadata.prompt && <p>{preview.metadata.prompt}</p>}
          </section>
        </div>
      )}
      {compare.length === 2 && (
        <div className="comparebar">
          <button
            onClick={() => {
              setPreview(null);
              setPanel("Медиатека");
            }}
          >
            Сравнение двух версий
          </button>
          {compare.map((id) => {
            const a = assets.find((v) => v.id === id);
            return a ? (
              <div key={id}>
                {a.kind === "image" ? (
                  <img src={url(a)} alt={a.name} />
                ) : (
                  <video controls src={url(a)} />
                )}
                <small>{a.name}</small>
              </div>
            ) : null;
          })}
          <button className="ghost" onClick={() => setCompare([])}>
            Закрыть ×
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
