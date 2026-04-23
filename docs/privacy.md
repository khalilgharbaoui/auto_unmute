# Privacy Policy — Auto Unmute

_Last updated: 2026-04-23_

**Auto Unmute** ("the extension") is a Chrome extension that automatically unmutes you in Google Meet when you start talking while muted.

## Summary

**The extension does not collect, store, transmit, or share any user data.** All processing happens locally in your browser. There are no analytics, no telemetry, no remote servers, and no third parties involved.

## What the extension accesses, and why

| Data / permission | Why it is needed | Where it goes |
|---|---|---|
| **Camera (video)** | Local mouth-movement detection via [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker), running inside the extension iframe, to determine whether you are speaking while muted. | Stays on your device. Never recorded, never uploaded, never shared. The video stream is read frame-by-frame and immediately discarded. |
| **Microphone (audio)** | Used for two local signals: (1) raw audio-level detection (AudioWorklet RMS) and (2) optional [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) activity. Depending on browser/vendor behavior, Web Speech may use cloud recognition services; that behavior is provided by the browser API, not by this extension's own backend (it has none). | The extension does not store, log, or transmit audio itself. Audio-level values are ephemeral in-memory metrics. Recognized words are in-memory only and shown only in the optional popup activity panel. |
| **`storage`** (Chrome sync storage) | Saves your settings (auto-unmute on/off, engine choice, sustained-frames threshold, mouth-open threshold, selected camera, language, debug-panel toggles). | Synced via your Chrome profile (Google account) using Chrome's standard `chrome.storage.sync` API. Settings only — never any audio, video, or speech content. |
| **`tabs`** + host permission for `https://meet.google.com/*` | Lets the extension find your Google Meet tab, observe the mic-button state, and dispatch the same `Ctrl+D` / `⌘+D` keyboard shortcut you would press yourself to toggle the mic. | Local browser API calls only. No network requests are made by the extension. |

## What the extension does NOT do

- It does **not** record or save your audio or video.
- It does **not** transmit audio, video, transcripts, or any other personal data to any server, including the developer's.
- It does **not** use analytics, crash reporting, or any third-party SDKs.
- It does **not** run on any site other than `https://meet.google.com/*`.
- It does **not** read or modify any other web pages, browsing history, cookies, or stored data.

## Open source

The full source code, including every file the extension ships with, is published at:

https://github.com/khalilgharbaoui/auto_unmute

You can audit exactly what the extension does and build it yourself.

## Contact

For questions or concerns about this privacy policy, please open an issue at https://github.com/khalilgharbaoui/auto_unmute/issues or email khalilgharbaoui@hotmail.com.
