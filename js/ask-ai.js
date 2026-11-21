/**
 * 评分后的「去 AI 追问」入口
 *
 * 原来内嵌在评分卡里的追问窗口（score-chat.js）移到独立页面 ai-chat.html：
 * 这里只负责渲染一个入口按钮，并把当前记录的 recordId 带在 URL 上，
 * 追问对话的上下文（题目 / 作答 / 评分）由 ai-chat.html 按 recordId 重新读取。
 */

import { escapeHtml } from './utils.js';

const MODE_LABEL = { structured: '结构化面试', trial: '数学试讲' };

function scoreTextOf(result) {
  if (!result) return '';
  const total = Math.max(0, Math.min(100, Math.round(Number(result.total) || 0)));
  const level = String(result.level || '').trim();
  return `${total} 分${level ? ` · ${level}` : ''}`;
}

export function mountAskAi(host, options = {}) {
  if (!host) return null;
  const mode = options.mode === 'trial' ? 'trial' : 'structured';
  const recordId = options.recordId === undefined || options.recordId === null
    ? ''
    : String(options.recordId);
  const scoreText = scoreTextOf(options.result);
  const href = recordId
    ? `ai-chat.html?recordId=${encodeURIComponent(recordId)}`
    : 'ai-chat.html';

  // 同一道题重复评分时替换旧入口，避免叠加
  host.querySelector('[data-ask-ai]')?.remove();

  const section = document.createElement('section');
  section.className = 'score-chat';
  section.dataset.askAi = '1';
  section.innerHTML = `
    <div class="score-chat__head">
      <div class="min-w-0">
        <h4 class="score-chat__title">去 AI 追问</h4>
        <p class="score-chat__sub">已带入这道题、你的作答与本次评分，在独立页面继续聊</p>
      </div>
      ${scoreText ? `<span class="pill pill-slate shrink-0">${escapeHtml(scoreText)}</span>` : ''}
    </div>
    <a href="${href}" class="mt-3 flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-brand-600 text-sm font-bold text-white active:bg-brand-700">
      去 AI 追问 <span aria-hidden="true">›</span>
    </a>
    <p class="score-chat__note">${escapeHtml(MODE_LABEL[mode])} · ${
      recordId
        ? '追问记录按题目保存在本机浏览器，返回后仍可接着看。'
        : '这条记录没有保存成功，打开后可能读不到内容，可返回练习记录重新评分。'
    }</p>
  `;
  host.appendChild(section);

  return { element: section };
}
