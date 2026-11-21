/**
 * 数学试讲页（初中 / 高中题库可切换）
 * 模块：课题 → 流程与板书 → 计时讲稿 → 评分反馈
 * 评分优先走 AI（已配置且可用），失败或未配置时降级为本机规则评分。
 */

import { $, escapeHtml, countChars, toast, setButtonLoading, beep, scrollToElement } from './utils.js';
import { loadMathQuestions, loadMathOutline, loadStructuredTemplates } from './data-loader.js';
import { resolveMathBoard } from './template-store.js';
import { createCountdown } from './timer.js';
import { localTrialScore, normalizeResult, renderScoreCard, snapshotResult } from './scoring.js';
import { mountAskAi } from './ask-ai.js';
import { isLlmConfigured, scoreTrial } from './llm.js';
import { ensureSettingsDialog } from './settings.js';
import { createRecorder, isRecordingSupported, isSpeechRecognitionSupported } from './recorder.js';
import { bindVoiceButton } from './hold-talk.js';
import { setupPhotoUpload } from './photo-upload.js';
import { saveAttempt, lastPractice } from './storage.js';

ensureSettingsDialog();

const LIMIT_SECONDS = 600;
const STAGE_KEY = 'pb.mathStage';
const state = {
  allQuestions: [],
  questions: [],
  stage: 'junior',
  boards: [],
  outline: null,
  rubric: null,
  question: null,
  board: null,
  timer: null,
  scoring: false
};

const params = new URLSearchParams(location.search);

/** 学段判定：优先取题目里的 stage 字段，缺失时按教材名推断 */
function stageOf(item) {
  if (!item) return 'junior';
  if (item.stage === 'senior' || item.stage === 'junior') return item.stage;
  return /^(必修|选择性必修)/.test(String(item.grade || '')) ? 'senior' : 'junior';
}

function poolOf(stage) {
  const list = state.allQuestions.filter((item) => stageOf(item) === stage);
  return list.length ? list : state.allQuestions;
}

function readStoredStage() {
  try {
    return localStorage.getItem(STAGE_KEY) === 'senior' ? 'senior' : 'junior';
  } catch (error) {
    return 'junior';
  }
}

/** 学段切换按钮与提示条 */
function paintStage() {
  const senior = state.stage === 'senior';
  const title = $('#page-title');
  if (title) title.textContent = senior ? '高中数学试讲' : '初中数学试讲';

  document.querySelectorAll('#stage-tabs [data-stage]').forEach((button) => {
    const active = button.dataset.stage === state.stage;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.classList.toggle('bg-emerald-600', active);
    button.classList.toggle('text-white', active);
    button.classList.toggle('active:bg-emerald-700', active);
    button.classList.toggle('text-slate-600', !active);
    button.classList.toggle('active:bg-slate-100', !active);
  });

  const hint = $('#stage-hint');
  if (hint) {
    const juniorCount = state.allQuestions.filter((item) => stageOf(item) === 'junior').length;
    const seniorCount = state.allQuestions.filter((item) => stageOf(item) === 'senior').length;
    hint.textContent = `初中 ${juniorCount} 个课题 · 高中 ${seniorCount} 个课题 · 「换一题」只在当前学段内抽题`;
  }
}

/** 切换学段：刷新题库、标题与按钮，并换一道题 */
function applyStage(stage, options = {}) {
  state.stage = stage === 'senior' ? 'senior' : 'junior';
  state.questions = poolOf(state.stage);
  try {
    localStorage.setItem(STAGE_KEY, state.stage);
  } catch (error) {
    /* 隐私模式下忽略 */
  }
  paintStage();
  if (options.pick !== false) selectQuestion(pickAnother());
  if (options.announce) toast(state.stage === 'senior' ? '已切换到高中题库' : '已切换到初中题库');
}


function findBoard(item) {
  const base = state.boards.find((board) => board.id === item?.boardId)
    || state.boards.find((board) => board.name === item?.board)
    || state.boards[0]
    || null;
  return base ? resolveMathBoard(base) : null;
}

