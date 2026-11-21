/**
 * 练习记录页
 * 数据来自 IndexedDB 的 attempts（结构化页 / 试讲页评分后写入）。
 * 结构：顶部统计 → 分类筛选 → 列表工具条 → 记录卡片（可展开维度 / 重做 / 删除）。
 */

import { $, escapeHtml, toast } from './utils.js';
import { idbAll, idbDelete, idbClear, stores } from './storage.js';
import { ensureSettingsDialog } from './settings.js';
import { levelOf } from './scoring.js';

ensureSettingsDialog();

const MODE_LABEL = { structured: '结构化', math: '试讲' };
const FILTERS = [
  ['all', '全部'],
  ['structured', '结构化'],
  ['math', '试讲']
];
const LEVEL_STYLE = {
  优秀: 'bg-emerald-50 text-emerald-700',
  良好: 'bg-sky-50 text-sky-700',
  合格: 'bg-amber-50 text-amber-700',
  待提升: 'bg-rose-50 text-rose-700'
};
const LOAD_TIMEOUT = 3000;

const state = {
  items: [],
  filter: 'all',
  sort: 'time', // time：最新优先；score：高分优先
  loading: true,
  storageError: false
};

const pad = (value) => String(value).padStart(2, '0');

/** 今天 / 昨天 / 月日 + 时分，跨年记录补上年份 */
function formatAt(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '时间未知';
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (sameDay(at, now)) return `今天 ${clock}`;
  if (sameDay(at, yesterday)) return `昨天 ${clock}`;
  const datePart = at.getFullYear() === now.getFullYear()
    ? `${at.getMonth() + 1}月${at.getDate()}日`
    : `${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()}`;
  return `${datePart} ${clock}`;
}

function totalOf(item) {
  const value = Math.round(Number(item?.total) || 0);
  return Math.max(0, Math.min(100, value));
}

function levelMetaOf(item) {
  const total = totalOf(item);
  const label = String(item?.level || '').trim() || levelOf(total).label;
  return { total, label, style: LEVEL_STYLE[label] || 'bg-slate-100 text-slate-600' };
}

function statCard(label, value, hint = '') {
  return `<div class="rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center">
    <div class="text-lg font-bold tabular-nums text-slate-900">${escapeHtml(String(value))}</div>
    <div class="mt-0.5 text-[10px] text-slate-500">${escapeHtml(label)}</div>
    ${hint ? `<div class="mt-0.5 truncate text-[10px] text-slate-400">${escapeHtml(hint)}</div>` : ''}
  </div>`;
}

function dimBar(dim) {
  const max = Number(dim?.max) || 0;
  const score = Number(dim?.score) || 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((score / max) * 100))) : 0;
  const tone = pct >= 80 ? 'bg-emerald-500' : (pct >= 60 ? 'bg-sky-500' : (pct >= 40 ? 'bg-amber-500' : 'bg-rose-400'));
  return `<div>
    <div class="flex items-center justify-between gap-2 text-[11px] text-slate-600">
      <span class="min-w-0 truncate">${escapeHtml(dim?.name || '维度')}</span>
      <span class="shrink-0 tabular-nums text-slate-500"><b class="text-slate-800">${score}</b>/${max}</span>
    </div>
    <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div class="h-full rounded-full ${tone}" style="width:${pct}%"></div>
    </div>
  </div>`;
}

