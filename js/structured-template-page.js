/**
 * 结构化面试 · 题型模板页
 * URL: structured-template.html?type=self（也兼容 ?type=自我认知）
 * 只展示某一个题型的答题框架，不放题干、不放计时器。
 */

import { $, escapeHtml, renderRich, toast } from './utils.js';
import { loadStructuredTemplates } from './data-loader.js';
import { resolveStructuredType } from './template-store.js';
import { ensureSettingsDialog } from './settings.js';
import { findTemplateByKey, styleOf, listHref, templateHref } from './structured-nav.js';

ensureSettingsDialog();

const params = new URLSearchParams(location.search);
const requestedKey = params.get('type') || 'self';

const state = { types: [], type: null };

function renderSwitcher() {
  $('#type-switch').innerHTML = state.types
    .map((item) => {
      const active = item.id === state.type?.id;
      const cls = active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'bg-white text-slate-600 border-slate-200';
      return `<a href="${templateHref(item)}" class="flex h-9 shrink-0 items-center rounded-full border px-3 text-xs font-semibold ${cls}"${active ? ' aria-current="page"' : ''}>${escapeHtml(item.name || '')}</a>`;
    })
    .join('');
}

function render(type) {
  state.type = type;
  const style = styleOf(type);

  document.title = `${type.name}模板 · 教资面试陪跑`;
  $('#tpl-title').textContent = `${type.name} · 答题模板`;
  $('#tpl-sub').textContent = type.short || '只放这一类题的框架';
  $('#tpl-icon').className = `grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style.bg} text-lg`;
  $('#tpl-icon').textContent = style.icon;
  $('#tpl-name').textContent = type.name || '';
  $('#tpl-short').textContent = type.short || '';
  $('#tpl-source').textContent = type.isUser ? '我的模板' : '内置模板';
  $('#tpl-source').className = type.isUser ? 'pill pill-green' : 'pill pill-slate';
  $('#tpl-summary').textContent = type.summary || '';

  $('#tpl-keywords').innerHTML = (type.keywords || [])
    .map((word) => `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">${escapeHtml(word)}</span>`)
    .join('');

  $('#tpl-structure').innerHTML = (type.structure || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  $('#tpl-phrases').innerHTML = (type.phrases || [])
    .map((line) => `<li class="rounded-lg bg-brand-50/60 px-2.5 py-1.5 text-slate-700">${escapeHtml(line)}</li>`)
    .join('');

  $('#tpl-points').innerHTML = (type.points || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  $('#tpl-demo').innerHTML = renderRich(type.demo || '') || '<span class="text-slate-400">暂无示范答案</span>';

  $('#tpl-pitfalls').innerHTML = (type.pitfalls || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  $('#btn-practice').href = listHref(type);
  $('#tpl-error').classList.add('hidden');
  renderSwitcher();
}

function showError(message) {
  $('#tpl-error-text').textContent = message;
  $('#tpl-error').classList.remove('hidden');
  $('#tpl-title').textContent = '答题模板';
  $('#tpl-sub').textContent = '加载失败';
  $('#tpl-name').textContent = '未找到模板';
  $('#tpl-summary').textContent = '';
  ['#tpl-structure', '#tpl-phrases', '#tpl-points', '#tpl-pitfalls'].forEach((selector) => {
    $(selector).innerHTML = '';
  });
  $('#tpl-demo').textContent = '';
  $('#tpl-keywords').innerHTML = '';
}

async function init() {
  try {
    const data = await loadStructuredTemplates();
    state.types = (data.types || []).filter((item) => item && item.id);
    const base = findTemplateByKey(state.types, requestedKey);
    if (!base) throw new Error(`模板里没有这个题型：${requestedKey}`);
    render(resolveStructuredType(base));
  } catch (error) {
    console.error('[structured-template] 加载失败', error);
    showError(`加载失败：${error.message}。请确认已通过本地服务器打开（如 start.cmd）。`);
    toast('模板加载失败', { type: 'error' });
  }
}

init();
