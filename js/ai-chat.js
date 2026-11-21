/**
 * AI 追问独立页
 *
 * 入口：评分结果里的「去 AI 追问」按钮 → ai-chat.html?recordId=xxx
 * 流程：IndexedDB 读取一条练习记录 → 还原题目 / 作答 / 评分上下文
 *      → 复用 score-chat.js 的追问能力（AI 动态追问 + 预设追问库）。
 *
 * 这样评分页不再塞一整个聊天窗口，练习记录页也能完整看到作答与考官点评。
 */

import { $, escapeHtml } from './utils.js';
import { idbGet, stores } from './storage.js';
import { ensureSettingsDialog } from './settings.js';
import { mountScoreChat } from './score-chat.js';
import { levelOf } from './scoring.js';
import { loadStructuredQuestions, loadMathQuestions } from './data-loader.js';

ensureSettingsDialog();

const MODE_LABEL = { structured: '结构化面试', trial: '数学试讲' };
const LEVEL_STYLE = {
  优秀: 'bg-emerald-50 text-emerald-700',
  良好: 'bg-sky-50 text-sky-700',
  合格: 'bg-amber-50 text-amber-700',
  待提升: 'bg-rose-50 text-rose-700'
};
/** 分数徽章用内联色值，避免运行时改 class 后 Tailwind Play 不重新生成样式 */
const LEVEL_TONE = {
  优秀: ['#ecfdf5', '#047857'],
  良好: ['#f0f9ff', '#0369a1'],
  合格: ['#fffbeb', '#b45309'],
  待提升: ['#fff1f2', '#be123c']
};
const LOAD_TIMEOUT = 4000;
const QUESTION_TIMEOUT = 8000;

const state = { chat: null };
const params = new URLSearchParams(location.search);

const pad = (value) => String(value).padStart(2, '0');

