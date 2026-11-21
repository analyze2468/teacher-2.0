/**
 * 通用工具函数
 * 约定：所有页面脚本均以 ES Module 方式导入本文件，不使用全局变量。
 */

/** 查询单个元素 */
export const $ = (selector, root = document) => root.querySelector(selector);

/** 查询多个元素并返回数组 */
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** HTML 转义，防止把用户输入 / 模型输出当标签执行 */
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

/**
 * 富文本渲染（安全）：
 * 1) 先整体转义，杜绝 HTML 注入；
 * 2) 支持 **重点内容** → 红色加粗（教资解析里的重点句标红）；
 * 3) 支持段落与单换行。
 */
export function renderRich(text = '') {
  const escaped = escapeHtml(text).replace(/\r\n/g, '\n').trim();
  if (!escaped) return '';
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="mark-key">$1</span>');
}

/** 秒 → mm:ss */
export function formatClock(totalSeconds = 0) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const seconds = String(safe % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** 秒 → 1 分 20 秒 */
export function formatDuration(totalSeconds = 0) {
  const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (safe < 60) return `${safe} 秒`;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

/** 生成唯一 id */
export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 数字区间限制 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 防抖 */
export function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 统计非空白字符数（中文按 1 个字计） */
export function countChars(text = '') {
  return String(text).replace(/\s/g, '').length;
}

/** 统一 Toast 提示 */
export function toast(message, options = {}) {
  const { type = 'info', duration = 2600 } = options;
  let host = $('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  item.className = `toast${type === 'info' ? '' : ` toast--${type}`}`;
  item.textContent = String(message);
  host.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = 'opacity .2s ease';
    setTimeout(() => item.remove(), 220);
  }, Math.max(1200, duration));
}

/** 按钮 loading 状态（自动保存原始内容） */
export function setButtonLoading(button, loading, loadingText = '处理中…') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span><span>${escapeHtml(loadingText)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

/** 提示音：用 WebAudio 合成，不依赖音频文件 */
export function beep(times = 2) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    let startAt = ctx.currentTime + 0.02;
    for (let index = 0; index < times; index += 1) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.32);
      startAt += 0.42;
    }
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, (times * 0.45 + 0.8) * 1000);
  } catch (error) {
    // 静默失败：提示音不是关键路径
    console.warn('[beep] 无法播放提示音', error);
  }
}

/** 手机震动提醒（部分浏览器不支持） */
export function vibrate(pattern = [200, 100, 200]) {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch (error) {
    console.warn('[vibrate] 不支持震动', error);
  }
}

/** 复制文本到剪贴板 */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    console.warn('[copyText] clipboard 失败，尝试降级', error);
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch (error) {
    console.warn('[copyText] 复制失败', error);
    return false;
  }
}

/** 读取文本文件 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

/** 下载文本为文件 */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 字节 → 易读体积 */
export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** 安全滚动到元素（避开吸顶导航） */
export function scrollToElement(element, offset = 72) {
  if (!element) return;
  const top = element.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}

/** 图片压缩：拍照/相册上传前统一处理，控制存档体积 */
export async function compressImage(file, { maxSize = 1280, quality = 0.8 } = {}) {
  if (!file || !String(file.type).startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  const bitmap = await loadImage(file);
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return { dataUrl, blob, width: canvas.width, height: canvas.height };
}

function loadImage(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImageElement(file));
  }
  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };
    image.src = url;
  });
}

/** 全屏查看图片（用于拍照存档缩略图） */
export function showPhotoOverlay(dataUrl) {
  const overlay = document.createElement('div');
  overlay.className = 'photo-overlay';
  overlay.innerHTML = `<img src="${dataUrl}" alt="作答照片预览">`;
  document.body.appendChild(overlay);
  document.body.classList.add('dialog-open');

  function close() {
    overlay.remove();
    document.body.classList.remove('dialog-open');
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
}
