/**
 * 长按说话（移动端）+ 轻点切换（桌面端）
 *
 * 交互约定：
 * 1. 手指按住超过 holdMs（默认 320ms）= 长按：触发 onHoldStart（开始录音）；
 * 2. 手指抬起 = 长按结束：触发 onHoldEnd（结束录音并转写）；
 * 3. 按住后横向滑动超过 28px = 放弃本次长按（onHoldEnd({ cancelled: true })）；
 * 4. 快速轻点 = 触发 onTap，保留原来的「点一下开始、再点一下结束」习惯；
 * 5. 长按结束后浏览器可能还会补发一次 click，这里用 suppressClick 吞掉，避免立刻又开录。
 *
 * 返回解绑函数，页面卸载 / 换题时可调用。
 */

const HOLD_MS = 320;
const MOVE_TOLERANCE = 28;

export function bindVoiceButton(button, {
  onTap,
  onHoldStart,
  onHoldEnd,
  holdMs = HOLD_MS
} = {}) {
  if (!button) return () => {};

  let timer = 0;
  let holding = false;
  let suppressClick = false;
  let startX = 0;
  let startY = 0;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
  };

  const endHold = (reason) => {
    if (!holding) return;
    holding = false;
    button.dataset.holding = 'false';
    // 长按抬手后浏览器通常还会派发 click，这里短暂屏蔽
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 600);
    if (typeof onHoldEnd === 'function') onHoldEnd({ cancelled: reason === 'cancel' });
  };

  const handleDown = (event) => {
    if (button.disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClick = false;
    startX = event.clientX;
    startY = event.clientY;
    clearTimer();
    timer = setTimeout(() => {
      timer = 0;
      holding = true;
      button.dataset.holding = 'true';
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch (error) {
        /* 部分浏览器不支持指针捕获，忽略即可 */
      }
      if (navigator.vibrate) navigator.vibrate(12);
      if (typeof onHoldStart === 'function') onHoldStart();
    }, holdMs);
  };

  const handleMove = (event) => {
    if (!holding && !timer) return;
    if (!event.touches && typeof event.clientX !== 'number') return;
    const moved = Math.abs(event.clientX - startX) > MOVE_TOLERANCE
      || Math.abs(event.clientY - startY) > MOVE_TOLERANCE;
    if (!moved) return;
    // 手指滑走：取消长按（录音交给 onHoldEnd 处理是否放弃）
    clearTimer();
    endHold('cancel');
  };

  const handleUp = () => {
    clearTimer();
    endHold('release');
  };

  const handleClick = (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    if (typeof onTap === 'function') onTap(event);
  };

  const preventContextMenu = (event) => {
    // 长按录音时不让系统弹出「复制 / 保存图片」菜单
    if (holding) event.preventDefault();
  };

  button.addEventListener('pointerdown', handleDown);
  button.addEventListener('pointermove', handleMove);
  button.addEventListener('pointerup', handleUp);
  button.addEventListener('pointercancel', handleUp);
  button.addEventListener('pointerleave', handleUp);
  button.addEventListener('click', handleClick);
  button.addEventListener('contextmenu', preventContextMenu);

  return function unbind() {
    clearTimer();
    button.removeEventListener('pointerdown', handleDown);
    button.removeEventListener('pointermove', handleMove);
    button.removeEventListener('pointerup', handleUp);
    button.removeEventListener('pointercancel', handleUp);
    button.removeEventListener('pointerleave', handleUp);
    button.removeEventListener('click', handleClick);
    button.removeEventListener('contextmenu', preventContextMenu);
  };
}
