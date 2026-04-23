'use strict';

// popup.js — settings UI. Vanilla JS, no jQuery.

const TICK_MS = 25;

const els = {
  useAutoUnmute:        document.getElementById('useAutoUnmute'),
  useAutoUnmuteState:   document.getElementById('useAutoUnmuteState'),
  settings:             document.getElementById('settings'),
  audioSettings:        document.getElementById('audioSettings'),
  imageSettings:        document.getElementById('imageSettings'),
  speechSettings:       document.getElementById('speechSettings'),
  selectCamera:         document.getElementById('select_camera'),
  marThresh:            document.getElementById('range_mar_thresh'),
  marThreshLabel:       document.getElementById('marThresholdLabel'),
  speakFrames:          document.getElementById('speakFramesRequired'),
  speakFramesLabel:     document.getElementById('speakFramesRequiredLabel'),
  speakFramesMs:        document.getElementById('speakFramesMs'),
  debugLogging:         document.getElementById('debugLogging'),
  audioThresh:          document.getElementById('audioRmsThreshold'),
  audioThreshLabel:     document.getElementById('audioThresholdLabel'),
  audioThreshHint:      document.getElementById('audioThresholdHint'),
  audioMeterFill:       document.getElementById('audioMeterFill'),
  audioMeterThresh:     document.getElementById('audioMeterThresh'),
  audioStatus:          document.getElementById('audioStatus'),
  showAudioActivity:    document.getElementById('showAudioActivity'),
  speechLang:           document.getElementById('select_speech_lang'),
  showImageActivity:    document.getElementById('showImageActivity'),
  showSpeechActivity:   document.getElementById('showSpeechActivity'),
  debugImage:           document.getElementById('debug_image'),
  speechRecognized:     document.getElementById('speechRecognized'),
  speechRecognizedWord: document.getElementById('speechRecognizedWord'),
};

const SETTING_KEYS = [
  'useAutoUnmute', 'engine', 'speakFramesRequired', 'marThreshold',
  'debugLogging',
  'audioRmsThreshold', 'showAudioActivity',
  'speechLang', 'cameraDeviceId', 'showImageActivity', 'showSpeechActivity',
];

// dB <-> linear RMS conversion. We expose dBFS to the user on a full-ish
// -60..0 range so the live meter can distinguish normal speech from truly loud
// input, but persist linear RMS so the
// detector loop avoids per-tick log math.
const DB_MIN = -60;
const DB_MAX = 0;
function rmsToDb(rms) {
  if (rms <= 0) return DB_MIN;
  return Math.max(DB_MIN, Math.min(0, 20 * Math.log10(rms)));
}
function dbToRms(db) {
  return Math.pow(10, db / 20);
}
function clampDb(db) {
  return Math.max(DB_MIN, Math.min(DB_MAX, db));
}
// Friendly zone label for a given dBFS value.
function dbZoneLabel(db) {
  if (db <= -55) return '(silent)';
  if (db <= -42) return '(quiet speech)';
  if (db <= -28) return '(normal speech)';
  if (db <= -14) return '(loud speech)';
  return '(very loud)';
}

let imageEnabled = false;
let audioEnabled = false;
let speechEnabled = false;

function updateMasterState() {
  const enabled = els.useAutoUnmute.checked;
  els.useAutoUnmuteState.textContent = enabled ? 'ON' : 'OFF';
  els.useAutoUnmuteState.style.color = enabled ? '#7cf0aa' : '#90a0ba';
}

function recomputeEnginesFromUI() {
  const useAU = els.useAutoUnmute.checked;
  const engine = (document.querySelector('input[name="engine"]:checked') || {}).value;
  updateMasterState();
  audioEnabled  = useAU && (engine === 'engineSpeech' || engine === 'engineImageSpeech');
  imageEnabled  = useAU && (engine === 'engineImage'  || engine === 'engineImageSpeech');
  speechEnabled = useAU && (engine === 'engineRecognition' || engine === 'engineImageSpeech');
  els.audioSettings.style.display  = audioEnabled ? '' : 'none';
  els.imageSettings.style.display  = imageEnabled  ? '' : 'none';
  els.speechSettings.style.display = speechEnabled ? '' : 'none';
  els.settings.style.display       = useAU         ? '' : 'none';
  if (!audioEnabled) renderAudioLevel(0, false);
  if (!imageEnabled) clearImagePreview();
  if (!speechEnabled) clearSpeechPreview();
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

els.debugImage.addEventListener('load', () => {
  const w = els.debugImage.naturalWidth;
  const h = els.debugImage.naturalHeight;
  if (!w || !h) return;
  const frame = els.debugImage.parentElement;
  const ratio = `${w} / ${h}`;
  if (frame.style.aspectRatio !== ratio) frame.style.aspectRatio = ratio;
});

function clearImagePreview() {
  const prev = els.debugImage.dataset.blobUrl;
  if (prev) URL.revokeObjectURL(prev);
  els.debugImage.removeAttribute('src');
  els.debugImage.dataset.blobUrl = '';
  els.debugImage.parentElement.style.aspectRatio = '';
}

function clearSpeechPreview() {
  els.speechRecognized.textContent = '';
  els.speechRecognized.style.color = '';
  els.speechRecognizedWord.textContent = '';
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'speech_activity') {
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
    return;
  }
  if (msg.action === 'audio_level') {
    if (!els.showAudioActivity.checked || !audioEnabled) return;
    renderAudioLevel(msg.rms || 0, !!msg.active);
    return;
  }
});

