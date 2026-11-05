import { describe, expect, it } from 'vitest';
import {
  BAR_HEIGHT_EST,
  BAR_WIDTH_FALLBACK,
  computeBarLayout,
  ZERO_INSETS,
} from './actionBarLayout';
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

  // 栏高入参（specs/rem-typography §4.6）：根字号放大时栏随 rem 变高，翻转判定改用实测
  it('barH 缺省等于 BAR_HEIGHT_EST（1x 真值不变）', () => {
    const input = {
      bounds: B(250, 300, 120, 90),
      barW: 320,
      areaW: 844,
      safe: SAFE0,
      type: 'SHAPE',
    };
    expect(computeBarLayout(input)).toEqual(computeBarLayout({ ...input, barH: BAR_HEIGHT_EST }));
    expect(computeBarLayout(input).top).toBe(214);
  });

  it('barH=80：估算放得下、实测放不下 → 翻到选区下方', () => {
    // 估算 aboveY = 120-12-40-34 = 34 ≥ 4 悬上方；barH=80 → 120-12-80-34 = -6 < 4 → 120+60+12
    const input = {
      bounds: B(100, 120, 120, 60),
      barW: 320,
      areaW: 844,
      safe: SAFE0,
      type: 'SHAPE',
    };
    expect(computeBarLayout(input).top, '估算高应悬上方').toBe(34);
    expect(computeBarLayout({ ...input, barH: 80 }).top, '实测 80 应翻到下方').toBe(192);
  });

  it('barH 参与上方落点：top = y - 12 - barH - 让位', () => {
    // 根字号 32px 时栏高约 74：300-12-74-34 = 180；仍用估算 40 会落在 214，
    // 74 高的栏底到 288，侵入快捷按钮的 34px 让位区
    const { top } = computeBarLayout({
      bounds: B(250, 300, 120, 90),
      barW: 320,
      barH: 74,
      areaW: 844,
      safe: SAFE0,
      type: 'SHAPE',
    });
    expect(top, `应为 300-12-74-34=180（实际 ${top}）`).toBe(180);
  });
});
