'use strict';

// auto_unmute.js
//
// Runs inside the hidden detector iframe injected by content_script.js.
// Watches camera + microphone, and whenever the Meet tab is currently
// MUTED and we observe sustained mouth movement OR recognized speech,
// we ask the content script to flip the mic on. We never auto-mute.

const TICK_MS = 100;
// Cooldown after we observe a transition into the muted state. Prevents an
// instant re-unmute when the user manually mutes mid-sentence (residual
// speechActive/MAR can otherwise trigger immediately).
const MUTE_COOLDOWN_MS = 1500;
const PREVIEW_W = 320;
const PREVIEW_H = 180;
const CAMERA_W = 640;
const CAMERA_H = 360;
const FACE_DETECTOR_INPUT = 224; // multiple of 32; trade-off speed vs. accuracy
const FACE_SCORE_THRESH = 0.5;

// Detection state machine. Two states only — we never re-mute, so there
// is no count-down toward silence.
const STATE = Object.freeze({ LISTENING: 'listening', UNMUTED: 'unmuted' });

const settings = {
  useAutoUnmute: true,
  engine: 'engineImageSpeech',
  speakFramesRequired: 1,
  marThreshold: 0.4,
  speechLang: 'en-US',
  cameraDeviceId: null,
  showImageActivity: true,
  showSpeechActivity: true,
};

let imageEnabled = false;
let speechEnabled = false;
let muteState = 'unknown';            // 'mute' | 'unmute' | 'unknown'
let machineState = STATE.LISTENING;
let speakStreak = 0;
let popupOpen = false;
let cameraStream = null;
let modelsReady = false;
let speechActive = false;             // true between onresult and silence
let lastRecognizedWord = '';
let unmuteRequestInFlight = false;
let lastMutedAt = 0;

const PREVIEW_BUS = 'auto_unmute_preview_v1';
const previewBus = new BroadcastChannel(PREVIEW_BUS);

const LOG = (...a) => console.debug('[auto_unmute/iframe]', ...a);

// ---- video & canvas ---------------------------------------------------------

const video = document.createElement('video');
video.autoplay = true;
video.muted = true;
video.width = CAMERA_W;
video.height = CAMERA_H;
video.style.display = 'none';
document.body.appendChild(video);

const previewCanvas = document.createElement('canvas');
previewCanvas.width = PREVIEW_W;
previewCanvas.height = PREVIEW_H;
const previewCtx = previewCanvas.getContext('2d');
// Mirror horizontally so the preview matches what users see in webcams.
previewCtx.scale(-1, 1);
previewCtx.translate(-PREVIEW_W, 0);

// ---- mouth math -------------------------------------------------------------

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Mouth Aspect Ratio computed from the face-api 68-landmark mouth subset.
// Higher value ≈ mouth more open. Returns 0 when geometry is degenerate.
function mouthAspectRatio(mouth) {
  const horizontal = distance(mouth[12], mouth[16]);
  if (horizontal <= 0.0001) return 0;
  const v1 = distance(mouth[13], mouth[19]);
  const v2 = distance(mouth[14], mouth[18]);
  const v3 = distance(mouth[15], mouth[17]);
  return (v1 + v2 + v3) / horizontal;
}

// ---- preview drawing (only when popup wants debug) --------------------------

function drawPreview(detection, mar, speaking) {
  previewCtx.drawImage(video, 0, 0, video.videoWidth || CAMERA_W,
                       video.videoHeight || CAMERA_H, 0, 0, PREVIEW_W, PREVIEW_H);
  if (detection) {
    const mouth = faceapi.resizeResults(detection,
                    { width: PREVIEW_W, height: PREVIEW_H }).landmarks.getMouth();
    previewCtx.lineWidth = 2;
    previewCtx.strokeStyle = speaking ? '#22c55e' : '#9ca3af';
    previewCtx.beginPath();
    previewCtx.moveTo(mouth[12].x, mouth[12].y);
    for (let i = 13; i <= 19; i++) previewCtx.lineTo(mouth[i].x, mouth[i].y);
    previewCtx.closePath();
    previewCtx.stroke();
  }
  // Un-flip text so it reads normally.
  previewCtx.save();
  previewCtx.scale(-1, 1);
  previewCtx.translate(-PREVIEW_W, 0);
  previewCtx.font = '16px sans-serif';
  previewCtx.lineWidth = 3;
  previewCtx.strokeStyle = '#ffffff';
  previewCtx.fillStyle = speaking ? '#16a34a' : (detection ? '#374151' : '#dc2626');
  const label = !detection ? 'No face'
              : speaking   ? `Speaking (MAR ${mar.toFixed(2)})`
                           : `Quiet (MAR ${mar.toFixed(2)})`;
  previewCtx.strokeText(label, 8, 22);
  previewCtx.fillText(label, 8, 22);
  previewCtx.restore();

  previewCanvas.toBlob((blob) => {
    if (blob) previewBus.postMessage(blob);
  });
}

