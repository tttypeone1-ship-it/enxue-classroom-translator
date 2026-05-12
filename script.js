const homeView = document.querySelector("#homeView");
const translatorView = document.querySelector("#translatorView");
const startButton = document.querySelector("#startButton");
const introModal = document.querySelector("#introModal");
const confirmStartButton = document.querySelector("#confirmStartButton");
const sourceLabel = document.querySelector("#sourceLabel");
const sourceText = document.querySelector("#sourceText");
const translatedLabel = document.querySelector("#translatedLabel");
const translatedText = document.querySelector("#translatedText");
const modeChinese = document.querySelector("#modeChinese");
const modeEnglish = document.querySelector("#modeEnglish");
const mainSpeakButton = document.querySelector("#mainSpeakButton");
const mainSpeakText = document.querySelector("#mainSpeakText");
const mainSpeakDirection = document.querySelector("#mainSpeakDirection");
const listeningFeedback = document.querySelector("#listeningFeedback");
const listeningFeedbackText = document.querySelector("#listeningFeedbackText");
const micHint = document.querySelector("#micHint");
const playButton = document.querySelector("#playButton");
const debugLine = document.querySelector("#debugLine");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = !!SpeechRecognition;

const samples = {
  chinese: {
    source: "同学们，今天我们讲解颈椎的基本检查方法。",
    translated: "Today, we will explain the basic examination methods for the cervical spine."
  },
  english: {
    source: "Could you please explain this movement again?",
    translated: "您可以再解释一下这个动作吗？"
  }
};

const uiText = {
  chinese: {
    sourceLabel: "原文",
    translatedLabel: "译文",
    play: "播放译文",
    playing: "正在播放",
    start: "开始",
    startSub: "说中文",
    listening: "结束",
    listeningSub: "录制",
    requesting: "正在连接麦克风...",
    requestingSub: "",
    processing: "正在处理...",
    processingSub: "",
    listeningFeedback: "正在聆听，现在可以说话",
    micRequesting: "正在请求麦克风权限...",
    micConnected: "麦克风已连接，正在聆听",
    micDenied: "麦克风权限未开启，请允许浏览器使用麦克风",
    sourcePlaceholder: "选择方向后，点击下方圆形按钮。",
    translatedPlaceholder: "译文会显示在这里。",
    listeningSource: "正在聆听，请开始讲话",
    translating: "正在翻译...",
    noSpeech: "未识别到清晰语音，请再试一次",
    noTranslation: "请重新录制后再查看译文",
    speechNotSupported: "当前浏览器不支持语音识别，请尝试 Safari 或 Chrome。"
  },
  english: {
    sourceLabel: "Original",
    translatedLabel: "Translation",
    play: "Play translation",
    playing: "Playing",
    start: "Start",
    startSub: "English",
    listening: "Finish",
    listeningSub: "",
    requesting: "Connecting microphone...",
    requestingSub: "",
    processing: "Processing...",
    processingSub: "",
    listeningFeedback: "Listening now. Please speak.",
    micRequesting: "Requesting microphone permission...",
    micConnected: "Microphone connected. Listening...",
    micDenied: "Microphone permission is not enabled. Please allow microphone access.",
    sourcePlaceholder: "Choose a direction, then tap the round button below.",
    translatedPlaceholder: "The translation will appear here.",
    listeningSource: "Listening now. Please speak.",
    translating: "Translating...",
    noSpeech: "No clear speech recognized. Please try again.",
    noTranslation: "Please try again before viewing the translation.",
    speechNotSupported: "Speech recognition is not supported in this browser. Please try Safari or Chrome."
  }
};

let currentMode = "chinese";
let isListening = false;
let isProcessing = false;
let isRequestingMic = false;
let hasResult = false;
let flowTimer = null;
let micStream = null;
let audioContext = null;
let analyser = null;
let audioSource = null;
let volumeData = null;
let volumeFrame = null;
let micHintType = null;
let recognition = null;
let recognitionEndTimer = null;
let recognitionStarted = false;

// Speech recognition result accumulation — multi-layered for iOS/webkit resilience.
// These are ONLY reset in startRecognition() (new recording start), never during stop/cleanup.
let finalTranscript = "";
let latestInterimTranscript = "";
let latestRecognizedDraft = "";
let lastDisplayedTranscript = "";
let lastError = "";

