/**
 * 评分与结果渲染
 * - normalizeResult：把模型输出收敛到 rubric 结构，防止缺字段/超分/维度错位；
 * - localStructuredScore / localTrialScore：无 AI 时的本机规则评分（明确标注，不冒充 AI）；
 * - renderScoreCard：统一的结果卡片（分数环、维度条、重点标红解析）。
 */

import { escapeHtml, renderRich, clamp, countChars } from './utils.js';

const LEVELS = [
  { min: 85, label: '优秀', color: '#059669', tone: 'pill-green' },
  { min: 70, label: '良好', color: '#2563eb', tone: 'pill-blue' },
  { min: 60, label: '合格', color: '#d97706', tone: 'pill-amber' },
  { min: 0, label: '待提升', color: '#dc2626', tone: 'pill-rose' }
];

const DISCLAIMER = 'AI 评分仅作练习参考，不代表任何官方成绩。真实面试评分由考官依据现场综合表现给出，请把重点放在改进建议上。';

/** 根据总分获取等级 */
export function levelOf(total) {
  const score = Number(total) || 0;
  return LEVELS.find((item) => score >= item.min) || LEVELS[LEVELS.length - 1];
}

function toTextList(value, limit = 8) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, limit);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeTeaching(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const process = Array.isArray(raw.process)
    ? raw.process.map((item) => ({
      stage: String(item?.stage || '').trim(),
      time: String(item?.time || '').trim(),
      teacher: String(item?.teacher || '').trim(),
      student: String(item?.student || '').trim(),
      intent: String(item?.intent || '').trim()
    })).filter((item) => item.stage || item.teacher)
    : [];
  return {
    objectives: toTextList(raw.objectives, 4),
    keyPoints: toTextList(raw.key_points ?? raw.keyPoints, 6),
    difficulties: toTextList(raw.difficulties, 6),
    process,
    board: String(raw.board || '').trim(),
    homework: String(raw.homework || '').trim()
  };
}

/**
 * 归一化模型输出
 * @param {object} raw 模型返回的原始对象
 * @param {object} rubric { dimensions: [{ key, name, weight, desc }] }
 * @param {'structured'|'trial'} type
 */
export function normalizeResult(raw, rubric, type = 'structured') {
  const dimensions = Array.isArray(rubric?.dimensions) ? rubric.dimensions : [];
  const rawDimensions = Array.isArray(raw?.dimensions) ? raw.dimensions : [];
  const normalizedDimensions = dimensions.map((item) => {
    const found = rawDimensions.find((entry) => entry?.key === item.key)
      || rawDimensions.find((entry) => entry?.name === item.name)
      || null;
    const score = clamp(Math.round(Number(found?.score) || 0), 0, item.weight);
    return {
      key: item.key,
      name: item.name,
      max: item.weight,
      desc: item.desc || '',
      score,
      comment: String(found?.comment || '').trim()
    };
  });

  const sum = normalizedDimensions.reduce((acc, item) => acc + item.score, 0);
  let total = Math.round(Number(raw?.total));
  if (!Number.isFinite(total)) total = sum;
  total = clamp(total, 0, 100);
  // 总分与维度之和偏差过大时，以维度之和为准，避免“总分虚高”
  if (Math.abs(total - sum) > 12) total = sum;

  const level = levelOf(total);
  return {
    type,
    total,
    level: String(raw?.level || '').trim() || level.label,
    levelMeta: level,
    dimensions: normalizedDimensions,
    highlights: toTextList(raw?.highlights, 6),
    issues: toTextList(raw?.issues, 6),
    tips: toTextList(raw?.tips, 6),
    analysis: String(raw?.analysis || '').trim(),
    referenceAnswer: String(raw?.reference_answer ?? raw?.referenceAnswer ?? '').trim(),
    teachingDesign: normalizeTeaching(raw?.teaching_design ?? raw?.teachingDesign),
    source: raw?.__meta?.source === 'ai' ? 'ai' : 'local',
    model: String(raw?.__meta?.model || ''),
    raw
  };
}

/**
 * 生成可直接落库的评分快照（考官点评记录）
 * 练习记录详情页展示、AI 追问页还原评分上下文都从这里取，
 * 只保留评分结果里真正有用的字段，避免把模型原始输出整段存进 IndexedDB。
 */
