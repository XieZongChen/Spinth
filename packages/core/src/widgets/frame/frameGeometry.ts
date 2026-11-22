/**
 * 容器控件几何单源（specs/container-frame §3）：标题带几何、标题可用宽、
 * 单行截断、命中区域（标题带 ∪ 边框环）——全部纯函数，单测直测。
 * 纯模块（无 PIXI）：渲染 Vm / 标题编辑链 / 命中测试共用，不依赖 Vm 层。
 */
import type { IPoint, IRect } from '../../common/geometry';
import { graphemes } from '../../platform/textEngine/measure';

// —— 常量（§3.1；标题带恒定 = 几何可预测，空标题不塌陷） ——

/** 顶部标题带高（世界 px，headerSide 'top'） */
export const FRAME_HEADER_TOP = 28;
/** 左侧表头列宽（世界 px，headerSide 'left' 行泳道） */
export const FRAME_HEADER_LEFT = 112;
/** 标题左内边距（渲染与编辑同源） */
export const FRAME_PAD_X = 10;
/** 标题字号 */
export const FRAME_TITLE_FONT = 13;
/** 标题像素行高（单行 1.4 倍——编辑器 lineHeightPx 与渲染共用） */
export const FRAME_TITLE_LINE_HEIGHT = 18;
/** 边框命中环宽（屏幕 px，命中时按 vpScale 折算世界值） */
export const FRAME_HIT_EDGE = 8;
/** 折算后的世界值上限（防 0.05x 下环宽过大吃掉整块内部） */
export const FRAME_HIT_EDGE_MAX = 32;
/** 单击创建默认尺寸 */
export const FRAME_DEFAULT_SIZE = { width: 320, height: 220 };
/** 拖拽草稿 / resize 软下限（再低只退化不禁止） */
export const FRAME_MIN_SIZE = { width: 40, height: 40 };
export const FRAME_DEFAULT_COLOR = '#ffffff';
export const FRAME_DEFAULT_BORDER = '#94a3b8';
/** 标题渲染/编辑退化阈值：低于此值带内放不下文字（§3.2 退化不抛错） */
export const FRAME_TITLE_MIN_SIZE = 24;

// —— 标题带几何（§3.2，局部系左上原点） ——

/** 标题带矩形：top = 整宽 × 28；left = 112 × 整高（带宽/列宽按整尺寸钳制，
 *  超小容器不会画出负尺寸带） */
export function frameHeaderRect(w: number, h: number, side: 'top' | 'left'): IRect {
  return side === 'top'
    ? { x: 0, y: 0, width: w, height: Math.min(FRAME_HEADER_TOP, h) }
    : { x: 0, y: 0, width: Math.min(FRAME_HEADER_LEFT, w), height: h };
}

/** 标题文字可用宽（top = w − 2×PAD；left = 112 − 2×PAD；下限 0） */
export function frameTitleWidth(w: number, h: number, side: 'top' | 'left'): number {
  void h;
  const usable = (side === 'top' ? w : FRAME_HEADER_LEFT) - FRAME_PAD_X * 2;
  return Math.max(usable, 0);
}

/** 标题文字矩形（局部系）：带内左侧内边距 + 垂直居中（left 侧同样垂直居中，
 *  不贴顶——§3.2）。供渲染定位与 plain 编辑器 getRect 共用 */
export function frameTitleRect(w: number, h: number, side: 'top' | 'left'): IRect {
  const band = frameHeaderRect(w, h, side);
  const lineH = Math.min(FRAME_TITLE_LINE_HEIGHT, band.height);
  return {
    x: band.x + FRAME_PAD_X,
    y: band.y + (band.height - lineH) / 2,
    width: frameTitleWidth(w, h, side),
    height: lineH,
  };
}

// —— 单行截断（§3.2：同 SYMBOL 标签口径——二分最长前缀 + 省略号） ——

/** 单行截断：超出可用宽时按字素二分找最长前缀 + '…'；连省略号都放不下返回
 *  '…'（由调用方的最小宽度兜底）。measure 注入（canvas 测宽单源） */
export function truncateTitle(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (text.length === 0 || measure(text) <= maxWidth) return text;
  const gs = [...graphemes(text)];
  const ellipsis = '…';
  let lo = 0;
  let hi = gs.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(gs.slice(0, mid).join('') + ellipsis) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return gs.slice(0, lo).join('') + ellipsis;
}

// —— 命中区域（§3.3：标题带 ∪ 边框环，内部空白不命中） ——

function rectContains(r: IRect, p: IPoint): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * 容器命中 = 标题带 ∪ 边框环（不含内部空白）。edgeWorld 由调用方按
 * `clamp(FRAME_HIT_EDGE / vpScale, FRAME_HIT_EDGE, FRAME_HIT_EDGE_MAX)` 现算
 * （缩放随时变，不缓存）。边框环在任一边尺寸不足两倍环宽时退化为整块命中
 * （超小容器必须仍抓得住，不能处处漏）。
 */
export function frameHitTest(
  p: IPoint,
  rect: IRect,
  side: 'top' | 'left',
  edgeWorld: number,
): boolean {
  if (rectContains(rect, p)) {
    // 命中标题带（天然抓取把手——泳道 = 抓表头）；band 是局部系，平移到 rect 原点
    const band = frameHeaderRect(rect.width, rect.height, side);
    const bandAt = {
      x: rect.x + band.x,
      y: rect.y + band.y,
      width: band.width,
      height: band.height,
    };
    if (rectContains(bandAt, p)) return true;
    // 边框环：在 rect 内且不在内缩矩形内；任一边放不下两倍环宽 = 整块算环
    const insetW = rect.width - edgeWorld * 2;
    const insetH = rect.height - edgeWorld * 2;
    if (insetW <= 0 || insetH <= 0) return true;
    const inner: IRect = {
      x: rect.x + edgeWorld,
      y: rect.y + edgeWorld,
      width: insetW,
      height: insetH,
    };
    return !rectContains(inner, p);
  }
  return false;
}
