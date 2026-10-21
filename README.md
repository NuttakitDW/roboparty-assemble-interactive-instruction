# Roboto Origin: interactive assembly guide

An unofficial, interactive guide for assembling the [RoboParty Roboto Origin](https://roboparty.com/roboto_origin/doc) humanoid. It turns the 71-page PDF manual into a 3D component tour and a step-by-step practice build, in Thai and English.

Live site: https://www.nuttakitkundum.com/roboparty

> Not affiliated with RoboParty. The manual is the authority. The practice mode rehearses the steps; it does not replace the manual, and the 3D model is joint-level, so the order in which pieces appear is approximate. Follow the manual's figures, torque values and safety gates for the real build.

## What is in the repo

| Path | What it holds |
|---|---|
| `web/` | The static web app (no build step): `index.html`, `app.js` (3D viewer, tour, palette), `build.js` (practice build mode), `overlays.js` (IMU and CAN wiring overlays), `style.css`, `data/`, `assets/tts/` |
| `manual/` | The PDF converted: `pages/pNN.txt` text, `img/pNN.jpg` page images, `INDEX.md` page map, `parts.csv` (87-item BOM), `spec.json`, and `th/` (Thai translation) |
| `harness/` | `steps.json` and `gates.json`: the same assembly as ordered stages and safety checklists, for walking someone through it in the terminal |
| `cad/` | RoboParty's V2.0 mechanical CAD and URDF, copied from upstream (see `cad/SOURCE.txt`) |
| `CLAUDE.md` | Instructions that make Claude Code act as the step-by-step assembly assistant over `harness/` |
| `.github/workflows/pages.yml` | Deploys `web/` to GitHub Pages on every push to `main` |

## Run it locally

Serve the repo root with any static server (the app fetches `cad/` and `manual/` through the symlinks inside `web/`):

```bash
python3 -m http.server 8000
# open http://localhost:8000/web/index.html
```

Opening `index.html` from `file://` fails because the browser blocks the model and JSON fetches.

## How the repo was built

It was built in layers, each one on top of the previous. The commit history follows the same order.

1. **Manual to data.** The PDF was converted page by page: text with `pdftotext -layout` into `manual/pages/`, and each page rendered with `pdftoppm` into `manual/img/` (about 1400 px wide). The step figures only exist as images, so every step shown in the app links to its manual page image. The parts list was lifted into `parts.csv` and the headline specs into `spec.json`. `INDEX.md` maps each PDF page to its topic. PDF page numbers are the printed page plus 3.
2. **Terminal harness.** `harness/steps.json` orders the build into stages (prep, legs, hip, leg-hip, waist, arms, cable hardware, wiring, calibration). `harness/gates.json` holds the safety checklists (bench and PPE, battery, power-on, inference) and the e-stop rules. `CLAUDE.md` tells Claude Code to present one step at a time, require an explicit yes for every gate item, and never invent torque values, screw sizes or wiring that the manual does not state.
3. **CAD.** `cad/` is the V2.0 mechanical folder from [Roboparty/roboto_origin](https://github.com/Roboparty/roboto_origin) at a pinned commit. Thirty-two third-party vendor and standard-part models (motors, switches, fasteners, battery and so on) were removed because third-party files are not relicensed by RoboParty; the licence notices were kept. Get them from upstream if you need them, and check their terms first. See `cad/SOURCE.txt`.
4. **Component overview (3D).** The browser loads the URDF, parses it with `DOMParser`, and builds one three.js node per link from the STL meshes. `web/data/stages.json`, `systems.json` and `parts.json` drive the guided tour, the "systems and parts" sidebar and the Cmd-K search. `overlays.js` draws the IMU and the CAN wiring chains on top of the model, using real URDF joint origins where the data exists and labelling the rest as approximate. Thai and English strings live in `app.js`; the choice is remembered in `localStorage`.
5. **Thai translation.** `manual/th/pNN.md` translates PDF pages 04 to 71. Pages were translated in parallel by Claude subagents that all followed one shared `manual/th/glossary.md`, so part names stay consistent. The English original is authoritative. The translation is CC-BY-SA-4.0, following RoboParty's documentation licence (see `manual/th/NOTICE.md`).
6. **Practice build mode.** `web/build.js` replays the manual as 104 steps in 10 phases. Step text, parts and fasteners were extracted from the manual into `web/data/assembly/{a,b,c,d}.json` and merged into `web/data/assembly.json`. A step with a gate shows a safety checklist to tick; progress is saved in `localStorage`. The 3D view highlights the links involved, legs are built apart and slide into the hip at the connection step, and the wiring steps show the harness name, spec and CAN port exactly as the manual words them.
7. **Narration.** Every step has Thai and English speech (`web/assets/tts/th|en/*.mp3`, 104 files each), generated with Paxa TTS. `web/data/narration.json` maps a step id to its audio file and spoken text. Audio loads on demand; the voice toggle is remembered.
8. **Deploy.** The workflow in `.github/workflows/pages.yml` assembles `_site/` from `web/`, the URDF and meshes, the licence files and the manual page images, then publishes it. `web/cad` and `web/manual` are symlinks for local development, so the workflow copies the real files instead. The site is served from its own root and also works behind a path prefix such as `/roboparty`.

### Not in the repo

`web/assets/models/` is git-ignored. It holds a locally converted 3D model of the HiPNUC IMU whose redistribution terms are unconfirmed. Without it the IMU overlay still shows the axes and label, and the rest of the app works.

## How the video was built

The 48-second promo (1920x1080, 60 fps, Thai voice-over, music) is not recorded from a screen. Real-time recording gave uneven frame pacing and cuts that only roughly met the beat. Each frame is instead rendered at an exact time, and the audio is cut to the same grid. The video file and the render scripts are not in this repo; the scripts were throwaway working files, so this section documents the method.

### 1. Deterministic capture

Headless Chrome (Playwright) opens the real app with a virtual clock:

- an init script replaces `requestAnimationFrame` and `performance.now` with a queue that the script steps one frame at a time (1/60 s);
- CSS transitions and animations are paused and stepped through `document.getAnimations()` by setting `currentTime`, and `scrollIntoView` is made instant, so nothing moves between frames;
- for each frame the script advances the clock, calls `page.screenshot`, and pipes the PNG to ffmpeg (x264, `-crf 13`) at 60 fps.

URL switches on the app exist for this: `?intro=0` skips the welcome intro, `?debug` exposes `window.__app` (camera, controls, nodes) so the script can own the camera, and `?g67hz=` and `?g67ph=` lock the robot's "6-7" gesture to the music's tempo and phase.

### 2. Three takes, one grid

The music is 100 BPM, so one bar is 2.4 s. Every cut and every on-screen change lands on that grid.

| Time | Take | What happens |
|---|---|---|
| 0 to 12 s | A: intro | Parts fly in feet first; each landing is moved onto the 16th-note grid and the last one hits the drop at 7.2 s with a small camera punch-in; the robot does the 6-7 gesture |
| 12 to 33.6 s | B: practice build mode | Steps change on beats while the script drives the camera (tracked on the legs, then the lower body, then a spline from the hips up the spine to the 3-in-1 board); the wiring scene shows the harness names and CAN channels from the step data |
| 33.6 to 40.8 s | C: our end card | Title lines land on beats while the robot keeps doing 6-7; the elbow joint lags its target by about 50 ms, so the target is led by 50 ms to put the visible extremes on the beat |
| 40.8 to 48 s | C: Humanoice card | Logo tile, name and URL, recommending [Humanoice](https://humanoice.com/) for people who want to build the real robot |

The three takes are concatenated with ffmpeg, faded out over the last 0.6 s, tagged BT.709, and encoded with x264 (`-crf 17`) and AAC 192 kb/s.

### 3. Voice-over

Seven Thai lines from Paxa TTS (`paxa-tts-flash-v2`, language `th`). Pronunciation was checked by transcribing clips back with Paxa speech-to-text:

- "six seven" is written in Thai script ("ซิกซ์ เซเว่น") so that it is spoken in English;
- "CAN" is easy to mishear as "arm" in Thai at higher speeds, so the wording avoids it where it can;
- the narration is never time-stretched. If a line does not fit, the scene gets whole bars (2.4 s each), not a faster voice;
- each clip is placed so its first audible sound sits on a beat, with at least a second between lines.

### 4. Music bed

The 100 BPM track (credited below, not in this repo) is longer than the video, so the bed is assembled from whole bars. The beat grid was measured from the audio (downbeat hits at `0.331 + 2.4 * bar` s). Source bars are chosen so the 4-bar chord cycle stays in order, seams sit 50 ms before a downbeat with a 24 ms equal-power crossfade, and the track's own hard stop ends the video.

### 5. Mix and checks

Music at 0.75, voice-over +10 dB with a compressor, and the music ducked by side-chain compression under the voice. Before delivery, the final file was checked with:

- scene detection, to confirm every cut is a multiple of 0.6 s;
- speech-to-text on the finished mix, to confirm that only the narration is spoken;
- audio/video lag by cross-correlation of the muxed track against the mix;
- a frame-to-frame difference, to find duplicated frames and judder.

## Licence and credits

- RoboParty's hardware design (CAD, URDF, meshes, BOM) is CERN-OHL-W-2.0; their documentation is CC-BY-SA-4.0. Third-party files keep their own terms (`cad/rpo_hardware/LICENSES.md`, `THIRD_PARTY_NOTICES.md`). RoboParty's trademarks stay theirs (`TRADEMARKS.md`).
- The Thai translation in `manual/th/` is CC-BY-SA-4.0.
- Promo video music: "Vibe Check" by Curtis Cole (Artlist). The track is not included in this repo.
- Humanoice is shown as a recommendation only. Neither Humanoice nor RoboParty endorses this guide.

(c) 2026 Nuttakit Kundum. All rights reserved. RoboParty material keeps the licences listed above.
