'use strict';

// Background service worker.
//
// Two jobs:
//   1. Seed default user settings on install.
//   2. Relay messages between the detector iframe and the content script
//      (they live on different origins so they cannot talk directly).

const DEFAULTS = {
  useAutoUnmute: true,
  engine: 'engineImageSpeech',          // engineImageSpeech | engineImage | engineSpeech
  speakFramesRequired: 2,               // ~400ms at 200ms tick
  marThreshold: 0.4,                    // mouth-aspect-ratio open threshold
  speechLang: 'en-US',
  cameraDeviceId: null,
  showImageActivity: true,
  showSpeechActivity: true,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(Object.keys(DEFAULTS), (stored) => {
    const seed = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (stored[k] === undefined) seed[k] = v;
    }
    if (Object.keys(seed).length) chrome.storage.sync.set(seed);
  });
});

// When the last Meet tab is closed, drop the action icon back to "off".
chrome.tabs.onRemoved.addListener(() => {
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    if (tabs.length === 0) {
      chrome.action.setIcon({
        path: { '16': 'images/off16.png', '32': 'images/off32.png' },
      }).catch(() => {});
    }
  });
});

// ---- iframe ⇄ content script relay -----------------------------------------
//
// chrome.runtime.sendMessage from any extension page (including our iframe)
// reaches other extension pages but NOT content scripts. To get a message to
// the content script we have to look up the sender's tab and use
// chrome.tabs.sendMessage on it.

const RELAY_TO_CONTENT = new Set(['request_unmute', 'get_mute_state']);
const RELAY_TO_EXTENSION = new Set(['mute_state', 'speech_activity']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return false;

  // Iframe → content script (needs response)
  if (RELAY_TO_CONTENT.has(msg.action)) {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        void chrome.runtime.lastError;
        sendResponse(resp);
      });
      return true; // async
    }
    // Sender wasn't in a tab (e.g. popup) — find the active Meet tab.
    chrome.tabs.query({ url: 'https://meet.google.com/*', active: true }, (tabs) => {
      const tab = tabs[0] || null;
      if (!tab) { sendResponse({ ok: false, error: 'no-meet-tab' }); return; }
      chrome.tabs.sendMessage(tab.id, msg, (resp) => {
        void chrome.runtime.lastError;
        sendResponse(resp);
      });
    });
    return true;
  }

  // Content script → other extension pages (iframe + popup)
  if (RELAY_TO_EXTENSION.has(msg.action)) {
    chrome.runtime.sendMessage(msg).catch(() => {});

    if (msg.action === 'mute_state') {
      const path = msg.isMuted === 'mute'
        ? { '16': 'images/armed16.png', '32': 'images/armed32.png' }
        : msg.isMuted === 'unmute'
        ? { '16': 'images/idle16.png', '32': 'images/idle32.png' }
        : { '16': 'images/off16.png', '32': 'images/off32.png' };
      const tabId = sender.tab && sender.tab.id;
      if (tabId) chrome.action.setIcon({ tabId, path }).catch(() => {});
    }
    return false;
  }

  return false;
});
