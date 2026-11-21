/**
 * 首页：初始化 AI 设置入口，并预载题库（失败不影响页面）
 */

import { ensureSettingsDialog } from './settings.js';
import { isLlmConfigured } from './llm.js';
import { loadStructuredQuestions, loadMathQuestions } from './data-loader.js';
import { lastPractice } from './storage.js';

ensureSettingsDialog();

// 预载题库，进入选题页更快；失败时只在控制台提示
Promise.allSettled([loadStructuredQuestions(), loadMathQuestions()]).then((results) => {
  results.forEach((item) => {
    if (item.status === 'rejected') console.warn('[home] 题库预载失败：', item.reason?.message || item.reason);
  });
});

// 未配置 AI 时，在提示条上补一句状态说明（不打断阅读）
if (!isLlmConfigured()) {
  const tip = document.querySelector('section.border-amber-200');
  if (tip) tip.setAttribute('data-ai-state', 'local');
}

/* ------------------------- 海洋背景：后台暂停动效 ------------------------- */

const oceanScene = document.querySelector('.ocean-scene');
if (oceanScene) {
  const syncOceanMotion = () => {
    oceanScene.classList.toggle('is-paused', document.hidden);
  };
  document.addEventListener('visibilitychange', syncOceanMotion);
  syncOceanMotion();
}

/* ------------------------- 继续上次练习 ------------------------- */

function formatAt(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderResume() {
  const record = lastPractice.get();
  const card = document.querySelector('#resume-card');
  const link = document.querySelector('#resume-link');
  if (!card || !link || !record?.id) return;

  const isMath = record.mode === 'math';
  link.href = `${isMath ? 'math.html' : 'structured.html'}?id=${encodeURIComponent(record.id)}`;
  document.querySelector('#resume-title').textContent = record.title || (isMath ? '数学试讲' : '结构化面试');
  document.querySelector('#resume-meta').textContent = `${isMath ? '试讲' : '结构化'} · ${formatAt(record.at)}`;
  card.classList.remove('hidden');
}

renderResume();
