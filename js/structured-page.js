/**
 * 结构化面试 · 单题作答页
 * 流程：题干 → 2 分钟计时 → 作答（文字 / 录音转写）→ 提交评分（六维）
 * 答题模板已独立到 structured-template.html，本页不展示任何模板内容。
 * 评分优先走 AI（已配置且可用），失败或未配置时降级为本机规则评分。
 */

import { $, countChars, toast, setButtonLoading, beep, scrollToElement } from './utils.js';
import { loadStructuredQuestions, loadStructuredTemplates } from './data-loader.js';
import { createCountdown } from './timer.js';
import { localStructuredScore, normalizeResult, renderScoreCard, snapshotResult } from './scoring.js';
import { mountAskAi } from './ask-ai.js';
import { isLlmConfigured, scoreStructured } from './llm.js';
import { ensureSettingsDialog } from './settings.js';
import { createRecorder, isRecordingSupported, isSpeechRecognitionSupported } from './recorder.js';
import { bindVoiceButton } from './hold-talk.js';
import { setupPhotoUpload } from './photo-upload.js';
import { saveAttempt, lastPractice } from './storage.js';
import { findTemplateByKey, questionsOfType } from './structured-nav.js';

ensureSettingsDialog();

/** 固定 2 分钟作答 */
const LIMIT_SECONDS = 120;

const state = {
  questions: [],
  types: [],
  rubric: null,
  question: null,
  type: null,
  pool: [],
  timer: null,
  scoring: false
};

const params = new URLSearchParams(location.search);

function renderQuestion() {
  const item = state.question;
  if (!item) return;
  const level = Math.max(1, Math.min(3, Number(item.difficulty) || 1));
  $('#q-type').textContent = item.type || '未分类';
  $('#q-text').textContent = item.question || '';
  $('#q-meta').textContent = `难度 ${'★'.repeat(level)}${'☆'.repeat(3 - level)} · ${LIMIT_SECONDS / 60} 分钟 · 六维评分`;
  document.title = `${item.type || '结构化'} · 限时作答 · 教资面试陪跑`;
}

/** 换题只在同题型内抽；找不到同题型时退回全题库 */
function refreshPool() {
  const type = findTemplateByKey(state.types, state.question?.type) || null;
  state.type = type;
  const same = type ? questionsOfType(state.questions, type) : [];
  state.pool = same.length ? same : state.questions;

  const back = $('#btn-back');
  if (back) back.href = type ? `structured-list.html?type=${encodeURIComponent(type.id)}` : 'structured-hub.html';
  $('#page-title').textContent = type ? `${type.name.replace(/类$/, '')} · 限时作答` : '结构化 · 限时作答';
}

function selectQuestion(item) {
  state.question = item;
  renderQuestion();
  refreshPool();
}

function pickAnother() {
  const pool = state.pool.length ? state.pool : state.questions;
  if (!pool.length) return null;
  const rest = pool.filter((item) => item.id !== state.question?.id);
  if (!rest.length) return pool[0];
  return rest[Math.floor(Math.random() * rest.length)];
}

/** 首题定位：优先 ?id=，其次 ?type=（该题型第一题），最后取题库第一题 */
function resolveInitial() {
  const wantedId = params.get('id');
  const byId = wantedId ? state.questions.find((item) => item.id === wantedId) : null;
  if (byId) return byId;
  const type = findTemplateByKey(state.types, params.get('type'));
  const pool = type ? questionsOfType(state.questions, type) : [];
  return pool[0] || state.questions[0] || null;
}

async function init() {
  try {
    const [questionData, templateData] = await Promise.all([
      loadStructuredQuestions(),
      loadStructuredTemplates()
    ]);
    state.questions = Array.isArray(questionData) ? questionData : questionData.items || [];
    state.types = Array.isArray(templateData.types) ? templateData.types : [];
    state.rubric = templateData.rubric?.structured || null;

    if (!state.questions.length) throw new Error('题库为空');
    if (!state.rubric) throw new Error('缺少评分维度配置');

    const initial = resolveInitial();
    if (!initial) throw new Error('没有可用的题目');
    selectQuestion(initial);
  } catch (error) {
    $('#q-text').textContent = `题库加载失败：${error.message}`;
    $('#q-type').textContent = '加载失败';
    $('#q-meta').textContent = '';
    toast('题库加载失败，请确认已用本地服务器打开', { type: 'error' });
    console.error('[structured] 加载失败', error);
  }
}

/* ----------------------------- 录音 ----------------------------- */

let recorder = null;
let recording = false;
let pendingStop = false;

