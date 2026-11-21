/**
 * 选题页：按题型 / 板块筛选、关键词搜索、随机抽题
 * URL: select.html?mode=structured | select.html?mode=math
 */

import { $, escapeHtml, toast } from './utils.js';
import { loadStructuredQuestions, loadMathQuestions } from './data-loader.js';
import { ensureSettingsDialog } from './settings.js';

ensureSettingsDialog();

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'math' ? 'math' : 'structured';

const CONFIG = {
  structured: {
    title: '结构化面试 · 选题',
    page: 'structured.html',
    groupOf: (item) => item.type || '其他',
    primary: (item) => item.question || '',
    secondary: (item) => (item.key_points || []).slice(0, 2).join(' · '),
    tags: (item) => item.tags || [],
    load: loadStructuredQuestions
  },
  math: {
    title: '数学试讲 · 选题',
    page: 'math.html',
    hasStages: true,
    groupOf: (item) => item.board || '其他',
    primary: (item) => item.title || item.question || '',
    secondary: (item) => [item.grade, item.source, item.topic].filter(Boolean).join(' · '),
    tags: (item) => [item.topic].filter(Boolean),
    load: loadMathQuestions
  }
};

const cfg = CONFIG[mode];
const stageKey = 'pb.mathStage';

/** 学段判定：优先题目 stage 字段，缺失时按教材名推断（与 math-page.js 保持一致） */
function stageOf(item) {
  if (!item) return 'junior';
  if (item.stage === 'senior' || item.stage === 'junior') return item.stage;
  return /^(必修|选择性必修)/.test(String(item.grade || '')) ? 'senior' : 'junior';
}

function readStoredStage() {
  try {
    return localStorage.getItem(stageKey) === 'senior' ? 'senior' : 'junior';
  } catch (error) {
    return 'junior';
  }
}

/** 支持 ?stage=senior 深链（分享/刷新后直达对应学段），否则用上次记忆 */
function initialStage() {
  const fromUrl = params.get('stage');
  if (fromUrl === 'senior' || fromUrl === 'junior') return fromUrl;
  return readStoredStage();
}

const state = { items: [], group: '全部', keyword: '', stage: initialStage() };

/** 当前学段下的题库；非数学模式直接返回全部 */
function scoped() {
  if (!cfg.hasStages) return state.items;
  return state.items.filter((item) => stageOf(item) === state.stage);
}

document.title = `${cfg.title} · 教资面试陪跑`;
$('#page-title').textContent = cfg.title;

/** 学段切换按钮 + 标题 + 数量提示 */
function paintStage() {
  if (!cfg.hasStages) {
    $('#stage-bar')?.classList.add('hidden');
    return;
  }
  const senior = state.stage === 'senior';
  const label = `${senior ? '高中' : '初中'}数学试讲`;
  document.title = `${label} · 选题 · 教资面试陪跑`;
  $('#page-title').textContent = `${label} · 选题`;

  document.querySelectorAll('#stage-bar [data-stage]').forEach((button) => {
    const active = button.dataset.stage === state.stage;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.classList.toggle('bg-brand-600', active);
    button.classList.toggle('ring-1', active);
    button.classList.toggle('text-white', active);
    button.classList.toggle('active:bg-brand-700', active);
    button.classList.toggle('text-slate-600', !active);
    button.classList.toggle('active:bg-slate-100', !active);
  });

  const juniorCount = state.items.filter((item) => stageOf(item) === 'junior').length;
  const seniorCount = state.items.filter((item) => stageOf(item) === 'senior').length;
  // 数量提示写进按钮旁的说明；#count-text 交给 renderList 独占，避免相互覆盖
  const badge = $('#stage-hint');
  if (badge) badge.textContent = `初中 ${juniorCount} 题 · 高中 ${seniorCount} 题`;
}

function stars(level) {
  const value = Math.max(1, Math.min(3, Number(level) || 1));
  return '★'.repeat(value) + '☆'.repeat(3 - value);
}