function formatAt(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '时间未知';
  const now = new Date();
  const datePart = at.getFullYear() === now.getFullYear()
    ? `${at.getMonth() + 1}月${at.getDate()}日`
    : `${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()}`;
  return `${datePart} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('读取超时')), ms);
    })
  ]);
}

function textListOf(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean).slice(0, 6);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/** 从记录里还原评分结果（新记录有 review 快照；旧记录退回基础字段） */
function buildResult(record) {
  const review = record?.review && typeof record.review === 'object' ? record.review : null;
  const rawDims = Array.isArray(review?.dimensions) && review.dimensions.length
    ? review.dimensions
    : (Array.isArray(record?.dimensions) ? record.dimensions : []);
  const total = Math.max(0, Math.min(100, Math.round(Number(review?.total ?? record?.total) || 0)));
  return {
    total,
    level: String(review?.level || record?.level || '').trim() || levelOf(total).label,
    source: (review?.source || record?.source) === 'ai' ? 'ai' : 'local',
    model: String(review?.model || '').trim(),
    dimensions: rawDims.map((item) => ({
      key: String(item?.key || ''),
      name: String(item?.name || ''),
      score: Number(item?.score) || 0,
      max: Number(item?.max) || 0,
      comment: String(item?.comment || '').trim()
    })),
    highlights: textListOf(review?.highlights),
    issues: textListOf(review?.issues),
    tips: textListOf(review?.tips),
    analysis: String(review?.analysis || '').trim()
  };
}

/** 题库里找不到时的兜底题目（用记录里保存的题型 / 题面 / 板块） */
function fallbackQuestion(record, mode) {
  const title = String(record?.title || '').trim();
  const excerpt = String(record?.excerpt || '').trim();
  if (mode === 'trial') {
    return {
      id: record?.questionId || '',
      title: title || excerpt || '未命名课题',
      board: excerpt,
      question: excerpt
    };
  }
  return {
    id: record?.questionId || '',
    question: excerpt || title || '未命名题目',
    type: title,
    difficulty: 0,
    key_points: []
  };
}

/** 按 questionId 回题库取完整题目，拿不到就用记录里的摘要 */
async function resolveQuestion(record, mode) {
  const id = String(record?.questionId || '').trim();
  if (id) {
    try {
      const list = mode === 'trial'
        ? await withTimeout(loadMathQuestions(), QUESTION_TIMEOUT)
        : await withTimeout(loadStructuredQuestions(), QUESTION_TIMEOUT);
      const found = (Array.isArray(list) ? list : [])
        .find((item) => String(item?.id || '') === id);
      if (found) return found;
    } catch (error) {
      console.warn('[ai-chat] 题库读取失败，使用记录摘要', error);
    }
  }
  return fallbackQuestion(record, mode);
}

function setState({ title, sub, retry = false }) {
  $('#state-title').textContent = title;
  $('#state-sub').textContent = sub;
  $('#btn-retry').classList.toggle('hidden', !retry);
  $('#state-box').classList.remove('hidden');
  $('#record-summary').classList.add('hidden');
  $('#chat-host').classList.add('hidden');
}

function renderSummary(record, result, mode) {
  const title = String(record?.title || '').trim();
  const excerpt = String(record?.excerpt || '').trim();
  // 结构化：title 是题型、excerpt 是题面；试讲：title 是课题、excerpt 是板块
  const headline = mode === 'trial'
    ? (title || excerpt || '未命名课题')
    : (excerpt || title || '未命名题目');
  const secondary = mode === 'trial' ? excerpt : title;
  const answer = String(record?.answer || '').trim();
  const answerChars = answer.replace(/\s+/g, '').length;
  const tone = LEVEL_TONE[result.level] || ['#f1f5f9', '#475569'];
  const sourceText = result.source === 'ai' ? 'AI 评分' : '本机评分';

  const badge = $('#score-badge');
  badge.className = 'grid h-14 w-14 shrink-0 place-items-center rounded-xl';
  badge.style.backgroundColor = tone[0];
  badge.style.color = tone[1];
  $('#score-total').textContent = String(result.total);
  $('#score-level').textContent = result.level;
  $('#summary-tags').innerHTML = `
    <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">${escapeHtml(MODE_LABEL[mode])}</span>
    <span class="rounded-md ${LEVEL_STYLE[result.level] || 'bg-slate-100 text-slate-600'} px-1.5 py-0.5 text-[10px] font-semibold">${escapeHtml(result.level)}</span>
    <span class="rounded-md ${result.source === 'ai' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} px-1.5 py-0.5 text-[10px] font-semibold">${sourceText}</span>
  `;
  $('#summary-title').textContent = headline;
  $('#summary-meta').textContent = [
    secondary && secondary !== headline ? secondary : '',
    formatAt(record?.createdAt),
    answer ? `作答 ${answerChars} 字` : '未保存答题内容'
  ].filter(Boolean).join(' · ');

  const details = $('#summary-answer');
  details.classList.toggle('hidden', !answer);
  if (answer) $('#summary-answer-text').textContent = answer;

  $('#record-summary').classList.remove('hidden');
}

async function load() {
  state.chat?.destroy();
  state.chat = null;

  const raw = params.get('recordId');
  const id = Number(raw);
  if (!raw || !Number.isFinite(id)) {
    $('#page-sub').textContent = '缺少记录编号';
    setState({
      title: '没有拿到练习记录编号',
      sub: '请从评分结果里的「去 AI 追问」按钮进入。直接打开这个页面读不到评分与作答。'
    });
    return;
  }

  $('#page-sub').textContent = '读取练习记录…';
  setState({ title: '正在读取练习记录…', sub: `记录编号 ${raw} · 只读取本机浏览器` });

  let record;
  try {
    record = await withTimeout(idbGet(stores.attempts, id), LOAD_TIMEOUT);
  } catch (error) {
    console.warn('[ai-chat] 读取记录失败', error);
    $('#page-sub').textContent = '读取记录失败';
    setState({
      title: '读不到这条记录',
      sub: '可能是无痕模式、浏览器禁用了 IndexedDB，或读取超时。换一个普通窗口重试。',
      retry: true
    });
    return;
  }

  if (!record) {
    $('#page-sub').textContent = '记录不存在';
    setState({
      title: '没有找到这条记录',
      sub: '记录可能已经被删除。返回练习记录，重新完成一次评分后再来追问。'
    });
    return;
  }

  const mode = record.mode === 'math' ? 'trial' : 'structured';
  const result = buildResult(record);
  const question = await resolveQuestion(record, mode);

  renderSummary(record, result, mode);
  $('#state-box').classList.add('hidden');
  $('#chat-host').classList.remove('hidden');
  state.chat = mountScoreChat($('#chat-host'), {
    mode,
    question,
    answer: String(record?.answer || ''),
    result
  });
  $('#page-sub').textContent = `${MODE_LABEL[mode]} · 总分 ${result.total} 分${result.level ? ` · ${result.level}` : ''}`;
}

$('#btn-retry').addEventListener('click', () => load());
load();
