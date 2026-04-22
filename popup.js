'use strict';

// popup.js — settings UI. Vanilla JS, no jQuery.

const TICK_MS = 200;

const els = {
  useAutoUnmute:        document.getElementById('useAutoUnmute'),
  settings:             document.getElementById('settings'),
  imageSettings:        document.getElementById('imageSettings'),
  speechSettings:       document.getElementById('speechSettings'),
  selectCamera:         document.getElementById('select_camera'),
  marThresh:            document.getElementById('range_mar_thresh'),
  marThreshLabel:       document.getElementById('marThresholdLabel'),
  speakFrames:          document.getElementById('speakFramesRequired'),
  speakFramesLabel:     document.getElementById('speakFramesRequiredLabel'),
  speakFramesMs:        document.getElementById('speakFramesMs'),
  speechLang:           document.getElementById('select_speech_lang'),
  showImageActivity:    document.getElementById('showImageActivity'),
  showSpeechActivity:   document.getElementById('showSpeechActivity'),
  debugImage:           document.getElementById('debug_image'),
  speechRecognized:     document.getElementById('speechRecognized'),
  speechRecognizedWord: document.getElementById('speechRecognizedWord'),
};

const SETTING_KEYS = [
  'useAutoUnmute', 'engine', 'speakFramesRequired', 'marThreshold',
  'speechLang', 'cameraDeviceId', 'showImageActivity', 'showSpeechActivity',
];

let imageEnabled = false;
let speechEnabled = false;

function recomputeEnginesFromUI() {
  const useAU = els.useAutoUnmute.checked;
  const engine = (document.querySelector('input[name="engine"]:checked') || {}).value;
  imageEnabled  = useAU && (engine === 'engineImage'  || engine === 'engineImageSpeech');
  speechEnabled = useAU && (engine === 'engineSpeech' || engine === 'engineImageSpeech');
  els.imageSettings.style.display  = imageEnabled  ? '' : 'none';
  els.speechSettings.style.display = speechEnabled ? '' : 'none';
  els.settings.style.display       = useAU         ? '' : 'none';
}

// Persist a settings patch and forward to the iframe in the Meet tab.
function persistAndBroadcast(patch) {
  chrome.storage.sync.set(patch);
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'settings_changed', patch }, () => {
        void chrome.runtime.lastError; // ignore; iframe may not be ready
      });
    }
  });
}

// ---- camera enumeration -----------------------------------------------------

async function populateCameras(currentDeviceId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    els.selectCamera.innerHTML = '';
    cams.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `camera ${i + 1}`;
      els.selectCamera.appendChild(opt);
    });
    if (currentDeviceId) els.selectCamera.value = currentDeviceId;
  } catch (err) {
    console.warn('[auto_unmute] enumerateDevices:', err);
  }
}

// ---- preview canvas (image activity) ---------------------------------------

const previewBus = new BroadcastChannel('auto_unmute_preview_v1');
previewBus.onmessage = (ev) => {
  if (!els.showImageActivity.checked || !imageEnabled) return;
  const url = URL.createObjectURL(ev.data);
  // revoke prior URL to avoid leaks
  const prev = els.debugImage.dataset.blobUrl;
  if (prev) URL.revokeObjectURL(prev);
  els.debugImage.src = url;
  els.debugImage.dataset.blobUrl = url;
};

function clearImagePreview() {
  const prev = els.debugImage.dataset.blobUrl;
  if (prev) URL.revokeObjectURL(prev);
  els.debugImage.removeAttribute('src');
  els.debugImage.dataset.blobUrl = '';
}

function clearSpeechPreview() {
  els.speechRecognized.textContent = '';
  els.speechRecognizedWord.textContent = '';
}

// ---- speech activity messages from iframe ----------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'speech_activity') return;
  if (!els.showSpeechActivity.checked || !speechEnabled) return;
  if (msg.active) {
    els.speechRecognized.textContent = 'Voice detected';
    els.speechRecognized.style.color = '#16a34a';
    els.speechRecognizedWord.textContent = msg.word || '';
  } else {
    els.speechRecognized.textContent = 'Quiet';
    els.speechRecognized.style.color = '#6b7280';
    els.speechRecognizedWord.textContent = '';
  }
});

// ---- wire the inputs --------------------------------------------------------

function updateMarLabel() { els.marThreshLabel.textContent = Number(els.marThresh.value).toFixed(2); }
function updateFramesLabel() {
  const n = Number(els.speakFrames.value);
  els.speakFramesLabel.textContent = String(n);
  els.speakFramesMs.textContent = String(n * TICK_MS);
}

els.useAutoUnmute.addEventListener('change', () => {
  recomputeEnginesFromUI();
  clearImagePreview(); clearSpeechPreview();
  persistAndBroadcast({ useAutoUnmute: els.useAutoUnmute.checked });
});

document.querySelectorAll('input[name="engine"]').forEach((radio) => {
  radio.addEventListener('change', (ev) => {
    recomputeEnginesFromUI();
    clearImagePreview(); clearSpeechPreview();
    persistAndBroadcast({ engine: ev.target.value });
  });
});

els.marThresh.addEventListener('input', () => {
  updateMarLabel();
  persistAndBroadcast({ marThreshold: Number(els.marThresh.value) });
});

els.speakFrames.addEventListener('input', () => {
  updateFramesLabel();
  persistAndBroadcast({ speakFramesRequired: Number(els.speakFrames.value) });
});

els.selectCamera.addEventListener('change', () => {
  persistAndBroadcast({ cameraDeviceId: els.selectCamera.value });
});

els.speechLang.addEventListener('change', () => {
  persistAndBroadcast({ speechLang: els.speechLang.value });
});

els.showImageActivity.addEventListener('change', () => {
  if (!els.showImageActivity.checked) clearImagePreview();
  persistAndBroadcast({ showImageActivity: els.showImageActivity.checked });
});

els.showSpeechActivity.addEventListener('change', () => {
  if (!els.showSpeechActivity.checked) clearSpeechPreview();
  persistAndBroadcast({ showSpeechActivity: els.showSpeechActivity.checked });
});

// ---- initial load -----------------------------------------------------------

chrome.storage.sync.get(SETTING_KEYS, (data) => {
  els.useAutoUnmute.checked      = data.useAutoUnmute !== false;
  els.marThresh.value            = data.marThreshold ?? 0.4;
  els.speakFrames.value          = data.speakFramesRequired ?? 2;
  els.speechLang.value           = data.speechLang ?? 'en-US';
  els.showImageActivity.checked  = data.showImageActivity !== false;
  els.showSpeechActivity.checked = data.showSpeechActivity !== false;

  const engine = data.engine || 'engineImageSpeech';
  const radio = document.getElementById(engine);
  if (radio) radio.checked = true;

  updateMarLabel();
  updateFramesLabel();
  recomputeEnginesFromUI();
  populateCameras(data.cameraDeviceId);
});

// Tell the iframe the popup is open so it can stream debug previews.
const port = chrome.runtime.connect({ name: 'popup_opened' });
port.postMessage({ open: true });
