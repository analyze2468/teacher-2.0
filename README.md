# 教资面试陪跑 2.0（初中 & 高中数学）

纯静态多页应用：HTML + 本地 Tailwind + 原生 ES Module，无构建工具、无后端。
用于教资面试练习：**结构化问答**（五大题型，2 分钟限时）+ **数学试讲**（初中 / 高中，10 分钟流程与板书）。
评分后可继续和「AI 考官」追问复盘；首页是竖版静态启动页，不依赖任何 CDN，断网也能完整打开。

> **2.0 与 1.0 的隔离**：本目录由「教资面试学习室」完整复制而来，之后所有改动只在本目录进行。
> 原产品目录保持只读、不再变更。为了两个版本能同时打开、数据互不干扰，2.0 做了三处隔离：
>
> | 项目 | 1.0 教资面试学习室 | 2.0 教资面试陪跑 |
> | --- | --- | --- |
> | 本地端口 | `8000` | `8001` |
> | localStorage 前缀 / IndexedDB 库名 | `tss.` / `tss-database` | `pb.` / `pb-database` |
> | Service Worker 缓存 | `jzms-precache-*` / `jzms-runtime-*` | `pb-precache-*` / `pb-runtime-*`（升级时只清 `pb-*`） |
>
> 因此 2.0 不会读到 1.0 的 AI Key、练习记录与我的模板，也不会把 1.0 的离线缓存清掉。

## 一、运行

必须通过本地 HTTP 服务打开（`file://` 下浏览器会拦截 `fetch` 读取 JSON，录音也拿不到麦克风权限）。

```powershell
cd 'E:\vibecoding_project\产品：教资面试陪跑2.0'
python -m http.server 8001
```

浏览器访问：<http://localhost:8001/index.html>

> 没有 Python 时，任选一种静态服务器：`npx serve`、VS Code 的 Live Server 插件等。
>
> **Windows 一键启动**：双击项目根目录的 `start.cmd`。它会先 `cd` 到项目根目录（`%~dp0`）再起 `8001` 端口的服务并自动打开首页——服务的工作目录必须是本项目根目录，否则访问 `structured.html` 会 404。
> 1.0 仍占用 `8000`，两个版本可以同时开、互不影响。

## 二、页面

| 页面 | 作用 |
| --- | --- |
| `index.html` | 竖版启动页（静态主视觉：夜间跑道 + 蓝色光轨 + 奔跑少年 + 地面倒影）＋「开始学习」「产品介绍」＋ 底部三入口（结构化 / 数学试讲 / 练习记录） |
| `home.html` | 学习室入口：「开始学习」后的练习入口（结构化 / 数学试讲 / 练习记录 / 示范视频）+ 继续上次 + AI 设置齿轮 |
| `product.html` | 产品介绍页：2.0 的功能清单与使用说明 |
| `structured-hub.html` | 结构化一级页：五大题型，每题型的「查看模板 / 刷题」两个入口 |
| `structured-template.html?type=self` | 题型模板页：只放该题型的答题框架、过渡句、示范与失分点 |
| `structured-list.html?type=self` | 该题型的题目列表：搜索、随机抽题，点进去作答 |
| `structured.html?id=S001` | 单题作答：题干 → 固定 2 分钟计时 → 换题 / 提交评分（不含模板） |
| `select.html?mode=structured` | 旧的结构化选题页（题库全量浏览，仍可用；主入口已改为题型页） |
| `select.html?mode=math` | 试讲选题：初中 / 高中切换（代数 / 几何 / 统计与概率），支持 `?stage=senior` 深链 |
| `math.html?id=M001` | 试讲：课题 → 流程与板书 → 计时讲稿 → 评分，页内可切初中 / 高中 |
| `records.html` | 练习记录：练习次数/平均分/最高分、按题型筛选与排序、单条维度详情、重做与删除/清空 |
| `videos.html` | 示范视频位：有 `embedUrl` 就内嵌，没有就跳 B 站搜索 |
| `card.html` | 与本项目无关的旧文件，可删除 |
| `_shot.html` | 截图用的临时空白页，与功能无关，可删除 |

