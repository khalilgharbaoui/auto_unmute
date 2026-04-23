'use strict';

// content_script.js
//
// Lives inside the Google Meet page. Three jobs:
//   1. Locate Meet's microphone toggle button so we can read its current
//      state (data-is-muted) and toggle it.
//   2. Inject a hidden iframe that hosts auto_unmute.js (the detection loop).
//   3. Handle requests relayed by the background service worker from the
//      iframe / popup.

let debugLogging = false;
const LOG = (...a) => {
  if (debugLogging) console.debug('[auto_unmute/cs]', ...a);
};

const isMac = navigator.platform.toUpperCase().includes('MAC');
let micButton = null;
let lastReportedState = 'unknown'; // 'mute' | 'unmute' | 'unknown'
let micObserver = null;
let pageObserver = null;
let contextValid = true;
let lastGestureAt = 0;

chrome.storage.sync.get(['debugLogging'], (data) => {
  debugLogging = !!data.debugLogging;
});

// Detect the "extension context invalidated" race: when the user reloads the
// extension, this orphaned content script keeps running but chrome.runtime is
// gone. Tear down our listeners so we stop spamming the console.
function isCtxAlive() {
  if (!contextValid) return false;
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
      throw new Error('no runtime');
    }
    return true;
  } catch (_e) {
    contextValid = false;
    LOG('extension context invalidated; tearing down');
    try { micObserver && micObserver.disconnect(); } catch (_e2) { /* noop */ }
    try { pageObserver && pageObserver.disconnect(); } catch (_e2) { /* noop */ }
    micObserver = null;
    pageObserver = null;
    return false;
  }
}

function readMuteState() {
  if (!micButton) return 'unknown';
  // Modern Meet uses data-is-muted, but some builds also expose aria-pressed.
  const ds = micButton.dataset.isMuted;
  if (ds === 'true') return 'mute';
  if (ds === 'false') return 'unmute';
  const ap = micButton.getAttribute('aria-pressed');
  if (ap === 'true') return 'mute';
  if (ap === 'false') return 'unmute';
  // Fall back to aria-label heuristics ("Turn off microphone" = currently on).
  const label = (micButton.getAttribute('aria-label') || '').toLowerCase();
  if (/turn off (the )?microphone|mute microphone/.test(label)) return 'unmute';
  if (/turn on (the )?microphone|unmute microphone/.test(label))  return 'mute';
  return 'unknown';
}

