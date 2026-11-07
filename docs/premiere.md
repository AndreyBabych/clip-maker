# Import the rough cut on Windows

1. Approve the selected scene videos and the analyzed track; save and approve the storyboard.
2. Set aspect ratio, resolution and integer frame rate (24, 25 or 30).
3. Choose the short-clip policy in Export: reject or freeze the last frame.
4. Generate the export, wait for the worker, then download and completely extract the ZIP.
5. Run `Relink.ps1` inside the extracted directory. It writes absolute `file:` paths into `timeline-local.xml`. No credentials or network access are used. It validates that media paths stay inside the package.
6. In Premiere Pro use File → Import and select `timeline-local.xml`. If script execution is unavailable, import `timeline.xml` and locate the files using Link Media. Do not weaken your PowerShell execution policy just for this utility.
7. Check clip count, timing and audio start, and save a native Premiere project.

The export is Final Cut Pro 7 XML (`xmeml version="5"`), not modern FCPXML. The package includes normalized H.264 clips, stereo 48 kHz PCM music, original music and a manifest linking source asset IDs to scene frames. Source clips remain unchanged in storage. Export durations are quantized to the chosen frame rate; scenes are ordered by explicit start time. Gaps remain gaps, overlaps and scenes beyond track duration are rejected. Long videos are trimmed; short ones require explicit freeze-frame policy.

The XML has been parsed and its sequence/video/audio timing tested automatically. FFmpeg output durations are checked before packaging. **Actual import into Premiere Pro remains an acceptance test requiring the user's installed application.** The synthetic demo package is suitable for that first check.

References: [Apple FCP 7 XML elements](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html), [encoding examples](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Basics/Basics.html), [Adobe distinction from modern FCPXML](https://helpx.adobe.com/premiere/desktop/organize-media/import-files/migrate-from-final-cut-pro-x.html).
