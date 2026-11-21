/**
 * 存储层（教资面试陪跑 2.0）
 * - localStorage：AI 设置、我的模板、上次练习摘要（体积小、读取同步）
 * - IndexedDB：答题记录、录音/照片等大体积数据
 *
 * 所有 key 统一加 pb. 前缀（practice-buddy），IndexedDB 库名同样是 pb-*，
 * 与「教资面试学习室」的 tss.* / tss-database 完全隔离：
 * 两个版本即使跑在同一个端口下，也不会互相读写对方的设置与练习记录。
 */

const PREFIX = 'pb.';

/** 读取 localStorage（JSON 解析失败时返回兜底值） */
export function readLocal(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    console.warn(`[storage] 读取 ${key} 失败`, error);
    return fallback;
  }
}

/** 写入 localStorage（隐私模式/空间不足时返回 false） */
export function writeLocal(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[storage] 写入 ${key} 失败`, error);
    return false;
  }
}

/** 删除 localStorage 键 */
export function removeLocal(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (error) {
    console.warn(`[storage] 删除 ${key} 失败`, error);
  }
}

/* ------------------------- AI 设置 ------------------------- */

const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.3,
  updatedAt: ''
};

export const settings = {
  /** 读取 AI 设置 */
  get() {
    return { ...DEFAULT_SETTINGS, ...(readLocal('settings.llm', {}) || {}) };
  },
  /** 局部更新 AI 设置 */
  save(patch) {
    const next = {
      ...this.get(),
      ...patch,
      updatedAt: new Date().toISOString()
    };
    writeLocal('settings.llm', next);
    return next;
  },
  /** 清空（含密钥） */
  clear() {
    removeLocal('settings.llm');
  },
  /** 是否已具备调用条件 */
  isConfigured() {
    const current = this.get();
    return Boolean(current.apiKey && current.baseUrl && current.model);
  }
};

/* ------------------------- 上次练习 ------------------------- */

export const lastPractice = {
  get() {
    return readLocal('last-practice', null);
  },
  save(record) {
    writeLocal('last-practice', { ...record, at: new Date().toISOString() });
  },
  clear() {
    removeLocal('last-practice');
  }
};

/* ------------------------- IndexedDB ------------------------- */

const DB_NAME = 'pb-database';
const DB_VERSION = 1;
const STORE_ATTEMPTS = 'attempts';
const STORE_PHOTOS = 'photos';
let dbPromise = null;

/** 浏览器是否支持 IndexedDB */
export function isIdbSupported() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase() {
  if (!isIdbSupported()) {
    return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const store = db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('page', 'page');
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const store = db.createObjectStore(STORE_PHOTOS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('questionId', 'questionId');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function runTransaction(storeName, mode, executor) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    try {
      request = executor(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务中止'));
  }));
}

/** 新增一条记录（返回自增主键） */
export function idbAdd(storeName, record) {
  return runTransaction(storeName, 'readwrite', (store) => store.add(record));
}

/** 读取全部记录 */
export function idbAll(storeName) {
  return runTransaction(storeName, 'readonly', (store) => store.getAll());
}

/** 按主键读取单条记录（练习记录详情 / AI 追问页使用） */
export function idbGet(storeName, id) {
  return runTransaction(storeName, 'readonly', (store) => store.get(id));
}

/** 按主键删除 */
export function idbDelete(storeName, id) {
  return runTransaction(storeName, 'readwrite', (store) => store.delete(id));
}

/** 清空 */
export function idbClear(storeName) {
  return runTransaction(storeName, 'readwrite', (store) => store.clear());
}

/** 保存作答记录（静默失败，不阻塞主流程） */
export async function saveAttempt(record) {
  try {
    return await idbAdd(STORE_ATTEMPTS, { ...record, createdAt: new Date().toISOString() });
  } catch (error) {
    console.warn('[storage] 作答记录保存失败', error);
    return null;
  }
}

/** 保存一张照片到本机存档 */
export async function savePhoto(record) {
  try {
    return await idbAdd(STORE_PHOTOS, { ...record, createdAt: new Date().toISOString() });
  } catch (error) {
    console.warn('[storage] 照片存档失败', error);
    return null;
  }
}

/** 读取照片存档 */
export async function listPhotos() {
  try {
    return await idbAll(STORE_PHOTOS);
  } catch (error) {
    console.warn('[storage] 照片读取失败', error);
    return [];
  }
}

/** 删除一张照片存档 */
export async function deletePhoto(id) {
  try {
    return await idbDelete(STORE_PHOTOS, id);
  } catch (error) {
    console.warn('[storage] 照片删除失败', error);
    return null;
  }
}

export const stores = {
  attempts: STORE_ATTEMPTS,
  photos: STORE_PHOTOS
};