// Build list of non-real-transcript values for the current mode.
function getNonTranscriptValues() {
  const t = uiText[currentMode];
  return [
    t.sourcePlaceholder,
    t.listeningSource,
    t.noSpeech,
    t.speechNotSupported,
    t.translating
  ];
}

function clearFlowTimer() {
  if (flowTimer) {
    clearTimeout(flowTimer);
    flowTimer = null;
  }
}

function clearRecognitionEndTimer() {
  if (recognitionEndTimer) {
    clearTimeout(recognitionEndTimer);
    recognitionEndTimer = null;
  }
}

function updateDebug() {
  if (!debugLine) return;
  debugLine.textContent =
    "sup=" + speechSupported +
    " started=" + recognitionStarted +
    " final=" + finalTranscript.length +
    " inter=" + latestInterimTranscript.length +
    " draft=" + latestRecognizedDraft.length +
    " disp=" + lastDisplayedTranscript.length +
    " err=" + lastError;
}

function updateMainButton() {
  const isChineseMode = currentMode === "chinese";
  const text = uiText[currentMode];

  modeChinese.classList.toggle("is-active", isChineseMode);
  modeEnglish.classList.toggle("is-active", !isChineseMode);
  mainSpeakButton.classList.toggle("is-pressed", isListening);
  listeningFeedback.classList.toggle("is-visible", isListening);
  listeningFeedback.setAttribute("aria-hidden", String(!isListening));
  sourceLabel.textContent = text.sourceLabel;
  translatedLabel.textContent = text.translatedLabel;
  listeningFeedbackText.textContent = text.listeningFeedback;

  if (isListening) {
    mainSpeakText.textContent = text.listening;
    mainSpeakDirection.textContent = text.listeningSub;
    return;
  }

  if (isRequestingMic) {
    mainSpeakText.textContent = text.requesting;
    mainSpeakDirection.textContent = text.requestingSub;
    return;
  }

  if (isProcessing) {
    mainSpeakText.textContent = text.processing;
    mainSpeakDirection.textContent = text.processingSub;
    return;
  }

  mainSpeakText.textContent = text.start;
  mainSpeakDirection.textContent = text.startSub;
  playButton.textContent = text.play;
}

function setMicHint(text, isWarning = false, type = null) {
  micHintType = type;
  micHint.textContent = text;
  micHint.classList.toggle("is-warning", isWarning);
}

function setMicLevel(level) {
  const normalized = Math.max(0, Math.min(level, 1));
  document.documentElement.style.setProperty("--mic-level", normalized.toFixed(3));
}

function readVolume() {
  if (!analyser || !volumeData) {
    return;
  }

  analyser.getByteTimeDomainData(volumeData);

  let sum = 0;
  for (const value of volumeData) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / volumeData.length);
  const level = Math.min(rms * 5.5, 1);
  setMicLevel(level);
  volumeFrame = requestAnimationFrame(readVolume);
}

async function stopMicrophone() {
  if (volumeFrame) {
    cancelAnimationFrame(volumeFrame);
    volumeFrame = null;
  }

  if (micStream) {
    for (const track of micStream.getTracks()) {
      track.stop();
    }
    micStream = null;
  }

  if (audioContext) {
    try {
      await audioContext.close();
    } catch (error) {
      // Some mobile browsers may close an AudioContext that is already closing.
    }
  }

  audioContext = null;
  analyser = null;
  audioSource = null;
  volumeData = null;
  setMicLevel(0);
}

async function connectMicrophone() {
  const mediaDevices = navigator.mediaDevices;

  if (!mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }

  micStream = await mediaDevices.getUserMedia({ audio: true });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("audio-context-unsupported");
  }

  audioContext = new AudioContextClass();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  audioSource = audioContext.createMediaStreamSource(micStream);
  audioSource.connect(analyser);
  volumeData = new Uint8Array(analyser.frequencyBinCount);
  readVolume();
}

function updateSourceDisplay() {
  const displayed = finalTranscript + latestInterimTranscript;
  if (displayed) {
    sourceText.textContent = displayed;
    lastDisplayedTranscript = displayed;
  }
}

