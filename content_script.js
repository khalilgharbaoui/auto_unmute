'use strict';

// content_script.js
//
// Lives inside the Google Meet page. Three jobs:
//   1. Locate Meet's microphone toggle button so we can read its current
//      state (data-is-muted) and send synthetic Ctrl/Cmd+D to flip it.
//   2. Inject a hidden iframe that hosts auto_unmute.js (the detection loop).
//   3. Relay messages between the iframe / popup / service-worker.

const MUTE_BUS = 'auto_unmute_mute_state_v1';
const muteStateBus = new BroadcastChannel(MUTE_BUS);

const isMac = navigator.platform.toUpperCase().includes('MAC');
let micButton = null;
let lastReportedState = 'unknown'; // 'mute' | 'unmute' | 'unknown'

function readMuteState() {
  if (!micButton) return 'unknown';
  const v = micButton.dataset.isMuted;
  if (v === 'true') return 'mute';
  if (v === 'false') return 'unmute';
  return 'unknown';
}

function broadcastMuteState() {
  const s = readMuteState();
  if (s === lastReportedState) return;
  lastReportedState = s;
  muteStateBus.postMessage({ isMuted: s });
  chrome.runtime.sendMessage({ action: 'mute_state', isMuted: s }, () => {
    void chrome.runtime.lastError; // ignore "no receiver" during early load
  });
}

// Synthesize the same hotkey Meet uses for mic toggle.
function pressMuteHotkey() {
  const init = {
    bubbles: true,
    cancelable: true,
    keyCode: 68,
    code: 'KeyD',
    key: 'd',
  };
  if (isMac) init.metaKey = true; else init.ctrlKey = true;
  document.dispatchEvent(new KeyboardEvent('keydown', init));
}

// Attach a click listener so we notice manual mutes/unmutes.
function bindMicButton(el) {
  if (micButton === el) return;
  micButton = el;
  micButton.addEventListener('click', () => {
    // The dataset flips after the click; read on next tick.
    setTimeout(broadcastMuteState, 50);
  });
  broadcastMuteState();
}

// Meet rebuilds its toolbar on join/leave; watch the whole subtree.
const findAndBindMicButton = () => {
  document.querySelectorAll('[data-is-muted][data-tooltip]').forEach((el) => {
    const tip = (el.dataset.tooltip || '').toUpperCase();
    if (tip.includes('CTRL+D') || tip.includes('⌘+D') || tip.includes('CMD+D')) {
      bindMicButton(el);
    }
  });
};

const domObserver = new MutationObserver(findAndBindMicButton);
domObserver.observe(document.documentElement, { childList: true, subtree: true });
findAndBindMicButton();

// Manual hotkey use should also re-broadcast.
window.addEventListener('keydown', (ev) => {
  const hot = isMac ? (ev.key === 'd' && ev.metaKey)
                    : (ev.key === 'd' && ev.ctrlKey);
  if (hot) setTimeout(broadcastMuteState, 50);
});

// Messages from the iframe / popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'request_unmute') {
    if (readMuteState() === 'mute') pressMuteHotkey();
    setTimeout(() => {
      broadcastMuteState();
      sendResponse({ ok: true, isMuted: readMuteState() });
    }, 80);
    return true; // async response
  }
  if (msg.action === 'get_mute_state') {
    sendResponse({ isMuted: readMuteState() });
    return false;
  }
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
}

if (document.body) injectDetector();
else window.addEventListener('DOMContentLoaded', injectDetector, { once: true });
