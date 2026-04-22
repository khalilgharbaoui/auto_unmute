'use strict';

// auto_unmute.js
//
// Runs inside the hidden detector iframe injected by content_script.js.
// Watches camera + microphone, and whenever the Meet tab is currently
// MUTED and we observe sustained mouth movement, mic activity, or recognized
// speech (depending on the selected mode),
// we ask the content script to flip the mic on. We never auto-mute.
//
// Loaded as an ES module from auto_unmute.html so we can `import` the
// MediaPipe Face Landmarker SDK (replaces face-api.js, whose URI loader
// is broken inside MV3 chrome-extension:// iframes).

import {
  FaceLandmarker,
  FilesetResolver,
} from './js/mediapipe/vision_bundle.mjs';

const TICK_MS = 25;
// Cooldown after we observe a transition into the muted state. Prevents an
// instant re-unmute when the user manually mutes mid-sentence (residual
// speechActive/MAR can otherwise trigger immediately).
const MUTE_COOLDOWN_MS = 1500;
// Raw-audio fast path. Web Speech API has 200-500ms inherent latency before
// onresult fires; reading raw mic level via AnalyserNode fires within one
// audio frame (~20ms), giving sub-100ms total unmute latency.
// Threshold is now user-tunable via settings.audioRmsThreshold (slider in
// popup). Default 0.005 ≈ -46 dBFS catches normal speech but may also catch
// nearby people; users with chatty neighbors can raise it.
const AUDIO_RMS_THRESHOLD_DEFAULT = 0.005;
// Hold `audioActive` true for this long after RMS drops below threshold so a
// brief inter-syllable dip ('h-i') doesn't reset the speakStreak counter.
// 350ms comfortably bridges the gap between fast consecutive words.
const AUDIO_HANGOVER_MS = 350;
const PREVIEW_W = 320;
const PREVIEW_H = 180;
const CAMERA_W = 640;
const CAMERA_H = 360;
// MediaPipe Face Landmarker — 478 3D landmarks, ~10ms inference on M-series.
// We don't need blendshapes or transformation matrix; just the raw points.

// Detection state machine. Two states only — we never re-mute, so there
// is no count-down toward silence.
const STATE = Object.freeze({ LISTENING: 'listening', UNMUTED: 'unmuted' });

const settings = {
  useAutoUnmute: true,
  engine: 'engineImageSpeech',
  speakFramesRequired: 1,
  // MediaPipe inner-lip MAR: ~0.05 closed, ~0.20-0.40 speaking, ~0.5+ open.
  // 0.20 catches normal speech without false-firing on rest position.
  marThreshold: 0.20,
  audioRmsThreshold: AUDIO_RMS_THRESHOLD_DEFAULT,
  speechLang: 'en-US',
  cameraDeviceId: null,
  showImageActivity: true,
  showAudioActivity: true,
  showSpeechActivity: true,
};

let imageEnabled = false;
let audioEnabled = false;
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
let diagTickCounter = 0;

const PREVIEW_BUS = 'auto_unmute_preview_v1';
const previewBus = new BroadcastChannel(PREVIEW_BUS);

const LOG = (...a) => console.log('[auto_unmute/iframe]', ...a);

// ---- video & canvas ---------------------------------------------------------

const video = document.createElement('video');
video.autoplay = true;
video.muted = true;
video.playsInline = true;
video.width = CAMERA_W;
video.height = CAMERA_H;
// Position offscreen rather than display:none. MediaPipe's internal pipeline
// (even with CPU delegate) reads video frames into a canvas/WebGL texture,
// and `display:none` videos can fail with "Framebuffer attachment has zero
// size" because the browser may skip allocating a render surface.
video.style.position = 'fixed';
video.style.left = '-10000px';
video.style.top = '0';
video.style.width = CAMERA_W + 'px';
video.style.height = CAMERA_H + 'px';
video.style.opacity = '0';
video.style.pointerEvents = 'none';
document.body.appendChild(video);

