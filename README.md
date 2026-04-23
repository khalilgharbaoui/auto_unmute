<div align="center">
  <img src="readme_images/banner.png" width="100%" alt="Auto Unmute — Chrome extension for Google Meet">
</div>

# Auto Unmute for Google Meet

Auto Unmute is a Chrome extension that automatically unmutes you in [Google Meet](https://meet.google.com/) when you start speaking while muted.

It does one thing on purpose: recover from "I forgot I was muted." It **never auto-mutes** you.

- Chrome Web Store: https://chromewebstore.google.com/detail/google-meet-auto-unmute/bgpcnhfoanbgbjhkjehbnbphlmhekdcm
- Landing page: https://khalilgharbaoui.codez.it/auto_unmute/
- Privacy policy: https://khalilgharbaoui.codez.it/auto_unmute/privacy.html
- Releases: https://github.com/khalilgharbaoui/auto_unmute/releases

## What it does now

Auto Unmute listens to up to three local signals (based on the engine mode you pick):

1. **Raw mic level (AudioWorklet RMS)** for very fast voice onset detection.
2. **Camera mouth movement (MediaPipe Face Landmarker)** via inner-lip MAR.
3. **Optional Web Speech recognition** signal.

When Meet is muted and speech is detected for the configured hold window, it asks the content script to toggle the mic. It prefers clicking Meet's mic button (trusted UI action) and falls back to the standard `Ctrl+D` / `⌘+D` shortcut if needed.

## Detection modes

| Mode | Signals used | Best for |
|---|---|---|
| **Audio only** | Raw mic level | Fastest response, no camera use |
| **Camera only** | MediaPipe mouth movement | Environments where audio-level false triggers are a concern |
| **Speech only** | Web Speech API activity | Language-aware trigger path |
| **Audio + camera + speech** (default) | All three | Best overall reliability |

## Behavior

| Current mic state | What you do | What the extension does |
|---|---|---|
| Muted | Start speaking | Unmutes once sustained detection passes your hold threshold |
| Muted | Brief transient/noise | Ignores it (streak resets) |
| Unmuted | Anything | Does nothing |
| You mute manually | — | Re-arms and waits for next speech |

Current timing defaults:

- Tick loop: **25 ms**
- Detection hold (`speakFramesRequired`): **1** check (25 ms) by default
- Post-mute cooldown: **1500 ms**
- Popup-open cooldown: **800 ms** (prevents click-to-open from causing instant unmute)

## Installation

### Chrome Web Store (recommended)

Install directly from:

https://chromewebstore.google.com/detail/google-meet-auto-unmute/bgpcnhfoanbgbjhkjehbnbphlmhekdcm

### Load unpacked (dev/testing)

1. Download the latest ZIP from [Releases](https://github.com/khalilgharbaoui/auto_unmute/releases/latest) and unzip it (or `git clone` this repo).
2. Open `chrome://extensions`, enable **Developer mode**, then click **Load unpacked** and pick the `auto_unmute` folder.

<div align="center">
  <img src="readme_images/install_1.png" width="80%" alt="chrome://extensions with Developer mode toggle and Load unpacked button highlighted">
</div>

3. Open [Google Meet](https://meet.google.com/) and allow microphone/camera access when prompted (camera is only needed for modes using image detection).

<div align="center">
  <img src="readme_images/install_2.png" width="70%" alt="Google Meet asking for microphone and camera permission">
</div>

## Usage

1. Join a Meet call and mute yourself as usual.
2. Start talking.
3. If Auto Unmute is enabled and you're in muted state, it toggles your mic on.
4. Open the toolbar popup to tune thresholds and debug panels.

<div align="center">
  <img src="readme_images/usage_popup.png" width="80%" alt="Auto Unmute popup with engine selector, sensitivity sliders, and live debug panels">
</div>

### Settings reference

| Setting | What it controls |
|---|---|
| **Auto Unmute** | Master enable/disable toggle |
| **Detection engine** | Audio / Camera / Speech / Combined mode |
| **Detection hold** | Number of consecutive 25 ms checks required before unmute |
| **Mic sensitivity** | RMS threshold in dBFS for raw audio detection |
| **Camera** | Video device used for mouth detection |
| **Mouth sensitivity** | MAR threshold for mouth-open detection |
| **Speech language** | Web Speech recognition language |
| **Show camera/mic/speech activity** | Live debug panels in popup |
| **Debugging** | Verbose logging and diagnostics |

## Architecture (high level)

1. `content_script.js` runs on `meet.google.com`, tracks mute state, and controls the mic toggle path.
2. It injects `auto_unmute.html` + `auto_unmute.js` iframe for detection.
3. The iframe runs the 25 ms detection loop, combining enabled signals.
4. `background.js` relays messages between popup, iframe, and content script.
5. The state machine only acts in muted state, and only in the unmute direction.

## Privacy

- No analytics, telemetry, or remote control plane.
- No audio/video recordings are stored by the extension.
- Settings are stored in `chrome.storage.sync`.
- If you enable speech-recognition mode, browser-provided Web Speech behavior applies (depending on browser/vendor implementation).

Full policy: [`docs/privacy.md`](./docs/privacy.md)

## Build and release

Build zip:

```bash
bash scripts/build-zip.sh
# -> dist/auto_unmute-<version>.zip
```

Automated GitHub release workflow (tag push):

```bash
git tag vX.Y.Z
git push --tags
```

## Credits and license

MIT — see [`LICENSE`](./LICENSE).

Inspired by [`morphoinc/auto_mute`](https://github.com/morphoinc/auto_mute), adapted for the opposite direction (speak while muted -> unmute only).

Built with:

- [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
- Web Audio API (`AudioWorklet`)
- Web Speech API (optional signal)
- Bootstrap + vanilla JS for popup UI
