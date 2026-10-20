import type { IRect } from '../../common/geometry';

/**
 * 等间距参考线纯逻辑（docs/06 §7，参考equal-spacing guides）。
 *
 * 拖动中若与两侧邻居的间隙「接近相等」，吸附到精确等距位置并产出徽标数据：
 * - 触发：邻居与被拖矩形在该轴的**投影重叠**（只在「横向排」语境下谈水平间距）；
 * - 两种等距独立检测取最强：边间隙等距（gapL = gapR）与中心等距（A.cx 居中）；
 * - 解析解非迭代：边间隙 d = (L.r + R.l − A.w)/2 − A.x；中心 d = (L.cx + R.cx)/2 − A.w/2 − A.x；
 * - 优先级（同轴对齐 > 等距）由调用方接线（refLineService），纯函数不知晓。
 */

/** 一段间隙的绘制数据（徽标 + 桥线） */
export interface ISpacingGap {
  axis: 'x' | 'y';
  /** 间隙沿轴起止（世界坐标） */
  from: number;
  to: number;
  /** 间隙正交方向的位置（被拖矩形 cross 中点） */
  cross: number;
  /** 间隙值（世界单位，徽标数字） */
  value: number;
}

export interface ISpacingResult {
  dx: number;
  dy: number;
  /** 命中等距时的间隙段（0 或 2 段；两轴各自独立，最多 4 段） */
  gaps: ISpacingGap[];
}

interface AxisView {
  main: (r: IRect) => number;
  size: (r: IRect) => number;
  crossStart: (r: IRect) => number;
  crossSize: (r: IRect) => number;
}

const X_AXIS: AxisView = {
  main: (r) => r.x,
  size: (r) => r.width,
  crossStart: (r) => r.y,
  crossSize: (r) => r.height,
};
const Y_AXIS: AxisView = {
  main: (r) => r.y,
  size: (r) => r.height,
  crossStart: (r) => r.x,
  crossSize: (r) => r.width,
};

/** 单轴等距：投影重叠的左右（上下）邻居配对，取偏差最小的等距解 */
function axisSpacing(
  axis: 'x' | 'y',
  view: AxisView,
  cur: IRect,
  base: IRect,
  delta: number,
  neighbors: IRect[],
  threshold: number,
): { delta: number; gaps: ISpacingGap[] } {
  const a0 = view.main(base); // 被拖矩形该轴初始坐标
  const aw = view.size(base);
  const aStart = view.crossStart(cur);
  const aEnd = aStart + view.crossSize(cur);
  const aCur = view.main(cur);

  const overlaps = neighbors.filter((n) => {
    const ns = view.crossStart(n);
    return aStart < ns + view.crossSize(n) && ns < aEnd;
  });
  const lefts = overlaps.filter((n) => view.main(n) + view.size(n) < aCur);
  const rights = overlaps.filter((n) => view.main(n) > aCur + aw);
  if (lefts.length === 0 || rights.length === 0) return { delta, gaps: [] };

  let best: { d: number; dev: number; gaps: ISpacingGap[] } | null = null;
  const cross = aStart + view.crossSize(cur) / 2;
  // 边间隙徽标：两段 = 邻缘→A 左缘 / A 右缘→邻缘
  const edgeGaps = (lr: number, rl: number, aAt: number): ISpacingGap[] => [
    { axis, from: lr, to: aAt, cross, value: Math.abs(aAt - lr) },
    { axis, from: aAt + aw, to: rl, cross, value: Math.abs(rl - aAt - aw) },
  ];
  // 中心等距徽标：两段 = 邻中心→A 中心 / A 中心→邻中心
  const centerGaps = (lc: number, rc: number, aCx: number): ISpacingGap[] => [
    { axis, from: lc, to: aCx, cross, value: Math.abs(aCx - lc) },
    { axis, from: aCx, to: rc, cross, value: Math.abs(rc - aCx) },
  ];

  for (const l of lefts) {
    for (const r of rights) {
      // 边间隙等距：gapL = gapR 的解析解
      const lr = view.main(l) + view.size(l);
      const rl = view.main(r);
      const dEdge = (lr + rl - aw) / 2 - a0;
      const devEdge = Math.abs(delta - dEdge);
      const aAtEdge = a0 + dEdge;
      if (devEdge < threshold && aAtEdge - lr > 0 && rl - aAtEdge - aw > 0) {
        if (!best || devEdge < best.dev)
          best = { d: dEdge, dev: devEdge, gaps: edgeGaps(lr, rl, aAtEdge) };
      }
      // 中心等距：被拖中心在两邻中心正中
      const lc = view.main(l) + view.size(l) / 2;
      const rc = view.main(r) + view.size(r) / 2;
      const dCenter = (lc + rc) / 2 - aw / 2 - a0;
      const devCenter = Math.abs(delta - dCenter);
      if (devCenter < threshold && devCenter > 0.01) {
        if (!best || devCenter < best.dev) {
          best = { d: dCenter, dev: devCenter, gaps: centerGaps(lc, rc, a0 + dCenter + aw / 2) };
        }
      }
    }
  }
  if (!best) return { delta, gaps: [] };
  return { delta: best.d, gaps: best.gaps };
}

/** 等间距吸附：对期望位移 (dx,dy) 修正，命中时给出间隙徽标数据（解析解） */
export function snapEqualSpacing(
  rect: IRect,
  dx: number,
  dy: number,
  neighbors: IRect[],
  threshold: number,
): ISpacingResult {
  const cur: IRect = { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
  const sx = axisSpacing('x', X_AXIS, cur, rect, dx, neighbors, threshold);
  const sy = axisSpacing('y', Y_AXIS, cur, rect, dy, neighbors, threshold);
  return { dx: sx.delta, dy: sy.delta, gaps: [...sx.gaps, ...sy.gaps] };
}