// ---- camera lifecycle -------------------------------------------------------

async function startCamera() {
  await stopCamera();
  const video_constraints = { width: CAMERA_W, height: CAMERA_H };
  if (settings.cameraDeviceId) video_constraints.deviceId = settings.cameraDeviceId;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: video_constraints,
    });
    cameraStream = stream;
    video.srcObject = stream;
    if (!settings.cameraDeviceId) {
      const id = stream.getVideoTracks()[0]?.getSettings().deviceId || null;
      if (id) {
        settings.cameraDeviceId = id;
        chrome.storage.sync.set({ cameraDeviceId: id });
      }
    }
  } catch (err) {
    console.warn('[auto_unmute] camera unavailable:', err);
  }
}

async function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  video.srcObject = null;
}

// ---- Web Speech API ---------------------------------------------------------

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionRunning = false;

function buildRecognition() {
  if (!SpeechRecognitionImpl) return null;
  const r = new SpeechRecognitionImpl();
  r.lang = settings.speechLang;
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;

  r.onresult = (ev) => {
    speechActive = true;
    const last = ev.results[ev.results.length - 1];
    if (last && last[0]) lastRecognizedWord = last[0].transcript;
  };
  r.onspeechend = () => {
    speechActive = false;
  };
  r.onerror = (ev) => {
    if (ev.error === 'no-speech' || ev.error === 'aborted') {
      // Common, just restart.
    } else if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      console.warn('[auto_unmute] speech recognition denied:', ev.error);
      speechEnabled = false;
      return;
    }
  };
  r.onend = () => {
    recognitionRunning = false;
    speechActive = false;
    if (speechEnabled) restartRecognition();
  };
  return r;
}

function restartRecognition() {
  if (!recognition || recognitionRunning) return;
  setTimeout(() => {
    if (!speechEnabled) return;
    try {
      recognition.start();
      recognitionRunning = true;
    } catch (_e) {
      // start() throws if already started; safe to ignore.
    }
  }, 120);
}

function startSpeech() {
  if (!SpeechRecognitionImpl) {
    console.warn('[auto_unmute] Web Speech API unavailable');
    return;
  }
  if (!recognition) recognition = buildRecognition();
  recognition.lang = settings.speechLang;
  if (!recognitionRunning) restartRecognition();
}

function stopSpeech() {
  if (recognition && recognitionRunning) {
    try { recognition.stop(); } catch (_e) { /* noop */ }
  }
  recognitionRunning = false;
  speechActive = false;
  lastRecognizedWord = '';
}

// ---- engine wiring ----------------------------------------------------------

function applyEngineFlags() {
  const prevImage = imageEnabled;
  const prevSpeech = speechEnabled;
  if (settings.useAutoUnmute) {
    imageEnabled  = settings.engine === 'engineImage'  || settings.engine === 'engineImageSpeech';
    speechEnabled = settings.engine === 'engineSpeech' || settings.engine === 'engineImageSpeech';
  } else {
    imageEnabled = false;
    speechEnabled = false;
  }
  if (imageEnabled  && !prevImage)  startCamera();
  if (!imageEnabled &&  prevImage)  stopCamera();
  if (speechEnabled && !prevSpeech) startSpeech();
  if (!speechEnabled &&  prevSpeech) stopSpeech();
}

// ---- mute-state sync from content script (relayed by background) -----------

function applyMuteState(next) {
  if (!next || next === muteState) return;
  LOG('mute_state ->', next);
  muteState = next;
  if (next === 'mute') {
    machineState = STATE.LISTENING;
    speakStreak = 0;
    // Clear residual speech state so an in-flight phrase doesn't immediately
    // re-trigger an unmute right after the user manually muted.
    speechActive = false;
    lastRecognizedWord = '';
    lastMutedAt = Date.now();
  } else if (next === 'unmute') {
    machineState = STATE.UNMUTED;
    speakStreak = 0;
  }
}

