/**
 * AI 设置面板（方案一：纯前端 + localStorage）
 * - 预设 DeepSeek / 通义千问 / 智谱 GLM / OpenAI，也支持任意 OpenAI 兼容端点；
 * - 密钥仅保存在本机 localStorage，不会上传到本项目以外的服务器；
 * - 未配置或请求失败时，页面自动降级为本机规则评分。
 */

import { $, toast } from './utils.js';
import { settings } from './storage.js';
import { requestChat } from './llm.js';

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  dashscope: {
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyUrl: 'https://bailian.console.aliyun.com/'
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    keyUrl: ''
  }
};

const DIALOG_ID = 'ai-settings-dialog';

function buildOptions(current) {
  return Object.entries(PROVIDERS)
    .map(([key, item]) => `<option value="${key}"${key === current ? ' selected' : ''}>${item.label}</option>`)
    .join('');
}

function buildMarkup() {
  const current = settings.get();
  return `
  <div id="${DIALOG_ID}" hidden>
    <div class="dialog-backdrop" data-close-settings></div>
    <div class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
      <div class="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div>
          <h2 id="ai-settings-title" class="text-base font-bold text-slate-900">AI 评分配置</h2>
          <p class="mt-0.5 text-[11px] text-slate-500">密钥只保存在本机浏览器，不会上传</p>
        </div>
        <button type="button" class="btn-icon" data-close-settings aria-label="关闭设置">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>

      <form id="ai-settings-form" class="space-y-4 p-4" novalidate>
        <div>
          <label class="mb-1.5 block text-sm font-semibold text-slate-700" for="ai-provider">服务商</label>
          <select id="ai-provider" class="field">${buildOptions(current.provider)}</select>
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-semibold text-slate-700" for="ai-base-url">接口地址（Base URL）</label>
          <input id="ai-base-url" class="field" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com/v1" value="${current.baseUrl || ''}">
          <p class="mt-1 text-[11px] text-slate-400">需以 /v1 或 /v4 结尾，页面会自动补全 /chat/completions。</p>
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-semibold text-slate-700" for="ai-model">模型名称</label>
          <input id="ai-model" class="field" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-chat" value="${current.model || ''}">
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <label class="block text-sm font-semibold text-slate-700" for="ai-api-key">API Key</label>
            <a id="ai-key-link" class="text-[11px] font-semibold text-brand-600 underline underline-offset-2" href="#" target="_blank" rel="noopener">获取密钥</a>
          </div>
          <div class="relative">
            <input id="ai-api-key" class="field pr-14" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..." value="${current.apiKey || ''}">
            <button type="button" id="ai-key-toggle" class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">显示</button>
          </div>
          <p class="mt-1 text-[11px] text-slate-400">仅存放在本机 localStorage，清除浏览器数据会一并删除。</p>
        </div>

        <div id="ai-test-result" class="hidden rounded-xl border px-3 py-2 text-xs leading-relaxed"></div>

        <div class="flex gap-2">
          <button type="button" id="ai-test-btn" class="btn btn-secondary btn-sm flex-1">测试连接</button>
          <button type="submit" class="btn btn-primary btn-sm flex-1">保存配置</button>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p class="text-[11px] leading-relaxed text-slate-400">浏览器会直连服务商接口，若提示跨域失败，请改用支持浏览器调用的接口或本地代理。</p>
          <button type="button" id="ai-clear-btn" class="shrink-0 text-xs font-semibold text-rose-600 hover:underline">清除</button>
        </div>
      </form>
    </div>
  </div>`;
}

function setTestResult(message, type = 'info') {
  const box = $('#ai-test-result');
  if (!box) return;
  if (!message) {
    box.className = 'hidden';
    box.textContent = '';
    return;
  }
  const tone = {
    info: 'border-slate-200 bg-slate-50 text-slate-600',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-rose-200 bg-rose-50 text-rose-700'
  }[type] || 'border-slate-200 bg-slate-50 text-slate-600';
  box.className = `rounded-xl border px-3 py-2 text-xs leading-relaxed whitespace-pre-line ${tone}`;
  box.textContent = message;
}

function readForm() {
  const stored = settings.get();
  return {
    provider: $('#ai-provider')?.value || 'custom',
    baseUrl: $('#ai-base-url')?.value.trim() || '',
    model: $('#ai-model')?.value.trim() || '',
    apiKey: $('#ai-api-key')?.value.trim() || '',
    temperature: typeof stored.temperature === 'number' ? stored.temperature : 0.3
  };
}

function fillByProvider(providerKey) {
  const preset = PROVIDERS[providerKey];
  if (!preset || providerKey === 'custom') return;
  const baseUrlInput = $('#ai-base-url');
  const modelInput = $('#ai-model');
  if (baseUrlInput) baseUrlInput.value = preset.baseUrl;
  if (modelInput) modelInput.value = preset.model;
  const link = $('#ai-key-link');
  if (link) {
    link.href = preset.keyUrl || '#';
    link.classList.toggle('hidden', !preset.keyUrl);
  }
}

