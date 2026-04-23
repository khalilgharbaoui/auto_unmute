# Chrome Web Store listing — copy and paste

Use this when updating the listing in the dashboard:
https://chromewebstore.google.com/

---

## Item name (max 75 chars)

```
Google Meet Auto Unmute
```

## Summary (max 132 chars)

```
Automatically unmutes you in Google Meet when you start speaking while muted, using local audio, camera, and speech signals.
```

## Category

```
Communication
```

## Language

```
English
```

---

## Detailed description

```
Ever started talking in a Google Meet call and realized you were muted the whole time?

Google Meet Auto Unmute fixes that. While your mic is muted, it listens for signs that you actually started speaking and toggles the mic back on automatically.

It is intentionally one-directional: it never auto-mutes you.

KEY FEATURES

• Auto-unmute while muted: triggers Meet's own mic toggle path when sustained speech is detected.
• Four detection modes in the popup:
  - Audio only (raw mic-level detection)
  - Camera only (mouth movement)
  - Speech only (Web Speech API activity)
  - Audio + camera + speech (default)
• Fast local detection loop (25 ms tick) with configurable hold window (1-10 checks).
• Tunable thresholds:
  - Mic sensitivity in dBFS
  - Mouth sensitivity (MAR)
• Camera selector and speech language selector.
• Live debug panels for camera/mic/speech activity.
• Safety cooldowns to avoid accidental immediate re-unmute after manual mute.

HOW IT WORKS

• Camera mouth detection uses MediaPipe Face Landmarker, running locally in the extension iframe.
• Mic-level detection uses Web Audio API AudioWorklet RMS sampling.
• Optional speech-recognition signal uses the browser Web Speech API.
• The extension runs only on https://meet.google.com/* and does not touch other sites.

PRIVACY

The extension does not collect, store, or transmit user data. No analytics, telemetry, third-party SDKs, or remote control plane.

Audio/video streams are processed locally and discarded immediately. Only user settings are saved in chrome.storage.sync.

If speech-recognition mode is enabled, browser Web Speech behavior applies (depending on browser/vendor implementation).

Privacy policy: https://khalilgharbaoui.codez.it/auto_unmute/privacy.html

OPEN SOURCE

MIT-licensed source code: https://github.com/khalilgharbaoui/auto_unmute
```

---

## Single-purpose justification (required)

```
Google Meet Auto Unmute has a single purpose: detect when the user starts speaking in Google Meet while the microphone is muted, then trigger Meet's mic toggle so the user is unmuted automatically. Every feature exists only to support this one accessibility/productivity behavior.
```

---

## Permission justifications

### `storage`

```
Used to persist extension settings via chrome.storage.sync: enable/disable state, detection mode, hold threshold, mic sensitivity threshold, camera device, speech language, and debug-panel toggles. No personal data, audio, video, transcript, or browsing history is stored.
```

### `tabs`

```
Used to identify and message the active Google Meet tab so popup settings can reach the detector iframe and mute-state requests can be relayed to the content script. No unrelated tab content is read.
```

### Host permission `https://meet.google.com/*`

```
Required to inject the Meet-specific content script that observes microphone button state and toggles the mic when speaking is detected while muted.
```

### `webcam` (camera) permission justification

```
The camera is used only for local mouth-movement detection via MediaPipe Face Landmarker when a camera-based detection mode is enabled. Frames are processed in-browser and immediately discarded. No recording or transmission occurs.
```

### `microphone` permission justification

```
The microphone is used for local audio-level detection (AudioWorklet RMS) and optional Web Speech API activity detection. The extension itself does not record, store, or transmit audio.

If Web Speech mode is enabled, browser-provided speech recognition behavior applies, which may involve vendor services depending on the browser implementation.
```

### Remote code disclosure

```
The extension does NOT load or execute remote code. All scripts, including MediaPipe runtime files, model assets, and UI assets, are packaged inside the extension and loaded from the extension origin.
```

### Data usage disclosures (data-collection form)

- Personally identifiable information: **NO**
- Health information: **NO**
- Financial and payment information: **NO**
- Authentication information: **NO**
- Personal communications: **NO** (audio/video are processed in real time and discarded; not stored or sent by the extension)
- Location: **NO**
- Web history: **NO**
- User activity: **NO**
- Website content: **NO**

Tick the three certification checkboxes:

- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Privacy policy URL

```
https://khalilgharbaoui.codez.it/auto_unmute/privacy.html
```

---

## Visibility

```
Public
```

## Distribution

```
All regions
```