export function snapshotResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    total: clamp(Math.round(Number(result.total) || 0), 0, 100),
    level: String(result.level || '').trim(),
    source: result.source === 'ai' ? 'ai' : 'local',
    model: String(result.model || '').trim(),
    dimensions: (Array.isArray(result.dimensions) ? result.dimensions : []).map((item) => ({
      key: String(item?.key || ''),
      name: String(item?.name || ''),
      score: Number(item?.score) || 0,
      max: Number(item?.max) || 0,
      comment: String(item?.comment || '').trim()
    })),
    highlights: toTextList(result.highlights, 6),
    issues: toTextList(result.issues, 6),
    tips: toTextList(result.tips, 6),
    analysis: String(result.analysis || '').trim(),
    referenceAnswer: String(result.referenceAnswer || '').trim()
  };
}

/* ---------------- 本机规则评分（无 AI 时降级） ---------------- */

const STRUCTURE_WORDS = ['第一', '第二', '第三', '首先', '其次', '再次', '最后', '一方面', '另一方面', '因此', '总之', '综上', '我认为', '我会'];

function structureCueCount(text) {
  const found = new Set();
  STRUCTURE_WORDS.forEach((word) => {
    if (text.includes(word)) found.add(word);
  });
  return found.size;
}

/** 判断一个得分点是否被提及（按顿号/逗号拆成关键词片段） */
export function keyPointHit(text, point) {
  const value = String(point || '').trim();
  if (!value) return false;
  if (text.includes(value)) return true;
  const segments = value.split(/[、，,；;：:／/\s（）()·]+/).filter((item) => item.length >= 2);
  if (!segments.length) return false;
  return segments.some((segment) => text.includes(segment));
}

function splitHits(text, points) {
  const hits = [];
  const misses = [];
  (points || []).forEach((point) => {
    if (keyPointHit(text, point)) hits.push(point);
    else misses.push(point);
  });
  return { hits, misses };
}

/**
 * 结构化面试：本机规则评分
 * 只做“关键词覆盖 + 结构标志词 + 篇幅”的可解释估算，界面上会明确标注未接入 AI。
 */
export function localStructuredScore({ question, answer, rubric }) {
  const text = String(answer || '');
  const chars = countChars(text);
  const keyPoints = question?.key_points || [];
  const { hits, misses } = splitHits(text, keyPoints);
  const coverage = keyPoints.length ? hits.length / keyPoints.length : 0;
  const cues = structureCueCount(text);
  const paragraphs = text.split(/\n+/).filter((item) => item.trim()).length;
  const lengthScore = clamp(chars / 260, 0, 1);
  const cueScore = clamp(cues / 5, 0, 1);

  const dimensions = (rubric?.dimensions || []).map((dim) => {
    let score = 0;
    let comment = '';
    switch (dim.key) {
      case 'professional':
        score = 6 + coverage * 5 + lengthScore * 3;
        comment = '按作答中体现的教育理念、教师角色意识估算。';
        break;
      case 'analysis':
        score = 7 + coverage * 12 + lengthScore * 4 + cueScore * 2;
        comment = `覆盖参考要点 ${hits.length}/${keyPoints.length} 条。`;
        break;
      case 'logic':
        score = 6 + cueScore * 9 + clamp(paragraphs / 3, 0, 1) * 4;
        comment = `检测到 ${cues} 个分层标志词、${paragraphs} 个自然段。`;
        break;
      case 'expression':
        score = 6 + lengthScore * 9 + cueScore * 3;
        comment = `作答约 ${chars} 字，按 2 分钟语速估算。`;
        break;
      case 'resilience':
        score = 7 + (/(冷静|稳定|情绪|耐心|倾听)/.test(text) ? 2 : 0);
        comment = '现场应变需结合录音自查，本项只给基础分。';
        break;
      case 'manner':
        score = 8;
        comment = '仪表仪态无法从文字判断，默认基础分，建议录视频自查。';
        break;
      default:
        score = 6 + coverage * 4 + lengthScore * 3;
        comment = '本机规则估算。';
    }
    return {
      key: dim.key,
      name: dim.name,
      max: dim.weight,
      desc: dim.desc || '',
      score: clamp(Math.round(score), 0, dim.weight),
      comment
    };
  });

  const total = dimensions.reduce((acc, item) => acc + item.score, 0);
  const meta = levelOf(total);
  const highlights = [];
  if (hits.length) highlights.push(`命中参考要点：${hits.slice(0, 3).join('；')}`);
  if (cues >= 3) {
    const used = STRUCTURE_WORDS.filter((word) => text.includes(word)).slice(0, 4);
    highlights.push(`结构意识较好，使用了「${used.join('、')}」等分层表达。`);
  }
  if (chars >= 150) highlights.push(`篇幅约 ${chars} 字，接近 2 分钟作答量。`);

  const issues = [];
  if (misses.length) issues.push(`未提及参考要点：${misses.slice(0, 3).join('；')}。`);
  if (chars < 120) issues.push(`作答仅 ${chars} 字，展开不足，建议按“观点—分析—对策—升华”补充。`);
  if (cues < 3) issues.push('缺少“首先/其次/最后”等分层标志词，考官不易抓住结构。');
  if (!issues.length) issues.push('整体结构完整，可再用一个具体事例增强说服力。');

  const analysis = [
    `本机规则评分依据：关键词覆盖 ${hits.length}/${keyPoints.length}、分层标志词 ${cues} 个、篇幅 ${chars} 字。`,
    misses.length ? `建议补充：${misses.join('；')}。` : '参考要点已基本覆盖。',
    '注意：本机评分只能检查“有没有说到”，无法判断语气、眼神与临场状态，请配合录音或录像复盘。'
  ].join('\n\n');

  return {
    type: 'structured',
    total,
    level: meta.label,
    levelMeta: meta,
    dimensions,
    highlights,
    issues,
    tips: [
      '用手机录音 2 分钟，检查是否超时、语速是否过快。',
      '把缺失的得分点补进你的模板，再练同一题。',
      '开头 10 秒先给结论，结尾用一句话升华。'
    ],
    analysis,
    referenceAnswer: String(question?.reference_answer || ''),
    teachingDesign: null,
    source: 'local',
    model: '',
    coverage: { hits: hits.length, total: keyPoints.length }
  };
}

