/**
 * 符号控件几何单源（specs/symbol-widget §3）：两段几何（图形区 + 标签带）派生、
 * contain 适配、图形区四边锚点、单行标签截断与落库清洗——全部纯函数，单测直测。
 */
import type { IPoint, IRect, JoinDir } from '../../common/geometry';
import { graphemes, type IMeasurer, type ITextStyleProps } from '../../platform/textEngine/measure';
import { defaultTextColor } from '../../platform/textEngine/theme';

/** 合法着色：#RRGGBB（ActionBar 色板全 6 位 hex；坏项目文件里的空串/色名/
 *  三位 hex 一律兜底——防 hexToNum 产出 NaN tint） */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** 着色单源（specs/symbol-widget §4.4）：缺省随主题墨色（light #333333 /
 *  dark #ededf2）；图标与标签同色；显式 color 不随主题反转（实例数据语义，
 *  与 textColor 同口径）。渲染 Vm / 编辑器 / ActionBar 触发钮共用本函数。
 *  纯模块（无 PIXI）——样式层与编辑链 import 本文件即可，不依赖 Vm 层 */
export function resolveSymbolColor(data: { color?: string }): string {
  return data.color && HEX6.test(data.color) ? data.color : defaultTextColor();
}

// —— 常量（§3.1；标签带恒定 = 几何与对齐可预测，空标签不塌陷） ——

/** 标签字号（与 SHAPE 正文默认字号一致） */
export const SYMBOL_LABEL_FONT_SIZE = 16;
/** 标签像素行高（1.5 倍） */
export const SYMBOL_LABEL_LINE_HEIGHT = 24;
/** 标签带高度（恒定，空标签也保留） */
export const SYMBOL_LABEL_BAND = 24;
/** 图形区与标签带间距 */
export const SYMBOL_LABEL_GAP = 8;
/** 单击创建默认宽 */
export const SYMBOL_DEFAULT_WIDTH = 96;
/** 单击创建默认高（96 图形 + 8 间距 + 24 标签带） */
export const SYMBOL_DEFAULT_HEIGHT = 128;
/** 拖拽创建草稿软下限（再低只退化不禁止，§3.3） */
export const SYMBOL_MIN_WIDTH = 48;
export const SYMBOL_MIN_HEIGHT = 56;
/** 标签落库截断上限（字素级） */
export const SYMBOL_LABEL_MAX_CHARS = 64;
/** 标签左右内边距（渲染与编辑同源） */
export const SYMBOL_LABEL_PADDING_X = 4;
/** 资产 viewBox 边长（生成期硬校验同一约定，§4.3） */
export const SYMBOL_GLYPH_VIEWBOX = 48;

// —— 两段几何（§3.2，局部系左上原点） ——

export function symbolGlyphRect(w: number, h: number): IRect {
  return { x: 0, y: 0, width: w, height: Math.max(h - SYMBOL_LABEL_BAND - SYMBOL_LABEL_GAP, 0) };
}

export function symbolLabelRect(w: number, h: number): IRect {
  return {
    x: 0,
    y: Math.max(h - SYMBOL_LABEL_BAND, 0),
    width: w,
    height: Math.min(SYMBOL_LABEL_BAND, h),
  };
}

/**
 * contain 适配（§3.2）：图标按图形区等比缩放居中（不拉伸——设备图标拉扁
 * 立刻露馅），宽高不等时左右或上下留白。退化（图形区非正）由调用方跳过绘制。
 */
export function containFitGlyph(glyph: IRect): { x: number; y: number; scale: number } {
  const vb = SYMBOL_GLYPH_VIEWBOX;
  const s = Math.max(Math.min(glyph.width / vb, glyph.height / vb), 0);
  return {
    x: glyph.x + (glyph.width - vb * s) / 2,
    y: glyph.y + (glyph.height - vb * s) / 2,
    scale: s,
  };
}

/**
 * 图形区四边锚点（§3.4）：t ∈ [0,1] 沿图形区边滑动；标签带不参与锚定
 * （连线落在图标上而不是名字上）。旋转恒 0（rotatable: false），无 θ 回投。
 */
export function symbolGlyphAnchor(rect: IRect, join: JoinDir, t: number): IPoint {
  const bottom = Math.max(rect.height - SYMBOL_LABEL_BAND - SYMBOL_LABEL_GAP, 0);
  switch (join) {
    case 'top':
      return { x: rect.x + rect.width * t, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width * t, y: rect.y + bottom };
    case 'left':
      return { x: rect.x, y: rect.y + bottom * t };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + bottom * t };
  }
}

// —— 标签（§5.1/§5.4：单行渲染截断 + 落库清洗；数据恒存完整 64 字素） ——

/**
 * 单行截断：可用宽度内逐字素贪心保留，超宽末尾补省略号。textEngine 的
 * overflow:'hidden' 未实现（measure.ts Pending，docs/07 §5）——符号标签不走
 * 自动换行，靠本函数在渲染前截短（加宽控件后完整名字自动回来）。
 * 连省略号都放不下的极端窄宽返回 '…'（由调用方的最小宽度兜底）。
 */
export function truncateLabelToWidth(
  label: string,
  maxWidth: number,
  style: ITextStyleProps,
  measurer: IMeasurer,
): string {
  if (label.length === 0 || measurer.measure(label, style) <= maxWidth) return label;
  const gs = [...graphemes(label)];
  const ellipsis = '…';
  // 二分最大前缀 k（前缀宽度单调）：width(前 k 字素 + …) ≤ maxWidth
  let lo = 0;
  let hi = gs.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measurer.measure(gs.slice(0, mid).join('') + ellipsis, style) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return gs.slice(0, lo).join('') + ellipsis;
}

/** 落库清洗（§5.1）：连续空白（含换行）折成一个空格 → trim → 截 64 字素 */
export function clampSymbolLabel(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const gs = [...graphemes(collapsed)];
  return gs.length <= SYMBOL_LABEL_MAX_CHARS
    ? collapsed
    : gs.slice(0, SYMBOL_LABEL_MAX_CHARS).join('');
}
