/**
 * Service Worker：核心静态资源预缓存 + 基础离线访问
 *
 * 设计要点
 * 1. 只处理同源 GET 请求；跨域（B 站播放器 iframe、AI 接口）与 Range 请求（音视频分段）直接放行，
 *    因此不会影响 AI 评分、录音回放等既有功能。
 * 2. 页面（导航请求）：network-first，超时或断网回落到缓存；带查询参数（?id=S001 / ?type=self）
 *    也能命中已缓存的同名页面（ignoreSearch）。
 * 3. 静态资源（css / js / 图片）：stale-while-revalidate，先给缓存再后台更新，二次打开更快。
 * 4. data/*.json：network-first，题库改动能及时生效，断网时用缓存兜底。
 * 5. 升级方式：修改 CACHE_VERSION，旧缓存会在 activate 阶段被清理。
 *
 * 路径全部使用相对于本文件的 './'，部署到 GitHub Pages 子目录（/repo/）时同样可用。
 */

const CACHE_VERSION = 'v14';
/**
 * 缓存前缀：2.0 使用 pb（practice-buddy）。
 * 「教资面试学习室」用的是 jzms-*，两个版本同域名/同端口打开时不会互相覆盖或清掉对方的缓存。
 */
const CACHE_PREFIX = 'pb';
const PRECACHE = `${CACHE_PREFIX}-precache-${CACHE_VERSION}`;
const RUNTIME = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;
/** 离线兜底页：页面自身没缓存时返回首页 */
const OFFLINE_PAGE = './index.html';
/** 页面/数据的网络超时（毫秒），超时改用缓存，避免弱网一直转圈 */
const NETWORK_TIMEOUT = 3500;

/** 预缓存清单：安装成功后即具备离线能力 */
const CORE_ASSETS = [
  './',
  './index.html',
  './product.html',
  './home.html',
  './structured-hub.html',
  './structured-template.html',
  './structured-list.html',
  './structured.html',
  './select.html',
  './math.html',
  './records.html',
  './ai-chat.html',
  './videos.html',
  './manifest.json',

  './assets/css/app.css',
  './assets/vendor/tailwind-play.js',

  './assets/img/favicon.ico',
  './assets/img/landing-hero.jpg',
  './assets/img/favicon-32.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-maskable-192.png',
  './assets/img/icon-maskable-512.png',
  './assets/img/apple-touch-icon.png',

  './js/pwa.js',
  './js/tailwind-config.js',
  './js/utils.js',
  './js/storage.js',
  './js/data-loader.js',
  './js/timer.js',
  './js/picker.js',
  './js/recorder.js',
  './js/hold-talk.js',
  './js/photo-upload.js',
  './js/template-store.js',
  './js/llm.js',
  './js/settings.js',
  './js/scoring.js',
  './js/score-chat.js',
  './js/ask-ai.js',
  './js/followups.js',
  './js/structured-nav.js',
  './js/home.js',
  './js/select-page.js',
  './js/math-page.js',
  './js/structured-hub-page.js',
  './js/structured-template-page.js',
  './js/structured-list-page.js',
  './js/structured-page.js',
  './js/records-page.js',
  './js/ai-chat.js',
  './js/videos-page.js',

  './data/structured-questions.json',
  './data/structured-templates.json',
  './data/math-questions.json',
  './data/math-outline.json',
  './data/videos.json'
];

/* --------------------------------- 安装 / 激活 --------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // cache: 'reload' 绕过 HTTP 缓存，保证拿到的是最新副本
      await cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, RUNTIME]);
      const keys = await caches.keys();
      // 只清理本应用（pb-*）的旧版本缓存：
      // 同一端口下「教资面试学习室」的 jzms-* 缓存必须原样保留，不能被 2.0 的 activate 清掉。
      await Promise.all(
        keys
          .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && !keep.has(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/** 由 pwa.js 在页面隐藏时调用，用于切换新版本；不会强制刷新页面 */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ----------------------------------- 请求拦截 ----------------------------------- */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // 跨域资源（视频 iframe、AI 接口等）不接管，保持原有网络行为
  if (url.origin !== self.location.origin) return;
  // 音视频分段请求交给浏览器，避免缓存出问题导致回放卡住
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/* ------------------------------------ 策略实现 ------------------------------------ */

/** 页面导航：先网络（带超时），失败回落缓存，再回落首页 */
async function handleNavigation(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached =
      (await caches.match(request)) ||
      (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match(OFFLINE_PAGE, { ignoreSearch: true }));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>离线</title>' +
        '<body style="font:16px/1.7 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;padding:40px;color:#1e293b">' +
        '<h1 style="font-size:18px">当前处于离线状态</h1>' +
        '<p>这个页面还没有缓存。联网后再打开一次，就可以离线使用了。</p></body>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/** 网络优先（data/*.json 用），断网回落缓存 */
async function networkFirst(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) || (await caches.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    throw error;
  }
}

/** 缓存优先 + 后台更新（css / js / 图片等静态资源） */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  // 预缓存与运行时缓存都查一遍
  const cached = (await caches.match(request)) || (await caches.match(request, { ignoreSearch: true }));

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Offline' });
}

/** 带超时的 fetch：超时抛错，交给缓存兜底 */
function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network-timeout')), NETWORK_TIMEOUT);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