function filtered() {
  const keyword = state.keyword.trim().toLowerCase();
  return scoped().filter((item) => {
    if (state.group !== '全部' && cfg.groupOf(item) !== state.group) return false;
    if (!keyword) return true;
    const haystack = [item.question, item.title, item.topic, item.type, item.board, ...(item.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

function renderFilters() {
  const groups = ['全部', ...new Set(scoped().map(cfg.groupOf))];
  // 切学段后原分组可能不存在，回落到「全部」
  if (!groups.includes(state.group)) state.group = '全部';
  $('#filter-bar').innerHTML = groups
    .map((group) => {
      const active = group === state.group;
      const cls = active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'bg-white text-slate-600 border-slate-200';
      return `<button type="button" data-group="${escapeHtml(group)}" class="h-9 rounded-full border px-3 text-xs font-semibold ${cls}">${escapeHtml(group)}</button>`;
    })
    .join('');
}

function renderList() {
  const list = filtered();
  const host = $('#list');
  $('#empty-hint').classList.toggle('hidden', list.length > 0);
  $('#count-text').textContent = cfg.hasStages
    ? `${state.stage === 'senior' ? '高中' : '初中'} · ${state.group} · 共 ${list.length} 题`
    : `共 ${list.length} 题 · ${state.group}`;

  host.innerHTML = list
    .map((item) => {
      const id = encodeURIComponent(item.id);
      const tags = cfg.tags(item)
        .map((tag) => `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">${escapeHtml(tag)}</span>`)
        .join('');
      return `
        <a href="${cfg.page}?id=${id}" class="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.995]">
          <div class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">${escapeHtml(cfg.groupOf(item))}</span>
            <p class="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-slate-900">${escapeHtml(cfg.primary(item))}</p>
            <span class="shrink-0 text-[11px] text-amber-500">${stars(item.difficulty)}</span>
          </div>
          <p class="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">${escapeHtml(cfg.secondary(item))}</p>
          ${tags ? `<div class="mt-2 flex flex-wrap gap-1.5">${tags}</div>` : ''}
        </a>`;
    })
    .join('');
}

function bindEvents() {
  const stageBar = $('#stage-bar');
  if (stageBar && cfg.hasStages) {
    stageBar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-stage]');
      if (!button) return;
      const next = button.dataset.stage === 'senior' ? 'senior' : 'junior';
      if (next === state.stage) return;
      state.stage = next;
      state.group = '全部';
      try {
        localStorage.setItem(stageKey, next);
      } catch (error) {
        /* 隐私模式下忽略 */
      }
      paintStage();
      renderFilters();
      renderList();
      toast(next === 'senior' ? '已切换到高中题库' : '已切换到初中题库');
    });
  }

  $('#filter-bar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-group]');
    if (!button) return;
    state.group = button.dataset.group;
    renderFilters();
    renderList();
  });

  $('#search-input').addEventListener('input', (event) => {
    state.keyword = event.target.value;
    renderList();
  });

  $('#btn-random').addEventListener('click', () => {
    const list = filtered();
    if (!list.length) {
      toast('当前筛选下没有题目', { type: 'warning' });
      return;
    }
    const picked = list[Math.floor(Math.random() * list.length)];
    location.href = `${cfg.page}?id=${encodeURIComponent(picked.id)}`;
  });
}

async function init() {
  bindEvents();
  try {
    const data = await cfg.load();
    state.items = Array.isArray(data) ? data : data.items || [];
    if (!state.items.length) throw new Error('题库为空');
    if (cfg.hasStages) $('#stage-bar')?.classList.remove('hidden');
    paintStage();
    renderFilters();
    renderList();
  } catch (error) {
    $('#count-text').textContent = '题库加载失败';
    $('#empty-hint').classList.remove('hidden');
    $('#empty-hint').textContent = `题库加载失败：${error.message}。请确认已通过本地服务器打开（如 python -m http.server）。`;
    toast('题库加载失败', { type: 'error' });
    console.error('[select] 加载失败', error);
  }
}

init();
