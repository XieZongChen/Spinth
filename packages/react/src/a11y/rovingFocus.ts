/**
 * Roving focus 纯函数（specs/a11y-closeout §5.1）：方向键 → 步进、跳过禁用、
 * 首尾、wrap。五个消费者（ContextMenu/Toolbar/ToolFlyout/PopoverControl/
 * ProjectMenu）共用同一协议——同一逻辑重复五次必然漂移（D1）。
 * 纯函数无 DOM 依赖：单测矩阵在此，DOM 契约在 useRovingFocus。
 */
export type RovingOrientation = 'vertical' | 'horizontal' | 'both';

/** 方向键 → 步进；非该方向的键（或非方向键）返回 0（不拦截，交还浏览器/全局） */
export function stepForKey(key: string, orientation: RovingOrientation): -1 | 0 | 1 {
  if (key === 'ArrowUp') return orientation === 'horizontal' ? 0 : -1;
  if (key === 'ArrowDown') return orientation === 'horizontal' ? 0 : 1;
  if (key === 'ArrowLeft') return orientation === 'vertical' ? 0 : -1;
  if (key === 'ArrowRight') return orientation === 'vertical' ? 0 : 1;
  return 0;
}

/**
 * 从 current 出发按 step 找下一个可用项。
 * 全禁用返回 -1；wrap=false 时跨边界返回 -1（Toolbar 不循环）；current 越界
 * 时先按 step 归位（如 autoFocus 前的无焦点态从 0 起）。
 */
export function nextEnabledIndex(
  disabled: readonly boolean[],
  current: number,
  step: -1 | 1,
  wrap: boolean,
): number {
  const n = disabled.length;
  if (n === 0) return -1;
  const wrapTo = (i: number): number => ((i % n) + n) % n;
  let i = current + step;
  if (i < 0 || i >= n) {
    if (!wrap) return -1;
    i = wrapTo(i);
  }
  for (let k = 0; k < n; k++) {
    if (!disabled[i]) return i;
    i += step;
    if (i < 0 || i >= n) {
      if (!wrap) return -1;
      i = wrapTo(i);
    }
  }
  return -1; // 全禁用
}

/** 首/尾可用项；全禁用返回 -1（Home/End 键与 autoFocus 用） */
export function edgeEnabledIndex(disabled: readonly boolean[], edge: 'first' | 'last'): number {
  if (edge === 'first') {
    for (let i = 0; i < disabled.length; i++) if (!disabled[i]) return i;
  } else {
    for (let i = disabled.length - 1; i >= 0; i--) if (!disabled[i]) return i;
  }
  return -1;
}
