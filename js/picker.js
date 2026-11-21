/**
 * 随机抽题封装
 * 特性：
 * 1) 同一轮内不重复，全部抽完后自动洗牌重来；
 * 2) 尽量避免“连续两次抽到同一题”；
 * 3) 支持按题型 / 板块筛选，筛选变化时重置本轮进度。
 */

export function createPicker({
  items = [],
  key = 'id',
  filter = null,
  onCycleReset = null
} = {}) {
  let pool = Array.isArray(items) ? items.slice() : [];
  let filterFn = typeof filter === 'function' ? filter : null;
  const drawn = new Set();
  let lastId = null;

  function candidates() {
    return pool.filter((item) => (filterFn ? filterFn(item) : true));
  }

  /** 抽取下一题；无可用题目时返回 null */
  function next() {
    const available = candidates();
    if (!available.length) return null;

    let rest = available.filter((item) => !drawn.has(item[key]));
    if (!rest.length) {
      drawn.clear();
      rest = available.slice();
      if (typeof onCycleReset === 'function') onCycleReset();
    }

    // 尽量避开上一题，避免连续重复（题库只有一题时除外）
    if (rest.length > 1) {
      const withoutLast = rest.filter((item) => item[key] !== lastId);
      if (withoutLast.length) rest = withoutLast;
    }

    const picked = rest[Math.floor(Math.random() * rest.length)];
    drawn.add(picked[key]);
    lastId = picked[key];
    return picked;
  }

  /** 当前筛选下的统计信息 */
  function stats() {
    const available = candidates();
    const drawnCount = available.filter((item) => drawn.has(item[key])).length;
    return {
      total: available.length,
      drawn: drawnCount,
      remaining: Math.max(0, available.length - drawnCount)
    };
  }

  function setItems(nextItems) {
    pool = Array.isArray(nextItems) ? nextItems.slice() : [];
    drawn.clear();
    lastId = null;
  }

  function setFilter(nextFilter) {
    filterFn = typeof nextFilter === 'function' ? nextFilter : null;
    drawn.clear();
    lastId = null;
  }

  function reset() {
    drawn.clear();
    lastId = null;
  }

  return { next, stats, setItems, setFilter, reset };
}

/** 从数组随机取一个元素（抽题以外的轻量场景） */
export function pickOne(list = []) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}
