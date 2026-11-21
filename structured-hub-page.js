/**
 * 结构化面试 · 一级页面（题型）
 * 每个题型提供两个互不干扰的入口：
 *   ① 查看该题型模板 → structured-template.html?type=xxx
 *   ② 进入该题型题目列表 → structured-list.html?type=xxx
 */

import { $, escapeHtml, toast } from './utils.js';
import { loadStructuredQuestions, loadStructuredTemplates } from './data-loader.js';
import { ensureSettingsDialog } from './settings.js';
import { questionsOfType, styleOf, templateHref, listHref } from './structured-nav.js';

ensureSettingsDialog();

const state = { types: [], questions: [] };

function cardHtml(type) {
  const style = styleOf(type);
  const total = questionsOfType(state.questions, type).length;
  const keywords = (type.keywords || [])
    .slice(0, 4)
    .map((word) => `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">${escapeHtml(word)}</span>`)
    .join('');

  const practice = total
    ? `<a href="${listHref(type)}" class="flex h-10 items-center justify-center gap-1 rounded-xl bg-brand-600 text-xs font-bold text-white active:bg-brand-700">✏️ 刷题 · ${total}</a>`
    : `<span class="flex h-10 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-400">暂无题目</span>`;

  return `
    <article class="rounded-2xl border ${style.ring} bg-white p-4 shadow-sm">
      <div class="flex items-start gap-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style.bg} text-lg">${style.icon}</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="truncate text-sm font-bold text-slate-900">${escapeHtml(type.name || '')}</h3>
            <span class="pill pill-slate">${total} 题</span>
          </div>
          <p class="mt-0.5 text-[11px] text-slate-500">${escapeHtml(type.short || '')}</p>
          <p class="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">${escapeHtml(type.summary || '')}</p>
          ${keywords ? `<div class="mt-2 flex flex-wrap gap-1.5">${keywords}</div>` : ''}
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <a href="${templateHref(type)}" class="flex h-10 items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 active:bg-slate-50">📖 查看模板</a>
        ${practice}
      </div>
    </article>`;
}

function renderTypes() {
  const host = $('#type-list');
  host.innerHTML = state.types.map(cardHtml).join('');
  host.setAttribute('aria-busy', 'false');
  $('#hub-meta').textContent = `${state.types.length} 类题型 · ${state.questions.length} 道真题`;
  $('#hub-count').textContent = `共 ${state.questions.length} 题`;
  $('#hub-error').classList.add('hidden');
}

function showError(message) {
  $('#type-list').innerHTML = '';
  $('#type-list').setAttribute('aria-busy', 'false');
  $('#hub-count').textContent = '加载失败';
  $('#hub-error-text').textContent = message;
  $('#hub-error').classList.remove('hidden');
}

async function init() {
  $('#hub-error').classList.add('hidden');
  try {
    const [templateData, questions] = await Promise.all([
      loadStructuredTemplates(),
      loadStructuredQuestions()
    ]);
    state.types = (templateData.types || []).filter((type) => type && type.id);
    state.questions = Array.isArray(questions) ? questions : [];
    if (!state.types.length) throw new Error('模板数据里没有题型（types 为空）');
    renderTypes();
  } catch (error) {
    console.error('[structured-hub] 加载失败', error);
    showError(`加载失败：${error.message}。请确认已通过本地服务器打开（如 start.cmd）。`);
    toast('题型加载失败', { type: 'error' });
  }
}

$('#btn-retry').addEventListener('click', init);

init();
