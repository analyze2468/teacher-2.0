/**
 * 示范视频页
 * 数据来自 data/videos.json；embedUrl 为空时只显示站内搜索入口，避免空白 iframe。
 */

import { $, escapeHtml } from './utils.js';
import { loadVideos } from './data-loader.js';
import { ensureSettingsDialog } from './settings.js';

ensureSettingsDialog();

const state = { items: [], meta: null, filter: '全部' };

function searchUrl(keyword) {
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword || '教资面试')}`;
}

function videoCard(item) {
  const embed = String(item.embedUrl || '').trim();
  const playArea = embed
    ? `<div class="mt-3 aspect-video overflow-hidden rounded-xl bg-slate-900">
        <iframe class="h-full w-full" src="${escapeHtml(embed)}" title="${escapeHtml(item.title || '示范视频')}" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe>
      </div>`
    : `<a href="${escapeHtml(searchUrl(item.search))}" target="_blank" rel="noopener noreferrer" class="mt-3 flex h-11 items-center justify-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white active:bg-slate-800">
        去 B 站搜索：${escapeHtml(item.search || item.title || '教资面试')} ↗
      </a>`;

  return `<article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="flex flex-wrap items-center gap-1.5">
      ${item.category ? `<span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">${escapeHtml(item.category)}</span>` : ''}
      ${item.duration ? `<span class="text-[10px] text-slate-400">${escapeHtml(item.duration)}</span>` : ''}
    </div>
    <h2 class="mt-1.5 text-sm font-bold leading-relaxed text-slate-900">${escapeHtml(item.title || '未命名视频位')}</h2>
    ${item.note ? `<p class="mt-1 text-[11px] leading-relaxed text-slate-500">${escapeHtml(item.note)}</p>` : ''}
    ${playArea}
  </article>`;
}

function renderFilters() {
  const categories = ['全部', ...new Set(state.items.map((item) => item.category).filter(Boolean))];
  $('#filter-row').innerHTML = categories.map((name) => {
    const active = state.filter === name;
    const cls = active ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600';
    const count = name === '全部'
      ? state.items.length
      : state.items.filter((item) => item.category === name).length;
    return `<button type="button" data-cat="${escapeHtml(name)}" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${cls}">${escapeHtml(name)} ${count}</button>`;
  }).join('');
}

function renderList() {
  const items = state.filter === '全部'
    ? state.items
    : state.items.filter((item) => item.category === state.filter);
  $('#video-list').innerHTML = items.length
    ? items.map(videoCard).join('')
    : '<p class="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-[11px] text-slate-500">这个分类下还没有视频位。</p>';
}

function render() {
  renderFilters();
  renderList();
}

async function init() {
  try {
    const data = await loadVideos();
    state.meta = data?.meta || null;
    state.items = Array.isArray(data?.items) ? data.items : [];
  } catch (error) {
    $('#count-text').textContent = '加载失败';
    const tip = $('#error-tip');
    tip.classList.remove('hidden');
    tip.textContent = `视频配置加载失败：${error?.message || error}。请确认页面是通过本地 HTTP 服务打开的。`;
    return;
  }
  $('#count-text').textContent = `${state.items.length} 个视频位`;
  $('#meta-note').textContent = state.meta?.note
    || '视频位为占位配置：给 videos.json 的 embedUrl 填入播放器地址后即可内嵌播放。';
  render();
}

$('#filter-row').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cat]');
  if (!button) return;
  state.filter = button.dataset.cat;
  render();
});

init();
