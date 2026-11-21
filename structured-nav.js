/**
 * 结构化面试 · 题型导航的共享工具
 * 用于一级页面（题型）、模板页、题目列表页、单题作答页之间保持一致的题型匹配规则。
 *
 * 约定：
 * 1) 模板里的题型 id：self / communication / emergency / organization / analysis；
 * 2) 模板里的题型 name 带「类」后缀（如“自我认知类”），题库里的 type 不带（如“自我认知”）；
 * 3) 页面间传参优先用模板 id（?type=self），也兼容中文短名（?type=自我认知）。
 */

/** 题型视觉风格（图标 + 主色），未收录的题型走默认值 */
const TYPE_STYLE = {
  self: { icon: '🧭', bg: 'bg-brand-50', text: 'text-brand-700', ring: 'border-brand-200' },
  communication: { icon: '🤝', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'border-emerald-200' },
  emergency: { icon: '🚨', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'border-rose-200' },
  organization: { icon: '🗂️', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'border-amber-200' },
  analysis: { icon: '🧠', bg: 'bg-violet-50', text: 'text-violet-700', ring: 'border-violet-200' }
};

const DEFAULT_STYLE = { icon: '📌', bg: 'bg-slate-100', text: 'text-slate-700', ring: 'border-slate-200' };

/** 去掉「类」后缀，得到题库里使用的题型短名 */
export function templateKey(type) {
  return String(type?.name || '').replace(/类$/, '').trim();
}

/** 按 id / 中文短名 / 中文全名 查找模板；找不到返回 null */
export function findTemplateByKey(types, key) {
  const list = Array.isArray(types) ? types : [];
  const raw = String(key || '').trim();
  if (!raw) return null;
  const value = raw.replace(/类$/, '');
  return (
    list.find((type) => type.id === raw) ||
    list.find((type) => templateKey(type) === value) ||
    list.find((type) => type.name === raw) ||
    null
  );
}

/** 取某个题型下的题目（题目 type 不带「类」） */
export function questionsOfType(questions, type) {
  const list = Array.isArray(questions) ? questions : [];
  const key = templateKey(type);
  if (!key) return [];
  return list.filter((item) => templateKey({ name: item?.type }) === key);
}

/** 题型图标与配色 */
export function styleOf(type) {
  return TYPE_STYLE[type?.id] || DEFAULT_STYLE;
}

/** 题型入口链接 */
export function templateHref(type) {
  return `structured-template.html?type=${encodeURIComponent(type?.id || '')}`;
}

export function listHref(type) {
  return `structured-list.html?type=${encodeURIComponent(type?.id || '')}`;
}

export function questionHref(question, type) {
  const id = encodeURIComponent(question?.id || '');
  const typeId = type?.id ? `&type=${encodeURIComponent(type.id)}` : '';
  return `structured.html?id=${id}${typeId}`;
}
