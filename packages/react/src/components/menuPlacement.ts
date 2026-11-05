/**
 * 右键菜单定位几何（specs/rem-typography §4.6）——纯函数：从 ContextMenu 渲染期
 * 逐行迁出，语义与迁出前等价。尺寸由调用方给：挂载后实测优先，未测到（首帧 /
 * jsdom 无布局）用 estimateMenuSize。面板宽与行高是 rem，随根字号缩放且文本可能
 * 折行，估算常量只做首帧兜底，不再承担最终定位。
 */
import type { ISafeInsets } from '../a11y/safeArea';

/** 估算：根字号 16px 下的面板宽（w-[13.5rem]） */
const MENU_W_EST = 216;
/** 估算：菜单项最小高（min-h-[2.125rem]） */
const ITEM_H_EST = 34;
/** 估算：分隔线占高（my-1 + 1px） */
const DIVIDER_H_EST = 9;
/** 估算：上下内边距 py-1.5 共 12 + 上下边框各 1（R1-c 实测：漏算 2px 会底边越界 2px） */
const CHROME_Y_EST = 12 + 2;
/** 面板与视口（含安全区）的留白 */
const EDGE_PAD = 8;

export interface IMenuGeometry {
  /** 右键点（视口坐标） */
  anchor: { x: number; y: number };
  /** 面板尺寸：优先实测，未测到用估算 */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  safe: ISafeInsets;
}

export interface IMenuPlacement {
  left: number;
  top: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** 越过右/下缘先翻转到锚点左/上侧，再夹进「安全区 + 8px」可视矩形（四面夹取，
 *  同时收口 450px 高 Z1 与 320px 宽 R1 两类越界）；面板比可视区大时贴左/上限，
 *  超出部分由面板自身 max-h + 滚动兜底。 */
export function placeMenu(g: IMenuGeometry): IMenuPlacement {
  const { anchor, size, viewport, safe } = g;
  const flipX = anchor.x + size.width > viewport.width;
  const flipY = anchor.y + size.height > viewport.height;
  const minX = safe.left + EDGE_PAD;
  const maxX = Math.max(minX, viewport.width - safe.right - EDGE_PAD - size.width);
  const minY = safe.top + EDGE_PAD;
  const maxY = Math.max(minY, viewport.height - safe.bottom - EDGE_PAD - size.height);
  return {
    left: clamp(flipX ? anchor.x - size.width : anchor.x, minX, maxX),
    top: clamp(flipY ? anchor.y - size.height : anchor.y, minY, maxY),
  };
}

/** 未测量时的估算（根字号 16px 下逐像素等于实测，公式与迁出前一致）：
 *  宽 216；高 = Σ菜单项 34 + Σ分隔 9 + 内边距 12 + 边框 2 */
export function estimateMenuSize(
  itemCount: number,
  dividerCount: number,
): { width: number; height: number } {
  return {
    width: MENU_W_EST,
    height: itemCount * ITEM_H_EST + dividerCount * DIVIDER_H_EST + CHROME_Y_EST,
  };
}
