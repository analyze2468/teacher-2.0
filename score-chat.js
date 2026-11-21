/**
 * 评分后的「考官追问」窗口（双模式）
 *
 * 设计要点
 * 1. 上下文绑定：题目、考生作答、本次评分（总分 / 等级 / 维度 / 问题 / 建议）全部写入
 *    system prompt，且每轮请求都会重新带上，模型不会「失忆」；
 * 2. 会话留存：按「模式 + 题目 id」写入 localStorage，刷新页面或重新评分后仍可接着聊；
 * 3. 双模式切换：AI 动态追问（大模型实时回答）↔ 预设追问库（逐题绑定、本地生成，
 *    未配置 AI / 余额不足 / 请求失败时也能用），选择记在 localStorage；
 * 4. 降级友好：未配置 AI 时给出引导按钮（复用 settings.js 的 data-open-settings 委托），
 *    不静默失败；请求异常时把错误原样显示在对话里，方便排查 CORS / 密钥问题。
 */

import { toast } from './utils.js';
import { isLlmConfigured, requestChat } from './llm.js';
import { buildFollowups, buildLocalReply } from './followups.js';

const HISTORY_PREFIX = 'pb.scoreChat.';
const MAX_MESSAGES = 24; // 只保留最近 12 轮，防止 token 无限膨胀
const MAX_ANSWER_CHARS = 2200;
const MAX_ANALYSIS_CHARS = 900;

const QUICK_PROMPTS = {
  structured: [
    '帮我把这题重答成 2 分钟标准答案',
    '我的表达里有哪些减分习惯？',
    '考官还可能怎么追问？'
  ],
  trial: [
    '帮我把导入改得更自然',
    '这节课的板书怎么设计更好？',
    '时间不够时哪里可以删？'
  ]
};

/**
 * 追问模式（双模式，界面上可随时切换）
 * - ai：保留原有的大模型动态追问，结合本题、作答与评分实时回答；
 * - preset：静态预设追问库，逐题绑定、本地拼装，不调用大模型也能用。
 */
const MODE_KEY = 'pb.scoreChatMode';

function loadPanelMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'ai' || saved === 'preset') return saved;
  } catch (error) {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  // 没配置过大模型时直接进预设库，保证「打开就能用」
  return isLlmConfigured() ? 'ai' : 'preset';
}

function modeLabel(mode) {
  return mode === 'trial' ? '数学试讲' : '结构化面试';
}