// Render the live mic-level meter. The bar grows from 0% (-60dBFS) to
// 100% (-20dBFS); anything quieter or louder clamps. The vertical marker
// shows the current trigger threshold.
function renderAudioLevel(rms, active) {
  const db = rmsToDb(rms);
  const pct = Math.max(0, Math.min(100,
    ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100));
  els.audioMeterFill.style.width = pct.toFixed(1) + '%';
  if (active) {
    els.audioStatus.textContent = `Voice detected (${db.toFixed(0)} dB)`;
    els.audioStatus.classList.add('active');
  } else {
    els.audioStatus.textContent = `Quiet (${db.toFixed(0)} dB)`;
    els.audioStatus.classList.remove('active');
  }
}

// Position the threshold marker on the meter to match the slider value.
function renderThresholdMarker(db) {
  const pct = ((clampDb(db) - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
  els.audioMeterThresh.style.left = pct.toFixed(1) + '%';
}

// ---- wire the inputs --------------------------------------------------------

function updateMarLabel() { els.marThreshLabel.textContent = Number(els.marThresh.value).toFixed(2); }
function updateFramesLabel() {
  const n = Number(els.speakFrames.value);
  els.speakFramesLabel.textContent = String(n);
  els.speakFramesMs.textContent = String(n * TICK_MS);
}
function updateAudioThresholdLabel() {
  const db = Number(els.audioThresh.value);
  els.audioThreshLabel.textContent = String(db);
  els.audioThreshHint.textContent = dbZoneLabel(db);
  renderThresholdMarker(db);
}

els.useAutoUnmute.addEventListener('change', () => {
  recomputeEnginesFromUI();
  clearImagePreview();
  clearSpeechPreview();
  persistAndBroadcast({ useAutoUnmute: els.useAutoUnmute.checked });
});

document.querySelectorAll('input[name="engine"]').forEach((radio) => {
  radio.addEventListener('change', (ev) => {
    recomputeEnginesFromUI();
    clearImagePreview();
    clearSpeechPreview();
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

els.audioThresh.addEventListener('input', () => {
  updateAudioThresholdLabel();
  const rms = dbToRms(Number(els.audioThresh.value));
  persistAndBroadcast({ audioRmsThreshold: rms });
});

els.debugLogging.addEventListener('change', () => {
  persistAndBroadcast({ debugLogging: els.debugLogging.checked });
});

els.showAudioActivity.addEventListener('change', () => {
  if (!els.showAudioActivity.checked) {
    els.audioMeterFill.style.width = '0%';
    els.audioStatus.textContent = '(meter off)';
    els.audioStatus.classList.remove('active');
  }
  persistAndBroadcast({ showAudioActivity: els.showAudioActivity.checked });
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
  els.marThresh.value            = data.marThreshold ?? 0.20;
  els.speakFrames.value          = data.speakFramesRequired ?? 1;
  els.debugLogging.checked       = !!data.debugLogging;
  els.speechLang.value           = data.speechLang ?? 'en-US';
  els.showImageActivity.checked  = data.showImageActivity !== false;
  els.showAudioActivity.checked  = data.showAudioActivity !== false;
  els.showSpeechActivity.checked = data.showSpeechActivity !== false;

  // Audio threshold: persisted as linear RMS, surfaced as dBFS in the UI.
  const persistedRms = data.audioRmsThreshold ?? 0.005;
  const dbVal = clampDb(Math.round(rmsToDb(persistedRms)));
  els.audioThresh.value = String(dbVal);

  const engine = data.engine || 'engineImageSpeech';
  const radio = document.getElementById(engine);
  if (radio) radio.checked = true;

  updateMarLabel();
  updateFramesLabel();
  updateAudioThresholdLabel();
  renderAudioLevel(0, false);
  recomputeEnginesFromUI();
  populateCameras(data.cameraDeviceId);
});

// Tell the iframe the popup is open so it can stream debug previews.
const port = chrome.runtime.connect({ name: 'popup_opened' });
port.postMessage({ open: true });
