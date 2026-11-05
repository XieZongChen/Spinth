/**
 * 操作栏定位几何（specs/a11y-closeout §7.4）——纯函数：从 ActionBar 渲染期
 * 逐字迁出（渲染期读 getComputedStyle/window.innerWidth 是纯度+性能债，
 * 且安全区变化没有失效路径）。常量随数学同源，ActionBar 只引用不复制。
 */
import type { ISafeInsets } from '../a11y/safeArea';

/** 操作栏出现在选区上方的间距（视觉规格） */
export const OFFSET_Y = 12;
/** 操作栏预估高度（实测就绪前的兜底，也是翻转判定用高的下限——根字号 16px 下
 *  实测 38–39px，取 max 保 1x 位置不变；上方放不下时翻到下方） */
export const BAR_HEIGHT_EST = 40;
/** 实测宽度就绪前的渲染帧宽度兜底（useLayoutEffect 校正发生在绘制前） */
export const BAR_WIDTH_FALLBACK = 320;
/** 安全区全 0（渲染期兜底用；桌面 inset=0 时布局与无安全区逐像素一致） */
export const ZERO_INSETS: ISafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
/** 左右留白基数（安全区另计） */
const PAD_BASE = 8;
/** 可快速创建类型（选中态有外置连接点 + 快捷按钮，形状外 ~24px）→ 上移让位 */
const QUICK_CAPABLE = new Set(['SHAPE', 'STICKY', 'TEXT', 'IMAGE']);
/** 让位量（连接点 + 快捷按钮的净空） */
const QUICK_CLEAR = 34;
/** 上方最小留白（不足则翻到选区下方） */
const MIN_ABOVE = 4;

export interface IBarLayoutInput {
  bounds: { x: number; y: number; width: number; height: number };
  barW: number;
  /** 翻转判定用的栏高（specs/rem-typography §4.6）；缺省 BAR_HEIGHT_EST——
   *  根字号放大时栏随 rem 变高，调用方传实测值才不会压住选区 */
  barH?: number;
  areaW: number;
  safe: ISafeInsets;
  type: string;
}

export interface IBarLayout {
  left: number;
  top: number;
}

/** 以选区水平中心居中，画布区域内钳制——左右留白计入安全区；上方放得下则悬于
 *  选区上方（QUICK 类型让位），否则翻到下方。bounds 是 canvas 局部坐标。 */
export function computeBarLayout(i: IBarLayoutInput): IBarLayout {
  const padL = PAD_BASE + i.safe.left;
  const padR = PAD_BASE + i.safe.right;
  const left = Math.min(
    Math.max(i.bounds.x + i.bounds.width / 2 - i.barW / 2, padL),
    Math.max(i.areaW - i.barW - padR, padL),
  );
  const quickClear = QUICK_CAPABLE.has(i.type) ? QUICK_CLEAR : 0;
  const aboveY = i.bounds.y - OFFSET_Y - (i.barH ?? BAR_HEIGHT_EST) - quickClear;
  const top = aboveY >= MIN_ABOVE ? aboveY : i.bounds.y + i.bounds.height + OFFSET_Y;
  return { left, top };
}
