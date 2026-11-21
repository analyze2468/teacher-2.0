/**
 * LLM 接入层（OpenAI 兼容协议）
 * 支持 DeepSeek / 通义千问 / 智谱 GLM / OpenAI / 任意兼容端点。
 * 注意：浏览器直连第三方接口可能被 CORS 拦截，页面会捕获错误并降级为本机规则评分。
 */

import { settings } from './storage.js';

export class LlmError extends Error {
  constructor(message, { code = 'llm_error', status = 0, detail = '' } = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** 读取当前 AI 配置 */
export function getLlmConfig() {
  return settings.get();
}

/** 是否已具备调用条件 */
export function isLlmConfigured() {
  return settings.isConfigured();
}

function normalizeBaseUrl(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function chatEndpoint(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return '';
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/**
 * 发送对话请求
 * @param {object} options
 * @param {Array} options.messages OpenAI 格式消息
 * @param {object} [options.config] 临时覆盖配置（用于“测试连接”）
 */
export async function requestChat({
  messages,
  temperature = 0.3,
  maxTokens = 1800,
  timeout = 60000,
  config = null
} = {}) {
  const current = config || getLlmConfig();
  if (!current?.apiKey) {
    throw new LlmError('尚未配置 API Key，请点击右上角设置', { code: 'no_key' });
  }
  const endpoint = chatEndpoint(current.baseUrl);
  if (!endpoint) {
    throw new LlmError('接口地址为空，请检查 AI 设置', { code: 'no_base_url' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${current.apiKey}`
      },
      body: JSON.stringify({
        model: current.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new LlmError('请求超时，请检查网络或稍后重试', { code: 'timeout' });
    }
    throw new LlmError('网络请求失败：可能是浏览器跨域（CORS）限制、密钥无效或网络不通', {
      code: 'network',
      detail: error.message
    });
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (error) {
      detail = '';
    }
    throw new LlmError(`接口返回 ${response.status}`, {
      code: 'http_error',
      status: response.status,
      detail: String(detail).slice(0, 400)
    });
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new LlmError('接口返回的不是合法 JSON', { code: 'bad_response' });
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError('接口未返回内容', {
      code: 'empty_response',
      detail: JSON.stringify(data).slice(0, 300)
    });
  }
  return { content, usage: data.usage || null, model: data.model || current.model };
}

/** 从模型输出中提取 JSON（兼容 ```json 代码块与前后寒暄） */
export function extractJson(text) {
  if (!text) throw new LlmError('模型输出为空', { code: 'empty_output' });
  let cleaned = String(text).trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new LlmError('模型输出中未找到 JSON', { code: 'parse_error', detail: cleaned.slice(0, 300) });
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new LlmError('模型输出 JSON 解析失败', { code: 'parse_error', detail: error.message });
  }
}


const STRUCTURED_SYSTEM_PROMPT = [
  '你是一名有 12 年经验的教师资格证面试考官与教研员，熟悉中小学教师资格考试面试的评分标准。',
  '你的任务：对考生的“结构化面试”作答给出真实、具体、可执行的练习反馈。',
  '',
  '硬性要求：',
  '1. 只能输出一个 JSON 对象，不要输出 JSON 以外的解释文字，不要使用 Markdown 代码块。',
  '2. 评分维度与分值必须严格使用用户给出的 rubric：不得增删维度，不得改变维度 key 与满分。',
  '3. 分数要有区分度，不要一律给高分；跑题、无结构、内容空泛要果断扣分。',
  '4. 所有点评使用简体中文，要具体到考生原话或缺失要点，避免“很好、不错”这类空话。',
  '5. reference_answer 必须是 2 分钟内可讲完的标准答案，并用 **双星号** 包裹 2-4 处关键句（前端会标红），不要使用 HTML 标签。',
  '6. 不要编造考生没有说过的内容；考生作答缺失的信息，在 issues 中指出。',
  '7. total 为各维度得分之和（四舍五入取整），等级按：85 分及以上“优秀”，70-84“良好”，60-69“合格”，60 以下“待提升”。'
].join('\n');

/**
 * 试讲考官人设按学段切换：初中用初中教材体系，高中用必修 / 选择性必修体系。
 * @param {'junior'|'senior'} stage
 */
function buildTrialSystemPrompt(stage) {
  const senior = stage === 'senior';
  const stageName = senior ? '高中' : '初中';
  const textbook = senior ? '高中数学教材（必修 / 选择性必修）' : '初中数学教材';
  return [
    `你是一名有 12 年经验的${stageName}数学教师资格证面试考官与教研员，熟悉人教版${textbook}与${stageName}数学试讲评分标准。`,
    '你的任务：根据试讲题目、考生的试讲思路（文字稿）与给定模板，输出一份可落地的试讲改进方案。',
    '',
    '硬性要求：',
    '1. 只能输出一个 JSON 对象，不要输出 JSON 以外的解释文字，不要使用 Markdown 代码块。',
    '2. 评分维度与分值必须严格使用用户给出的 rubric：不得增删维度，不得改变维度 key 与满分。',
    '3. 数学知识必须准确，出现公式时使用纯文本或简单符号（如 y=ax^2），不要编造教材页码。',
    '4. 教学过程要写出可照读的教师话术片段，并体现“学生活动 + 设计意图”，符合 10 分钟试讲节奏。',
    '5. 重点内容用 **双星号** 包裹（前端会标红），不要使用 HTML 标签。',
    '6. 若考生思路缺失，不要虚构其表现，在 issues 中明确指出并给出补足建议。',
    '7. total 为各维度得分之和（四舍五入取整），等级按：85 分及以上“优秀”，70-84“良好”，60-69“合格”，60 以下“待提升”。'
  ].join('\n');
}

function describeRubric(rubric) {
  const dimensions = rubric?.dimensions || [];
  return dimensions
    .map((item) => `- key: ${item.key}｜${item.name}｜满分 ${item.weight} 分｜${item.desc || ''}`)
    .join('\n');
}

/**
 * 只保留 dataURL 形式的图片，避免把非法值塞进请求体
 */
function pickImages(images) {
  return (Array.isArray(images) ? images : []).filter(
    (url) => typeof url === 'string' && /^data:image\//i.test(url)
  );
}

/**
 * 组 user 消息：有图片时用 OpenAI 兼容的多模态格式（text + image_url），
 * 图片是直接交给模型读的，不在本地做 OCR；没有图片时保持纯文本，老配置不受影响。
 */
function buildUserContent(text, images) {
  const list = pickImages(images);
  if (!list.length) return text;
  return [
    { type: 'text', text },
    ...list.map((url) => ({ type: 'image_url', image_url: { url } }))
  ];
}

/** 提示模型「这里有图，请读图」，没有图片时返回空串 */
function imageHintOf(images) {
  const count = pickImages(images).length;
  return count
    ? `【作答照片】共 ${count} 张（见本条消息的图片），请直接读图评分，不要假设存在文字转写。`
    : '';
}

/**
 * 结构化面试评分
 * @param {object} options
 * @param {string[]} [options.images] 作答照片 dataURL；有则走多模态读图评分
 * @returns {Promise<object>} 模型原始结果（由 scoring.js 统一归一化）
 */
export async function scoreStructured({ question, answer, rubric, images = [] }) {
  const imageHint = imageHintOf(images);
  const userPrompt = [
    `【题目】${question?.question || ''}`,
    `【题型】${question?.type || ''}`,
    `【考生参考得分点】${(question?.key_points || []).join('；') || '无'}`,
    `【考生作答】${answer || ''}`,
    ...(imageHint ? [imageHint] : []),
    '',
    '【评分维度 rubric】',
    describeRubric(rubric),
    '',
    '【输出 JSON 结构】',
    '{',
    '  "total": 0,',
    '  "level": "优秀|良好|合格|待提升",',
    '  "dimensions": [',
    '    { "key": "维度key", "name": "维度名称", "score": 0, "comment": "该维度具体点评，指出扣分原因" }',
    '  ],',
    '  "highlights": ["做得好的 2-4 点，引用考生原话更佳"],',
    '  "issues": ["主要问题 2-4 点，指出缺失的要点或结构问题"],',
    '  "analysis": "整体解析：审题是否准确、结构是否清晰、内容是否充实、表达是否流畅，分 2-4 段",',
    '  "reference_answer": "2 分钟标准答案，**重点句**用双星号包裹",',
    '  "tips": ["下次练习可执行的 2-4 条建议"]',
    '}'
  ].join('\n');

  const { content, usage, model } = await requestChat({
    messages: [
      { role: 'system', content: STRUCTURED_SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(userPrompt, images) }
    ],
    temperature: 0.35,
    maxTokens: 2200,
    timeout: 60000
  });
  const parsed = extractJson(content);
  return { ...parsed, __meta: { usage, model, source: 'ai' } };
}

/**
 * 数学试讲解析 + 评分（考官人设随学段切换）
 */
export async function scoreTrial({ question, notes, rubric, outline, images = [] }) {
  const imageHint = imageHintOf(images);
  const stage = question?.stage === 'senior' || question?.stage === 'junior'
    ? question.stage
    : /^(必修|选择性必修)/.test(String(question?.grade || ''))
      ? 'senior'
      : 'junior';
  const processHint = (outline?.process || [])
    .map((item) => `${item.stage}：${item.content}`)
    .join('\n');
  const userPrompt = [
    `【试讲题目】${question?.topic || ''}`,
    `【教材信息】${question?.textbook || ''} ${question?.grade || ''} ${question?.chapter || ''}`,
    `【题目要求】${(question?.requirements || []).map((item, index) => `${index + 1}. ${item}`).join(' ')}`,
    `【参考要点】${(question?.key_points || []).join('；')}`,
    `【考生试讲思路 / 逐字稿】${notes || (imageHint ? '（考生未填写文字思路，答案见下方的作答照片）' : '（考生未填写文字思路）')}`,
    ...(imageHint ? [imageHint] : []),
    '',
    '【教学流程参考】',
    processHint || '（无）',
    '',
    '【评分维度 rubric】',
    describeRubric(rubric),
    '',
    '【输出 JSON 结构】',
    '{',
    '  "total": 0,',
    '  "level": "优秀|良好|合格|待提升",',
    '  "dimensions": [',
    '    { "key": "维度key", "name": "维度名称", "score": 0, "comment": "该维度具体点评" }',
    '  ],',
    '  "highlights": ["做得好的 2-4 点"],',
    '  "issues": ["主要问题 2-4 点"],',
    '  "analysis": "整体解析：目标是否合理、重难点是否突出、教学过程是否完整、数学素养是否体现",',
    '  "teaching_design": {',
    '    "objectives": ["知识与技能：...", "过程与方法：...", "情感态度价值观：..."],',
    '    "key_points": ["..."],',
    '    "difficulties": ["..."],',
    '    "process": [',
    '      { "stage": "导入", "time": "1 分钟", "teacher": "教师活动与话术", "student": "学生活动", "intent": "设计意图" }',
    '    ],',
    '    "board": "板书设计说明，可用换行与简单符号",',
    '    "homework": "分层作业设计"',
    '  },',
    '  "tips": ["下次练习可执行的 2-4 条建议"]',
    '}'
  ].join('\n');

  const { content, usage, model } = await requestChat({
    messages: [
      { role: 'system', content: buildTrialSystemPrompt(stage) },
      { role: 'user', content: buildUserContent(userPrompt, images) }
    ],
    temperature: 0.35,
    maxTokens: 2800,
    timeout: 70000
  });
  const parsed = extractJson(content);
  return { ...parsed, __meta: { usage, model, source: 'ai' } };
}
