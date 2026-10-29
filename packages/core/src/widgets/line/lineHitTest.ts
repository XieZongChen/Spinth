import type { Point } from 'pixi.js';
import type { IHostGeom } from '../../common/geometry';
import type { IViewportService, IVmEngineService } from '../../types';
import { dotOffsetCenter, type IPt, type JoinDir } from './lineMath';

const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 锚点抓取边缘容差（屏幕像素）：连接点画在元素**边上**，严格 point-in-bounds
 *  会在贴边/压点时出界——指示器闪烁、按点抓空（用户实测）。命中失败时按此
 *  容差取环内最近元素（连线命中检测 8px 同款口径）。 */
export const ANCHOR_GRAB_TOLERANCE_SCREEN = 8;

/** 悬停命中：返回被压住的控件（line 工具下按下在控件上 = 锚定起点）。
 *  严格命中优先；未命中按边缘容差取环内最近元素（连接点在边上——贴边
 *  悬停/按压点必须仍命中，否则指示器闪烁、起点抓空）。
 *  PEN 不参与（2026-10-08 用户拍板）：画笔元素不作为连线锚定/快捷创建
 *  目标——线画开路径，与笔画交叉会误抓。
 *  命中返回宿主几何（局部矩形 + θ，docs/05 §8——锚点/最近边随旋转感知）；
 *  容差环按世界 AABB（保守外接）。
 *  消费方：LineDrawSession（拉线起点吸附）与 LineEndpointDrag（重锚定命中）。
 */
export function hitWidget(
  vmEngine: IVmEngineService,
  viewport: IViewportService,
  p: { x: number; y: number },
): { id: string; geom: IHostGeom } | null {
  for (const vm of vmEngine.getVmByPoint({ x: p.x, y: p.y } as Point)) {
    if (vm.type === 'LINE' || vm.type === 'PEN') continue;
    return { id: vm.id, geom: vm.getHostGeom() };
  }
  const tol = ANCHOR_GRAB_TOLERANCE_SCREEN / (viewport.vpScale$.value || 1);
  const cands = vmEngine.getVmsInRect({
    x: p.x - tol,
    y: p.y - tol,
    width: tol * 2,
    height: tol * 2,
  });
  for (const vm of cands) {
    if (vm.type === 'LINE' || vm.type === 'PEN') continue;
    const b = vm.getBounds();
    const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width));
    const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
    if (Math.hypot(dx, dy) <= tol) return { id: vm.id, geom: vm.getHostGeom() };
  }
  return null;
}

/** 选中形状的最近连接点外移点（抓取判定按**外移点**——形状外 24px；
 *  maybeShapeAnchorGrab 抓取与 hover 同口径） */
export function nearestAnchorDot(
  geom: IHostGeom,
  world: { x: number; y: number },
  scale: number,
): { j: JoinDir; d: number } {
  return JOINS.map((j) => ({ j, a: dotOffsetCenter(geom.rect, j, 0, scale) }))
    .map(({ j, a }) => ({ j, d: Math.hypot(a.x - world.x, a.y - world.y) }))
    .sort((p, q) => p.d - q.d)[0]!;
}

/** 连线两端较近的一端（handleGestureDown 端点手柄抓取用；pts = 视觉语义路径） */
export function nearestLineEndpoint(
  pts: IPt[],
  world: { x: number; y: number },
): { which: 'start' | 'end'; d: number } {
  const dStart = Math.hypot(world.x - pts[0]!.x, world.y - pts[0]!.y);
  const dEnd = Math.hypot(world.x - pts[pts.length - 1]!.x, world.y - pts[pts.length - 1]!.y);
  const which: 'start' | 'end' = dStart <= dEnd ? 'start' : 'end';
  return { which, d: which === 'start' ? dStart : dEnd };
}