// Ask the content script for its current view (e.g. just after iframe loads).
function requestInitialMuteState() {
  chrome.runtime.sendMessage({ action: 'get_mute_state' }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.isMuted) applyMuteState(resp.isMuted);
  });
}

// ---- popup wiring -----------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup_opened') {
    popupOpen = true;
    port.onDisconnect.addListener(() => { popupOpen = false; });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.action) return false;
  switch (msg.action) {
    case 'mute_state':
      applyMuteState(msg.isMuted);
      return false;
    case 'settings_changed':
      Object.assign(settings, msg.patch || {});
      if (recognition && msg.patch && msg.patch.speechLang) {
        recognition.lang = settings.speechLang;
        if (speechEnabled) { stopSpeech(); startSpeech(); }
      }
      if (msg.patch && msg.patch.cameraDeviceId !== undefined && imageEnabled) {
        startCamera();
      }
      applyEngineFlags();
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

function pushSpeechActivityToPopup() {
  if (!popupOpen || !settings.showSpeechActivity || !speechEnabled) return;
  chrome.runtime.sendMessage({
    action: 'speech_activity',
    active: speechActive,
    word: lastRecognizedWord,
  }, () => { void chrome.runtime.lastError; });
}

// ---- main loop --------------------------------------------------------------

async function loadModels() {
  const modelsUrl = chrome.runtime.getURL('models');
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelsUrl),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelsUrl),
  ]);
  modelsReady = true;
}

async function tick() {
  if (!settings.useAutoUnmute) return;

  let mar = 0;
  let detection = null;
  if (imageEnabled && modelsReady && cameraStream && video.readyState >= 2) {
    detection = await faceapi.detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: FACE_DETECTOR_INPUT,
        scoreThreshold: FACE_SCORE_THRESH,
      })
    ).withFaceLandmarks(/* useTinyModel */ true);
    if (detection) {
      mar = mouthAspectRatio(detection.landmarks.getMouth());
    }
  }

  const mouthOpen = imageEnabled && mar > settings.marThreshold;
  const speaking = mouthOpen || (speechEnabled && speechActive);

  // Inverted state machine: only act when currently muted.
  if (muteState === 'mute' && machineState === STATE.LISTENING) {
    const sinceMute = Date.now() - lastMutedAt;
    if (sinceMute < MUTE_COOLDOWN_MS) {
      // In post-mute cooldown — ignore any speech so a freshly-pressed mute
      // doesn't get instantly undone by leftover audio.
      speakStreak = 0;
    } else if (speaking) {
      speakStreak += 1;
      LOG('speakStreak', speakStreak, '/', settings.speakFramesRequired,
          'mar', mar.toFixed(2), 'mouthOpen', mouthOpen, 'speechActive', speechActive);
      if (speakStreak >= settings.speakFramesRequired && !unmuteRequestInFlight) {
        unmuteRequestInFlight = true;
        LOG('-> request_unmute');
        chrome.runtime.sendMessage({ action: 'request_unmute' }, (resp) => {
          unmuteRequestInFlight = false;
          void chrome.runtime.lastError;
          LOG('request_unmute resp', resp);
          if (resp && resp.isMuted === 'unmute') {
            machineState = STATE.UNMUTED;
            muteState = 'unmute';
          }
          speakStreak = 0;
        });
      }
    } else {
      speakStreak = 0;
    }
  }
  // STATE.UNMUTED -> deliberately do nothing. We never re-mute.

  if (popupOpen && settings.showImageActivity && imageEnabled) {
    drawPreview(detection, mar, mouthOpen);
  }
  pushSpeechActivityToPopup();
}

// ---- bootstrap --------------------------------------------------------------

chrome.storage.sync.get(Object.keys(settings), (data) => {
  for (const k of Object.keys(settings)) {
    if (data[k] !== undefined) settings[k] = data[k];
  }
  applyEngineFlags();
  requestInitialMuteState();
  loadModels().catch((err) => console.warn('[auto_unmute] model load failed:', err));
  setInterval(() => { tick().catch((err) => console.warn('[auto_unmute] tick:', err)); }, TICK_MS);
});