**结构化练习流程**：`structured-hub.html` 选题型 → ①「查看模板」进 `structured-template.html?type=xxx`（只放该题型框架）／②「刷题」进 `structured-list.html?type=xxx` 挑题 → `structured.html?id=Sxxx` 只给题干 + 固定 2 分钟计时 + 换题 + 提交评分。模板与作答页完全分开，作答时看不到框架；换题只在同一题型内抽，计时自动回到 02:00。

**首页视觉（竖版启动页）**：`index.html` 是纯静态启动页，不加载 React / @react-three/fiber / WebGL，也没有 canvas；主视觉是一张本地 JPEG（`assets/img/landing-hero.jpg`，1170×1405），标题 / 副标题 /「开始学习」/ 底部导航都是普通 DOM 叠在图片之上。

- 主视觉来源：从人物参考图（夜间跑道 + 冲刺少年 + 湿地面倒影）裁切、去掉原图文字与水印后导出，86% 质量、约 190KB；`<link rel="preload" fetchpriority="high">` 提前拉取，不阻塞首屏渲染。
- 叠加方式：**严格视口居中**——`.landing__hero-edge` 用 `left: 50%; top: 50%; transform: translate(-50%, -50%)` 落在画面正中心，桌面端与移动端同一个锚点；宽度取 `min(104%, 860px, 78vh)`，再用 `max-width / max-height: 100%` 兜底，图片高度永远不会超过 94vh，窄屏 / 矮屏都不会顶出屏幕；`background-size: cover` 保证任何兜底裁切都不拉伸变形（恒定 1170:1405）。顶部与左右两侧用 `mask-image` 渐隐（手机 16%、≥720px 15%），接进夜色不会出现「贴了一张图」的硬边。
- 层级：主视觉在 `.landing__stage`（`z-index: 0`），文案在 `.landing__ui`（`z-index: 2`），标题 / 按钮自己再带 `position: relative; z-index: 1`，人物居中后重叠区域也永远由按钮压在上面，点击热区不受影响。
- 各断点只调文案与外框密度（字号、按钮排布、底部导航高度），不再偏移主视觉：≥720px 只把两侧渐隐加宽，手机横屏（`orientation: landscape` 且高 ≤ 460px）同样居中，尺寸按 `78vh` 自动缩小到画面以内。
- 动效克制：只做首屏淡入（品牌名 / 按钮 / 底部导航）与「开始学习」的呼吸光；`prefers-reduced-motion` 下全部关闭。
- 没有 3D 开关与降级逻辑：首页不请求 esm.sh，断网也完整显示。

## 三、PWA：安装到桌面 / 离线使用

本项目已具备 PWA 能力（纯静态实现，无需构建）：

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 应用名「结构化面试 · 教资面试陪跑」、短名「教资陪跑」、`display: standalone`、启动背景与主题色 `#0b0d12`（与首页夜色同色，避免启动闪白）、4 个图标（含 maskable）、3 个快捷方式（结构化刷题 / 数学试讲 / 练习记录） |
| `sw.js` | Service Worker（`CACHE_VERSION = v13`）：预缓存全部页面 + css/js/json/图片（含首页主视觉 `landing-hero.jpg`）；页面 network-first、静态资源 stale-while-revalidate、`data/*.json` network-first；跨域请求与 Range 请求直接放行（AI 接口、B 站播放器、录音回放不受影响） |
| `js/pwa.js` | 注册 Service Worker、新版本在页面隐藏时切换、捕获安装事件（不拦截浏览器自带的安装入口） |
| `assets/img/*` | `icon-192/512`（any）、`icon-maskable-192/512`（安全区内）、`apple-touch-icon`（iOS）、`favicon.ico` / `favicon-32` |