/**
 * 数学试讲（初中 / 高中）：本机规则评分
 * 依据“题目要求覆盖 + 教学环节完整性 + 篇幅 + 数学思想关键词”估算。
 */
export function localTrialScore({ question, notes, rubric }) {
  const text = String(notes || '');
  const chars = countChars(text);
  const keyPoints = question?.key_points || [];
  const requirements = question?.requirements || [];
  const keyHits = splitHits(text, keyPoints);
  const reqHits = splitHits(text, requirements);
  const stages = ['导入', '新授', '探究', '例题', '练习', '小结', '作业', '板书'];
  const stageHits = stages.filter((stage) => text.includes(stage));
  const cues = structureCueCount(text);
  const lengthScore = clamp(chars / 500, 0, 1);
  const coverage = keyPoints.length ? keyHits.hits.length / keyPoints.length : 0;
  const reqCoverage = requirements.length ? reqHits.hits.length / requirements.length : 0;

  const dimensions = (rubric?.dimensions || []).map((dim) => {
    let score = 0;
    let comment = '';
    switch (dim.key) {
      case 'design':
        score = 6 + reqCoverage * 8 + (text.includes('目标') ? 2 : 0)
          + (/(重难点|重点|难点)/.test(text) ? 2 : 0);
        comment = `题目要求覆盖 ${reqHits.hits.length}/${requirements.length} 条。`;
        break;
      case 'implementation':
        score = 8 + clamp(stageHits.length / 6, 0, 1) * 12 + lengthScore * 6 + coverage * 4;
        comment = `检测到教学环节：${stageHits.join('、') || '未明确写出'}。`;
        break;
      case 'evaluation':
        score = 4 + (/(评价|反馈|鼓励|表扬|追问)/.test(text) ? 4 : 0) + (text.includes('作业') ? 2 : 0);
        comment = '依据是否写出评价语、追问与作业设计估算。';
        break;
      case 'expression':
        score = 5 + lengthScore * 6 + clamp(cues / 6, 0, 1) * 4;
        comment = `文字稿约 ${chars} 字，请再用录音核对语速与口头禅。`;
        break;
      case 'thinking':
        score = 3 + coverage * 5
          + (/(数形结合|分类讨论|转化|建模|归纳|类比)/.test(text) ? 2 : 0);
        comment = '依据数学思想方法的显性表达估算。';
        break;
      case 'professional':
        score = 3 + (/(学生为主体|以学生为中心|启发|引导)/.test(text) ? 2 : 0);
        comment = '依据是否体现学生主体与启发式教学估算。';
        break;
      case 'psychology':
        score = 4;
        comment = '需通过录像观察教态与紧张控制，本项给基础分。';
        break;
      case 'manner':
        score = 4;
        comment = '仪表仪态无法从文字判断，建议录像自查。';
        break;
      default:
        score = 4 + coverage * 3 + lengthScore * 2;
        comment = '本机规则估算。';
    }
    return {
      key: dim.key,
      name: dim.name,
      max: dim.weight,
      desc: dim.desc || '',
      score: clamp(Math.round(score), 0, dim.weight),
      comment
    };
  });

  const total = dimensions.reduce((acc, item) => acc + item.score, 0);
  const meta = levelOf(total);
  const missingStages = stages.filter((stage) => !stageHits.includes(stage)).slice(0, 4);

  const highlights = [];
  if (stageHits.length >= 4) highlights.push(`教学环节较完整：${stageHits.join('、')}。`);
  if (reqHits.hits.length) highlights.push(`回应了题目要求：${reqHits.hits.slice(0, 2).join('；')}。`);
  if (/(数形结合|分类讨论|转化|建模|归纳|类比)/.test(text)) highlights.push('体现了数学思想方法，是加分项。');

  const issues = [];
  if (reqHits.misses.length) issues.push(`未回应题目要求：${reqHits.misses.slice(0, 2).join('；')}。`);
  if (missingStages.length) issues.push(`教学过程缺少环节：${missingStages.join('、')}。`);
  if (chars < 200) issues.push('试讲文字稿偏短，建议补足教师话术与学生活动，按 10 分钟节奏展开。');
  if (!issues.length) issues.push('整体较完整，可进一步打磨导入与板书的亮点。');

  const analysis = [
    `本机规则评分依据：教学环节 ${stageHits.length}/8、题目要求覆盖 ${reqHits.hits.length}/${requirements.length}、文字稿 ${chars} 字。`,
    keyHits.misses.length ? `建议补充数学要点：${keyHits.misses.slice(0, 3).join('；')}。` : '数学要点覆盖较完整。',
    '注意：照片仅作本地存档，不能替代文字思路；本机评分无法判断教态、板书书写与课堂互动效果。'
  ].join('\n\n');

  return {
    type: 'trial',
    total,
    level: meta.label,
    levelMeta: meta,
    dimensions,
    highlights,
    issues,
    tips: [
      '用 10 分钟计时完整讲一遍，重点检查导入是否超过 1.5 分钟。',
      '板书只写核心结论与例题步骤，边讲边写，不要背对考官长时间沉默。',
      '每个环节至少设计 1 个提问，并写出预设的学生回答。'
    ],
    analysis,
    referenceAnswer: String(question?.analysis || ''),
    teachingDesign: null,
    source: 'local',
    model: '',
    coverage: { hits: keyHits.hits.length, total: keyPoints.length }
  };
}