function startRecognition() {
  if (!speechSupported) {
    recognitionStarted = false;
    updateDebug();
    return;
  }

  // Reset all transcript layers ONLY at the start of a new recording.
  finalTranscript = "";
  latestInterimTranscript = "";
  latestRecognizedDraft = "";
  lastDisplayedTranscript = "";
  lastError = "";
  recognitionStarted = false;

  const lang = currentMode === "chinese" ? "zh-CN" : "en-US";

  recognition = new SpeechRecognition();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = (event) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
        latestInterimTranscript = "";
      } else {
        interim += transcript;
      }
    }

    if (interim) {
      latestInterimTranscript = interim;
    }

    // Save any non-empty transcript as draft, regardless of final/interim.
    const currentText = finalTranscript + latestInterimTranscript;
    if (currentText) {
      latestRecognizedDraft = currentText;
    }

    updateSourceDisplay();
    updateDebug();
  };

  recognition.onerror = (event) => {
    lastError = event.error;
    updateDebug();
    // iOS/webkit may fire no-speech, aborted, network after partial results.
    // Do NOT overwrite sourceText. Do NOT treat as failure if we already have text.
  };

  recognition.onend = () => {
    recognitionStarted = false;
    updateDebug();
    // Recognition ended (either naturally or via stop()).
    // Clear the fallback timer since onend fired.
    clearRecognitionEndTimer();
    // Clean up engine callbacks and reference — NOT the text variables.
    cleanupRecognition();
    // Determine final text and run translation flow.
    finishRecognitionResult();
  };

  try {
    recognition.start();
    recognitionStarted = true;
  } catch (error) {
    lastError = "start-exception: " + error.message;
    recognitionStarted = false;
  }
  updateDebug();
}

// Cleanup only clears recognition engine references. Never clears text variables.
function cleanupRecognition() {
  if (recognition) {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition = null;
  }
}

// Best-effort extraction of the recognized text, with multiple-layer fallback for iOS/webkit.
function resolveFinalSourceText(capturedBeforeStop) {
  const nonTranscripts = getNonTranscriptValues();

  // a. finalTranscript — clean final results from engine
  if (finalTranscript) {
    return finalTranscript;
  }

  // b. latestInterimTranscript — last interim text from engine
  if (latestInterimTranscript) {
    return latestInterimTranscript;
  }

  // c. latestRecognizedDraft — any non-empty transcript seen during recording
  if (latestRecognizedDraft) {
    return latestRecognizedDraft;
  }

  // d. lastDisplayedTranscript — whatever was shown in sourceText during recording
  if (lastDisplayedTranscript) {
    return lastDisplayedTranscript;
  }

  // e. capturedBeforeStop — sourceText read by stopListening before stopping recognition
  if (capturedBeforeStop && !nonTranscripts.includes(capturedBeforeStop)) {
    return capturedBeforeStop;
  }

  // Nothing — will trigger no-speech message.
  return "";
}

function finishRecognitionResult(capturedBeforeStop) {
  const text = uiText[currentMode];
  const resolved = resolveFinalSourceText(capturedBeforeStop);

  if (resolved) {
    // Recognition succeeded — store as finalTranscript for downstream use.
    finalTranscript = resolved;
    sourceText.textContent = resolved;
    // Pass the resolved text directly to runMockTranslation to avoid any race.
    runMockTranslation(resolved);
  } else if (!speechSupported) {
    sourceText.textContent = text.speechNotSupported;
    runMockTranslation("");
  } else {
    sourceText.textContent = text.noSpeech;
    runMockTranslation("");
  }
}

function stopRecognition(capturedSourceText) {
  if (!recognition) {
    return;
  }

  // Override onend to carry capturedSourceText through to finishRecognitionResult.
  recognition.onend = () => {
    recognitionStarted = false;
    updateDebug();
    clearRecognitionEndTimer();
    cleanupRecognition();
    finishRecognitionResult(capturedSourceText);
  };

  try {
    recognition.stop();
  } catch (error) {
    // May already be stopped.
  }

  // Fallback: if onend doesn't fire within 1000ms, force cleanup and finish.
  clearRecognitionEndTimer();
  recognitionEndTimer = setTimeout(() => {
    cleanupRecognition();
    finishRecognitionResult(capturedSourceText);
  }, 1000);
}