**安装（Chrome / Edge 桌面）**：用 `http://localhost:8001` 或 HTTPS 打开首页 → 地址栏右侧出现「安装」图标（或在菜单里选「安装 结构化面试 · 教资面试陪跑」）。安装后以独立窗口运行，任务栏/开始菜单使用上面的图标。

**安装（Android Chrome）**：地址栏下方/菜单中选择「安装应用」或「添加到主屏幕」；**iOS Safari** 用「分享 → 添加到主屏幕」（iOS 读 `apple-touch-icon`，不使用 manifest 的图标，但图标已一并提供）。

**离线**：首次打开联网一次后，`index.html`、全部页面、样式、脚本、题库 JSON 都会进入缓存，断网仍可打开页面、看模板、刷题、计时、本机规则评分；「AI 评分 / AI 追问」在有网且配好接口时才调用服务商，未配置或断网时分别自动降级为本机规则评分、本机参考回答，功能不中断。首页主视觉是本地图片（同时也在预缓存清单里），不依赖任何 CDN，断网同样完整显示。

**手动触发安装**：控制台执行 `await window.pwa.install()`；`window.pwa.installable` 可判断当前是否具备安装条件。

**发布到 GitHub Pages**：把整个目录（含 `manifest.json`、`sw.js`、`.nojekyll`）推到仓库 → Settings → Pages → 分支选 `main` / 目录选 `/ (root)` → 访问 `https://<用户名>.github.io/<仓库名>/`。所有路径都是相对路径，`scope` 自动落在子目录下，不需要改配置。⚠️ 必须是 HTTPS（GitHub Pages 默认支持）才能注册 Service Worker。

**改了文件后**：

- 只改业务/样式：SW 的静态资源策略会在后台自动更新缓存，刷新两次即生效。
- 改了预缓存清单（增删页面、改文件名）或改了 `js/*.js` 里的业务代码：把 `sw.js` 顶部的 `CACHE_VERSION` 递增（当前 `v13`，下一版写 `v14`），旧缓存会在下次激活时清掉，避免继续跑旧脚本 / 残留 404。清理只针对 `pb-*` 前缀，不会动到 1.0 的 `jzms-*` 缓存。
- 新版本不会立刻抢切换：`js/pwa.js` 会等你把页面切到后台再切换，避免打断正在进行的计时 / 录音。所以改完代码后请「刷新 → 切到别的标签页再切回 → 再刷新」，或直接关掉浏览器重开。

## 四、AI 评分（可选）

右上角齿轮 → 选择服务商（DeepSeek / 通义千问 / 智谱 GLM / OpenAI / 自定义 OpenAI 兼容端点）→ 填 API Key → “测试连接” → 保存。

- 密钥只存在本机 `localStorage`，不会上传到本项目以外的服务器；换设备需重填。
- **未配置或请求失败时自动降级为本机规则评分**（关键词覆盖 + 结构标志词 + 篇幅），结果卡会标注“本机规则评分”。
- 本机规则评分只用于自查，不等于考官评分。
- **照片（板书 / 答题纸）**：作答区最多上传 3 张照片随本次练习留存。配置了支持视觉的模型时，照片直接随评分请求发给模型读图评分（不做 OCR）；未配置大模型 API 时图片评分不可用，会提示先写文字作答。

### 考官追问（评分后，`js/score-chat.js` + `js/followups.js`）

评分卡下面多出一块「考官追问」，有两种模式，标题下方可随时切换，选择记在 `localStorage`（`pb.scoreChatMode`）：

**① 预设追问库（默认，无需 API Key）**

- 逐题生成，点卡片展开参考回答；全部本地拼装，不发请求、不耗额度。
- 结构化：本次最弱维度怎么补 → 得分点覆盖（带本机 `key_points`）→ 30 秒版怎么说 → 题型专属追问（自我认知 / 人际沟通 / 应急应变 / 组织管理 / 综合分析）→「还有别的办法吗」怎么接。
- 试讲：重点为什么这样定 → 难点怎么突破 → 目标怎么检测 → 板书为什么这样写 → 导入怎么更自然 → 怎么演好互动（读 `keyPoints` / `difficulties` / `objectives` / `boardPlan` / `processHint`）。
- 回答只用 `textContent` 渲染，纯文本、保留换行；未配置 AI 时默认进入这个模式，AI 面板里的「去配置 / 切到预设追问库」也都指向它。