function clip(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}……（后文已截断）`;
}

function historyKey(mode, questionId) {
  return `${HISTORY_PREFIX}${mode === 'trial' ? 'trial' : 'structured'}.${questionId || 'unknown'}`;
}

function loadHistory(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.messages) ? parsed.messages : [];
    return list
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && item.content)
      .slice(-MAX_MESSAGES);
  } catch (error) {
    return [];
  }
}

function saveHistory(key, messages) {
  try {
    localStorage.setItem(key, JSON.stringify({
      updatedAt: new Date().toISOString(),
      messages: messages.slice(-MAX_MESSAGES)
    }));
  } catch (error) {
    /* 隐私模式 / 配额满：只影响刷新后的延续，不影响本次对话 */
  }
}


/** 题目摘要：结构化取题目 + 题型，试讲取课题 + 教材 + 要求 */
function describeQuestion(mode, question) {
  if (!question) return '（本题信息缺失）';
  if (mode === 'trial') {
    return [
      `课题：${question.title || question.topic || ''}`,
      `教材：${[question.grade, question.source].filter(Boolean).join(' ') || '未标注'}`,
      `试讲题目：${question.question || ''}`,
      `教学目标：${(question.objectives || []).join('；') || '未标注'}`,
      `重点：${(question.keyPoints || []).join('；') || '未标注'}`,
      `难点：${(question.difficulties || []).join('；') || '未标注'}`,
      `板书要点：${question.boardPlan || '未标注'}`
    ].join('\n');
  }
  return [
    `题目：${question.question || ''}`,
    `题型：${question.type || '未标注'}`,
    `难度：${question.difficulty || '-'} / 3`,
    `参考得分点：${(question.key_points || []).join('；') || '未标注'}`
  ].join('\n');
}

/** 评分摘要：只挑「能支撑追问」的字段，控制 token */
function describeResult(result) {
  if (!result) return '（暂无评分结果）';
  const dimensions = (result.dimensions || [])
    .map((item) => `${item.name} ${item.score}/${item.max}${item.comment ? `（${item.comment}）` : ''}`)
    .join('；');
  return [
    `总分：${result.total} / 100`,
    `等级：${result.level || ''}`,
    `评分来源：${result.source === 'ai' ? 'AI 评分' : '本机规则评分（关键词 / 结构估算，仅供参照）'}`,
    `维度得分：${dimensions || '无'}`,
    `做得好的地方：${(result.highlights || []).join('；') || '无'}`,
    `需要改进的地方：${(result.issues || []).join('；') || '无'}`,
    `下次练习建议：${(result.tips || []).join('；') || '无'}`,
    `整体解析：${clip(result.analysis, MAX_ANALYSIS_CHARS) || '无'}`
  ].join('\n');
}

function buildSystemPrompt({ mode, question, answer, result }) {
  const isTrial = mode === 'trial';
  return [
    '你是「教资面试陪跑」里的资深面试考官兼教研员，正在给一位考生做赛后的逐句复盘。',
    '',
    '【本次会话的固定背景，必须始终以此为准】',
    `考试类型：${modeLabel(mode)}`,
    describeQuestion(mode, question),
    '',
    '【考生的作答（转写 / 手写要点，可能有错别字）】',
    clip(answer, MAX_ANSWER_CHARS) || '（考生未提交文字内容，仅有录音或照片存档）',
    '',
    '【刚刚给出的评分结果】',
    describeResult(result),
    '',
    '【回答要求】',
    '1. 直接接着上面的题目、作答和评分讲，不要重新提问「你想练习什么题目」，也不要让考生再贴一遍内容；',
    '2. 引用考生原话时先用引号标出，再说明问题，避免空泛评价；',
    `3. 站在${isTrial ? '试讲（10 分钟无生课堂）' : '结构化面试（2 分钟答题）'}的真实场景给建议：${isTrial ? '关注教学环节、提问设计、板书与时间分配' : '关注审题、结构、内容与表达'}；`,
    '4. 给改写示范时，写成考生可以直接背下来的话术，不要只讲道理；',
    '5. 不要编造官方评分标准或「考官一定会怎么打分」，评分只作为练习参考；',
    '6. 中文回答，控制在 350 字以内；需要分点时用「1. 2. 3.」，最后给 1 条马上能做的行动建议；',
    '7. 如果考生问与本次题目无关的内容，先用一句话说明，再简要回答。'
  ].join('\n');
}

export function mountScoreChat(host, options = {}) {
  if (!host) return null;
  const mode = options.mode === 'trial' ? 'trial' : 'structured';
  const question = options.question || null;
  const answer = options.answer || '';
  const result = options.result || null;
  const key = historyKey(mode, question?.id);
  const systemPrompt = buildSystemPrompt({ mode, question, answer, result });

  let messages = loadHistory(key);
  let busy = false;
  // 预设追问库：逐题绑定，本地拼装，不调用大模型
  const followups = buildFollowups({ mode, question, result });
  let panelMode = loadPanelMode();

  // 同一道题重复评分时替换旧窗口，避免叠加
  host.querySelector('[data-score-chat]')?.remove();

  const section = document.createElement('section');
  section.className = 'score-chat';
  section.dataset.scoreChat = '1';
  section.innerHTML = `
    <div class="score-chat__head">
      <div class="min-w-0">
        <h4 class="score-chat__title">考官追问</h4>
        <p class="score-chat__sub">已带入本题、你的作答与本次评分</p>
      </div>
      <button type="button" class="score-chat__reset" data-chat-reset>清空</button>
    </div>
    <div class="score-chat__modes" role="group" aria-label="追问模式">
      <button type="button" class="score-chat__mode" data-chat-mode="ai" aria-pressed="false">AI 动态追问</button>
      <button type="button" class="score-chat__mode" data-chat-mode="preset" aria-pressed="false">预设追问库</button>
    </div>
    <p class="score-chat__mode-hint" data-chat-mode-hint></p>
    <div class="score-chat__panel" data-chat-panel="ai" hidden>
      <div class="score-chat__log" data-chat-log role="log" aria-live="polite" aria-label="AI 追问对话"></div>
      <div class="score-chat__chips" data-chat-chips>
        ${(QUICK_PROMPTS[mode] || QUICK_PROMPTS.structured)
          .map((text) => `<button type="button" class="score-chat__chip" data-chat-prompt>${text}</button>`)
          .join('')}
      </div>
      <form class="score-chat__composer" data-chat-form>
        <textarea
          class="score-chat__input"
          data-chat-input
          rows="1"
          maxlength="600"
          enterkeyhint="send"
          placeholder="继续问：这句话怎么改？考官会追问什么？"
          aria-label="向 AI 考官提问"
        ></textarea>
        <button type="submit" class="score-chat__send" data-chat-send>发送</button>
      </form>
      <p class="score-chat__note">AI 回复仅作练习参考，请结合真实考官反馈判断。</p>
    </div>
    <div class="score-chat__panel" data-chat-panel="preset" hidden>
      <p class="score-chat__note">本题专属追问，点一下展开参考回答；全部本地生成，不调用大模型、不消耗额度。</p>
      <div class="score-chat__presets" data-chat-presets></div>
    </div>
  `;
  host.appendChild(section);

  const log = section.querySelector('[data-chat-log]');
  const form = section.querySelector('[data-chat-form]');
  const input = section.querySelector('[data-chat-input]');
  const sendButton = section.querySelector('[data-chat-send]');
  const chips = section.querySelector('[data-chat-chips]');
  const presetHost = section.querySelector('[data-chat-presets]');
  const modeButtons = Array.from(section.querySelectorAll('[data-chat-mode]'));
  const modeHint = section.querySelector('[data-chat-mode-hint]');
  const resetButton = section.querySelector('[data-chat-reset]');
  const panels = {
    ai: section.querySelector('[data-chat-panel="ai"]'),
    preset: section.querySelector('[data-chat-panel="preset"]')
  };

  function appendBubble(role, text, extraClass = '') {
    const bubble = document.createElement('div');
    bubble.className = `score-chat__msg score-chat__msg--${role}${extraClass ? ` ${extraClass}` : ''}`;
    bubble.textContent = text;
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  function renderHistory() {
    log.innerHTML = '';
    if (!messages.length) {
      appendBubble(
        'bot',
        mode === 'trial'
          ? '我已看过这次的课题、讲稿和评分。想先聊哪一块？例如导入、提问设计、板书或时间分配。'
          : '我已看过这道题、你的作答和评分。想先聊哪一块？例如审题、结构、内容或语言表达。'
      );
      return;
    }
    messages.forEach((item) => appendBubble(item.role === 'user' ? 'user' : 'bot', item.content));
    log.scrollTop = log.scrollHeight;
  }

  /** 渲染预设追问库：题目绑定 + 本地参考答案 */
  function renderPresets() {
    presetHost.innerHTML = '';
    if (!followups.length) {
      const empty = document.createElement('p');
      empty.className = 'score-chat__preset-empty';
      empty.textContent = '本题暂无预设追问，可切换到 AI 动态追问。';
      presetHost.appendChild(empty);
      return;
    }
    followups.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'score-chat__preset';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'score-chat__preset-toggle';
      toggle.dataset.presetToggle = String(index);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = `<span class="score-chat__preset-no">${index + 1}</span><span class="score-chat__preset-label"></span><span class="score-chat__preset-more">展开</span>`;
      toggle.querySelector('.score-chat__preset-label').textContent = item.label;

      const answer = document.createElement('div');
      answer.className = 'score-chat__preset-answer';
      answer.dataset.presetAnswer = String(index);
      answer.hidden = true;

      const ask = document.createElement('p');
      ask.className = 'score-chat__preset-ask';
      ask.textContent = `追问：${item.question}`;

      const body = document.createElement('p');
      body.className = 'score-chat__preset-body';
      body.textContent = item.answer;

      answer.append(ask, body);
      card.append(toggle, answer);
      presetHost.appendChild(card);
    });
  }

  /** 切换追问模式：ai = 大模型动态追问，preset = 静态预设追问库 */
  function applyPanelMode(next, { persist = true } = {}) {
    panelMode = next === 'preset' ? 'preset' : 'ai';
    modeButtons.forEach((button) => {
      const active = button.dataset.chatMode === panelMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    panels.ai.hidden = panelMode !== 'ai';
    panels.preset.hidden = panelMode !== 'preset';
    resetButton.hidden = panelMode !== 'ai';
    if (panelMode === 'preset') {
      modeHint.textContent = '预设追问：逐题绑定本题，点开即看参考回答，不调用大模型。';
    } else if (isLlmConfigured()) {
      modeHint.textContent = 'AI 追问：已接入大模型，回答会结合本题、作答与本次评分。';
    } else {
      modeHint.textContent = 'AI 追问：尚未配置大模型，提问会先用本机参考回答；配好接口后可逐句改写你的原话。';
    }
    if (persist) {
      try {
        localStorage.setItem(MODE_KEY, panelMode);
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  function setBusy(next) {
    busy = next;
    sendButton.disabled = next;
    sendButton.textContent = next ? '思考中…' : '发送';
    input.disabled = next;
    chips.querySelectorAll('button').forEach((button) => {
      button.disabled = next;
    });
  }

  function appendNotice(text, { withPresetSwitch = false } = {}) {
    const notice = document.createElement('div');
    notice.className = 'score-chat__notice';
    notice.innerHTML = `${text} <button type="button" class="score-chat__link" data-open-settings>去配置</button>${
      withPresetSwitch
        ? ' <button type="button" class="score-chat__link" data-chat-switch-preset>切到预设追问库</button>'
        : ''
    }`;
    log.appendChild(notice);
    log.scrollTop = log.scrollHeight;
  }

  /** 本机兜底回答：未配置 AI 或请求失败时，至少给出可用的参考内容 */
  function replyLocally(content) {
    const local = buildLocalReply({ mode, question, result, prompt: content });
    messages.push({ role: 'assistant', content: local.text, local: true });
    saveHistory(key, messages);
    appendBubble('bot', local.text);
    return local;
  }

  async function send(text) {
    const content = String(text || '').trim();
    if (!content || busy) return;

    appendBubble('user', content);
    messages.push({ role: 'user', content });
    saveHistory(key, messages);
    input.value = '';

    if (!isLlmConfigured()) {
      // 没有接口也要有答案：先用本机参考回答顶上，再引导去配置
      replyLocally(content);
      appendNotice('以上是未配置大模型时的本机参考回答。想结合你的原话逐句改写，可以', { withPresetSwitch: true });
      return;
    }

    setBusy(true);
    const thinking = appendBubble('bot', '正在结合本次评分思考…', 'is-thinking');

    try {
      const reply = await requestChat({
        // 每轮都重发 system（题目 / 作答 / 评分）+ 完整会话，保证上下文不丢失；
        // 本机兜底回答（local）只用于展示，不喂给模型，免得它顺着模板作答
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.filter((item) => !item.local)
        ],
        temperature: 0.5,
        maxTokens: 900,
        timeout: 60000
      });
      thinking.remove();
      const replyText = String(reply.content || '').trim();
      messages.push({ role: 'assistant', content: replyText });
      saveHistory(key, messages);
      appendBubble('bot', replyText);
    } catch (error) {
      thinking.remove();
      const status = error?.status ? `（HTTP ${error.status}）` : '';
      appendBubble(
        'bot',
        `追问失败：${error?.message || '未知错误'}${status}\n可以检查 AI 配置、余额或跨域限制后重试；下面先按本题给你一份本机参考回答。`,
        'is-error'
      );
      console.warn('[score-chat] 追问失败', error);
      if (error?.code === 'no_key') toast('请先在设置里填写 API Key', { type: 'warning' });
      // 请求失败也不让对话空着
      replyLocally(content);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send(input.value);
    }
  });

  resetButton.addEventListener('click', () => {
    if (busy || !messages.length) return;
    if (!window.confirm('清空这道题的追问记录？（评分结果与讲稿不受影响）')) return;
    messages = [];
    try {
      localStorage.removeItem(key);
    } catch (error) {
      /* 忽略 */
    }
    renderHistory();
    toast('已清空本题对话');
  });

  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chat-prompt]');
    if (!chip || busy) return;
    send(chip.textContent || '');
  });

  // 模式切换：AI 动态追问 ↔ 预设追问库（选择会记住）
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => applyPanelMode(button.dataset.chatMode));
  });

  // 预设追问：点开展开 / 收起本地参考回答，全程不联网
  presetHost.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-preset-toggle]');
    if (!toggle) return;
    const index = toggle.dataset.presetToggle;
    const answer = presetHost.querySelector(`[data-preset-answer="${index}"]`);
    const card = toggle.closest('.score-chat__preset');
    if (!answer || !card) return;
    const open = answer.hidden;
    answer.hidden = !open;
    card.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    const more = toggle.querySelector('.score-chat__preset-more');
    if (more) more.textContent = open ? '收起' : '展开';
  });

  // 未配置大模型时的引导：一键切到预设追问库
  section.addEventListener('click', (event) => {
    if (!event.target.closest('[data-chat-switch-preset]')) return;
    applyPanelMode('preset');
  });

  renderPresets();
  applyPanelMode(panelMode, { persist: false });
  renderHistory();

  return {
    element: section,
    destroy() {
      section.remove();
    }
  };
}