function resetContent() {
  clearFlowTimer();
  clearRecognitionEndTimer();
  // Stop recognition engine before cleaning up callbacks.
  if (recognition) {
    try { recognition.stop(); } catch (error) { /* ignore */ }
  }
  cleanupRecognition();
  stopMicrophone();
  isListening = false;
  isProcessing = false;
  isRequestingMic = false;
  hasResult = false;
  recognitionStarted = false;
  finalTranscript = "";
  latestInterimTranscript = "";
  latestRecognizedDraft = "";
  lastDisplayedTranscript = "";
  lastError = "";
  setMicHint("");
  sourceText.textContent = uiText[currentMode].sourcePlaceholder;
  translatedText.textContent = uiText[currentMode].translatedPlaceholder;
  playButton.disabled = true;
  playButton.textContent = uiText[currentMode].play;
  updateMainButton();
  updateDebug();
}

function runMockTranslation(recognizedSourceText) {
  const text = uiText[currentMode];
  const hasRecognized = recognizedSourceText.length > 0;

  isProcessing = true;
  setMicHint("");
  mainSpeakButton.disabled = true;
  updateMainButton();

  if (hasRecognized) {
    // Recognition succeeded — show recognized text and mock translation.
    sourceText.textContent = recognizedSourceText;
    translatedText.textContent = text.translating;
    playButton.disabled = true;

    flowTimer = setTimeout(() => {
      translatedText.textContent = samples[currentMode].translated;
      playButton.disabled = false;
      mainSpeakButton.disabled = false;
      isProcessing = false;
      hasResult = true;
      flowTimer = null;
      updateMainButton();
    }, 750);
  } else {
    // Recognition failed — show failure message, no translation.
    translatedText.textContent = text.noTranslation;
    playButton.disabled = true;
    mainSpeakButton.disabled = false;
    isProcessing = false;
    hasResult = false;
    updateMainButton();
  }
}

async function startListening() {
  clearFlowTimer();
  clearRecognitionEndTimer();

  isRequestingMic = true;
  setMicHint(uiText[currentMode].micRequesting, false, "requesting");
  playButton.disabled = true;
  updateMainButton();

  try {
    await connectMicrophone();
    isListening = true;
    // Show "listening" in source area while recording.
    sourceText.textContent = uiText[currentMode].listeningSource;
    if (speechSupported) {
      setMicHint(uiText[currentMode].micConnected, false, "connected");
    } else {
      setMicHint(uiText[currentMode].speechNotSupported, true, "unsupported");
    }
    startRecognition();
  } catch (error) {
    await stopMicrophone();
    setMicHint(uiText[currentMode].micDenied, true, "denied");
  } finally {
    isRequestingMic = false;
    updateMainButton();
  }
}

async function stopListening() {
  isListening = false;
  setMicHint("");

  // Capture sourceText BEFORE stopping recognition, in case engine callbacks
  // overwrite it during the stop sequence.
  const capturedSourceText = sourceText.textContent.trim();

  stopRecognition(capturedSourceText);
  await stopMicrophone();
  updateMainButton();
  // runMockTranslation is called from finishRecognitionResult after recognition ends.
}

function setMode(mode) {
  if (isListening || isProcessing || isRequestingMic || currentMode === mode) {
    return;
  }

  currentMode = mode;
  if (hasResult) {
    sourceText.textContent = samples[currentMode].source;
    translatedText.textContent = samples[currentMode].translated;
    playButton.disabled = false;
  } else {
    sourceText.textContent = uiText[currentMode].sourcePlaceholder;
    translatedText.textContent = uiText[currentMode].translatedPlaceholder;
    playButton.disabled = true;
  }

  if (micHintType === "denied") {
    setMicHint(uiText[currentMode].micDenied, true, "denied");
  }
  updateMainButton();
}

function enterTranslator() {
  introModal.classList.add("is-hidden");
  homeView.classList.add("is-hidden");
  translatorView.classList.remove("is-hidden");
  resetContent();
}

startButton.addEventListener("click", () => {
  introModal.classList.remove("is-hidden");
});

confirmStartButton.addEventListener("click", enterTranslator);

modeChinese.addEventListener("click", () => setMode("chinese"));
modeEnglish.addEventListener("click", () => setMode("english"));

mainSpeakButton.addEventListener("click", () => {
  if (isProcessing || isRequestingMic) {
    return;
  }

  if (isListening) {
    stopListening();
    return;
  }

  startListening();
});

playButton.addEventListener("click", () => {
  if (playButton.disabled) {
    return;
  }

  playButton.disabled = true;
  playButton.textContent = uiText[currentMode].playing;

  setTimeout(() => {
    playButton.textContent = uiText[currentMode].play;
    playButton.disabled = false;
  }, 1200);
});

updateMainButton();
updateDebug();