function renderTopic() {
  const item = state.question;
  if (!item) return;
  $('#m-board').textContent = item.board || '未分类';
  $('#m-title').textContent = item.title || '未命名课题';
  $('#m-meta').textContent = [item.grade, item.source, `难度 ${'★'.repeat(Number(item.difficulty) || 1)}`]
    .filter(Boolean)
    .join(' · ');
  $('#m-question').textContent = item.question || '';

  const fill = (selector, list) => {
    $(selector).innerHTML = (list || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  };
  fill('#m-objectives', item.objectives);
  fill('#m-keypoints', item.keyPoints);
  fill('#m-difficulties', item.difficulties);

  $('#m-detail').classList.add('hidden');
  $('#btn-toggle-detail').textContent = '展开教学目标与重难点';
  document.title = `${item.title || '试讲'} · 教资面试陪跑`;
}

function renderBoardTemplate(board) {
  state.board = board;
  if (!board) {
    $('#tpl-summary').textContent = '暂未找到该板块模板。';
    $('#tpl-process').innerHTML = '';
    $('#tpl-board').textContent = '';
    $('#tpl-phrases').innerHTML = '';
    return;
  }

  const template = board.template || {};
  $('#tpl-source').textContent = board.isUser ? '我的模板' : '内置模板';
  $('#tpl-summary').textContent = board.summary || '';

  const steps = (template.process || [])
    .map((line) => `<li class="rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-700">${escapeHtml(line)}</li>`)
    .join('');
  const hints = (state.question?.processHint || [])
    .map((line) => `<li class="rounded-lg bg-emerald-50/70 px-2.5 py-1.5 text-emerald-900">${escapeHtml(line)}</li>`)
    .join('');
  $('#tpl-process').innerHTML = steps + hints;

  $('#tpl-board').innerHTML = [
    template.board ? `<span class="block">${escapeHtml(template.board)}</span>` : '',
    state.question?.boardPlan ? `<span class="mt-1.5 block text-emerald-800">本题板书：${escapeHtml(state.question.boardPlan)}</span>` : ''
  ].join('');

  $('#tpl-phrases').innerHTML = (template.phrases || [])
    .map((line) => `<li class="rounded-lg bg-brand-50/60 px-2.5 py-1.5 text-slate-700">${escapeHtml(line)}</li>`)
    .join('');
}

function selectQuestion(item) {
  state.question = item;
  renderTopic();
  renderBoardTemplate(findBoard(item));
}

function pickAnother() {
  if (state.questions.length < 2) return state.questions[0] || null;
  const rest = state.questions.filter((item) => item.id !== state.question?.id);
  return rest[Math.floor(Math.random() * rest.length)];
}

async function init() {
  try {
    const [questionData, outlineData, templateData] = await Promise.all([
      loadMathQuestions(),
      loadMathOutline(),
      loadStructuredTemplates()
    ]);
    state.allQuestions = Array.isArray(questionData) ? questionData : questionData.items || [];
    state.outline = outlineData;
    state.boards = Array.isArray(outlineData.boards) ? outlineData.boards : [];
    state.rubric = templateData.rubric?.trial || null;

    if (!state.allQuestions.length) throw new Error('课题库为空');
    if (!state.rubric) throw new Error('缺少试讲评分维度配置');

    // 学段优先级：URL > 指定题目所属学段 > 上次选择 > 初中
    const wantedId = params.get('id');
    const wanted = state.allQuestions.find((item) => item.id === wantedId) || null;
    const wantedStage = params.get('stage') || (wanted ? stageOf(wanted) : readStoredStage());
    state.stage = wantedStage === 'senior' ? 'senior' : 'junior';
    state.questions = poolOf(state.stage);
    paintStage();

    const matched = wanted && stageOf(wanted) === state.stage ? wanted : null;
    selectQuestion(matched || pickAnother());
  } catch (error) {
    $('#m-title').textContent = `课题加载失败：${error.message}`;
    $('#m-board').textContent = '加载失败';
    toast('课题加载失败，请确认已用本地服务器打开', { type: 'error' });
    console.error('[math] 加载失败', error);
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
  recorder = createRecorder({
    maxSeconds: LIMIT_SECONDS,
    onState(next) {
      recording = next === 'recording';
      const labels = {
        idle: '未录音',
        requesting: '请求麦克风…',
        recording: '录音中…',
        stopping: '保存中…',
        stopped: '已录音',
        error: '录音出错'
      };
      $('#rec-state').textContent = labels[next] || '未录音';
      button.textContent = recording ? '■ 停止录音' : '● 开始录音';
      // 请求麦克风时不禁用按钮：避免长按过程中禁用触发 pointercancel，
      // 导致「按住说话」被误判成取消
      button.disabled = next === 'stopping';
      button.setAttribute('aria-busy', next === 'requesting' ? 'true' : 'false');
      button.classList.toggle('bg-rose-600', recording);
      button.classList.toggle('text-white', recording);
      button.classList.toggle('bg-rose-50', !recording);
      button.classList.toggle('text-rose-600', !recording);
      // 用户松手比麦克风授权更快时，等真正开录后再立刻收尾
      if (next === 'recording' && pendingStop) {
        pendingStop = false;
        finishRecording();
      }
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
        // 手指滑走 = 放弃这一条
        if (current === 'recording' || current === 'requesting') {
          pendingStop = false;
          recorder.cancel();
          toast('已取消这次录音');
        }
        return;
      }
      if (current === 'requesting') {
        // 授权弹窗还没关就松手了，等真正开录后立即收尾
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
    console.warn('[math] 录音启动失败', error);
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
  const box = $('#notes-input');
  box.value = [box.value.trim(), text].filter(Boolean).join('\n');
  updateCharCount();
  toast('已把语音转写填入讲稿框，可再润色');
}

/* ----------------------------- 板书照片 ----------------------------- */

let photoUpload = null;

function setupPhoto() {
  photoUpload = setupPhotoUpload({
    input: $('#photo-input'),
    preview: $('#photo-preview'),
    status: $('#photo-state'),
    mode: 'math',
    limit: 3,
    getContext() {
      return {
        mode: 'math',
        questionId: state.question?.id || '',
        title: state.question?.title || ''
      };
    }
  });
}

function setupTimer() {
  state.timer = createCountdown({
    seconds: LIMIT_SECONDS,
    warnAt: 60,
    onTick({ clock, isWarn, isDanger, running }) {
      const clockEl = $('#timer-clock');
      const stickyEl = $('#sticky-clock');
      clockEl.textContent = clock;
      stickyEl.textContent = clock;
      clockEl.classList.toggle('text-rose-600', isDanger);
      clockEl.classList.toggle('text-amber-600', isWarn && !isDanger);
      stickyEl.classList.toggle('text-rose-600', isDanger);
      $('#timer-state').textContent = isDanger ? '时间快到了' : isWarn ? '剩余不足 1 分钟' : running ? '计时中' : '已暂停';
      $('#btn-timer-toggle').textContent = running ? '暂停' : '开始';
    },
    onEnd() {
      $('#timer-state').textContent = '时间到';
      toast('试讲时间到，请收尾并复盘', { type: 'warning' });
      beep(2);
    }
  });
}

function updateCharCount() {
  const text = $('#notes-input').value;
  $('#char-count').textContent = `${countChars(text)} 字`;
}

async function runScore() {
  if (state.scoring) return;
  if (!state.question || !state.rubric) {
    toast('课题尚未加载完成，请稍后再试', { type: 'warning' });
    return;
  }

  const notes = $('#notes-input').value.trim();
  const photos = photoUpload?.images?.() || [];
  // 图片评分只走多模态模型：API 不可用时图片不参与评分，也不调用 OCR
  const apiReady = isLlmConfigured();
  const images = apiReady ? photos : [];

  if (photos.length && !apiReady) {
    // 提交了图片但没配 API：弹出提示；文字够长就继续走本机规则评分，手动通路不被堵死
    toast('尚未配置大模型 API，图片评分不可用，可以手动输入答案测评', { type: 'warning' });
    if (countChars(notes) < 40) {
      $('#notes-input').focus();
      return;
    }
  }

  // 手动输入通路不变：没有可评分的图片时仍需 40 字；只传图片则由模型读图，不要求写满字数
  if (!images.length && countChars(notes) < 40) {
    toast('先记录至少 40 字的试讲要点，再生成评分', { type: 'warning' });
    $('#notes-input').focus();
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
      const raw = await scoreTrial({
        question: state.question,
        notes,
        rubric: state.rubric,
        outline: state.outline,
        images
      });
      result = normalizeResult(raw, state.rubric, 'trial');
      result.source = 'ai';
      usedAi = true;
    } catch (error) {
      console.warn('[math] AI 评分失败，降级本机规则', error);
      toast('AI 评分失败，已改用本机规则评分', { type: 'warning' });
    }
  }

  if (!result) {
    try {
      result = localTrialScore({ question: state.question, notes, rubric: state.rubric });
      if (result && !result.dimensions) result = normalizeResult(result, state.rubric, 'trial');
      result.source = 'local';
    } catch (error) {
      console.error('[math] 本机评分失败', error);
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
  const recordId = await rememberAttempt(result, notes);
  mountAskAi(host, {
    mode: 'trial',
    question: state.question,
    answer: notes,
    result,
    recordId
  });
  $('#score-status').textContent = usedAi
    ? images.length ? 'AI 读图评分完成' : 'AI 评分完成'
    : '本机规则评分（未接入 AI）';
  scrollToElement(host);
  state.scoring = false;
}

async function rememberAttempt(result, notes) {
  if (!state.question) return null;
  try {
    const recordId = await saveAttempt({
      mode: 'math',
      questionId: state.question.id,
      title: state.question.title || '',
      excerpt: state.question.board || '',
      answer: notes,
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
      mode: 'math',
      id: state.question.id,
      title: state.question.title || ''
    });
    return recordId;
  } catch (error) {
    console.warn('[math] 记录保存跳过', error);
    return null;
  }
}

function resetForNewQuestion() {
  $('#notes-input').value = '';
  updateCharCount();
  $('#score-card').classList.add('hidden');
  $('#score-card').innerHTML = '';
  $('#score-status').textContent = '';
  const audio = $('#rec-audio');
  audio.pause();
  audio.removeAttribute('src');
  audio.classList.add('hidden');
  photoUpload?.reset();
}

function bindEvents() {
  $('#btn-timer-toggle').addEventListener('click', () => state.timer?.toggle());
  $('#btn-timer-reset').addEventListener('click', () => state.timer?.reset(LIMIT_SECONDS));

  $('#btn-toggle-detail').addEventListener('click', () => {
    const detail = $('#m-detail');
    const willShow = detail.classList.contains('hidden');
    detail.classList.toggle('hidden', !willShow);
    $('#btn-toggle-detail').textContent = willShow ? '收起教学目标与重难点' : '展开教学目标与重难点';
  });

  $('#btn-new-question').addEventListener('click', () => {
    const next = pickAnother();
    if (!next) return;
    resetForNewQuestion();
    selectQuestion(next);
  });

  // 学段切换：初中 / 高中（手机上同样只有一次点击）
  document.querySelectorAll('#stage-tabs [data-stage]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.stage;
      if (next === state.stage) return;
      const hasContent = countChars($('#notes-input').value) > 0
        || !$('#score-card').classList.contains('hidden');
      if (hasContent && !window.confirm('切换学段会换一道题，并清空当前讲稿与评分，继续吗？')) return;
      resetForNewQuestion();
      applyStage(next, { announce: true });
    });
  });

  $('#notes-input').addEventListener('input', updateCharCount);

  $('#btn-score').addEventListener('click', runScore);
  $('#btn-sticky-score').addEventListener('click', runScore);
}

setupRecorder();
setupPhoto();
setupTimer();
bindEvents();
init();