/** 一条练习记录：分数徽章 + 题型/来源/时间 + 主要维度 + 可展开详情 */
function recordCard(item, index) {
  const rawId = item?.id === undefined || item?.id === null ? '' : String(item.id);
  const detailId = `detail-${rawId || index}`;
  const { total, label, style } = levelMetaOf(item);
  const mode = MODE_LABEL[item?.mode] || '练习';
  const dims = Array.isArray(item?.dimensions) ? item.dimensions : [];
  const topDims = [...dims]
    .sort((a, b) => (Number(b?.max) || 0) - (Number(a?.max) || 0))
    .slice(0, 3);
  const sourcePill = item?.source === 'ai'
    ? '<span class="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">AI 评分</span>'
    : '<span class="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">本机评分</span>';

  const titleText = String(item?.title || '').trim();
  const excerpt = String(item?.excerpt || '').trim();
  // 结构化的 title 是题型、excerpt 是题面；试讲相反。取信息量大的那条当标题。
  const headline = excerpt.length > titleText.length ? excerpt : (titleText || excerpt || '未命名练习');
  const secondary = headline === excerpt ? titleText : excerpt;
  const showSecondary = Boolean(secondary) && secondary !== headline;
  const answer = String(item?.answer || '').trim();

  const questionId = String(item?.questionId || '').trim();
  const redoHref = questionId
    ? `${item?.mode === 'math' ? 'math.html' : 'structured.html'}?id=${encodeURIComponent(questionId)}`
    : '';

  return `<article class="rounded-2xl border border-slate-200 bg-white p-3">
    <div class="flex items-start gap-3">
      <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl ${style}">
        <span class="text-base font-bold leading-none tabular-nums">${total}</span>
        <span class="mt-0.5 text-[9px] font-semibold leading-none">${escapeHtml(label)}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">${escapeHtml(mode)}</span>
          ${sourcePill}
          <span class="text-[10px] text-slate-400">${escapeHtml(formatAt(item?.createdAt))}</span>
        </div>
        <h2 class="mt-1 line-clamp-2 text-sm font-bold leading-relaxed text-slate-900">${escapeHtml(headline)}</h2>
        ${showSecondary ? `<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">${escapeHtml(secondary)}</p>` : ''}
      </div>
    </div>

    ${topDims.length ? `<div class="mt-2.5 space-y-1.5">${topDims.map(dimBar).join('')}</div>` : ''}

    <div class="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
      <button type="button" data-detail="${detailId}" aria-expanded="false"
        class="text-[11px] font-bold text-slate-600 active:text-slate-900">展开详情</button>
      <span class="truncate text-[10px] text-slate-400">${escapeHtml(questionId)}</span>
    </div>

    <div id="${detailId}" class="mt-2 hidden space-y-2.5">
      ${dims.length > 3 ? `<div class="space-y-1.5">${dims.slice(3).map(dimBar).join('')}</div>` : ''}
      ${answer ? `<div>
        <p class="text-[11px] font-semibold text-slate-500">当时的作答</p>
        <p class="mt-1 line-clamp-6 whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600">${escapeHtml(answer)}</p>
      </div>` : ''}
      <div class="flex gap-2">
        ${redoHref ? `<a href="${redoHref}" class="flex h-9 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-700 active:bg-slate-50">重做这道题</a>` : ''}
        <button type="button" data-del="${escapeHtml(rawId)}"
          class="flex h-9 flex-1 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-600 active:bg-rose-100">删除这条</button>
      </div>
    </div>
  </article>`;
}

/* ----------------------------- 渲染 ----------------------------- */

function countOf(mode) {
  return state.items.filter((item) => item.mode === mode).length;
}

/** 当前筛选 + 排序后的记录 */
function visibleItems() {
  const list = state.filter === 'all'
    ? state.items.slice()
    : state.items.filter((item) => item.mode === state.filter);
  if (state.sort === 'score') {
    list.sort((a, b) => totalOf(b) - totalOf(a)
      || String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
  } else {
    list.sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
  }
  return list;
}

function renderSummary() {
  const el = $('#summary-text');
  if (state.loading) {
    el.textContent = '读取本机记录…';
    return;
  }
  if (state.storageError) {
    el.textContent = '本机存储不可用，暂时读不到记录';
    return;
  }
  if (!state.items.length) {
    el.textContent = '还没有记录，完成一次评分就会自动保存';
    return;
  }
  const totals = state.items.map(totalOf);
  const avg = Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length);
  const lastAt = state.items.reduce(
    (acc, item) => (String(item?.createdAt || '') > String(acc) ? String(item?.createdAt || '') : acc),
    ''
  );
  el.textContent = `共 ${state.items.length} 次 · 平均 ${avg} 分 · 最近：${formatAt(lastAt)}`;
}

function renderStats() {
  if (!state.items.length) {
    $('#stat-row').innerHTML = [
      statCard('练习次数', 0, '还没有记录'),
      statCard('平均分', '—', '评分后统计'),
      statCard('最高分', '—', '仅本机')
    ].join('');
    return;
  }
  const totals = state.items.map(totalOf);
  const avg = Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length);
  const best = Math.max(...totals);
  $('#stat-row').innerHTML = [
    statCard('练习次数', state.items.length, `结构化 ${countOf('structured')} · 试讲 ${countOf('math')}`),
    statCard('平均分', avg, levelOf(avg).label),
    statCard('最高分', best, levelOf(best).label)
  ].join('');
}

function renderFilters() {
  const counts = { all: state.items.length, structured: countOf('structured'), math: countOf('math') };
  $('#filter-row').innerHTML = FILTERS.map(([key, label]) => {
    const active = state.filter === key;
    const cls = active
      ? 'bg-slate-900 text-white'
      : 'border border-slate-200 bg-white text-slate-600';
    return `<button type="button" data-filter="${key}" aria-pressed="${active}"
      class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${cls}">${escapeHtml(label)}
      <span class="${active ? 'text-white/60' : 'text-slate-400'}">${counts[key] || 0}</span></button>`;
  }).join('');
}

function renderList() {
  const host = $('#records-list');
  const items = visibleItems();
  if (state.loading || state.storageError) {
    host.innerHTML = '';
  } else if (!state.items.length) {
    host.innerHTML = '';
  } else if (!items.length) {
    host.innerHTML = '<p class="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-[11px] text-slate-500">这个分类下还没有记录。</p>';
  } else {
    host.innerHTML = items.map((item, index) => recordCard(item, index)).join('');
  }

  $('#loading-box').classList.toggle('hidden', !state.loading);
  $('#empty-tip').classList.toggle('hidden', state.loading || state.storageError || state.items.length > 0);
  $('#error-box').classList.toggle('hidden', !state.storageError);
  $('#danger-zone').classList.toggle('hidden', state.loading || state.storageError || state.items.length === 0);
  $('#clear-hint').textContent = `共 ${state.items.length} 条记录，只存在本机浏览器，清空后无法恢复。`;
}

function renderHint() {
  if (state.loading) {
    $('#list-hint').textContent = '正在读取本机记录…';
  } else if (state.storageError) {
    $('#list-hint').textContent = '读取失败';
  } else if (!state.items.length) {
    $('#list-hint').textContent = '暂无记录';
  } else {
    const shown = visibleItems().length;
    const sortLabel = state.sort === 'score' ? '高分优先' : '最新优先';
    $('#list-hint').textContent = state.filter === 'all'
      ? `共 ${shown} 条 · ${sortLabel}`
      : `${MODE_LABEL[state.filter] || ''} ${shown} 条 / 共 ${state.items.length} 条`;
  }
  $('#btn-sort').textContent = state.sort === 'score' ? '高分优先' : '最新优先';
}

function render() {
  renderSummary();
  renderStats();
  renderFilters();
  renderHint();
  renderList();
}

/* ----------------------------- 数据 ----------------------------- */

/** 给 IndexedDB 读取加超时兜底：隐私模式 / 存储被禁用时不能白屏 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('读取超时')), ms);
    })
  ]);
}

async function load() {
  state.loading = true;
  state.storageError = false;
  render();
  try {
    const rows = await withTimeout(idbAll(stores.attempts), LOAD_TIMEOUT);
    state.items = (Array.isArray(rows) ? rows : []).sort((a, b) =>
      String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
  } catch (error) {
    console.warn('[records] 读取记录失败', error);
    state.items = [];
    state.storageError = true;
  }
  state.loading = false;
  render();
}

/* ----------------------------- 交互 ----------------------------- */

function bindEvents() {
  $('#filter-row').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button || button.dataset.filter === state.filter) return;
    state.filter = button.dataset.filter;
    render();
  });

  $('#btn-sort').addEventListener('click', () => {
    state.sort = state.sort === 'time' ? 'score' : 'time';
    render();
  });

  $('#records-list').addEventListener('click', async (event) => {
    const detailBtn = event.target.closest('[data-detail]');
    if (detailBtn) {
      const panel = document.getElementById(detailBtn.dataset.detail);
      if (!panel) return;
      const willShow = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !willShow);
      detailBtn.textContent = willShow ? '收起详情' : '展开详情';
      detailBtn.setAttribute('aria-expanded', String(willShow));
      return;
    }

    const delBtn = event.target.closest('[data-del]');
    if (!delBtn) return;
    const id = Number(delBtn.dataset.del);
    if (!Number.isFinite(id)) return;
    if (!window.confirm('删除这条记录？删除后无法恢复。')) return;
    delBtn.disabled = true;
    try {
      await idbDelete(stores.attempts, id);
      state.items = state.items.filter((item) => Number(item?.id) !== id);
      render();
      toast('已删除一条记录');
    } catch (error) {
      delBtn.disabled = false;
      console.warn('[records] 删除失败', error);
      toast('删除失败，请重试', { type: 'error' });
    }
  });

  $('#btn-clear').addEventListener('click', async () => {
    if (!state.items.length) return;
    if (!window.confirm(`清空全部 ${state.items.length} 条记录？此操作无法撤销。`)) return;
    const button = $('#btn-clear');
    button.disabled = true;
    try {
      await idbClear(stores.attempts);
      state.items = [];
      render();
      toast('已清空全部记录');
    } catch (error) {
      console.warn('[records] 清空失败', error);
      toast('清空失败，请重试', { type: 'error' });
    } finally {
      button.disabled = false;
    }
  });

  $('#btn-retry').addEventListener('click', () => load());
}

bindEvents();
render();
load();