// Feed MediaPipe from a fixed-size canvas rather than the live <video> node.
// This avoids ANGLE/WebGL readback failures we've seen in Meet tabs where the
// SDK's internal upload path intermittently reports a zero-sized attachment.
const frameCanvas = document.createElement('canvas');
frameCanvas.width = CAMERA_W;
frameCanvas.height = CAMERA_H;
const frameCtx = frameCanvas.getContext('2d', { alpha: false });

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

// MediaPipe Face Mesh / Face Landmarker landmark indices for the inner lips:
//   horizontal corners: 78 (left), 308 (right)
//   vertical pairs (upper inner -> lower inner):
//     left:   81 / 178
//     center: 13 / 14
//     right:  311 / 402
// Mouth-Aspect-Ratio analogue: average vertical opening / corner distance.
// Returns 0 when geometry is degenerate. Higher value ≈ mouth more open.
const LM_LEFT_CORNER  = 78;
const LM_RIGHT_CORNER = 308;
const LM_V_PAIRS = [[81, 178], [13, 14], [311, 402]];

function mouthAspectRatio(lm) {
  if (!lm || lm.length < 478) return 0;
  const horizontal = distance(lm[LM_LEFT_CORNER], lm[LM_RIGHT_CORNER]);
  if (horizontal <= 0.0001) return 0;
  let v = 0;
  for (const [a, b] of LM_V_PAIRS) v += distance(lm[a], lm[b]);
  return (v / LM_V_PAIRS.length) / horizontal;
}

// ---- preview drawing (only when popup wants debug) --------------------------

// MediaPipe outer-lip ring (clockwise from left corner). Used purely for the
// debug overlay so the user can see the detector latched onto their mouth.
const LM_OUTER_LIP = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
  291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61,
];

function drawPreview(landmarks, mar, speaking) {
  previewCtx.drawImage(video, 0, 0, video.videoWidth || CAMERA_W,
                       video.videoHeight || CAMERA_H, 0, 0, PREVIEW_W, PREVIEW_H);
  if (landmarks && landmarks.length >= 478) {
    previewCtx.lineWidth = 2;
    previewCtx.strokeStyle = speaking ? '#22c55e' : '#9ca3af';
    previewCtx.beginPath();
    for (let i = 0; i < LM_OUTER_LIP.length; i++) {
      const p = landmarks[LM_OUTER_LIP[i]];
      // Landmarks are normalized [0,1] — scale into preview canvas.
      const x = p.x * PREVIEW_W;
      const y = p.y * PREVIEW_H;
      if (i === 0) previewCtx.moveTo(x, y);
      else         previewCtx.lineTo(x, y);
    }
    previewCtx.stroke();
  }
  // Un-flip text so it reads normally.
  previewCtx.save();
  previewCtx.scale(-1, 1);
  previewCtx.translate(-PREVIEW_W, 0);
  previewCtx.font = '16px sans-serif';
  previewCtx.lineWidth = 3;
  previewCtx.strokeStyle = '#ffffff';
  previewCtx.fillStyle = speaking ? '#16a34a' : (landmarks ? '#374151' : '#dc2626');
  const label = !modelsReady ? 'Loading model…'
              : !landmarks   ? 'No face'
              : speaking     ? `Speaking (MAR ${mar.toFixed(2)})`
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
  LOG('startCamera requesting', video_constraints);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: video_constraints,
    });
    cameraStream = stream;
    video.srcObject = stream;
    try {
      await video.play();
      LOG('video.play ok');
    } catch (err) {
      console.warn('[auto_unmute] video.play failed:', err);
    }
    const t = stream.getVideoTracks()[0];
    LOG('startCamera ok track', t && t.label, 'settings', t && t.getSettings());
    video.addEventListener('loadedmetadata', () => {
      LOG('video loadedmetadata size',
          video.videoWidth + 'x' + video.videoHeight,
          'readyState', video.readyState);
    }, { once: true });
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

