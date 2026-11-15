/**
 * 正交折线圆角命令生成器（specs/tree-diagrams §6.4，Phase 3）：纯函数——
 * 给定拐点序列输出 moveTo/lineTo/arc 命令，拐角 R8 真圆弧（与 mind 鱼骨
 * 同一圆角语言）；共线相邻段自动退化（单子竖直连线无水平段、无拐角）。
 * 圆心 = corner + (离开方向 − 进入方向)·r（正交拐角内角平分），起止角取
 * 切点相对圆心的 atan2，ccw = 进入×离开 叉积 < 0——四象限参数与 mind 鱼骨
 * 实战实现逐例同值（connector/mind.ts 四象限表）。
 */
import type { IConnectorCmd } from './types';

/** 拐角圆角半径（与 mind NODE_LINE_ARC_RADIUS 同值——全树统一圆角语言） */
export const ORTHO_CORNER_RADIUS = 8;

/** 过滤共线中点（1e-6 容差）：正交路径中不产生拐角的中间点直接去掉 */
function dropCollinear(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;
  const pts: Array<{ x: number; y: number }> = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = pts[pts.length - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const collinear =
      (Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) ||
      (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6);
    if (!collinear) pts.push(b);
  }
  pts.push(points[points.length - 1]!);
  return pts;
}

export function orthogonalPath(
  points: Array<{ x: number; y: number }>,
  radius = ORTHO_CORNER_RADIUS,
): IConnectorCmd[] {
  const pts = dropCollinear(points);
  if (pts.length < 2) return [];

  const cmds: IConnectorCmd[] = [{ op: 'moveTo', x: pts[0]!.x, y: pts[0]!.y }];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const corner = pts[i]!;
    const next = pts[i + 1]!;
    const u = { x: Math.sign(corner.x - prev.x), y: Math.sign(corner.y - prev.y) };
    const v = { x: Math.sign(next.x - corner.x), y: Math.sign(next.y - corner.y) };
    // 段过短时收缩半径（圆弧不越过相邻拐点）
    const r = Math.min(
      radius,
      Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const p1 = { x: corner.x - u.x * r, y: corner.y - u.y * r };
    const p2 = { x: corner.x + v.x * r, y: corner.y + v.y * r };
    cmds.push({ op: 'lineTo', x: p1.x, y: p1.y });
    if (r > 1e-6) {
      const ccx = corner.x + (v.x - u.x) * r;
      const ccy = corner.y + (v.y - u.y) * r;
      const cross = u.x * v.y - u.y * v.x;
      cmds.push({
        op: 'arc',
        cx: ccx,
        cy: ccy,
        r,
        start: Math.atan2(p1.y - ccy, p1.x - ccx),
        end: Math.atan2(p2.y - ccy, p2.x - ccx),
        ccw: cross < 0,
      });
    }
    cmds.push({ op: 'lineTo', x: p2.x, y: p2.y });
  }
  const last = pts[pts.length - 1]!;
  cmds.push({ op: 'lineTo', x: last.x, y: last.y });
  return cmds;
}