**② AI 动态追问（需配置 API）**

- **上下文绑定**：题目、你的作答、本次评分（总分 / 等级 / 各维度得分与点评 / 问题 / 建议）全部写进 system prompt，而且每一轮都重新带上，多轮聊不会「失忆」。
- **快捷问题**：结构化是「重答成 2 分钟标准答案 / 减分习惯 / 考官还可能怎么追问」，试讲是「导入改自然 / 板书设计 / 时间不够删哪」；也可自己输入（500 字以内）。
- **会话留存**：按「模式 + 题目」存 `localStorage`（`pb.scoreChat.structured.S001`、`pb.scoreChat.trial.M001`），刷新页面或重新评分后接着聊；「清空」只清当前这题，且只影响 AI 面板的显示。
- **答不出也不空着**：未配置接口时提问直接给本机参考回答（`js/followups.js` 的 `buildLocalReply`，标题前缀【本机参考回答】），下面再给「去配置 / 切到预设追问库」；请求失败（超时 / 401 / 跨域）时先显示错误原文，再补一份本机参考回答。这类回答带 `local: true`，会写进本地会话（刷新后仍能看到），但不会作为上下文发给模型，避免它照着模板作答。
- **失败可见**：跨域 / 401 / 超时等错误会把服务商返回的原文显示在对话里，输入框随即恢复可用。
- **省 token**：作答最多带 2200 字、评分分项最多 900 字，历史只保留最近 24 条；请求期间发送按钮显示“…”，避免重复提交。

## 五、目录

```
index.html  home.html  product.html  structured-hub.html  structured-template.html
structured-list.html  structured.html  math.html  select.html
records.html  videos.html  card.html（无关旧文件）  _shot.html（截图临时页）
start.cmd  README.md
manifest.json  sw.js  .nojekyll      PWA：应用清单 / Service Worker / GitHub Pages 免 Jekyll
assets/
  css/app.css              组件样式、富文本、打印
  vendor/tailwind-play.js  Tailwind Play CDN（本地副本，可离线）
  img/                     PWA 图标：icon-192/512、icon-maskable-192/512、apple-touch-icon、favicon，
                           以及首页主视觉 landing-hero.jpg
data/
  structured-questions.json  50 道结构化题（五大题型各 10 道，含题面、参考要点、参考答案）
  structured-templates.json  五大题型模板 + 两套评分维度（structured 六维 / trial 八维）
  math-questions.json        24 个试讲课题（初中 12 + 高中 12，目标、重难点、环节提示、板书）
  math-outline.json          试讲流程 + 三个板块模板
  videos.json                示范视频占位（embedUrl 为空时只显示搜索入口）
js/
  tailwind-config.js  utils.js  storage.js  data-loader.js
  timer.js  picker.js  recorder.js  hold-talk.js  photo-upload.js  template-store.js
  llm.js  settings.js  scoring.js  score-chat.js  followups.js
  pwa.js                     Service Worker 注册 + 安装事件
  landing.js  landing-scene.js  旧版 3D 首页遗留文件（index.html 已不再引用，可删）
  home.js  select-page.js  math-page.js
  structured-nav.js  structured-hub-page.js
  structured-template-page.js  structured-list-page.js  structured-page.js
  records-page.js  videos-page.js
```

## 六、替换成自己的模板 / 题目

**方式 A：直接改 JSON（推荐，改动全局生效）**

