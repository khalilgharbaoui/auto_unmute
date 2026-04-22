'use strict';

// Default user preferences. Installed once; the popup mutates them later.
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
      });
      chrome.action.setPopup({ popup: '' });
    }
  });
});
