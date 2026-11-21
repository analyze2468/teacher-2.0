/**
 * PWA 启动脚本：注册 Service Worker + 记录安装能力
 *
 * 边界说明：本文件只做「安装 / 离线」相关的事情，不读取也不改写任何业务数据，
 * 不干预计时、录音、评分、AI 配置（localStorage 与服务端请求都不经过这里）。
 *
 * - 只在 http / https 下注册（file:// 打开时浏览器不支持 Service Worker）
 * - 不调用 beforeinstallprompt.preventDefault()，保留浏览器自带的「安装」入口
 *   （桌面 Chrome/Edge 地址栏右侧的安装图标、移动端菜单里的「安装应用 / 添加到主屏幕」）
 * - 需要手动触发时可在控制台调用 window.pwa.install()
 */
(function () {
  'use strict';

  const SW_URL = 'sw.js';

  /* ------------------------------ 安装能力 ------------------------------ */

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    // 不 preventDefault：浏览器原生的安装按钮 / 安装提示保持可用
    deferredPrompt = event;
    window.dispatchEvent(new CustomEvent('pwa:installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.documentElement.dataset.installed = 'true';
    window.dispatchEvent(new CustomEvent('pwa:installed'));
  });

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) document.documentElement.dataset.displayMode = 'standalone';

  /** 手动触发安装：仅当浏览器给出 beforeinstallprompt 时可用 */
  async function install() {
    if (!deferredPrompt) return { ok: false, reason: 'not-installable' };
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }

  window.pwa = {
    get installable() {
      return Boolean(deferredPrompt);
    },
    get standalone() {
      return isStandalone;
    },
    install
  };

  /* ---------------------------- 注册 Service Worker ---------------------------- */

  if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;

  let pendingWorker = null;

  /** 新版本就绪后，等页面不可见时再切换，避免打断正在进行的计时 / 录音 */
  function scheduleActivation(worker) {
    if (!worker) return;
    pendingWorker = worker;
    document.addEventListener('visibilitychange', activateWhenHidden);
  }

  function activateWhenHidden() {
    if (document.visibilityState !== 'hidden' || !pendingWorker) return;
    document.removeEventListener('visibilitychange', activateWhenHidden);
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
    pendingWorker = null;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: './', updateViaCache: 'none' })
      .then((registration) => {
        // 主动检查一次新版本：否则浏览器可能把 sw.js 的更新检查推迟到之后的导航，
        // 改完 js / css 后容易长时间看到缓存里的旧界面。
        registration.update().catch(() => {});
        // 已有页面在用旧版本时，新版本装好后等待切换时机
        if (registration.waiting && navigator.serviceWorker.controller) {
          scheduleActivation(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              scheduleActivation(installing);
            }
          });
        });
      })
      .catch((error) => {
        // 注册失败不影响页面本身：无网、隐私模式或非安全上下文都可能出现
        console.warn('[pwa] Service Worker 注册失败：', (error && error.message) || error);
      });
  });
})();
