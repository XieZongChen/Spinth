import { describe, expect, it } from 'vitest';
import { edgeEnabledIndex, nextEnabledIndex, stepForKey } from './rovingFocus';

/** specs/a11y-closeout §5.1 单测矩阵（≥9）：跳禁用/跨分隔（分隔线不是 item，
 *  由 DOM 选择器天然排除——这里只测禁用跳过）/wrap 真假/全禁用/越界/四向 */
describe('stepForKey', () => {
  it('both 接受四向；vertical 忽略左右；horizontal 忽略上下；其余键 0', () => {
    expect(stepForKey('ArrowUp', 'both')).toBe(-1);
    expect(stepForKey('ArrowDown', 'both')).toBe(1);
    expect(stepForKey('ArrowLeft', 'both')).toBe(-1);
    expect(stepForKey('ArrowRight', 'both')).toBe(1);
    expect(stepForKey('ArrowLeft', 'vertical')).toBe(0);
    expect(stepForKey('ArrowRight', 'vertical')).toBe(0);
    expect(stepForKey('ArrowUp', 'horizontal')).toBe(0);
    expect(stepForKey('ArrowDown', 'horizontal')).toBe(0);
    expect(stepForKey('Enter', 'both')).toBe(0);
    expect(stepForKey('Home', 'both')).toBe(0); // Home/End 由 hook 直连 edge
  });
});

describe('nextEnabledIndex', () => {
  it('跳过禁用项（含连续多个）', () => {
    expect(nextEnabledIndex([false, true, false], 0, 1, true)).toBe(2);
    expect(nextEnabledIndex([false, true, true, false], 2, 1, true)).toBe(3);
    expect(nextEnabledIndex([false, true, false], 2, -1, true)).toBe(0);
  });

  it('wrap=true 首尾循环（跨边界仍跳禁用）', () => {
    expect(nextEnabledIndex([false, false], 1, 1, true)).toBe(0);
    expect(nextEnabledIndex([false, false], 0, -1, true)).toBe(1);
    expect(nextEnabledIndex([false, true, false], 2, 1, true)).toBe(0); // 越界回卷跳过 1
  });

  it('wrap=false 到边界返回 -1（Toolbar 不循环）', () => {
    expect(nextEnabledIndex([false, false], 1, 1, false)).toBe(-1);
    expect(nextEnabledIndex([false, false], 0, -1, false)).toBe(-1);
    expect(nextEnabledIndex([false, true, false], 0, 1, false)).toBe(2); // 未到边界仍前进
  });

  it('全禁用返回 -1', () => {
    expect(nextEnabledIndex([true, true], 0, 1, true)).toBe(-1);
    expect(nextEnabledIndex([true], 0, -1, true)).toBe(-1);
  });

  it('current 越界时按步进方向归位起步', () => {
    expect(nextEnabledIndex([false, false], -1, 1, true)).toBe(0); // -1+1=0
    expect(nextEnabledIndex([false, false], 5, 1, true)).toBe(0); // 6→wrap 0
    expect(nextEnabledIndex([false, false], 99, -1, false)).toBe(-1); // 越下界不 wrap
  });

  it('空列表返回 -1', () => {
    expect(nextEnabledIndex([], 0, 1, true)).toBe(-1);
  });
});

describe('edgeEnabledIndex', () => {
  it('首/尾可用项；跳过禁用', () => {
    expect(edgeEnabledIndex([true, false, false], 'first')).toBe(1);
    expect(edgeEnabledIndex([false, false, true], 'last')).toBe(1);
    expect(edgeEnabledIndex([false], 'first')).toBe(0);
  });

  it('全禁用/空列表返回 -1', () => {
    expect(edgeEnabledIndex([true, true], 'first')).toBe(-1);
    expect(edgeEnabledIndex([true], 'last')).toBe(-1);
    expect(edgeEnabledIndex([], 'last')).toBe(-1);
  });
});
