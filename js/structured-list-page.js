/**
 * 结构化面试 · 题目列表页（按题型）
 * URL: structured-list.html?type=self（也兼容 ?type=自我认知）
 * 只负责挑题；题干、计时、评分都在 structured.html，模板在 structured-template.html。
 */

import { $, escapeHtml, toast } from './utils.js';
import { loadStructuredQuestions, loadStructuredTemplates } from './data-loader.js';
import { ensureSettingsDialog } from './settings.js';
import {
  findTemplateByKey,
  questionsOfType,
  templateHref,
  questionHref
} from './structured-nav.js';

ensureSettingsDialog();

const params = new URLSearchParams(location.search);
const requestedKey = params.get('type') || 'self';

const state = { type: null, pool: [], keyword: '' };

function stars(level) {
  const value = Math.max(1, Math.min(3, Number(level) || 1));
  return '★'.repeat(value) + '☆'.repeat(3 - value);
}

function filtered() {
  const keyword = state.keyword.trim().toLowerCase();
  if (!keyword) return state.pool;
  return state.pool.filter((item) => {
    const haystack = [item.question, item.type, ...(item.tags || []), ...(item.key_points || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

function renderList() {
  const list = filtered();
  const host = $('#list');
  host.setAttribute('aria-busy', 'false');
  $('#empty-tip').classList.toggle('hidden', list.length > 0);
  $('#list-hint').textContent = state.keyword.trim()
    ? `匹配 ${list.length} / ${state.pool.length} 题`
    : `共 ${state.pool.length} 题 · 每题 2 分钟`;

  host.innerHTML = list
    .map((item) => {
      const tags = (item.tags || [])
        .slice(0, 3)
        .map((tag) => `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">${escapeHtml(tag)}</span>`)
        .join('');
      return `
        <a href="${questionHref(item, state.type)}" class="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.995]">
          <div class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0 text-[11px] text-amber-500">${stars(item.difficulty)}</span>
            <p class="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-slate-900">${escapeHtml(item.question || '')}</p>
            <span class="shrink-0 text-slate-300">›</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            ${tags}
            <span class="pill pill-blue">2 分钟</span>
          </div>
        </a>`;
    })
    .join('');
}

function showError(message) {
  $('#list').innerHTML = '';
  $('#list').setAttribute('aria-busy', 'false');
  $('#list-hint').textContent = '加载失败';
  $('#list-error-text').textContent = message;
  $('#list-error').classList.remove('hidden');
}

async function init() {
  try {
    const [templateData, questions] = await Promise.all([
      loadStructuredTemplates(),
      loadStructuredQuestions()
    ]);
    const types = (templateData.types || []).filter((item) => item && item.id);
    const type = findTemplateByKey(types, requestedKey);
    if (!type) throw new Error(`模板里没有这个题型：${requestedKey}`);

    state.type = type;
    state.pool = questionsOfType(questions, type);
    if (!state.pool.length) throw new Error('这个题型下还没有题目');

    document.title = `${type.name}刷题 · 教资面试陪跑`;
    $('#list-title').textContent = `${type.name} · 刷题`;
    $('#list-count').textContent = type.short || '选一道题开始';
    $('#btn-template').href = templateHref(type);

    renderList();
  } catch (error) {
    console.error('[structured-list] 加载失败', error);
    showError(`加载失败：${error.message}。请确认已通过本地服务器打开（如 start.cmd）。`);
    toast('题目加载失败', { type: 'error' });
  }
}

$('#search-input').addEventListener('input', (event) => {
  state.keyword = event.target.value;
  renderList();
});

$('#btn-random').addEventListener('click', () => {
  if (!state.type) return;
  const list = filtered();
  if (!list.length) {
    toast('当前筛选下没有题目', { type: 'warning' });
    return;
  }
  const picked = list[Math.floor(Math.random() * list.length)];
  location.href = questionHref(picked, state.type);
});

init();
