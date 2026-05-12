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
    start: "点击开始说中文",
    listening: "正在聆听，点击结束",
    requesting: "正在连接麦克风...",
    processing: "正在处理...",
    listeningFeedback: "正在聆听，现在可以说话",
    micRequesting: "正在请求麦克风权限...",
    micConnected: "麦克风已连接，正在聆听",
    micDenied: "麦克风权限未开启，请允许浏览器使用麦克风",
    sourcePlaceholder: "选择方向后，点击下方圆形按钮。",
    translatedPlaceholder: "译文会显示在这里。",
    recognizing: "正在整理模拟识别结果...",
    translating: "正在翻译..."
  },
  english: {
    sourceLabel: "Original",
    translatedLabel: "Translation",
    play: "Play translation",
    playing: "Playing",
    start: "Tap to speak English",
    listening: "Listening... Tap to finish",
    requesting: "Connecting microphone...",
    processing: "Processing...",
    listeningFeedback: "Listening now. Please speak.",
    micRequesting: "Requesting microphone permission...",
    micConnected: "Microphone connected. Listening...",
    micDenied: "Microphone permission is not enabled. Please allow microphone access.",
    sourcePlaceholder: "Choose a direction, then tap the round button below.",
    translatedPlaceholder: "The translation will appear here.",
    recognizing: "Preparing simulated recognition result...",
    translating: "Translating..."
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

function clearFlowTimer() {
  if (flowTimer) {
    clearTimeout(flowTimer);
    flowTimer = null;
  }
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
  mainSpeakDirection.textContent = isChineseMode ? "→ English" : "→ 中文";

  if (isListening) {
    mainSpeakText.textContent = text.listening;
    return;
  }

  if (isRequestingMic) {
    mainSpeakText.textContent = text.requesting;
    return;
  }

  if (isProcessing) {
    mainSpeakText.textContent = text.processing;
    return;
  }

  mainSpeakText.textContent = text.start;
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
  document.documentElement.style.setProperty("--mic-glow", (0.35 + normalized * 0.55).toFixed(3));
  document.documentElement.style.setProperty("--mic-glow-scale", (0.98 + normalized * 0.12).toFixed(3));
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

function resetContent() {
  clearFlowTimer();
  stopMicrophone();
  isListening = false;
  isProcessing = false;
  isRequestingMic = false;
  hasResult = false;
  setMicHint("");
  sourceText.textContent = uiText[currentMode].sourcePlaceholder;
  translatedText.textContent = uiText[currentMode].translatedPlaceholder;
  playButton.disabled = true;
  playButton.textContent = uiText[currentMode].play;
  updateMainButton();
}

function runMockFlow(language) {
  const sample = samples[language];

  isProcessing = true;
  const text = uiText[language];
  setMicHint("");
  playButton.disabled = true;
  mainSpeakButton.disabled = true;
  sourceText.textContent = text.recognizing;
  translatedText.textContent = text.translating;
  updateMainButton();

  flowTimer = setTimeout(() => {
    sourceText.textContent = sample.source;

    flowTimer = setTimeout(() => {
      translatedText.textContent = sample.translated;
      playButton.disabled = false;
      mainSpeakButton.disabled = false;
      isProcessing = false;
      hasResult = true;
      flowTimer = null;
      updateMainButton();
    }, 750);
  }, 750);
}

async function startListening() {
  clearFlowTimer();
  isRequestingMic = true;
  setMicHint(uiText[currentMode].micRequesting, false, "requesting");
  playButton.disabled = true;
  updateMainButton();

  try {
    await connectMicrophone();
    isListening = true;
    setMicHint(uiText[currentMode].micConnected, false, "connected");
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
  await stopMicrophone();
  updateMainButton();
  runMockFlow(currentMode);
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