function broadcastMuteState(force = false) {
  if (!isCtxAlive()) return;
  const s = readMuteState();
  if (!force && s === lastReportedState) return;
  lastReportedState = s;
  LOG('mute_state ->', s);
  try {
    chrome.runtime.sendMessage({ action: 'mute_state', isMuted: s }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_e) {
    // Context died between the guard and the call; swallow.
    contextValid = false;
  }
}

function clickMicButton() {
  if (!micButton) return false;
  try {
    micButton.click();
    return true;
  } catch (_e) {
    return false;
  }
}

// Synthesize the same hotkey Meet uses for mic toggle. Used as a fallback.
function pressMuteHotkey() {
  const target = document.activeElement || document.body;
  const init = {
    bubbles: true, cancelable: true,
    keyCode: 68, which: 68,
    code: 'KeyD', key: 'd',
  };
  if (isMac) init.metaKey = true; else init.ctrlKey = true;
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup',   init));
}

function toggleMic() {
  // Prefer a real click on the button (always trusted). Fall back to hotkey.
  if (!clickMicButton()) pressMuteHotkey();
}

function relayUserGesture() {
  if (!isCtxAlive()) return;
  const now = Date.now();
  if ((now - lastGestureAt) < 250) return;
  lastGestureAt = now;
  try {
    chrome.runtime.sendMessage({ action: 'user_gesture' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_e) {
    contextValid = false;
  }
}

// Attach a click listener so we notice manual mutes/unmutes.
function bindMicButton(el) {
  if (micButton === el) return;
  micButton = el;
  LOG('bound mic button', el);
  el.addEventListener('click', () => {
    setTimeout(broadcastMuteState, 80);
  });
  // Also observe attribute mutations so we catch programmatic flips
  // (Meet sometimes updates state without a click event).
  micObserver = new MutationObserver(() => broadcastMuteState());
  micObserver.observe(el, { attributes: true,
                 attributeFilter: ['data-is-muted', 'aria-pressed', 'aria-label'] });
  broadcastMuteState(true);
}

// Meet's mic button has changed selectors several times. Try the most-specific
// markers first and fall back to anything that looks like a mic toggle.
const findAndBindMicButton = () => {
  // 1. The classic data-is-muted attribute (most stable across redesigns).
  const candidates = Array.from(document.querySelectorAll('button[data-is-muted], div[role="button"][data-is-muted]'));
  // 2. Or any button whose aria-label talks about microphone + a hotkey hint.
  if (candidates.length === 0) {
    document.querySelectorAll('button[aria-label], div[role="button"][aria-label]').forEach((el) => {
      const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
      if (/microphone/.test(lbl) && /(ctrl|⌘|cmd|⌃|⇧)\s*\+\s*d/.test(lbl)) {
        candidates.push(el);
      }
    });
  }
  if (candidates.length === 0) return;
  // Prefer one whose tooltip / label mentions the +D hotkey, otherwise first.
  const preferred = candidates.find((el) => {
    const blob = ((el.dataset && el.dataset.tooltip) || el.getAttribute('aria-label') || '').toLowerCase();
    return /(ctrl|⌘|cmd)\s*\+\s*d/.test(blob);
  }) || candidates[0];
  bindMicButton(preferred);
};

const domObserver = new MutationObserver(() => {
  if (!isCtxAlive()) { try { domObserver.disconnect(); } catch (_e) { /* noop */ } return; }
  findAndBindMicButton();
});
pageObserver = domObserver;
domObserver.observe(document.documentElement, { childList: true, subtree: true });
findAndBindMicButton();

// Manual hotkey use should also re-broadcast.
window.addEventListener('keydown', (ev) => {
  relayUserGesture();
  const hot = isMac ? (ev.key === 'd' && ev.metaKey)
                    : (ev.key === 'd' && ev.ctrlKey);
  if (hot) setTimeout(broadcastMuteState, 80);
});
window.addEventListener('pointerdown', relayUserGesture, { capture: true, passive: true });

if (document.userActivation && document.userActivation.hasBeenActive) {
  relayUserGesture();
}

// Messages relayed from the iframe (and popup) by background.js.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.action) return false;

  if (msg.action === 'request_unmute') {
    LOG('request_unmute, current=', readMuteState());
    if (readMuteState() === 'mute') toggleMic();
    setTimeout(() => {
      broadcastMuteState();
      sendResponse({ ok: true, isMuted: readMuteState() });
    }, 120);
    return true; // async response
  }

  if (msg.action === 'get_mute_state') {
    sendResponse({ ok: true, isMuted: readMuteState() });
    return false;
  }

  if (msg.action === 'settings_changed') {
    if (msg.patch && msg.patch.debugLogging !== undefined) {
      debugLogging = !!msg.patch.debugLogging;
    }
    try {
      chrome.runtime.sendMessage(msg, () => {
        void chrome.runtime.lastError;
      });
    } catch (_e) {
      contextValid = false;
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Inject the detection iframe. Camera + mic permissions are inherited
// from the Meet origin which already has them granted.
function injectDetector() {
  if (document.getElementById('auto-unmute-iframe')) return;
  const iframe = document.createElement('iframe');
  iframe.id = 'auto-unmute-iframe';
  iframe.setAttribute('allow', 'microphone; camera');
  iframe.style.display = 'none';
  iframe.src = chrome.runtime.getURL('auto_unmute.html');
  document.body.appendChild(iframe);
  LOG('detector iframe injected');
}

if (document.body) injectDetector();
else window.addEventListener('DOMContentLoaded', injectDetector, { once: true });
