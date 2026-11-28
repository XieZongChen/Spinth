import { Container, Point, Text } from 'pixi.js';
import { effectivePath, polylineHit } from './lineMath';
import { KNOCKOUT_PADDING, lineTextIsOffLine, textAnchorOf } from './lineVmText';
import type { LineData } from '../../types';

/** 连线命中域：点命中（线身）与线上文字 bbox 命中。接收 root/state/textSprite
 *  的显式几何，不依赖 LineVm 实例（避免与绘制模块成环）。 */

/** 命中容差余量（世界像素）：tol = strokeWidth + 6（线宽笔宽批——默认 2 恰等
 *  原定常 8 零默认变化；粗线放宽保可选中性。penVm「strokeWidth + 4」同族口径） */
export const HIT_TOLERANCE_BASE = 6;

export function hitTestLinePoint(p: Point, root: Container, state: LineData): boolean {
  // 视觉位置 = points + root 偏移（拖拽预览中 root 携带 delta），先把点转回 points 坐标系；
  // 命中沿视觉语义路径（STRAIGHT 只测首尾线段，不测残留拐点）
  const lx = p.x - root.x;
  const ly = p.y - root.y;
  const pts = effectivePath(
    state.points.map((q) => ({ x: q[0], y: q[1] })),
    state.lineType,
  );
  // 屏幕恒定容差（Batch 1 · 1.8①）：worldTransform.a = 全局缩放（含 viewport
  // zoom；预览位移不改变它）——低 zoom 世界 tol 缩成亚像素点不中、高 zoom 过宽误选
  const s = Math.abs(root.worldTransform.a) || 1;
  return polylineHit({ x: lx, y: ly }, pts, ((state.strokeWidth ?? 2) + HIT_TOLERANCE_BASE) / s);
}

/** 线上文字 bbox 命中（世界坐标；文字滑移手势抓取判定，docs/08 §6 批次 3）。
 *  bbox 与渲染文字盒同源（computeLineTextKnockout）：锚点走 textAnchorOf（侧别随
 *  偏移）；骑线 = Text 实测 + KNOCKOUT_PADDING 外扩，侧别 = 字形盒不外扩 */
export function hitTestLineText(
  p: Point,
  root: Container,
  state: LineData,
  textSprite: Text | null,
): boolean {
  if (!textSprite || !textSprite.visible) return false;
  const lx = p.x - root.x;
  const ly = p.y - root.y;
  const pts = effectivePath(
    state.points.map((q) => ({ x: q[0], y: q[1] })),
    state.lineType,
  );
  const c = textAnchorOf(pts, state, textSprite.height);
  const pad = lineTextIsOffLine(state) ? 0 : KNOCKOUT_PADDING;
  const w = textSprite.width + pad * 2;
  const h = textSprite.height + pad * 2;
  return lx >= c.x - w / 2 && lx <= c.x + w / 2 && ly >= c.y - h / 2 && ly <= c.y + h / 2;
}