function closeDialog() {
  const dialog = $(`#${DIALOG_ID}`);
  if (!dialog) return;
  dialog.hidden = true;
  document.body.classList.remove('dialog-open');
}

function openDialog() {
  ensureSettingsDialog();
  const dialog = $(`#${DIALOG_ID}`);
  if (!dialog) return;
  const current = settings.get();
  $('#ai-provider').value = current.provider || 'deepseek';
  $('#ai-base-url').value = current.baseUrl || '';
  $('#ai-model').value = current.model || '';
  $('#ai-api-key').value = current.apiKey || '';
  $('#ai-api-key').type = 'password';
  $('#ai-key-toggle').textContent = '显示';
  const preset = PROVIDERS[current.provider] || PROVIDERS.custom;
  const link = $('#ai-key-link');
  if (link) {
    link.href = preset.keyUrl || '#';
    link.classList.toggle('hidden', !preset.keyUrl);
  }
  setTestResult('');
  dialog.hidden = false;
  document.body.classList.add('dialog-open');
  setTimeout(() => $('#ai-provider')?.focus(), 60);
}
function bindSettingsEvents() {
  const dialog = $(`#${DIALOG_ID}`);
  if (!dialog) return;

  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-settings]')) closeDialog();
  });

  $('#ai-provider').addEventListener('change', (event) => {
    fillByProvider(event.target.value);
  });

  const keyInput = $('#ai-api-key');
  const keyToggle = $('#ai-key-toggle');
  keyToggle.addEventListener('click', () => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    keyToggle.textContent = show ? '隐藏' : '显示';
  });

  const testButton = $('#ai-test-btn');
  testButton.addEventListener('click', async () => {
    const config = readForm();
    if (!config.baseUrl || !config.model || !config.apiKey) {
      setTestResult('请先填写接口地址、模型名称与 API Key。', 'error');
      return;
    }
    const original = testButton.textContent;
    testButton.disabled = true;
    testButton.textContent = '测试中…';
    setTestResult('正在请求模型接口，请稍候…', 'info');
    try {
      const result = await requestChat({
        config,
        messages: [{ role: 'user', content: '请只回复四个字：连接成功' }],
        maxTokens: 32,
        temperature: 0,
        timeout: 25000
      });
      setTestResult(`连接成功：${result.model} 返回「${String(result.content).trim().slice(0, 40)}」`, 'success');
      toast('连接成功', { type: 'success' });
    } catch (error) {
      const statusText = error.status ? `（HTTP ${error.status}）` : '';
      setTestResult(
        `连接失败：${error.message}${statusText}\n可能原因：密钥错误、余额不足、模型名不对，或服务商未开放浏览器跨域（CORS）。`,
        'error'
      );
      console.warn('[settings] 测试连接失败', error);
    } finally {
      testButton.disabled = false;
      testButton.textContent = original;
    }
  });

  $('#ai-settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const config = readForm();
    if (!/^https?:\/\//i.test(config.baseUrl)) {
      toast('接口地址需以 http:// 或 https:// 开头', { type: 'warn' });
      return;
    }
    if (!config.model) {
      toast('请填写模型名称', { type: 'warn' });
      return;
    }
    if (!config.apiKey) {
      toast('请填写 API Key；如只想使用本机评分，请点“清除”', { type: 'warn' });
      return;
    }
    settings.save(config);
    toast('AI 配置已保存（仅存于本机）', { type: 'success' });
    closeDialog();
    document.dispatchEvent(new CustomEvent('pb:settings-changed'));
  });

  $('#ai-clear-btn').addEventListener('click', () => {
    if (!window.confirm('确定清除本机保存的 AI 配置与密钥？清除后使用本机规则评分。')) return;
    settings.clear();
    const preset = PROVIDERS.deepseek;
    $('#ai-provider').value = 'deepseek';
    $('#ai-base-url').value = preset.baseUrl;
    $('#ai-model').value = preset.model;
    $('#ai-api-key').value = '';
    setTestResult('已清除配置，之后提交将使用本机规则评分。', 'info');
    toast('已清除 AI 配置', { type: 'info' });
    document.dispatchEvent(new CustomEvent('pb:settings-changed'));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDialog();
  });
}

export function ensureSettingsDialog() {
  if (!$(`#${DIALOG_ID}`)) {
    const host = document.createElement('div');
    host.innerHTML = buildMarkup();
    document.body.appendChild(host.firstElementChild);
    bindSettingsEvents();
  }
  // 任意页面上的齿轮按钮 / 提示条都可打开设置
  if (!document.body.dataset.settingsDelegated) {
    document.body.dataset.settingsDelegated = '1';
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-open-settings]');
      if (!trigger) return;
      event.preventDefault();
      openDialog();
    });
  }
}

export function openSettingsDialog() {
  openDialog();
}


