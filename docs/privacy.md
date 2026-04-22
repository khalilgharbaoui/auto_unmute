# Privacy Policy — Auto Unmute

_Last updated: 2026-04-22_

**Auto Unmute** ("the extension") is a Chrome extension that automatically unmutes you in Google Meet when you start talking while muted.

## Summary

**The extension does not collect, store, transmit, or share any user data.** All processing happens locally in your browser. There are no analytics, no telemetry, no remote servers, and no third parties involved.

## What the extension accesses, and why

| Data / permission | Why it is needed | Where it goes |
|---|---|---|
| **Camera (video)** | Local face & mouth-movement detection via the open-source [face-api.js](https://github.com/justadudewhohacks/face-api.js) library, which runs entirely inside your browser, to determine whether you are speaking while muted. | Stays on your device. Never recorded, never uploaded, never shared. The video stream is read frame-by-frame and immediately discarded. |
| **Microphone (audio)** | Used by Chrome's built-in [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) to detect whether you are speaking. The Web Speech API itself may, depending on your browser, send short audio snippets to Google's speech-recognition service — this is the same processing that occurs whenever any website uses the API. The extension does not send your audio anywhere itself. | The extension itself does not store, log, or transmit audio. Recognized words are kept only in memory for the duration of a single recognition event and only displayed in the optional popup activity panel if you enable it. |
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
