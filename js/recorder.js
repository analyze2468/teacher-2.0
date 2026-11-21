/**
 * 录音封装（MediaRecorder）
 * 支持：
 * 1) 麦克风权限申请与错误提示；
 * 2) 兼容 webm / mp4 等容器；
 * 3) 实时音量（用于波形条）与时长回调；
 * 4) 到最大时长自动停止；
 * 5) 可选：并行调用浏览器语音识别生成文字稿（国内部分机型不可用，需降级为手动输入）。
 */

export function isRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function isSpeechRecognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function createRecorder({
  maxSeconds = 120,
  onTick,
  onLevel,
  onState,
  onTranscript,
  onError
} = {}) {
  let state = 'idle';
  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let duration = 0;
  let tickId = null;
  let rafId = null;
  let audioContext = null;
  let analyser = null;
  let recognition = null;
  let transcript = '';
  let stopResolver = null;

  function setState(next) {
    state = next;
    if (typeof onState === 'function') onState(next);
  }

  function startRecognition() {
    if (!isSpeechRecognitionSupported()) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      recognition = new Recognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) finalText += result[0].transcript;
          else interimText += result[0].transcript;
        }
        if (finalText) transcript += finalText;
        if (typeof onTranscript === 'function') {
          onTranscript({ final: transcript, interim: interimText, text: transcript + interimText });
        }
      };
      recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (typeof onTranscript === 'function') {
          onTranscript({ final: transcript, interim: '', text: transcript, error: event.error });
        }
      };
      recognition.onend = () => {
        // 录音仍在进行时保持连续识别
        if (state === 'recording') {
          try {
            recognition.start();
          } catch (error) {
            console.warn('[recorder] 语音识别重启失败', error);
          }
        }
      };
      recognition.start();
    } catch (error) {
      console.warn('[recorder] 语音识别不可用', error);
      recognition = null;
    }
  }

  function stopRecognition() {
    if (!recognition) return;
    try {
      recognition.stop();
    } catch (error) {
      console.warn('[recorder] 停止语音识别失败', error);
    }
    recognition = null;
  }

  function setupMeter(mediaStream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          const value = (buffer[index] - 128) / 128;
          sum += value * value;
        }
        const level = Math.min(1, Math.sqrt(sum / buffer.length) * 3);
        if (typeof onLevel === 'function') onLevel(level);
        rafId = requestAnimationFrame(loop);
      };
      loop();
      audioContext.resume?.().catch(() => {});
    } catch (error) {
      console.warn('[recorder] 音量分析不可用', error);
    }
  }

  function teardownMeter() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    analyser = null;
    if (audioContext) {
      audioContext.close?.().catch(() => {});
      audioContext = null;
    }
  }

  function teardownStream() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  function finalize() {
    if (tickId) clearInterval(tickId);
    tickId = null;
    stopRecognition();
    teardownMeter();
    teardownStream();
    const mimeType = recorder?.mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const result = {
      blob,
      url,
      seconds: Math.max(0, Math.floor(duration)),
      duration: Math.round(duration * 10) / 10,
      mimeType,
      size: blob.size,
      transcript: transcript.trim()
    };
    setState('stopped');
    if (stopResolver) {
      stopResolver(result);
      stopResolver = null;
    }
    return result;
  }

  async function start({ withTranscript = false } = {}) {
    if (state === 'recording' || state === 'requesting') return;
    if (!isRecordingSupported()) {
      const error = new Error('当前浏览器不支持录音，请改用文字作答');
      error.code = 'unsupported';
      if (typeof onError === 'function') onError(error);
      throw error;
    }
    setState('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      setState('error');
      const reason = error?.name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请在浏览器设置中允许录音'
        : `无法访问麦克风：${error?.message || '未知错误'}`;
      const wrapped = new Error(reason);
      wrapped.code = error?.name || 'unknown';
      if (typeof onError === 'function') onError(wrapped);
      throw wrapped;
    }

    const mimeType = pickMimeType();
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      console.warn('[recorder] 指定格式失败，使用默认格式', error);
      recorder = new MediaRecorder(stream);
    }

    chunks = [];
    transcript = '';
    duration = 0;
    startedAt = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      const error = new Error(`录音出错：${event.error?.name || 'unknown'}`);
      if (typeof onError === 'function') onError(error);
    };
    recorder.onstop = finalize;
    recorder.start(200);
    setupMeter(stream);
    setState('recording');
    tickId = setInterval(() => {
      duration = Math.min(maxSeconds, (Date.now() - startedAt) / 1000);
      if (typeof onTick === 'function') {
        onTick({
          seconds: Math.floor(duration),
          remaining: Math.max(0, maxSeconds - Math.floor(duration)),
          limit: maxSeconds
        });
      }
      if (duration >= maxSeconds) stop();
    }, 200);
    if (withTranscript) startRecognition();
  }

  function stop() {
    if (state !== 'recording') return Promise.resolve(null);
    setState('stopping');
    return new Promise((resolve) => {
      stopResolver = resolve;
      try {
        recorder.requestData?.();
      } catch (error) {
        console.warn('[recorder] requestData 失败', error);
      }
      try {
        recorder.stop();
      } catch (error) {
        console.warn('[recorder] 停止录音失败', error);
        finalize();
      }
    });
  }

  async function cancel() {
    if (state === 'recording') {
      try {
        recorder.onstop = null;
        recorder.stop();
      } catch (error) {
        console.warn('[recorder] 取消录音失败', error);
      }
    }
    if (tickId) clearInterval(tickId);
    tickId = null;
    stopRecognition();
    teardownMeter();
    teardownStream();
    chunks = [];
    duration = 0;
    transcript = '';
    setState('idle');
  }

  function dispose() {
    cancel();
    recorder = null;
  }

  return {
    start,
    stop,
    cancel,
    dispose,
    getState: () => state,
    isRecording: () => state === 'recording',
    getTranscript: () => transcript
  };
}
