/**
 * 3D 首页 · 控制层（不依赖任何 CDN）
 *
 * 职责
 * 1. 维护 3D 开关状态（localStorage: pb.landing3d），一键关闭后释放 WebGL 资源；
 * 2. 动态 import('./landing-scene.js') 挂载 React + R3F 场景；
 * 3. 任何异常（WebGL 不支持、CDN 不可达、首帧超时、渲染报错）都回落到静态兜底图，
 *    「开始学习」按钮与页面文案始终可用。
 */
const STORAGE_KEY = 'pb.landing3d';
const SCENE_TIMEOUT = 9000;

const body = document.body;
const stage = document.getElementById('landing-stage');
const host = document.getElementById('landing-canvas');
const toggle = document.getElementById('btn-3d');
const toggleLabel = document.getElementById('btn-3d-label');
const statusEl = document.getElementById('landing-status');
const startBtn = document.getElementById('btn-start');

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let enabled = readPreference();
let controller = null;
let mountToken = 0;
let watchdog = 0;
let mounting = false;
let failed = false;
let statusTimer = 0;

/* ----------------------------- 偏好读写 ----------------------------- */

function readPreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'on' || saved === 'off') return saved === 'on';
  } catch (error) {
    /* 隐私模式下 localStorage 可能不可用，忽略即可 */
  }
  // 未设置过：省流量模式 / 减弱动效时默认用静态图，用户可手动开启
  if (navigator.connection && navigator.connection.saveData) return false;
  if (reducedMotionQuery.matches) return false;
  return true;
}

function savePreference(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch (error) {
    /* 存不了就只在本次会话生效 */
  }
}

/* ----------------------------- 状态展示 ----------------------------- */

function setStatus(text, { autoHide = 0 } = {}) {
  if (!statusEl) return;
  clearTimeout(statusTimer);
  if (!text) {
    statusEl.hidden = true;
    statusEl.textContent = '';
    return;
  }
  statusEl.textContent = text;
  statusEl.hidden = false;
  if (autoHide > 0) {
    statusTimer = setTimeout(() => setStatus(''), autoHide);
  }
}

function paintSwitch() {
  body.setAttribute('data-3d', enabled ? 'on' : 'off');
  if (toggle) {
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    toggle.setAttribute(
      'aria-label',
      enabled ? '关闭 3D 动画，改用静态插画' : '开启 3D 动画'
    );
  }
  if (toggleLabel) {
    toggleLabel.textContent = failed ? '3D 重试' : enabled ? '3D 开' : '3D 关';
  }
}

/* ----------------------------- 能力检测 ----------------------------- */

function supportsWebGL() {
  if (!window.WebGLRenderingContext) return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (error) {
    return false;
  }
}

/* ----------------------------- 挂载 / 卸载 ----------------------------- */

function markFailed(message) {
  failed = true;
  mounting = false;
  body.classList.remove('is-3d-loading', 'is-3d-ready');
  body.classList.add('is-3d-failed');
  setStatus(message);
  paintSwitch();
}

function unmountScene({ silent = false } = {}) {
  mountToken += 1;
  clearTimeout(watchdog);
  watchdog = 0;
  mounting = false;
  if (controller) {
    try {
      controller.destroy();
    } catch (error) {
      /* 卸载异常不影响页面 */
    }
    controller = null;
  }
  if (host) host.innerHTML = '';
  body.classList.remove('is-3d-ready', 'is-3d-loading', 'is-3d-failed');
  failed = false;
  if (!silent) setStatus('');
}

async function mountScene() {
  if (!enabled || controller || mounting) return;
  if (!stage || !host) return;

  if (!supportsWebGL()) {
    markFailed('当前浏览器不支持 WebGL，已切换为静态插画');
    return;
  }

  const token = ++mountToken;
  mounting = true;
  failed = false;
  body.classList.add('is-3d-loading');
  body.classList.remove('is-3d-ready', 'is-3d-failed');
  paintSwitch();

  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (token !== mountToken || controller) return;
    unmountScene({ silent: true });
    markFailed('3D 首屏超时（可能网络较慢），已切换为静态插画');
  }, SCENE_TIMEOUT);

  try {
    const sceneModule = await import('./landing-scene.js');
    if (token !== mountToken || !enabled) return; // 加载期间被关闭 / 已卸载
    controller = sceneModule.mountScene(host, {
      onReady() {
        if (token !== mountToken) return;
        clearTimeout(watchdog);
        watchdog = 0;
        mounting = false;
        body.classList.remove('is-3d-loading', 'is-3d-failed');
        body.classList.add('is-3d-ready');
        setStatus('');
        paintSwitch();
      },
      onError(error) {
        if (token !== mountToken) return;
        console.warn('[landing] 3D 渲染失败：', error);
        unmountScene({ silent: true });
        markFailed('3D 渲染失败，已切换为静态插画');
      },
      onDegrade() {
        setStatus('已自动降低画质以保证流畅', { autoHide: 2600 });
      }
    });
    controller.setPaused(document.hidden);
  } catch (error) {
    if (token !== mountToken) return;
    console.warn('[landing] 3D 资源加载失败：', error);
    unmountScene({ silent: true });
    markFailed(
      navigator.onLine
        ? '3D 资源加载失败，已切换为静态插画'
        : '当前离线，已使用静态插画（联网后自动恢复 3D）'
    );
  } finally {
    if (token === mountToken) mounting = false;
  }
}

function applyEnabled(next, { persist = true } = {}) {
  enabled = Boolean(next);
  if (persist) savePreference(enabled);
  if (enabled) {
    failed = false;
    paintSwitch();
    mountScene();
    return;
  }
  unmountScene();
  paintSwitch();
  setStatus('3D 已关闭，页面功能不受影响', { autoHide: 2600 });
}

/* ----------------------------- 事件绑定 ----------------------------- */

if (toggle) {
  toggle.addEventListener('click', () => {
    // 失败状态下点击 = 重试，不必先关再开
    if (failed && enabled) {
      failed = false;
      mountScene();
      return;
    }
    applyEnabled(!enabled);
  });
}

document.addEventListener('visibilitychange', () => {
  if (controller) controller.setPaused(document.hidden);
});

window.addEventListener('online', () => {
  if (failed && enabled) {
    failed = false;
    mountScene();
  }
});

window.addEventListener('pagehide', () => {
  unmountScene({ silent: true });
});

if (reducedMotionQuery.addEventListener) {
  reducedMotionQuery.addEventListener('change', (event) => {
    if (event.matches && !failed) applyEnabled(false, { persist: false });
  });
}

if (startBtn) {
  // 跳转前先暂停动画，避免切换页面的瞬间掉帧（移动端更明显）
  startBtn.addEventListener('click', () => {
    if (controller) controller.setPaused(true);
  });
}

paintSwitch();
if (enabled) mountScene();