function setupRecorder() {
  const button = $('#btn-record');
  if (!button) return;
  if (!isRecordingSupported()) {
    button.disabled = true;
    button.textContent = '当前浏览器不支持录音';
    button.classList.add('opacity-60');
    return;
  }
  if (!isSpeechRecognitionSupported()) {
    $('#rec-hint').textContent = '当前浏览器不支持语音转写，录音后请手动补文字';
  }
  recorder = createRecorder({
    maxSeconds: LIMIT_SECONDS,
    onState(next) {
      recording = next === 'recording';
      const labels = {
        idle: '未录音',
        requesting: '请求麦克风…',
        recording: '录音中…',
        stopping: '保存中…',
        stopped: '已生成音频',
        error: '录音出错'
      };
      $('#rec-state').textContent = labels[next] || '未录音';
      button.textContent = recording ? '■ 停止录音' : '● 开始录音';
      // 请求麦克风时不禁用按钮：避免长按过程中禁用触发 pointercancel
      button.disabled = next === 'stopping';
      button.setAttribute('aria-busy', next === 'requesting' ? 'true' : 'false');
      button.classList.toggle('bg-rose-600', recording);
      button.classList.toggle('text-white', recording);
      button.classList.toggle('bg-rose-50', !recording);
      button.classList.toggle('text-rose-600', !recording);
      // 松手早于麦克风授权结束时，真正开录后立刻收尾
      if (next === 'recording' && pendingStop) {
        pendingStop = false;
        finishRecording();
      }
    },
    onTick({ seconds, remaining }) {
      const clock = $('#rec-time');
      if (clock) clock.textContent = `已录 ${seconds}s / 上限 ${LIMIT_SECONDS}s（剩 ${remaining}s）`;
    },
    onError(error) {
      toast(error?.message || '麦克风不可用，请检查浏览器权限', { type: 'error' });
    }
  });

  // 手机：按住说话（松手自动结束）；桌面：轻点开始 / 再点结束
  bindVoiceButton(button, {
    onTap() {
      if (recording) {
        finishRecording();
        return;
      }
      startRecording();
    },
    onHoldStart() {
      if (recording) return;
      startRecording();
    },
    onHoldEnd({ cancelled } = {}) {
      const current = recorder.getState();
      if (cancelled) {
        if (current === 'recording' || current === 'requesting') {
          pendingStop = false;
          recorder.cancel();
          toast('已取消这次录音');
        }
        return;
      }
      if (current === 'requesting') {
        pendingStop = true;
        return;
      }
      if (current === 'recording') finishRecording();
    }
  });
}

async function startRecording() {
  if (!recorder || recorder.getState() === 'recording') return;
  try {
    await recorder.start({ withTranscript: isSpeechRecognitionSupported() });
  } catch (error) {
    pendingStop = false;
    console.warn('[structured] 录音启动失败', error);
  }
}

async function finishRecording() {
  const result = await recorder?.stop();
  if (!result) return;
  const audio = $('#rec-audio');
  audio.src = result.url;
  audio.classList.remove('hidden');
  const text = String(result.transcript || '').trim();
  if (!text) {
    toast('录音已保存，可回放复盘');
    return;
  }
  const box = $('#answer-input');
  box.value = [box.value.trim(), text].filter(Boolean).join('\n');
  updateCharCount();
  toast('已把语音转写填入作答框，可再润色');
}

/* ----------------------------- 答题纸照片 ----------------------------- */

let photoUpload = null;

function setupPhoto() {
  photoUpload = setupPhotoUpload({
    input: $('#photo-input'),
    preview: $('#photo-preview'),
    status: $('#photo-state'),
    mode: 'structured',
    limit: 3,
    getContext() {
      return {
        mode: 'structured',
        questionId: state.question?.id || '',
        title: state.question?.question || ''
      };
    }
  });
}

function setupTimer() {
  state.timer = createCountdown({
    seconds: LIMIT_SECONDS,
    warnAt: 30,
    onTick({ clock, remaining, duration, isWarn, isDanger, running }) {
      const clockEl = $('#timer-clock');
      const stickyEl = $('#sticky-clock');
      clockEl.textContent = clock;
      stickyEl.textContent = clock;
      clockEl.classList.toggle('text-rose-600', isDanger);
      clockEl.classList.toggle('text-amber-600', isWarn && !isDanger);
      stickyEl.classList.toggle('text-rose-600', isDanger);

      const bar = $('#timer-bar');
      if (bar) {
        const percent = Math.max(0, Math.round((remaining / (duration || LIMIT_SECONDS)) * 100));
        bar.style.width = `${percent}%`;
        bar.classList.toggle('is-warn', isWarn && !isDanger);
        bar.classList.toggle('is-danger', isDanger);
      }

      $('#timer-state').textContent = remaining === 0
        ? '时间到'
        : isDanger
          ? '时间快到了'
          : isWarn
            ? '剩余不足 30 秒'
            : running
              ? '计时中'
              : remaining === duration
                ? '未开始'
                : '已暂停';
      $('#btn-timer-toggle').textContent = running
        ? '暂停'
        : remaining === 0
          ? '重新计时'
          : remaining === duration
            ? '开始'
            : '继续';
    },
    onEnd() {
      $('#timer-state').textContent = '时间到';
      toast('2 分钟到，先收尾再提交评分', { type: 'warning' });
      beep(2);
      if (recording) finishRecording();
    }
  });
}

function updateCharCount() {
  const text = $('#answer-input').value;
  $('#char-count').textContent = `${countChars(text)} 字`;
}

