import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { ZipFile } from "yazl";
import { command, inspect } from "./media.js";
import { fail } from "../domain.js";
export const escapeXml = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function timelinePlan(d, assets, shortPolicy = "reject") {
  const audio = assets.find(
    (a) => a.id === d.audioId && a.kind === "audio" && a.state === "approved",
  );
  if (!audio?.metadata.duration) fail("Select an analyzed music track");
  if (!d.scenes.length) fail("Storyboard is empty");
  const fps = d.fps,
    frames = Math.round(audio.metadata.duration * fps);
  let last = 0;
  const clips = [...d.scenes]
    .sort((a, b) => a.start - b.start)
    .map((s, i) => {
      const start = Math.round(s.start * fps),
        end = Math.round(s.end * fps),
        asset = assets.find(
          (a) =>
            a.id === s.videoId &&
            a.kind === "video" &&
            a.target_id === s.id &&
            a.state === "approved",
        );
      if (!asset) fail(`Scene ${i + 1} needs an approved selected video`);
      if (start < last || end <= start || end > frames)
        fail(
          "Scene boundaries overlap, collapse at the chosen frame rate or exceed the track",
        );
      last = end;
      if (!asset.metadata.duration) fail("Video duration not analyzed");
      const shortage = asset.metadata.duration + 1 / fps < (end - start) / fps;
      if (shortage && shortPolicy !== "freeze")
        fail(
          `Scene ${i + 1} video is too short. Select freeze-last-frame or regenerate.`,
        );
      return {
        sceneId: s.id,
        title: s.title,
        assetId: asset.id,
        start,
        end,
        frames: end - start,
        sourceDuration: asset.metadata.duration,
        freeze: shortage,
        path: `media/scene-${String(i + 1).padStart(3, "0")}.mp4`,
        asset,
      };
    });
  const [rw, rh] = d.ratio.split(":").map(Number),
    base = d.resolution === "720p" ? 720 : 1080;
  const height = rh > rw ? Math.round((base * rh) / rw / 2) * 2 : base,
    width = rh > rw ? base : Math.round((base * rw) / rh / 2) * 2;
  return {
    title: d.title,
    fps,
    frames,
    width,
    height,
    clips,
    audio,
    audioPath: "media/music.wav",
    shortPolicy,
  };
}
export function timelineXml(plan) {
  const x = escapeXml,
    rate = `<rate><timebase>${plan.fps}</timebase><ntsc>FALSE</ntsc></rate>`,
    video = `<samplecharacteristics>${rate}<width>${plan.width}</width><height>${plan.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>`,
    audio =
      "<samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics>";
  const clips = plan.clips
    .map(
      (c, i) =>
        `<clipitem id="clip-${i}"><name>${x(c.title)}</name><enabled>TRUE</enabled><duration>${c.frames}</duration>${rate}<start>${c.start}</start><end>${c.end}</end><in>0</in><out>${c.frames}</out><file id="file-${i}"><name>${x(c.path.split("/").at(-1))}</name><pathurl>file://localhost/CLIP_MAKER_PACKAGE/${c.path}</pathurl>${rate}<duration>${c.frames}</duration><media><video>${video}</video></media></file></clipitem>`,
    )
    .join("");
  const music = (channel) =>
    `<clipitem id="music-${channel}"><name>Music</name><enabled>TRUE</enabled><duration>${plan.frames}</duration>${rate}<start>0</start><end>${plan.frames}</end><in>0</in><out>${plan.frames}</out><file id="music-file">${channel === 1 ? `<name>music.wav</name><pathurl>file://localhost/CLIP_MAKER_PACKAGE/${plan.audioPath}</pathurl>${rate}<duration>${plan.frames}</duration><media><audio>${audio}<channelcount>2</channelcount></audio></media>` : ""}</file><sourcetrack><mediatype>audio</mediatype><trackindex>${channel}</trackindex></sourcetrack></clipitem>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="clip-maker"><name>${x(plan.title)}</name><duration>${plan.frames}</duration>${rate}<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><format>${video}</format><track>${clips}</track></video><audio><numOutputChannels>2</numOutputChannels><format>${audio}</format><track>${music(1)}</track><track>${music(2)}</track></audio></media></sequence></xmeml>`;
}
export async function buildExport(
  { document, shortPolicy, revision },
  assets,
  storage,
  dir,
) {
  const plan = timelinePlan(document, assets, shortPolicy);
  await mkdir(path.join(dir, "media"), { recursive: true });
  for (const c of plan.clips) {
    const src = path.join(dir, `${c.assetId}.source`);
    await storage.download(c.asset.storage_key, src);
    const filter =
      `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${plan.fps}` +
      (c.freeze
        ? `,tpad=stop_mode=clone:stop_duration=${c.frames / plan.fps}`
        : "");
    await command(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        src,
        "-an",
        "-vf",
        filter,
        "-frames:v",
        String(c.frames),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "2",
        "-movflags",
        "+faststart",
        path.join(dir, c.path),
      ],
      { timeout: 900000 },
    );
    const checked = await inspect(path.join(dir, c.path));
    if (
      !checked.duration ||
      Math.abs(checked.duration - c.frames / plan.fps) > 1 / plan.fps + 0.01
    )
      throw Error("Normalized clip duration does not match timeline");
  }
  const original = path.join(
    dir,
    "music-original." + plan.audio.storage_key.split(".").at(-1),
  );
  await storage.download(plan.audio.storage_key, original);
  await command("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    original,
    "-vn",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    path.join(dir, plan.audioPath),
  ]);
  await writeFile(path.join(dir, "timeline.xml"), timelineXml(plan));
  const manifest = {
    version: 1,
    projectRevision: revision,
    title: plan.title,
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    durationFrames: plan.frames,
    audio: plan.audioPath,
    shortPolicy,
    clips: plan.clips.map(({ asset, ...c }) => c),
  };
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    path.join(dir, "IMPORT.txt"),
    "Extract the ZIP completely. Run Relink.ps1 from this folder to write absolute local media paths. Import timeline-local.xml using File > Import in Adobe Premiere Pro. If PowerShell scripts are blocked, import timeline.xml and use Link Media to locate media/scene-001.mp4 and media/music.wav. This is FCP 7 XML (xmeml), not FCPXML. Timing is quantized to the selected frame rate. Gaps remain gaps. Original music is included. The package format is structurally tested; verify the resulting timeline in your installed Premiere version.",
  );
  await writeFile(
    path.join(dir, "Relink.ps1"),
    `$ErrorActionPreference = 'Stop'\n$root = $PSScriptRoot\n[xml]$doc = Get-Content -LiteralPath (Join-Path $root 'timeline.xml') -Raw\nforeach ($node in $doc.SelectNodes('//pathurl')) {\n  $relative = $node.InnerText.Replace('file://localhost/CLIP_MAKER_PACKAGE/', '')\n  $target = [IO.Path]::GetFullPath((Join-Path $root $relative))\n  if (-not $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid media path' }\n  if (-not (Test-Path -LiteralPath $target)) { throw 'Media file missing' }\n  $node.InnerText = ([Uri]$target).AbsoluteUri\n}\n$doc.Save((Join-Path $root 'timeline-local.xml'))\nWrite-Host 'Import timeline-local.xml into Premiere Pro.'\n`,
  );
  const destination = path.join(dir, "package.zip");
  await new Promise((resolve, reject) => {
    const out = createWriteStream(destination),
      zip = new ZipFile();
    out.on("close", resolve);
    out.on("error", reject);
    zip.on("error", reject);
    zip.outputStream.pipe(out);
    for (const name of [
      ...plan.clips.map((c) => c.path),
      plan.audioPath,
      "timeline.xml",
      "manifest.json",
      "IMPORT.txt",
      "Relink.ps1",
      path.basename(original),
    ])
      zip.addFile(path.join(dir, name), name);
    zip.end();
  });
  return { file: destination, bytes: (await stat(destination)).size, manifest };
}