// ---- Raw audio level (fast path) -------------------------------------------
//
// Bypasses Web Speech API latency. We grab the mic stream once, run it through
// an AnalyserNode, and sample RMS on every tick. `audioActive` flips true the
// instant volume crosses the threshold, which is typically 30-80ms after the
// user starts speaking.

let audioStream = null;
let audioCtx = null;
let audioProcessor = null;
let audioSource = null;
let audioActive = false;
let lastAudioRms = 0;       // peak RMS from the previous tick window (for logs)
let audioPeakSinceTick = 0; // running peak the processor updates in real time
let displayPeakRms = 0;     // peak across the entire popup-push window (~100ms)
let displayActiveAny = false; // true if audioActive was true anywhere in window
let lastAboveThresholdAt = 0;

async function startAudioLevel() {
  if (audioStream) return;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioSource = audioCtx.createMediaStreamSource(audioStream);
    // ScriptProcessorNode is deprecated but universally supported and gives
    // us callback-per-buffer semantics on the audio thread. bufferSize=256
    // ≈ 5.3ms at 48kHz, so we evaluate the threshold ~190x/sec — there is
    // no gap between samples and syllable onsets cannot fall through it.
    // (AudioWorklet would be cleaner but requires a separate file URL,
    // which adds MV3 packaging friction for negligible gain at this rate.)
    audioProcessor = audioCtx.createScriptProcessor(256, 1, 1);
    audioProcessor.onaudioprocess = (ev) => {
      const data = ev.inputBuffer.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / data.length);
      // Track peak across all buffers since the tick last read it, so a
      // single quiet frame can't mask a loud one.
      if (rms > audioPeakSinceTick) audioPeakSinceTick = rms;
      const now = Date.now();
      if (rms > settings.audioRmsThreshold) {
        lastAboveThresholdAt = now;
        audioActive = true;
      } else if (audioActive && (now - lastAboveThresholdAt) >= AUDIO_HANGOVER_MS) {
        // Hold audioActive across brief sub-threshold dips (consonants,
        // pauses between syllables) so the streak counter doesn't reset
        // mid-word.
        audioActive = false;
      }
    };
    // ScriptProcessorNode only runs while connected to the destination.
    // Route through a muted GainNode so we never feed mic audio back out.
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    audioSource.connect(audioProcessor);
    audioProcessor.connect(sink);
    sink.connect(audioCtx.destination);
    LOG('audio level detector started (script-processor, ~5ms granularity)');
  } catch (err) {
    console.warn('[auto_unmute] audio level unavailable:', err);
    audioStream = null;
  }
}