- 只改文本，不要改字段名；数组项之间用英文逗号分隔。
- 结构化题型模板：`data/structured-templates.json` → `types[]`，字段 `structure`（答题结构，逐条）、`phrases`（过渡句）、`demo`（示范答案，支持 `**加粗**`）、`pitfalls`（失分点）。
- 结构化题库：`data/structured-questions.json` → `items[]`，`type` 需与模板 `name` 对应（如“自我认知”对应“自我认知类”）。
- 试讲课题：`data/math-questions.json` → `items[]`，`boardId` 取 `algebra` / `geometry` / `statistics`。**新增题目务必写 `stage`**（`junior` 初中 / `senior` 高中），选题页与试讲页的学段切换、随机抽题、「换一题」都按它过滤（缺省时按 `grade` 是否以“必修 / 选择性必修”开头推断）。
- 板块模板：`data/math-outline.json` → `boards[].template`，`process` 为逐条环节（建议保留时间标注）。
- 视频：把 16:9 播放器嵌入地址填入 `videos.json` 的 `embedUrl`（如 `//player.bilibili.com/player.html?bvid=BVxxxx`）。

**方式 B：页面内“我的模板”**（`template-store.js` 已提供读写接口，优先级：用户模板 > 内置）
后续会接入编辑面板；接口为 `saveStructuredOverride(typeId, patch)` / `removeStructuredOverride(typeId)` 与试讲板块对应方法。

## 七、录音与练习记录

**录音**（结构化页 / 试讲页的作答区；结构化固定 2 分钟，录音上限同样 2 分钟）

- 点“● 开始录音”→ 浏览器询问麦克风权限 → 允许后开始计时录音，再点“■ 停止录音”生成回放条。
- 若浏览器支持语音识别（Chrome / Edge 桌面版），转写文字会自动追加到作答框，可再手动润色；不支持的浏览器只录音、不转写，此时请手动打字。
- 录音以内存里的 blob 形式存在，**刷新页面即丢失**，也不会写入 IndexedDB；需要留存请用播放器的下载按钮另存。
- 依赖 HTTPS 或 `localhost`；用 `file://` 打开拿不到麦克风权限。

**记录**（`js/storage.js`）

- 每次生成评分后写一条到 IndexedDB `attempts`（模式、题目、作答、总分、各维度得分），首页“继续上次练习”读 `localStorage` 的 `last-practice` 跳回上一次的题。
- 记录只在本机，清理站点数据会全部丢失。
- 记录页（`records.html`）：顶部统计练习次数 / 平均分 / 最高分，按“全部 / 结构化 / 试讲”筛选并可在“最新优先 / 高分优先”间切换；每条卡片展示总分等级与权重最高的三个维度，展开后可见全部维度、当时作答，并提供“重做这道题”“删除这条”和底部“清空全部记录”。

## 八、当前边界

- 已实现：竖版静态启动页（主视觉 + 开始学习 / 产品介绍 + 底部三入口）、学习室入口页、产品介绍页、结构化题型一级页（模板 / 刷题分离）、题型模板页、按题型刷题列表、单题 2 分钟限时作答、录音与可选转写、照片留存、AI 或本机六维评分、**试讲初中 / 高中双学段切换（24 课题，八维评分）**、**评分后考官追问双模式（AI 动态追问 + 逐题预设追问库；未配置或请求失败时自动给本机参考回答，打开就有答案）**、练习记录页（统计 / 筛选 / 排序 / 维度详情 / 重做 / 删除）、继续上次、示范视频页、设置面板、PWA 安装与离线缓存（`sw.js` v13）。
- 未实现：页面内编辑“我的模板”（`template-store.js` 的覆盖接口已就绪，缺编辑 UI）；试讲语音识别只在支持 Web Speech 的浏览器可用，其余需手动打字；照片评分要求服务商支持视觉模型，纯文本模型只能基于文字作答。
- 根目录 `card.html` 与本站无关，可忽略或删除。

## 九、内容说明

题目与模板整理自公开备考资料并做了改写，仅用于个人练习，不代表官方评分标准；示范答案不是唯一答案。

## 著作权声明
本项目著作权归本人所有。
允许个人学习、本地试用；未经本人书面许可，不得大规模公网部署、二次分发、商用转卖。
如需二次开发、商用授权，请另行沟通。

