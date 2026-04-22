# Chrome Web Store listing — copy & paste

Use this when filling out the developer dashboard at https://chrome.google.com/webstore/devconsole.

---

## Item name (max 75 chars)

```
Auto Unmute for Google Meet
```

## Summary (max 132 chars)

```
Forgot you were muted? Auto Unmute detects when you start talking in Google Meet and turns your mic back on automatically.
```

## Category

```
Productivity
```

## Language

```
English
```

---

## Detailed description

```
Ever started talking in a Google Meet call and realised — too late — that you were muted the whole time?

Auto Unmute fixes that. It watches for mouth movement (using your camera) and recognised speech (using Chrome's built-in Web Speech API) and, the moment it detects you actually trying to talk while muted, it sends the same Ctrl+D / Cmd+D shortcut you would have pressed yourself, and unmutes you within roughly 400 ms.

It is the inverse of the popular open-source extension "Google Meet Auto Mute" by Morpho, Inc. Where that extension mutes you when you go quiet, this one unmutes you when you start talking — and only in that direction. It will never mute you on its own.

KEY FEATURES

• Auto-unmute on speech: dispatches the standard Meet mic-toggle hotkey when sustained speech is detected.
• Two complementary detection engines, selectable in the popup:
  – Image: local mouth-movement detection via the open-source face-api.js library.
  – Speech: Chrome's built-in Web Speech API.
  – Both (default) for maximum reliability.
• Tunable sensitivity: pick how many consecutive 200 ms frames of speech must occur before unmuting (1 to 10, default 2 ≈ 400 ms) and how open your mouth must be to count as "speaking".
• Camera selector and speech language selector.
• Optional live activity panels in the popup so you can see exactly what the extension is detecting.
• Never re-mutes you on its own — only you decide when to mute again.

PRIVACY

100% local. The extension does not collect, transmit, store, or share any user data. No analytics, no telemetry, no remote servers, no third parties. Your camera and microphone streams are read frame-by-frame in your browser and immediately discarded. Only your settings are saved (via Chrome's standard sync storage). Full privacy policy: https://khalilgharbaoui.codez.it/auto_unmute/privacy.html

OPEN SOURCE

Full source code (MIT license) at https://github.com/khalilgharbaoui/auto_unmute. Audit it, fork it, or build it yourself.

WORKS ON

Google Meet (https://meet.google.com) only. Recent Chromium-based browsers with Manifest V3 support (Chrome 88+).

CREDITS

Inspired by and structurally based on "Google Meet Auto Mute" by Morpho, Inc. (MIT licensed). Mouth-movement detection by face-api.js. UI styled with Bootstrap.
```

---

## Single-purpose justification (required)

```
Auto Unmute has one purpose: to detect when the user has started speaking in Google Meet while their microphone is muted, and to dispatch the standard Meet mute-toggle keyboard shortcut (Ctrl+D / Cmd+D) so the user is unmuted automatically. All features in the extension exist to support this single accessibility goal.
```

---

## Permission justifications

### `storage`

```
Used to persist the user's settings (auto-unmute on/off, detection engine, sustained-frames threshold, mouth-open threshold, selected camera, speech-recognition language, and debug-panel toggles) via chrome.storage.sync. No personal data, audio, video, or browsing data is stored.
```

### `tabs`

```
Used to locate the user's Google Meet tab so the extension can (a) read the current mute-state of Meet's microphone button and (b) deliver settings updates from the popup to the detection iframe injected into that tab. No information about other tabs is read or used.
```

### Host permission `https://meet.google.com/*`

```
The extension only operates on Google Meet. The host permission is required to inject the content script that observes Meet's microphone-button state and dispatches the standard Ctrl+D / Cmd+D mute-toggle keyboard event when the user is detected to be speaking while muted.
```

### `webcam` (camera) — listed as a remote-host-equivalent permission justification

```
The user's camera is accessed (after the standard browser permission prompt) so that mouth movement can be detected locally via the open-source face-api.js library. The video stream is processed frame-by-frame inside the browser and is never recorded, transmitted, or shared. Mouth movement is one of two signals (the other being recognised speech) used to determine whether the user is trying to speak while muted.
```

### `microphone` justification

```
The user's microphone is accessed (after the standard browser permission prompt) so that Chrome's built-in Web Speech API can determine whether the user is producing speech. The extension itself does not record, store, or transmit audio. The Web Speech API may, depending on the user's browser, perform recognition via Google's speech service — this is identical to the behaviour of any website that uses the Web Speech API. Recognised words are kept only in memory and only shown in an optional debug panel.
```

### "Remote code" disclosure

```
The extension does NOT load or execute any remote code. All JavaScript, including face-api.js, Bootstrap, and the face-detection model files, is bundled inside the extension package and served from the extension's own origin via chrome.runtime.getURL.
```

### Data usage disclosures (data-collection form)

- Personally identifiable information: **NO**
- Health information: **NO**
- Financial and payment information: **NO**
- Authentication information: **NO**
- Personal communications: **NO** (audio/video are processed in real time and immediately discarded; nothing is stored or transmitted by the extension)
- Location: **NO**
- Web history: **NO**
- User activity: **NO**
- Website content: **NO**

Tick the three certification checkboxes:
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Privacy policy URL

```
https://khalilgharbaoui.codez.it/auto_unmute/privacy.html
```

(Becomes live after you enable GitHub Pages on the repo — see the README.)

---

## Visibility

```
Public — anyone can find this item by searching the Chrome Web Store.
```

## Distribution

```
All regions
```