async function stopAudioLevel() {
  audioActive = false;
  lastAudioRms = 0;
  audioPeakSinceTick = 0;
  displayPeakRms = 0;
  displayActiveAny = false;
  if (audioProcessor) {
    try { audioProcessor.disconnect(); } catch (_e) { /* noop */ }
    audioProcessor.onaudioprocess = null;
    audioProcessor = null;
  }
  if (audioSource) {
    try { audioSource.disconnect(); } catch (_e) { /* noop */ }
    audioSource = null;
  }
  if (audioCtx) {
    try { await audioCtx.close(); } catch (_e) { /* noop */ }
    audioCtx = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
}

// The script-processor callback updates audioActive in real time, so the
// per-tick poll only needs to snapshot the running peak (so logs see real
// numbers) and reset it for the next window. We also accumulate the peak
// across the entire popup-display window (~100ms) so the meter never
// misses a syllable that landed between display pushes.
function sampleAudioLevel() {
  lastAudioRms = audioPeakSinceTick;
  if (lastAudioRms > displayPeakRms) displayPeakRms = lastAudioRms;
  if (audioActive) displayActiveAny = true;
  audioPeakSinceTick = 0;
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
  const prevAudio = audioEnabled;
  const prevSpeech = speechEnabled;
  if (settings.useAutoUnmute) {
    imageEnabled  = settings.engine === 'engineImage'  || settings.engine === 'engineImageSpeech';
    audioEnabled  = settings.engine === 'engineSpeech' || settings.engine === 'engineImageSpeech';
    speechEnabled = settings.engine === 'engineRecognition'
                 || settings.engine === 'engineImageSpeech';
  } else {
    imageEnabled = false;
    audioEnabled = false;
    speechEnabled = false;
  }
  if (imageEnabled  && !prevImage)  startCamera();
  if (!imageEnabled &&  prevImage)  stopCamera();
  if (speechEnabled && !prevSpeech) startSpeech();
  if (!speechEnabled &&  prevSpeech) stopSpeech();
  if (audioEnabled && !prevAudio) startAudioLevel();
  if (!audioEnabled &&  prevAudio) stopAudioLevel();
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
    audioActive = false;
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

// Audio level meter — push the peak RMS observed across the entire window
// (~100ms) to the popup ~10Hz so a syllable landing between pushes never
// gets thrown away. Gated on popupOpen + showAudioActivity.
let audioLevelTickCounter = 0;
function pushAudioLevelToPopup() {
  if (!popupOpen || !settings.showAudioActivity || !audioEnabled) return;
  // tick is 25ms; emit every 4th tick = ~100ms = 10 fps, smooth + cheap.
  audioLevelTickCounter = (audioLevelTickCounter + 1) % 4;
  if (audioLevelTickCounter !== 0) return;
  chrome.runtime.sendMessage({
    action: 'audio_level',
    rms: displayPeakRms,
    active: displayActiveAny,
    threshold: settings.audioRmsThreshold,
  }, () => { void chrome.runtime.lastError; });
  displayPeakRms = 0;
  displayActiveAny = false;
}

// ---- main loop --------------------------------------------------------------

let faceLandmarker = null;

// Extract a useful description from whatever a failed loader throws. Emscripten
// rejects with a bare DOM Event whose String() is "[object Event]"; we want
// the original network/script-tag error visible in the console.
function describeLoadError(err) {
  if (!err) return 'unknown';
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  if (err instanceof Event) {
    const t = err.target;
    const src = t && (t.src || t.href || t.responseURL);
    return `${err.type} on <${(t && t.tagName) || '?'}>${src ? ' src=' + src : ''}`;
  }
  try { return JSON.stringify(err); } catch (_e) { return String(err); }
}

async function probe(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return `${r.status} ${r.headers.get('content-type') || '?'}`;
  } catch (e) {
    return `fetch failed: ${e.message}`;
  }
}

async function loadModels() {
  const wasmBase = chrome.runtime.getURL('js/mediapipe/wasm/');
  const modelUrl = chrome.runtime.getURL('models/face_landmarker.task');
  LOG('loading MediaPipe FaceLandmarker', { wasmBase, modelUrl });
  // Probe the three files MediaPipe will try to load so we can tell at a glance
  // whether the failure is network (404 / bad MIME) or runtime (script error).
  LOG('probe loader.js  ->', await probe(wasmBase + 'vision_wasm_internal.js'));
  LOG('probe wasm       ->', await probe(wasmBase + 'vision_wasm_internal.wasm'));
  LOG('probe model.task ->', await probe(modelUrl));

  try {
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    LOG('FilesetResolver ready, creating FaceLandmarker…');
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelUrl,
        // CPU is plenty for 1 face at ~25fps; GPU adds a WebGL context that
        // we don't need and that can conflict with Meet's own renderer.
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      // Meet tiles are often a bit soft / low-contrast at 640x360. The
      // default 0.5 thresholds were too strict in testing and could return no
      // face at all even with a centered user, so relax them slightly.
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
      // We use raw landmarks for MAR; skip the heavier blendshape branch.
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    modelsReady = true;
    LOG('MediaPipe FaceLandmarker ready');
  } catch (err) {
    console.warn('[auto_unmute] MediaPipe load failed (audio modes still active):',
                 describeLoadError(err), err);
  }
}

async function tick() {
  if (!settings.useAutoUnmute) return;

  // Sample raw audio level every tick — sub-50ms latency, drives most unmutes.
  sampleAudioLevel();

  let mar = 0;
  let landmarks = null;
  let detectFaces = -1; // -1 = didn't run; 0..n = number of faces returned
  if (imageEnabled && modelsReady && faceLandmarker && frameCtx && cameraStream
      && video.readyState >= 2
      && video.videoWidth > 0 && video.videoHeight > 0) {
    frameCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight,
                       0, 0, CAMERA_W, CAMERA_H);
    // detectForVideo wants a monotonically increasing timestamp in ms.
    const result = faceLandmarker.detectForVideo(frameCanvas, performance.now());
    detectFaces = (result && result.faceLandmarks) ? result.faceLandmarks.length : 0;
    if (detectFaces > 0) {
      landmarks = result.faceLandmarks[0];
      mar = mouthAspectRatio(landmarks);
    }
  }

  // Diagnostic: when image engine is on but we're not getting MAR, log every
  // ~500ms why. Helps users (and us) tell apart "no camera" from "no face" from
  // "mouth closed". Throttled so it doesn't flood the console.
  if (imageEnabled) {
    diagTickCounter = (diagTickCounter + 1) % 20; // 20 * 25ms = 500ms
    if (diagTickCounter === 0) {
      let frameSample = 'n/a';
      if (frameCtx && cameraStream && video.readyState >= 2
          && video.videoWidth > 0 && video.videoHeight > 0) {
        frameCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight,
                           0, 0, CAMERA_W, CAMERA_H);
        const px = frameCtx.getImageData((CAMERA_W / 2) | 0, (CAMERA_H / 2) | 0, 1, 1).data;
        frameSample = `${px[0]}/${px[1]}/${px[2]}`;
      }
      LOG('image-diag',
          'modelsReady', modelsReady,
          'cameraStream', !!cameraStream,
          'paused', video.paused,
          't', video.currentTime.toFixed(2),
          'readyState', video.readyState,
          'videoSize', video.videoWidth + 'x' + video.videoHeight,
          'sample', frameSample,
          'detectFaces', detectFaces,
          'mar', mar.toFixed(3));
    }
  }

  const mouthOpen = imageEnabled && mar > settings.marThreshold;
  const speaking = (audioEnabled && audioActive)
                || mouthOpen
                || (speechEnabled && speechActive);

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
          'rms', lastAudioRms.toFixed(3), 'audioActive', audioActive,
          'mar', mar.toFixed(2), 'mouthOpen', mouthOpen,
          'speechActive', speechActive);
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
    drawPreview(landmarks, mar, mouthOpen);
  }
  pushSpeechActivityToPopup();
  pushAudioLevelToPopup();
}

// ---- bootstrap --------------------------------------------------------------

chrome.storage.sync.get(Object.keys(settings), (data) => {
  for (const k of Object.keys(settings)) {
    if (data[k] !== undefined) settings[k] = data[k];
  }
  // Migration: older versions defaulted speakFramesRequired to 2, which felt
  // sluggish with the new 25ms tick + audio fast path. Cap it at 1 if the
  // user never explicitly raised it (i.e. it's still the legacy default).
  if (settings.speakFramesRequired === 2) {
    settings.speakFramesRequired = 1;
    chrome.storage.sync.set({ speakFramesRequired: 1 });
  }
  applyEngineFlags();
  requestInitialMuteState();
  loadModels().catch((err) => console.warn('[auto_unmute] model load failed:', err));
  setInterval(() => { tick().catch((err) => console.warn('[auto_unmute] tick:', err)); }, TICK_MS);
});
