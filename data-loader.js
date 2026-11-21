/**
 * 数据加载层
 * 所有题库 / 模板 / 视频配置均来自 data/*.json，方便后续直接增删内容而不改代码。
 * 说明：必须通过 http(s) 访问页面，file:// 下 fetch 会被浏览器拦截。
 */

const cache = new Map();

export const DATA_PATHS = {
  structuredQuestions: 'data/structured-questions.json',
  structuredTemplates: 'data/structured-templates.json',
  mathQuestions: 'data/math-questions.json',
  mathOutline: 'data/math-outline.json',
  videos: 'data/videos.json'
};

/** 读取 JSON（带内存缓存） */
export async function loadJson(path) {
  if (cache.has(path)) return cache.get(path);
  const task = (async () => {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`加载 ${path} 失败（HTTP ${response.status}）`);
    }
    return response.json();
  })();
  cache.set(path, task);
  try {
    return await task;
  } catch (error) {
    cache.delete(path);
    throw error;
  }
}

/** 结构化真题列表 */
export async function loadStructuredQuestions() {
  const data = await loadJson(DATA_PATHS.structuredQuestions);
  if (!Array.isArray(data.items)) throw new Error('结构化题库格式错误：缺少 items 数组');
  return data.items;
}

/** 结构化模板 + 评分维度 */
export async function loadStructuredTemplates() {
  const data = await loadJson(DATA_PATHS.structuredTemplates);
  if (!data.rubric || !Array.isArray(data.types)) {
    throw new Error('结构化模板格式错误：缺少 rubric 或 types');
  }
  return data;
}

/** 初中数学试讲真题列表 */
export async function loadMathQuestions() {
  const data = await loadJson(DATA_PATHS.mathQuestions);
  if (!Array.isArray(data.items)) throw new Error('试讲题库格式错误：缺少 items 数组');
  return data.items;
}

/** 初中数学大纲 + 试讲模板 */
export async function loadMathOutline() {
  const data = await loadJson(DATA_PATHS.mathOutline);
  if (!Array.isArray(data.boards)) throw new Error('试讲大纲格式错误：缺少 boards');
  return data;
}

/** 示范视频配置 */
export async function loadVideos() {
  return loadJson(DATA_PATHS.videos);
}
