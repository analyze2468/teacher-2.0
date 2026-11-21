/**
 * 静态预设追问库（考官追问的备选方案）
 *
 * 设计要点
 * 1. 零网络：追问与参考回答全部在本机拼装，未配置 AI、余额不足、请求失败时照样可用；
 * 2. 逐题绑定：优先读取当前题目的字段（重点、难点、教学目标、板书、导入、题干、题型、
 *    参考要点），字段缺失时才回落到通用追问，所以每道题看到的追问不一样；
 * 3. 评分联动：若本次评分已生成，最前面会多一条「最弱维度怎么补」的追问；
 * 4. 纯函数：不操作 DOM、不读写 localStorage，方便复用与单独测试。
 */

const MAX_FIELD_CHARS = 26;

/** 归一化文本：压掉多余空白，避免模板里出现大段空格 */
function text(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** 截断到指定长度，超出加省略号 */
function short(value = '', limit = MAX_FIELD_CHARS) {
  const normalized = text(value);
  if (!normalized) return '';
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`;
}

/** 字段统一转数组（题库里既有字符串也有字符串数组） */
function listOf(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

/** 取得分率最低的维度 */
function weakestDimension(result) {
  const dims = (result?.dimensions || []).filter((item) => Number(item.max) > 0);
  if (!dims.length) return null;
  return dims.reduce(
    (worst, item) => (item.score / item.max < worst.score / worst.max ? item : worst),
    dims[0]
  );
}

/** 「最弱维度怎么补」：回答完全由本次评分结果拼装 */
function dimensionFollowup(result) {
  const dim = weakestDimension(result);
  if (!dim) return null;
  const tips = listOf(result?.tips).slice(0, 2);
  return {
    key: 'dimension',
    label: `「${short(dim.name, 10)}」怎么补？`,
    question: `「${dim.name}」只有 ${dim.score}/${dim.max} 分，具体怎么补？`,
    answer: [
      `【预设参考】本次「${dim.name}」得分 ${dim.score}/${dim.max}。`,
      dim.comment ? `评分点评：${dim.comment}` : '',
      tips.length
        ? `可以马上做的：\n${tips.map((tip, index) => `${index + 1}. ${tip}`).join('\n')}`
        : '',
      '补分三步：①对照该维度的评分说明逐条自查；②把缺失的要点写成一句话；③限时重讲一遍并录音回听。'
    ]
      .filter(Boolean)
      .join('\n')
  };
}

/** 试讲：用课题字段生成逐题绑定的追问 */
function trialFollowups(question = {}) {
  const title = short(question.title || question.topic, 20);
  const keyPoint = listOf(question.keyPoints)[0];
  const difficulty = listOf(question.difficulties)[0];
  const objective = listOf(question.objectives)[0];
  const boardPlan = short(question.boardPlan, 30);
  const importHint = listOf(question.processHint)[0];
  const items = [];

  if (keyPoint) {
    items.push({
      key: 'key-point',
      label: '重点为什么这样定？',
      question: `你把这节课的重点定为「${keyPoint}」，为什么？课上怎么保证学生真的掌握？`,
      answer: [
        '【预设参考】重点依据说三点：',
        `1. 知识地位：「${keyPoint}」是本节后续例题、变式甚至下一课时都要直接用到的基础；`,
        '2. 迁移价值：它决定学生能不能独立完成同类题，而不只是记住结论；',
        '3. 学情：学生常在这里出错，或停在「照抄步骤」的模仿层面。',
        `课堂落实三步：新授让学生自己经历探究并归纳出「${keyPoint}」；紧跟 1 道变式，点名说思路；小结再回扣一次，检验「能不能独立用」。`
      ].join('\n')
    });
  }

  if (difficulty) {
    items.push({
      key: 'difficulty',
      label: '难点怎么突破？',
      question: `难点「${difficulty}」你打算怎么突破？`,
      answer: [
        '【预设参考】突破难点四步：',
        `1. 拆台阶：把「${difficulty}」拆成 2-3 个小问题，先落在学生已有基础上；`,
        '2. 给直观：用图象、具体数字或反例制造冲突，让学生看见「为什么必须这样」；',
        '3. 让学生说：追问「你是怎么想的」「他的说法哪里还不完整」，把理解外显；',
        '4. 当堂检测：用一道只考这个难点的小题，巡视时重点看刚才出错的学生。',
        '话术示例：「先别急着记结论，我们回到刚才那个反例……」'
      ].join('\n')
    });
  }

  if (objective) {
    items.push({
      key: 'objective',
      label: '目标怎么检测？',
      question: `教学目标里「${objective}」这条，你打算怎么检测是否达成？`,
      answer: [
        '【预设参考】把目标变成可观察的行为：',
        '1. 换动词：把「理解 / 体会」落到「能说出依据、能独立完成、能指出错误」；',
        '2. 设计检测题：一道与例题同结构、换情境的题，限时 2 分钟独立完成；',
        '3. 给评价标准：答对关键步骤就具体肯定，卡住就追问「第一步先做什么」；',
        '4. 留证据：点名 2-3 名学生复述思路，作为是否达标的依据。'
      ].join('\n')
    });
  }

  if (boardPlan) {
    items.push({
      key: 'board-plan',
      label: '板书为什么这样写？',
      question: `你的板书是「${boardPlan}」，为什么这样设计？`,
      answer: [
        '【预设参考】这样设计的理由：',
        '1. 结构可见：左侧留知识主线，右侧给例题步骤，学生一眼看出「今天学什么、怎么用」；',
        '2. 生成性：关键结论边讲边写、用彩色粉笔标注，跟着学生的回答落笔，而不是提前抄满；',
        '3. 规范性：图形与符号按规范呈现（坐标轴、标注、等号对齐），本身就是示范；',
        '4. 收尾复用：小结时带学生看一遍板书，把今天的主线再串成一句话。'
      ].join('\n')
    });
  }

  items.push({
    key: 'import',
    label: '导入怎么更自然？',
    question: title ? `《${title}》的导入你会怎么设计，控制在 1 分钟内？` : '这节课的导入你会怎么设计？',
    answer: [
      '【预设参考】导入只做一件事：制造「必须学」的问题。',
      importHint
        ? `1. 起：可沿用你的思路——${importHint}；`
        : '1. 起：用旧知或生活情境制造冲突，例如上节课的结论在什么条件下会失效；',
      '2. 承：把冲突变成一个明确的问题，写在板书上；',
      `3. 转：一句话收口「带着这个问题，我们这节课来学习${title ? `《${title}》` : '新课'}」。`,
      '注意：导入不提前讲结论，不超过 1 分钟，不展开例题。'
    ].join('\n')
  });

  items.push({
    key: 'interaction',
    label: '怎么演好互动？',
    question: '没有真学生，怎么把互动演得自然？',
    answer: [
      '【预设参考】无生课堂的互动三件套：',
      '1. 提问＋停顿 3 秒＋复述回答（「你说……，很好」），让考官看到你在听；',
      '2. 预设一个不完整的回答，再引导补充，展示应变；',
      '3. 安排一次板演或同桌讨论，走到「学生」旁边说一句具体指导语；',
      '4. 评价语要具体：「思路很清楚，如果能把理由说完整就更好了」。'
    ].join('\n')
  });

  return items;
}

/** 结构化：按题型准备的追问（题库 type 字段为 自我认知 / 人际沟通 / 应急应变 / 组织管理 / 综合分析） */
const TYPE_FOLLOWUPS = [
  {
    match: /自我认知/,
    label: '动机能不空泛吗？',
    question: '你的回答里个人经历够具体吗？如果考官问「还有别的例子吗」，你怎么接？',
    answer: [
      '【预设参考】把「想当老师」讲成可验证的经历，用 STAR 四步：',
      '1. 情境：什么时候、在什么场合（支教、家教、实习带班）；',
      '2. 任务：你当时具体负责什么；',
      '3. 行动：你做了什么（越小越可信，如「先让他讲思路，再挑他会的那一步肯定他」）；',
      '4. 结果与认知：带来了什么变化，让你确认自己适合当老师。',
      '第二个例子提前备好：换场景（不只支教）、换对象（不只后进生），证明动机不是一时冲动。'
    ].join('\n')
  },
  {
    match: /人际沟通/,
    label: '对方不配合怎么办？',
    question: '如果家长（或同事）不配合，你的处理步骤是什么？',
    answer: [
      '【预设参考】五步走，先说态度再说方法：',
      '1. 稳住情绪：不在对立状态讲道理，「先听完，再解释」；',
      '2. 了解原因：是没时间、不信任，还是对情况有误解；',
      '3. 换位表达：先肯定对方的出发点（关心孩子），再摆事实；',
      '4. 给具体方案：明确谁在什么时候做什么，并约定反馈时间；',
      '5. 跟进与求助：一次沟通无效就借助班主任、年级组，形成合力。'
    ].join('\n')
  },
  {
    match: /应急应变/,
    label: '突发先做什么？',
    question: '课堂上出现突发情况，你先做什么、后做什么？',
    answer: [
      '【预设参考】按「安全—秩序—当事—跟进」排序：',
      '1. 安全第一：有受伤或危险，立即停课处置、第一时间上报；',
      '2. 稳定秩序：用一句话或一个任务把其他学生的注意力收回来；',
      '3. 处理当事：先冷静隔离情绪，不在全班面前定性；',
      '4. 课后跟进：了解原因、分别沟通、必要时联系家长；',
      '5. 反思预防：把这次的处理写进班级预案，避免重演。'
    ].join('\n')
  },
  {
    match: /组织管理/,
    label: '活动怎么落地？',
    question: '这个活动如果由你组织，怎么保证真正落地？',
    answer: [
      '【预设参考】按「目标—方案—分工—预案—总结」说：',
      '1. 目标：这次活动要解决什么问题，用一句话说清；',
      '2. 方案：时间、地点、对象、流程、物资，落到可执行的清单；',
      '3. 分工：谁负责什么，明确到人，避免「大家一起来」；',
      '4. 预案：安全、天气、人员缺席等风险的替代方案；',
      '5. 总结：收集反馈、留痕（照片 / 记录），形成可复用的经验。'
    ].join('\n')
  },
  {
    match: /综合分析/,
    label: '怎么辩证分析？',
    question: '这类现象你怎么辩证分析，才能不空泛？',
    answer: [
      '【预设参考】综合分析按「表态—原因—影响—对策」展开：',
      '1. 表态：一句话给出基本判断，避免「有好有坏」的骑墙；',
      '2. 原因：从社会、学校、家庭、学生自身多主体找 2-3 条；',
      '3. 影响：既说积极面，也说隐忧，用具体场景代替口号；',
      '4. 对策：落到教师能做的事（课堂、沟通、评价方式）；',
      '5. 升华：回到育人目标，一句话收束。'
    ].join('\n')
  }
];

/** 结构化：用题干与参考要点生成逐题绑定的追问 */
function structuredFollowups(question = {}) {
  const stem = short(question.question, 20);
  const points = listOf(question.key_points).slice(0, 3);
  const items = [];

  if (points.length) {
    items.push({
      key: 'key-points',
      label: '得分点覆盖了吗？',
      question: `这题的关键得分点你覆盖了吗？（${points.map((point) => short(point, 12)).join('、')}）`,
      answer: [
        '【预设参考】把参考要点当自查清单，逐条问自己「说到了吗、展开了吗」：',
        points.map((point, index) => `${index + 1}. ${point}${index === 0 ? '：有没有给出具体做法或事例？' : ''}`).join('\n'),
        '缺哪条就用一句话补（观点＋做法），不必整段重答；顺序按「最重要的先说」排列。'
      ].join('\n')
    });
  }

  items.push({
    key: 'short-version',
    label: '30 秒版怎么答？',
    question: stem
      ? `如果考官只给你 30 秒，这道题（${stem}）你怎么答？`
      : '如果考官只给你 30 秒，这道题你怎么答？',
    answer: [
      '【预设参考】30 秒＝结论先行＋两点支撑＋一句收束：',
      '1. 0-5 秒：直接给态度或处理原则，不复述题干；',
      '2. 5-25 秒：最多两点，每点一句话观点＋一个具体做法；',
      '3. 25-30 秒：回扣题干关键词，给一句反思或承诺。',
      '宁可少说一点，也不要为了凑满时间而重复；考官喊停时正好说完最有力的一句。'
    ].join('\n')
  });

  const typePreset = TYPE_FOLLOWUPS.find((item) => item.match.test(String(question.type || '')));
  if (typePreset) {
    items.push({
      key: 'type',
      label: typePreset.label,
      question: typePreset.question,
      answer: typePreset.answer
    });
  }

  items.push({
    key: 'another-way',
    label: '「还有别的办法吗」怎么接？',
    question: '如果考官追问「还有别的办法吗」，你怎么接？',
    answer: [
      '【预设参考】先给另一条可行路径，再说取舍：',
      '1. 承认两种做法都能解决问题，但适用条件不同（对象、场合、时间）；',
      '2. 说明在本场景下你会优先选哪种，并给出理由；',
      '3. 补一句边界：「如果……，我会调整为……」。',
      '不要硬说「只有一种办法对」，也不要为了显得全面而堆四五条，容易失焦。'
    ].join('\n')
  });

  return items;
}

/**
 * 生成当前题目的预设追问列表
 * @param {{ mode?: 'structured'|'trial', question?: object|null, result?: object|null }} options
 * @returns {Array<{ key: string, label: string, question: string, answer: string }>}
 */
export function buildFollowups({ mode = 'structured', question = null, result = null } = {}) {
  const list = [];
  const dimension = dimensionFollowup(result);
  if (dimension) list.push(dimension);
  const bound = mode === 'trial' ? trialFollowups(question || {}) : structuredFollowups(question || {});
  list.push(...bound);
  return list.filter((item) => item && item.question && item.answer).slice(0, 6);
}


/* ---------------------- 本机参考回答（未配置 AI / 请求失败时的兜底） ---------------------- */

/**
 * 中文没有空格，用「字符二元组」做一次粗糙的相似度：
 * 提问与某条预设追问的问法重合的二元组越多，越可能是在问同一件事。
 */
function bigrams(value = '') {
  const clean = text(value).replace(/[，。？！、；：""''（）()《》〈〉【】\s|/\\·…—]/g, '');
  const grams = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) grams.add(clean.slice(i, i + 2));
  return grams;
}

function sharedGramCount(from, target) {
  let count = 0;
  from.forEach((gram) => {
    if (target.has(gram)) count += 1;
  });
  return count;
}

/** 在预设追问库里找与提问最接近的一条；重合二元组少于 2 个视为没命中 */
function matchLibrary(prompt, items) {
  const target = bigrams(prompt);
  if (!target.size) return null;
  let best = null;
  let bestScore = 0;
  items.forEach((item) => {
    if (!item || !item.answer) return;
    const score = sharedGramCount(target, bigrams(`${item.label}${item.question}`));
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? best : null;
}

/** 取数组字段的第一条并截断，作为回答里的引用 */
function firstOf(value, limit = 34) {
  return short(listOf(value)[0] || '', limit);
}

/* --------------------------------- 试讲：本机回答 --------------------------------- */

function trialOutline(question = {}) {
  const keyPoint = firstOf(question.keyPoints);
  const difficulty = firstOf(question.difficulties);
  const hint = firstOf(question.processHint, 46);
  const board = short(question.boardPlan, 40);
  return [
    '【试讲提纲参考】10 分钟无生课堂按「导入 1′ → 新授 4-5′ → 练习 2′ → 小结 1′ → 作业 0.5′」铺开：',
    `1. 导入：${hint || '用旧知或生活情境制造冲突，一分钟内落到一个明确的问题上'}；`,
    `2. 新授：围绕「${keyPoint || '本节课的核心结论'}」让学生经历「猜想—验证—归纳」，关键结论边讲边写；`,
    difficulty
      ? `3. 难点：把「${difficulty}」先用反例或直观制造冲突，再追问「你是怎么想的」；`
      : '3. 难点：先给直观例子，再追问学生的想法，把理解外显；',
    board ? `4. 板书：${board}，边讲边生成，不提前抄满；` : '4. 板书：左侧知识主线、右侧例题步骤，边讲边生成；',
    '5. 练习：一道同结构变式，点名说思路，只点评卡住的那一步；',
    '6. 收尾：小结让学生说「解决了什么问题、用什么办法」，作业分层（必做基础 + 选做变式）。',
    '提醒：每个环节至少一次「请一位同学来说」，不要一口气讲完。'
  ].join('\n');
}

function trialTimePlan(question = {}) {
  const keyPoint = firstOf(question.keyPoints, 26);
  return [
    '【10 分钟怎么分配、不够时删哪】',
    '1. 0-1′：导入只留「现象 → 问题」两句，不展开；',
    `2. 1-5′：新授讲透「${keyPoint || '核心结论'}」的来由和第一次应用；`,
    '3. 5-7′：一道变式练习，点名说思路，点评只说关键步骤；',
    '4. 7-10′：小结（带学生看板书）+ 作业 + 一句升华。',
    '来不及时的删减顺序：先删第二道练习 → 再压缩评价语 → 最后才压缩新授里的重复讲解。',
    '不要删：重点的推导、导入的问题、小结的完整性，这三处最容易被考官记住。'
  ].join('\n');
}

function trialClosing(question = {}) {
  const keyPoint = firstOf(question.keyPoints, 24);
  return [
    '【小结与作业怎么收】',
    `1. 小结不复述：问学生「这节课我们解决了什么问题、用了什么办法${keyPoint ? `（${keyPoint}）` : ''}」，点名 1-2 人回答；`,
    '2. 带全班看一遍板书，用一句话收口，最好是一句可复述的口诀；',
    '3. 作业分两层：必做基础题 2 道，选做变式 1 道，并说明「明天用它引出下一节」；',
    '4. 收尾动作要干净：「这节课就到这里，下课」，停笔、站定，不要边说边收拾。'
  ].join('\n');
}

const TRIAL_DELIVERY = [
  '【表达与教态】',
  '1. 语速：新授稳定在每分钟约 200 字，关键结论前停 1 秒；',
  '2. 口头禅：把「然后」「这个」换成「第一步」「关键在这里」；',
  '3. 站位：导入站中间，板书侧身，提问时面向「学生」方向、目光停 2 秒；',
  '4. 手势：讲结论时手掌向上托一下，避免抱臂、插兜、来回踱步；',
  '5. 紧张：把开场第一句写死背下来（「上课，同学们好，请坐」），开口就不慌。'
].join('\n');

/* ------------------------------- 结构化：本机回答 ------------------------------- */

function structuredOutline(question = {}) {
  const points = listOf(question.key_points).slice(0, 3);
  const stem = short(question.question, 22);
  return [
    `【完整作答参考】${stem ? `题目：${stem}。` : ''}按「表态—分析—对策—升华」四段说：`,
    '1. 表态（约 10 秒）：一句话给判断或处理原则，不复述题干；',
    points.length
      ? `2. 分析（约 50 秒）：${points.map((point, index) => `${index + 1}）${short(point, 20)}`).join('；')}；`
      : '2. 分析（约 50 秒）：从「是什么—为什么—影响谁」三个角度各说一句；',
    '3. 对策（约 45 秒）：落到教师能做的两件事，明确「谁、在什么时候、做什么」；',
    '4. 升华（约 15 秒）：回到育人目标，一句话收束，不要喊口号。'
  ].join('\n');
}

function structuredExample(question = {}) {
  const point = firstOf(question.key_points, 20);
  return [
    '【怎么把内容说具体】用「一句话观点 + 一个场景 + 一个动作」：',
    `1. 观点：${point ? `先说「${point}」为什么重要` : '先给出你要表达的核心观点'}；`,
    '2. 场景：给一个真实会发生的情形（某类学生的具体表现、家长会上的某句话），代替「有些学生」；',
    '3. 动作：说清你具体做什么（先做什么、再说什么、事后怎么跟进）；',
    '4. 一句自查：把回答里所有「要重视、要加强」换成可执行的动作，答案立刻不空泛。'
  ].join('\n');
}

function structuredFollowupPreview(question = {}) {
  const points = listOf(question.key_points).slice(0, 3);
  const lines = ['【考官可能接着追问】'];
  points.forEach((point, index) => {
    lines.push(`${index + 1}. 「${short(point, 18)}」这一点，你具体怎么落实？`);
  });
  lines.push(`${points.length + 1}. 如果条件不允许、时间也不够，你会先调整哪一步？`);
  lines.push(`${points.length + 2}. 还有别的办法吗？两种做法你怎么取舍？`);
  lines.push('回答套路：先给结论，再补一个具体做法，最后说清边界条件。');
  return lines.join('\n');
}

const STRUCTURED_FRAME = [
  '【2 分钟答题结构】',
  '1. 破题（10 秒）：抓住题干关键词，说明你怎么理解，别急着表态；',
  '2. 分析（50 秒）：最多两点，每点「观点一句 + 展开两句」，用「第一……第二……」标号；',
  '3. 对策（45 秒）：给具体做法，配上「谁在什么时候做什么」；',
  '4. 收束（15 秒）：回扣题干，用一句反思或承诺收尾。',
  '结构词要显性：「首先」「具体来说」「落到我身上」「总之」，考官听结构比听内容更省力。'
].join('\n');

const STRUCTURED_TIME = [
  '【2 分钟怎么分配、超时先删什么】',
  '1. 0-10 秒：开口就给态度或原则，别复述题干；',
  '2. 10-60 秒：分析两点，说完一点就停，不要反复补充；',
  '3. 60-105 秒：对策两件具体的事；',
  '4. 105-120 秒：一句收束，正好收住。',
  '超时先删：重复的例子 → 形容词堆砌 → 客套话；不要删：你的判断和对策。'
].join('\n');

const STRUCTURED_DELIVERY = [
  '【表达减分项与改法】',
  '1. 少说「我觉得 / 可能 / 应该」，换成「我的处理是 / 我会先 / 我打算」；',
  '2. 每段结尾都落到具体做法，不要停在「要重视」；',
  '3. 卡壳时用「我分三点说，第一……」重启，比沉默或「呃」更好；',
  '4. 语速比平时慢一成，句尾下沉；关键句说完停半秒；',
  '5. 少用书面长句，一句话不超过 25 字，考官更容易记住。'
].join('\n');

const STRUCTURED_POLICY = [
  '【时政 / 热点类怎么答】',
  '1. 表态：先给基本立场（支持什么、反对什么），一句话；',
  '2. 意义：从学生成长、教育公平、教师职责三个角度各说一句；',
  '3. 落地：说清学校或教师层面具体能做的两件事；',
  '4. 边界：承认现实困难（资源、时间、家庭差异），给出你的应对；',
  '5. 收束：回到「为谁培养人」，一句即可。',
  '注意：不确定的政策细节不要编，宁可说「具体条款我记不准，但方向是……」。'
].join('\n');

/** 追问与本题信息都没命中时，至少给出本题速览，避免只剩一句「去配置」 */
function fallbackAnswer(mode, question = {}, result = null) {
  const dim = weakestDimension(result);
  const points =
    mode === 'trial' ? listOf(question.keyPoints).slice(0, 3) : listOf(question.key_points).slice(0, 3);
  const issues = listOf(result?.issues).slice(0, 2);
  const stem = short(mode === 'trial' ? question.title || question.topic : question.question, 24);
  const lines = ['【本题速览】'];
  if (stem) lines.push(`- ${mode === 'trial' ? '课题' : '题目'}：${stem}`);
  if (points.length) {
    lines.push(`- ${mode === 'trial' ? '重点' : '参考要点'}：${points.map((point) => short(point, 18)).join('；')}`);
  }
  if (dim) {
    lines.push(
      `- 本次最弱维度：${dim.name}（${dim.score}/${dim.max}）${dim.comment ? `，${short(dim.comment, 30)}` : ''}`
    );
  }
  if (issues.length) lines.push(`- 评分里提到的问题：${issues.join('；')}`);
  lines.push('');
  lines.push('把问题说得再具体一点，可以给出更针对性的参考，例如：');
  lines.push(
    mode === 'trial'
      ? '「导入怎么改」「难点怎么讲」「时间不够删哪」「板书怎么设计」「小结和作业怎么收」'
      : '「这道题怎么重答」「第 2 条要点怎么展开」「考官还可能怎么追问」「2 分钟怎么分配」'
  );
  return lines.join('\n');
}

/**
 * 关键词路由：先看预设库里有没有对应条目（直接复用那份逐题绑定的回答），
 * 没有再用专门的生成函数；命中顺序就是判断优先级。
 */
const TRIAL_ROUTES = [
  { match: /重讲|重答|完整|示范|标准答案|满分|讲一遍/, build: trialOutline },
  { match: /导入|开场|引入|情境/, key: 'import' },
  { match: /板书|黑板/, key: 'board-plan' },
  { match: /时间|分钟|删|压缩|来不及|超时|节奏/, build: trialTimePlan },
  { match: /互动|提问|学生|无生|演/, key: 'interaction' },
  { match: /重点/, key: 'key-point' },
  { match: /难点/, key: 'difficulty' },
  { match: /目标/, key: 'objective' },
  { match: /小结|总结|收尾|作业/, build: trialClosing },
  { match: /语言|语速|口头禅|紧张|教态|表情|声音|站/, build: () => TRIAL_DELIVERY }
];

const STRUCTURED_ROUTES = [
  { match: /重答|重说|完整|示范|标准答案|满分|答一遍/, build: structuredOutline },
  { match: /追问|还会问|可能问|接着问/, build: structuredFollowupPreview },
  { match: /要点|得分点|内容|覆盖/, key: 'key-points' },
  { match: /例子|事例|素材|具体|细节|空泛/, build: structuredExample },
  { match: /结构|条理|框架|逻辑|思路/, build: () => STRUCTURED_FRAME },
  { match: /时间|分钟|超时|太快|不够/, build: () => STRUCTURED_TIME },
  { match: /语言|表达|语速|口头禅|紧张|卡壳|口头语/, build: () => STRUCTURED_DELIVERY },
  { match: /时政|热点|政策/, build: () => STRUCTURED_POLICY }
];

/**
 * 未配置 AI（或请求失败）时的本机回答：保证「问了就有内容」
 * 1. 先在预设追问库里找最接近的一条，直接复用它的参考回答；
 * 2. 找不到再按关键词路由到专门的回答模板（导入 / 板书 / 时间 / 重答 …）；
 * 3. 都没有就给本题速览 + 更具体的提问建议。
 * @param {{ mode?: 'structured'|'trial', question?: object|null, result?: object|null, prompt?: string }} options
 * @returns {{ text: string, source: string, key: string }}
 */
export function buildLocalReply({ mode = 'structured', question = null, result = null, prompt = '' } = {}) {
  const target = question || {};
  const items = buildFollowups({ mode, question: target, result });
  const asked = text(prompt);
  const header = '【本机参考回答】未配置大模型，以下按本题和你的提问在本机生成，可直接当练习参考答案。';

  const hit = matchLibrary(asked, items);
  if (hit) return { text: `${header}\n\n${hit.answer}`, source: hit.label, key: hit.key };

  const routes = mode === 'trial' ? TRIAL_ROUTES : STRUCTURED_ROUTES;
  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    if (!route.match.test(asked)) continue;
    const item = route.key ? items.find((entry) => entry.key === route.key) : null;
    const body = item ? item.answer : route.build ? route.build(target) : '';
    if (body) {
      return { text: `${header}\n\n${body}`, source: item ? item.label : '本题要点', key: route.key || 'route' };
    }
  }

  return { text: `${header}\n\n${fallbackAnswer(mode, target, result)}`, source: '本题速览', key: 'fallback' };
}



