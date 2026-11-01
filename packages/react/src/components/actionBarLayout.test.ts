import { describe, expect, it } from 'vitest';
import { BAR_WIDTH_FALLBACK, computeBarLayout, ZERO_INSETS } from './actionBarLayout';
import type { ISafeInsets } from '../a11y/safeArea';

/** 操作栏定位几何真值表（specs/a11y-closeout §7.4/§13.5-8）——从 ActionBar
 *  渲染期迁出时的回归锚点：safe 全 0 的期望值按旧实现常量手算，逐像素一致。 */
const SAFE0: ISafeInsets = { ...ZERO_INSETS };
const B = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('computeBarLayout（操作栏定位几何）', () => {
  it('左安全区夹取：选区靠左时 left 钳到 8 + safe.left', () => {
    const { left } = computeBarLayout({
      bounds: B(0, 200, 120, 80),
      barW: 320,
      areaW: 844,
      safe: { ...SAFE0, left: 44 },
      type: 'SHAPE',
    });
    expect(left, `左钳制应为 8+44=52（实际 ${left}）`).toBe(52);
  });

  it('右安全区夹取：右边界不超过 areaW - barW - (8 + safe.right)', () => {
    const safe = { ...SAFE0, right: 44 };
    const { left } = computeBarLayout({
      bounds: B(700, 200, 120, 80), // 选区中心 760 → 居中落点远超右界
      barW: 300,
      areaW: 844,
      safe,
      type: 'SHAPE',
    });
    expect(left, `右钳制应为 844-300-8-44=492（实际 ${left}）`).toBe(492);
  });

  it('栏宽超过可视区 → 贴左（钳制下限兜底，不产生负坐标）', () => {
    const { left } = computeBarLayout({
      bounds: B(400, 200, 120, 80),
      barW: BAR_WIDTH_FALLBACK,
      areaW: 200, // 容器窄于栏宽
      safe: SAFE0,
      type: 'SHAPE',
    });
    expect(left, `窄容器应贴左 8（实际 ${left}）`).toBe(8);
  });

  it('上方放不下 → 翻到选区下方（bounds.y + height + 12）', () => {
    const { top } = computeBarLayout({
      bounds: B(100, 60, 120, 80), // aboveY = 60-12-40-34 = -26 < 4
      barW: 320,
      areaW: 844,
      safe: SAFE0,
      type: 'SHAPE',
    });
    expect(top, `应翻到下方 60+80+12=152（实际 ${top}）`).toBe(152);
  });

  it('QUICK 类型让位 34：同几何下 LINE 能放上方、SHAPE 翻下', () => {
    // aboveY = 80-12-40-quickClear：quickClear=0 → 28 ≥ 4 放上方；
    // quickClear=34 → -6 < 4 翻下方
    const line = computeBarLayout({
      bounds: B(100, 80, 120, 60),
      barW: 320,
      areaW: 844,
      safe: SAFE0,
      type: 'LINE',
    });
    const shape = computeBarLayout({
      bounds: B(100, 80, 120, 60),
      barW: 320,
      areaW: 844,
      safe: SAFE0,
      type: 'SHAPE',
    });
    expect(line.top, 'LINE 无让位应悬上方（aboveY=28）').toBe(28);
    expect(shape.top, 'SHAPE 让位 34 放不下应翻下方（80+60+12=152）').toBe(152);
  });

  it('safe 全 0 与旧实现逐像素一致（回归锚点）', () => {
    // 旧渲染期实现手算：padL=padR=8，居中 250+60-160=150，右界 844-320-8=516
    const { left, top } = computeBarLayout({
      bounds: B(250, 300, 120, 90),
      barW: 320,
      areaW: 844,
      safe: SAFE0,
      type: 'SHAPE',
    });
    expect(left, `居中应为 150（实际 ${left}）`).toBe(150);
    expect(top, `上方应为 300-12-40-34=214（实际 ${top}）`).toBe(214);
  });
});