async function runScore() {
  if (state.scoring) return;
  if (!state.question || !state.rubric) {
    toast('题目尚未加载完成，请稍后再试', { type: 'warning' });
    return;
  }

  const answer = $('#answer-input').value.trim();
  const photos = photoUpload?.images?.() || [];
  // 图片评分只走多模态模型：API 不可用时图片不参与评分，也不调用 OCR
  const apiReady = isLlmConfigured();
  const images = apiReady ? photos : [];

  if (photos.length && !apiReady) {
    // 提交了图片但没配 API：弹出提示；文字够长就继续走本机规则评分，手动通路不被堵死
    toast('尚未配置大模型 API，图片评分不可用，可以手动输入答案测评', { type: 'warning' });
    if (countChars(answer) < 30) {
      $('#answer-input').focus();
      return;
    }
  }

  // 手动输入通路不变：没有可评分的图片时仍需 30 字；只传图片则由模型读图，不要求写满字数
  if (!images.length && countChars(answer) < 30) {
    toast('先写下至少 30 字的答题要点，再生成评分', { type: 'warning' });
    $('#answer-input').focus();
    return;
  }

  const buttons = [$('#btn-score'), $('#btn-sticky-score')];
  state.scoring = true;
  buttons.forEach((button) => setButtonLoading(button, true, '评分中…'));
  $('#score-status').textContent = '评分中…';

  let result = null;
  let usedAi = false;

  if (isLlmConfigured()) {
    try {
      const raw = await scoreStructured({ question: state.question, answer, rubric: state.rubric, images });
      result = normalizeResult(raw, state.rubric, 'structured');
      result.source = 'ai';
      usedAi = true;
    } catch (error) {
      console.warn('[structured] AI 评分失败，降级本机规则', error);
      toast('AI 评分失败，已改用本机规则评分', { type: 'warning' });
    }
  }

  if (!result) {
    try {
      result = localStructuredScore({ question: state.question, answer, rubric: state.rubric });
      if (result && !result.dimensions) result = normalizeResult(result, state.rubric, 'structured');
      result.source = 'local';
    } catch (error) {
      console.error('[structured] 本机评分失败', error);
      toast('评分失败，请检查题库配置', { type: 'error' });
    }
  }

  buttons.forEach((button) => setButtonLoading(button, false));

  if (!result) {
    $('#score-status').textContent = '评分失败';
    state.scoring = false;
    return;
  }

  const host = $('#score-card');
  host.innerHTML = renderScoreCard(result);
  host.classList.remove('hidden');
  // 先把这条记录写进 IndexedDB，拿到 recordId 后再挂「去 AI 追问」入口
  const recordId = await rememberAttempt(result, answer);
  mountAskAi(host, {
    mode: 'structured',
    question: state.question,
    answer,
    result,
    recordId
  });
  $('#score-status').textContent = usedAi
    ? images.length ? 'AI 读图评分完成' : 'AI 评分完成'
    : '本机规则评分（未接入 AI）';
  scrollToElement(host);
  state.scoring = false;
}

async function rememberAttempt(result, answer) {
  if (!state.question) return null;
  try {
    const recordId = await saveAttempt({
      mode: 'structured',
      questionId: state.question.id,
      title: state.question.type || '',
      excerpt: state.question.question || '',
      answer,
      total: result.total,
      level: result.level,
      source: result.source,
      dimensions: (result.dimensions || []).map((item) => ({
        key: item.key,
        name: item.name,
        score: item.score,
        max: item.max,
        comment: String(item.comment || '').trim()
      })),
      // 考官点评：记录详情展示 + AI 追问页还原评分上下文
      review: snapshotResult(result)
    });
    lastPractice.save({
      mode: 'structured',
      id: state.question.id,
      title: state.question.question || ''
    });
    return recordId;
  } catch (error) {
    console.warn('[structured] 记录保存跳过', error);
    return null;
  }
}

function bindEvents() {
  $('#btn-timer-toggle').addEventListener('click', () => state.timer?.toggle());
  $('#btn-timer-reset').addEventListener('click', () => state.timer?.reset(LIMIT_SECONDS));

  $('#btn-new-question').addEventListener('click', () => {
    const next = pickAnother();
    if (!next) return;

    // 换题：清掉上一题的录音、作答与评分，计时器回到 02:00
    const audio = $('#rec-audio');
    recorder?.cancel();
    audio.pause();
    audio.removeAttribute('src');
    audio.classList.add('hidden');
    $('#rec-state').textContent = '未录音';
    $('#rec-time').textContent = '';

    $('#answer-input').value = '';
    updateCharCount();
    $('#score-card').classList.add('hidden');
    $('#score-card').innerHTML = '';
    $('#score-status').textContent = '';

    state.timer?.reset(LIMIT_SECONDS);
    photoUpload?.reset();
    selectQuestion(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#answer-input').addEventListener('input', updateCharCount);

  $('#btn-score').addEventListener('click', runScore);
  $('#btn-sticky-score').addEventListener('click', runScore);
}

setupRecorder();
setupPhoto();
setupTimer();
bindEvents();
init();
