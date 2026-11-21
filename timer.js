/**
 * 倒计时封装
 * 设计要点：
 * 1) 用“结束时间戳”计算剩余时间，避免 setInterval 累积误差；
 * 2) 切到后台再回来会立即校准；
 * 3) 只通过回调对外暴露状态，方便在控制台单独调试。
 *
 * 用法：
 *   const timer = createCountdown({ seconds: 120, onTick, onEnd });
 *   timer.start(); timer.pause(); timer.reset(120); timer.destroy();
 */

import { formatClock } from './utils.js';

export function createCountdown({
  seconds = 120,
  warnAt = 30,
  onTick,
  onEnd,
  onStart,
  onPause
} = {}) {
  let duration = Math.max(1, Math.floor(seconds));
  let remaining = duration;
  let endAt = 0;
  let tickId = null;
  let running = false;
  let ended = false;
  let warned = false;

  function emit() {
    if (typeof onTick !== 'function') return;
    onTick({
      remaining,
      duration,
      ratio: duration > 0 ? remaining / duration : 0,
      running,
      clock: formatClock(remaining),
      isWarn: remaining > 0 && remaining <= warnAt,
      isDanger: remaining > 0 && remaining <= 10
    });
  }

  function clearTicker() {
    if (tickId) {
      clearInterval(tickId);
      tickId = null;
    }
  }

  function finish() {
    clearTicker();
    running = false;
    remaining = 0;
    emit();
    if (!ended) {
      ended = true;
      if (typeof onEnd === 'function') onEnd();
    }
  }

  function tick() {
    const msLeft = Math.max(0, endAt - Date.now());
    remaining = Math.ceil(msLeft / 1000);
    if (!warned && remaining > 0 && remaining <= warnAt) warned = true;
    emit();
    if (msLeft <= 0) finish();
  }

  function start() {
    if (running || remaining <= 0) return;
    ended = false;
    warned = false;
    endAt = Date.now() + remaining * 1000;
    running = true;
    clearTicker();
    tickId = setInterval(tick, 200);
    emit();
    if (typeof onStart === 'function') onStart();
  }

  function pause() {
    if (!running) return;
    const msLeft = Math.max(0, endAt - Date.now());
    clearTicker();
    running = false;
    remaining = Math.ceil(msLeft / 1000);
    emit();
    if (typeof onPause === 'function') onPause();
  }

  function resume() {
    if (!running) start();
  }

  function toggle() {
    if (running) pause();
    else start();
  }

  function reset(nextSeconds = duration) {
    clearTicker();
    running = false;
    ended = false;
    warned = false;
    if (Number(nextSeconds) > 0) duration = Math.floor(nextSeconds);
    remaining = duration;
    emit();
  }

  function setDuration(nextSeconds) {
    const value = Math.max(1, Math.floor(Number(nextSeconds) || duration));
    const shouldResume = running;
    reset(value);
    if (shouldResume) start();
  }

  function getState() {
    return { remaining, duration, running, ended };
  }

  function destroy() {
    clearTicker();
    running = false;
    document.removeEventListener('visibilitychange', handleVisible);
  }

  function handleVisible() {
    if (document.visibilityState === 'visible' && running) tick();
  }

  document.addEventListener('visibilitychange', handleVisible);
  emit();

  return {
    start,
    pause,
    resume,
    toggle,
    reset,
    setDuration,
    getState,
    isRunning: () => running,
    destroy
  };
}
