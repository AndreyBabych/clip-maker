import { spawn } from "node:child_process";
import { fileTypeFromFile } from "file-type";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function binary(name) {
  const configured = process.env[name.toUpperCase() + "_PATH"];
  if (configured) return configured;
  if (process.platform === "win32") {
    try {
      return require.resolve(`@${name}-installer/win32-x64/${name}.exe`);
    } catch {}
  }
  return name;
}
export function command(
  name,
  args,
  { maxBytes = 8 * 1024 * 1024, timeout = 180000 } = {},
) {
  return new Promise((resolve, reject) => {
    const p = spawn(binary(name), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bytes = 0;
    const chunks = [];
    const timer = setTimeout(() => {
      p.kill();
      reject(Error("Media processing timed out"));
    }, timeout);
    p.stdout.on("data", (b) => {
      bytes += b.length;
      if (bytes > maxBytes) {
        p.kill();
        reject(Error("Media output exceeds limit"));
      } else chunks.push(b);
    });
    p.stderr.resume();
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(Error("Media processing failed; check the uploaded file"));
    });
  });
}
export async function inspect(file) {
  const d = JSON.parse(
    (
      await command("ffprobe", [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        file,
      ])
    ).toString(),
  );
  const duration = Number(d.format?.duration);
  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: d.streams?.find((s) => s.codec_type === "video")?.width,
    height: d.streams?.find((s) => s.codec_type === "video")?.height,
    hasAudio: d.streams?.some((s) => s.codec_type === "audio"),
    hasVideo: d.streams?.some((s) => s.codec_type === "video"),
  };
}
export async function analyzeAudio(file) {
  const info = await inspect(file);
  if (!info.hasAudio || !info.duration || info.duration > 3600)
    throw Error("Audio must be between 0 and 3600 seconds");
  const pcm = await command(
    "ffmpeg",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "1000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBytes: 15000000 },
  );
  const count = pcm.length / 4,
    step = Math.max(1, Math.ceil(count / 1000));
  const waveform = [];
  for (let i = 0; i < count; i += step) {
    let peak = 0;
    for (let j = i; j < Math.min(i + step, count); j++)
      peak = Math.max(peak, Math.abs(pcm.readFloatLE(j * 4)));
    waveform.push(Math.min(1, peak));
  }
  return { ...info, waveform };
}
export async function validateMedia(file, kind) {
  const type = await fileTypeFromFile(file);
  const allowed = {
    audio: ["audio/mpeg", "audio/wav", "audio/x-wav"],
    image: ["image/png", "image/jpeg", "image/webp"],
    video: ["video/mp4", "video/quicktime"],
  };
  if (!type || !allowed[kind]?.includes(type.mime))
    throw Object.assign(
      Error("Unsupported file content. Use MP3/WAV, PNG/JPEG/WebP or MP4/MOV."),
      { status: 400, public: true },
    );
  return type;
}