function renderBulletList(title, items, tone) {
  if (!items || !items.length) return '';
  const palette = {
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    blue: 'text-brand-600',
    rose: 'text-rose-600'
  }[tone] || 'text-slate-500';
  const mark = { green: '✓', amber: '!', blue: '→', rose: '✕' }[tone] || '·';
  return `
    <section class="mt-4">
      <h4 class="text-sm font-bold text-slate-800">${escapeHtml(title)}</h4>
      <ul class="mt-2 space-y-1.5">
        ${items.map((item) => `
          <li class="flex gap-2 text-sm leading-relaxed text-slate-600">
            <span class="mt-0.5 shrink-0 font-bold ${palette}">${mark}</span>
            <span>${escapeHtml(item)}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function renderTeachingDesign(design) {
  if (!design) return '';
  const processHtml = (design.process || []).map((step, index) => `
    <li class="rounded-xl bg-white p-3 ring-1 ring-slate-100">
      <div class="flex flex-wrap items-center gap-2">
        <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-100 text-xs font-bold text-brand-700">${index + 1}</span>
        <span class="text-sm font-bold text-slate-800">${escapeHtml(step.stage || '环节')}</span>
        ${step.time ? `<span class="pill pill-slate">${escapeHtml(step.time)}</span>` : ''}
      </div>
      ${step.teacher ? `<div class="rich mt-2 text-sm">${renderRich(step.teacher)}</div>` : ''}
      ${step.student ? `<p class="mt-1.5 text-xs leading-relaxed text-slate-500"><b class="text-slate-600">学生活动：</b>${escapeHtml(step.student)}</p>` : ''}
      ${step.intent ? `<p class="mt-1 text-xs leading-relaxed text-slate-500"><b class="text-slate-600">设计意图：</b>${escapeHtml(step.intent)}</p>` : ''}
    </li>`).join('');

  return `
    <section class="mt-4 rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
      <h4 class="text-sm font-bold text-brand-800">试讲设计方案</h4>
      ${design.objectives.length ? `
        <div class="mt-3">
          <p class="text-xs font-semibold text-slate-600">教学目标</p>
          <ul class="mt-1 space-y-1">${design.objectives.map((item) => `<li class="text-sm leading-relaxed text-slate-700">${escapeHtml(item)}</li>`).join('')}</ul>
        </div>` : ''}
      ${design.keyPoints.length ? `
        <div class="mt-3">
          <p class="text-xs font-semibold text-slate-600">教学重点</p>
          <div class="mt-1 flex flex-wrap gap-1.5">${design.keyPoints.map((item) => `<span class="pill pill-blue">${escapeHtml(item)}</span>`).join('')}</div>
        </div>` : ''}
      ${design.difficulties.length ? `
        <div class="mt-3">
          <p class="text-xs font-semibold text-slate-600">教学难点</p>
          <div class="mt-1 flex flex-wrap gap-1.5">${design.difficulties.map((item) => `<span class="pill pill-amber">${escapeHtml(item)}</span>`).join('')}</div>
        </div>` : ''}
      ${processHtml ? `
        <div class="mt-3">
          <p class="text-xs font-semibold text-slate-600">教学过程</p>
          <ol class="mt-1.5 space-y-2">${processHtml}</ol>
        </div>` : ''}
      ${design.board ? `
        <div class="mt-3">
          <p class="text-xs font-semibold text-slate-600">板书设计</p>
          <pre class="mt-1 whitespace-pre-wrap rounded-xl bg-white p-3 font-sans text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">${escapeHtml(design.board)}</pre>
        </div>` : ''}
      ${design.homework ? `
        <div class="mt-3">
          <p class="text-xs font-semibold text-slate-600">作业设计</p>
          <p class="mt-1 text-sm leading-relaxed text-slate-700">${escapeHtml(design.homework)}</p>
        </div>` : ''}
    </section>`;
}

/**
 * 渲染评分结果卡片（纯字符串，安全转义）
 * @param {object} result normalizeResult / localXxxScore 的返回值
 */
export function renderScoreCard(result) {
  const meta = result.levelMeta || levelOf(result.total);
  const sourcePill = result.source === 'ai'
    ? '<span class="pill pill-green">AI 评分</span>'
    : '<span class="pill pill-amber">本机规则评分</span>';
  const sourceNote = result.source === 'ai'
    ? `模型：${escapeHtml(result.model || '已配置模型')}`
    : '未接入 AI：基于关键词覆盖、结构标志词与篇幅的规则估算';

  const dimensionsHtml = (result.dimensions || []).map((item) => {
    const percent = item.max ? Math.round((item.score / item.max) * 100) : 0;
    return `
      <div>
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-slate-800">${escapeHtml(item.name)}</span>
          <span class="shrink-0 text-xs text-slate-500"><b class="text-base text-slate-900">${item.score}</b> / ${item.max}</span>
        </div>
        <div class="level-bar mt-1.5"><div class="level-bar__fill" style="width:${percent}%"></div></div>
        ${item.comment ? `<p class="mt-1 text-xs leading-relaxed text-slate-500">${escapeHtml(item.comment)}</p>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="animate-in">
      <div class="flex items-center gap-4">
        <div class="score-ring shrink-0" style="--p:${result.total};--ring-color:${meta.color}">
          <div class="score-ring__inner">
            <div>
              <div class="text-2xl font-bold" style="color:${meta.color}">${result.total}</div>
              <div class="text-[10px] text-slate-400">总分 / 100</div>
            </div>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="pill ${meta.tone}">${escapeHtml(result.level)}</span>
            ${sourcePill}
          </div>
          <p class="mt-2 text-xs leading-relaxed text-slate-500">${sourceNote}</p>
          ${result.coverage ? `<p class="mt-1 text-[11px] text-slate-400">参考要点覆盖 ${result.coverage.hits}/${result.coverage.total}</p>` : ''}
        </div>
      </div>

      <div class="mt-5 space-y-3.5">${dimensionsHtml}</div>

      ${result.analysis ? `
        <section class="mt-4 rounded-2xl bg-slate-50 p-3.5">
          <h4 class="text-sm font-bold text-slate-800">整体解析</h4>
          <div class="rich mt-2">${renderRich(result.analysis)}</div>
        </section>` : ''}

      ${renderBulletList('做得好的地方', result.highlights, 'green')}
      ${renderBulletList('需要改进的地方', result.issues, 'amber')}
      ${renderBulletList('下次练习建议', result.tips, 'blue')}
      ${renderTeachingDesign(result.teachingDesign)}
      ${result.referenceAnswer ? `
        <section class="mt-4 rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
          <h4 class="text-sm font-bold text-rose-700">${result.type === 'trial' ? '试讲解析要点（重点已标红）' : '参考答案（重点已标红）'}</h4>
          <div class="rich mt-2">${renderRich(result.referenceAnswer)}</div>
        </section>` : ''}

      <p class="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-500">${DISCLAIMER}</p>

      <a href="records.html" class="mt-3 flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 active:bg-slate-50">查看练习记录 ›</a>
    </div>`;
}

export { DISCLAIMER };



