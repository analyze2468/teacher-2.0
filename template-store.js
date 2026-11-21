/**
 * “我的模板”存储与合并
 * 优先级规则：用户模板 > 内置模板（空字段回退到内置内容）。
 * 数据仅保存在本机 localStorage，key 为 pb.templates.structured / pb.templates.math。
 */

import { readLocal, writeLocal, removeLocal } from './storage.js';

const KEY_STRUCTURED = 'templates.structured';
const KEY_MATH = 'templates.math';

function toLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readMap(key) {
  const data = readLocal(key, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/* ------------------------- 结构化面试 ------------------------- */

export function getStructuredOverrides() {
  return readMap(KEY_STRUCTURED);
}

export function countStructuredOverrides() {
  return Object.keys(getStructuredOverrides()).length;
}

export function saveStructuredOverride(typeId, patch = {}) {
  if (!typeId) throw new Error('缺少题型 id');
  const all = getStructuredOverrides();
  all[typeId] = {
    structure: toLines(patch.structure),
    phrases: toLines(patch.phrases),
    demo: toText(patch.demo),
    updatedAt: new Date().toISOString()
  };
  writeLocal(KEY_STRUCTURED, all);
  return all[typeId];
}

export function removeStructuredOverride(typeId) {
  const all = getStructuredOverrides();
  delete all[typeId];
  writeLocal(KEY_STRUCTURED, all);
}

export function resetStructuredOverrides() {
  removeLocal(KEY_STRUCTURED);
}

/** 合并内置模板与用户模板 */
export function resolveStructuredType(baseType) {
  const override = getStructuredOverrides()[baseType.id];
  if (!override) return { ...baseType, isUser: false };
  return {
    ...baseType,
    structure: override.structure?.length ? override.structure : baseType.structure,
    phrases: override.phrases?.length ? override.phrases : baseType.phrases,
    demo: override.demo ? override.demo : baseType.demo,
    isUser: true,
    updatedAt: override.updatedAt || ''
  };
}

export function exportStructuredOverrides() {
  return JSON.stringify({
    version: 1,
    kind: 'structured-templates',
    exportedAt: new Date().toISOString(),
    types: getStructuredOverrides()
  }, null, 2);
}

export function importStructuredOverrides(jsonText) {
  const parsed = JSON.parse(jsonText);
  const types = parsed?.types && typeof parsed.types === 'object' ? parsed.types : parsed;
  if (!types || typeof types !== 'object' || Array.isArray(types)) {
    throw new Error('模板文件格式不正确：缺少 types 对象');
  }
  const normalized = {};
  Object.keys(types).forEach((typeId) => {
    const item = types[typeId] || {};
    normalized[typeId] = {
      structure: toLines(item.structure),
      phrases: toLines(item.phrases),
      demo: toText(item.demo),
      updatedAt: new Date().toISOString()
    };
  });
  writeLocal(KEY_STRUCTURED, normalized);
  return Object.keys(normalized).length;
}

/* ------------------------- 初中数学试讲 ------------------------- */

export function getMathOverrides() {
  return readMap(KEY_MATH);
}

export function countMathOverrides() {
  return Object.keys(getMathOverrides()).length;
}

export function saveMathOverride(boardId, patch = {}) {
  if (!boardId) throw new Error('缺少板块 id');
  const all = getMathOverrides();
  all[boardId] = {
    process: toLines(patch.process),
    board: toText(patch.board),
    phrases: toLines(patch.phrases),
    updatedAt: new Date().toISOString()
  };
  writeLocal(KEY_MATH, all);
  return all[boardId];
}

export function removeMathOverride(boardId) {
  const all = getMathOverrides();
  delete all[boardId];
  writeLocal(KEY_MATH, all);
}

export function resetMathOverrides() {
  removeLocal(KEY_MATH);
}

/** 合并内置大纲模板与用户模板 */
export function resolveMathBoard(baseBoard) {
  const override = getMathOverrides()[baseBoard.id];
  if (!override) return { ...baseBoard, template: { ...baseBoard.template }, isUser: false };
  return {
    ...baseBoard,
    template: {
      ...baseBoard.template,
      process: override.process?.length ? override.process : baseBoard.template.process,
      board: override.board ? override.board : baseBoard.template.board,
      phrases: override.phrases?.length ? override.phrases : baseBoard.template.phrases
    },
    isUser: true,
    updatedAt: override.updatedAt || ''
  };
}

export function exportMathOverrides() {
  return JSON.stringify({
    version: 1,
    kind: 'math-templates',
    exportedAt: new Date().toISOString(),
    boards: getMathOverrides()
  }, null, 2);
}

export function importMathOverrides(jsonText) {
  const parsed = JSON.parse(jsonText);
  const boards = parsed?.boards && typeof parsed.boards === 'object' ? parsed.boards : parsed;
  if (!boards || typeof boards !== 'object' || Array.isArray(boards)) {
    throw new Error('模板文件格式不正确：缺少 boards 对象');
  }
  const normalized = {};
  Object.keys(boards).forEach((boardId) => {
    const item = boards[boardId] || {};
    normalized[boardId] = {
      process: toLines(item.process),
      board: toText(item.board),
      phrases: toLines(item.phrases),
      updatedAt: new Date().toISOString()
    };
  });
  writeLocal(KEY_MATH, normalized);
  return Object.keys(normalized).length;
}
