import type { IPoint } from '../../common/geometry';

/**
 * 轮廓折线的曲线采样工具（specs/flowchart-closeout §23 新模块 <200 行拆分）：
 * 二次贝塞尔链与圆角弧的折线化——outlinePolyline 的 20 型数据表消费。
 * 采样密度与 shapePath.drawShapePath 共用 shapeMetrics 单源；弦高误差
 * < 0.5px（8 段/曲线）。独立成模块避免数据表与生成器互相牵连行数。
 */

/** 二次贝塞尔采样段数（每条曲线） */
export const CURVE_SAMPLES = 8;
/** 椭圆圆周采样段数 */
export const ELLIPSE_SAMPLES = 32;

export const quadAt = (p0: IPoint, c: IPoint, p1: IPoint, t: number): IPoint => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
});

export function quadChain(p0: IPoint, c: IPoint, p1: IPoint, n = CURVE_SAMPLES): IPoint[] {
  const out: IPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(quadAt(p0, c, p1, i / n));
  return out;
}

/** 圆角矩形轮廓（round-rect 与 stadium 共用；每角 4 段弧采样） */
export function roundedOutline(w: number, h: number, radius: number): IPoint[] {
  const r = Math.min(radius, w / 2, h / 2);
  const corner = (cx: number, cy: number, a0: number): IPoint[] => {
    const pts: IPoint[] = [];
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  };
  // 从左上角弧起点顺时针：上边 → 右上角 → 右边 → 右下角 → 下边 → 左下角 → 左边 → 左上角
  return [
    { x: r, y: 0 },
    { x: w - r, y: 0 },
    ...corner(w - r, r, -Math.PI / 2),
    ...corner(w - r, h - r, 0),
    ...corner(r, h - r, Math.PI / 2),
    ...corner(r, r, Math.PI),
  ];
}
