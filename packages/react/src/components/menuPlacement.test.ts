import { describe, expect, it } from 'vitest';
import { estimateMenuSize, placeMenu } from './menuPlacement';
import type { ISafeInsets } from '../a11y/safeArea';

/** 右键菜单定位真值表（specs/rem-typography §4.6/§6.1）——从 ContextMenu 渲染期迁出
 *  时的回归锚点：期望值按迁出前的翻转 + 四面夹取公式手算。 */
const SAFE0: ISafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DESKTOP = { width: 1440, height: 900 };
const STAGE_MENU = { width: 216, height: 159 }; // 画布菜单：4 项 + 1 分隔

describe('placeMenu（右键菜单翻转 + 四面夹取）', () => {
  it('右缘放不下 → 翻到锚点左侧，纵向原样', () => {
    // 1300 + 216 = 1516 > 1440 → left = 1300 - 216 = 1084（在 [8, 1216] 内）
    const p = placeMenu({
      anchor: { x: 1300, y: 100 },
      size: STAGE_MENU,
      viewport: DESKTOP,
      safe: SAFE0,
    });
    expect(p).toEqual({ left: 1084, top: 100 });
  });

  it('下缘放不下 → 翻到锚点上方', () => {
    // 850 + 236 = 1086 > 900 → top = 850 - 236 = 614（在 [8, 656] 内）
    const p = placeMenu({
      anchor: { x: 100, y: 850 },
      size: { width: 216, height: 236 },
      viewport: DESKTOP,
      safe: SAFE0,
    });
    expect(p).toEqual({ left: 100, top: 614 });
  });

  it('左安全区夹取：贴左时 left 钳到 8 + safe.left', () => {
    const p = placeMenu({
      anchor: { x: 10, y: 100 },
      size: STAGE_MENU,
      viewport: { width: 844, height: 390 },
      safe: { ...SAFE0, left: 44 },
    });
    expect(p.left, `应为 8+44=52（实际 ${p.left}）`).toBe(52);
  });

  it('右安全区夹取：不翻转但右缘越过 inset → 钳到 viewport - safe.right - 8 - 宽', () => {
    // 600 + 216 = 816 ≤ 844 不翻转；右界 844 - 44 - 8 - 216 = 576
    const p = placeMenu({
      anchor: { x: 600, y: 50 },
      size: STAGE_MENU,
      viewport: { width: 844, height: 390 },
      safe: { ...SAFE0, right: 44 },
    });
    expect(p.left, `应为 576（实际 ${p.left}）`).toBe(576);
  });

  it('面板宽/高于可视区 → 贴左/上限（不产生负坐标，超出由面板滚动承接）', () => {
    const p = placeMenu({
      anchor: { x: 150, y: 300 },
      size: { width: 216, height: 700 },
      viewport: { width: 200, height: 640 },
      safe: SAFE0,
    });
    expect(p).toEqual({ left: 8, top: 8 });
  });
});

describe('estimateMenuSize（首帧估算）', () => {
  it('与迁出前公式逐值一致：宽 216，高 = 项×34 + 分隔×9 + 14', () => {
    // 两组值同时等于根字号 16px 下的实测面板盒（画布菜单 216×159、元素菜单 216×236）
    expect(estimateMenuSize(4, 1)).toEqual({ width: 216, height: 159 });
    expect(estimateMenuSize(6, 2)).toEqual({ width: 216, height: 236 });
  });
});
