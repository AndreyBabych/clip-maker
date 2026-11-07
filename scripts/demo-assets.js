import {
  mkdir,
  writeFile,
  copyFile,
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { command } from "../lib/media.js";
import { buildExport } from "../lib/export.js";
const out = new URL("../public/demo/", import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(
  new URL("frame.svg", out),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><radialGradient id="g"><stop stop-color="#526d5d"/><stop offset="1" stop-color="#101c25"/></radialGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="640" cy="330" r="200" fill="#162a2a" stroke="#789c81"/><ellipse cx="640" cy="400" rx="420" ry="85" fill="none" stroke="#c4ef85" opacity=".6"/><path d="M0 620L1280 620M0 650L1280 650M0 690L1280 690" stroke="#789c81" opacity=".2"/><text x="60" y="80" font-family="sans-serif" font-size="22" fill="#c4ef85" letter-spacing="5">CLIP MAKER / SYNTHETIC DEMO</text><text x="60" y="670" font-family="sans-serif" font-size="16" fill="#9dbaa8">STYLE STUDY 001 — NOT AN AI GENERATION</text></svg>`,
);
const audio = new URL("music.wav", out),
  video = new URL("clip.mp4", out);
await command("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:duration=12",
  "-af",
  "afade=t=in:d=1,afade=t=out:st=11:d=1,volume=0.3",
  "-y",
  audio.pathname.replace(/^\/(\w:)/, "$1"),
]);
await command("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=25:duration=4",
  "-an",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-y",
  video.pathname.replace(/^\/(\w:)/, "$1"),
]);
const dir = await mkdtemp(path.join(tmpdir(), "clip-demo-"));
try {
  const doc = {
    title: "Clip Maker — synthetic demo",
    audioId: "audio",
    ratio: "16:9",
    fps: 25,
    resolution: "720p",
    scenes: [0, 4, 8].map((start, i) => ({
      id: `scene-${i}`,
      title: `DEMO ${i + 1}`,
      start,
      end: start + 4,
      videoId: `video-${i}`,
    })),
  };
  const assets = [
    {
      id: "audio",
      kind: "audio",
      state: "approved",
      storage_key: "music.wav",
      metadata: { duration: 12 },
    },
    ...doc.scenes.map((s) => ({
      id: s.videoId,
      target_id: s.id,
      kind: "video",
      state: "approved",
      storage_key: "clip.mp4",
      metadata: { duration: 4 },
    })),
  ];
  const storage = {
    download: async (key, dest) => copyFile(new URL(key, out), dest),
  };
  const result = await buildExport(
    { document: doc, shortPolicy: "reject", revision: 1 },
    assets,
    storage,
    dir,
  );
  await copyFile(result.file, new URL("package.zip", out));
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log("Created synthetic demo audio, video and Premiere package.");
