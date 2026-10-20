/**
 * 点阵背景的网格数学（docs/03 §6）——纯函数抽离以便单测（2026-09 质量护栏补强）。
 * 模型与语义见 DotGrid 组件头注；本模块只做「缩放 + 可视世界矩形 → 平铺参数」推导。
 */

export interface IGridBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IGridTransform {
  /** 屏幕点距 px（世界锚定 W×scale，W 翻倍保证 ≥ MIN_SCREEN_SPACING） */
  pitch: number;
  /** 屏幕点径 px（clamp(scale, 1, 4)） */
  dot: number;
  /** 层平移 px ∈ [-pitch, 0)：使点中心对齐世界格点（点在格中心，格点 ≡ 0 mod W） */
  dx: number;
  dy: number;
}

export const BASE_WORLD_SPACING = 16;
export const MIN_SCREEN_SPACING = 12;
export const DOT_MIN = 1;
export const DOT_MAX = 4;
/** 层四边过盈 px：≥ 最大点距（400% 时 64px），平移取模后仍全覆盖视口 */
export const OVERSCAN = 64;

export function computeGridTransform(scale: number, bounds: IGridBounds): IGridTransform {
  const s = scale > 0 ? scale : 1;
  let world = BASE_WORLD_SPACING;
  while (world * s < MIN_SCREEN_SPACING) world *= 2;
  const pitch = world * s;
  const dot = Math.min(DOT_MAX, Math.max(DOT_MIN, s));
  // 点中心屏幕 x = 层左缘 + pitch/2 + k·pitch，层左缘 = -OVERSCAN + dx，
  // 要求 ≡ -bounds.x·s (mod pitch)
  const dx = mod(-bounds.x * s + OVERSCAN - pitch / 2, pitch) - pitch;
  const dy = mod(-bounds.y * s + OVERSCAN - pitch / 2, pitch) - pitch;
  return { pitch, dot, dx, dy };
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
