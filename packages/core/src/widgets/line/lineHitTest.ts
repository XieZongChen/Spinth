import type { Point } from 'pixi.js';
import type { IHostGeom } from '../../common/geometry';
import type { IBaseWidgetVm, IViewportService, IVmEngineService } from '../../types';
import { isAxisHost } from './lineAxisAnchor';
import { anchorDotCenter, type IPt, type JoinDir } from './lineMath';

const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 锚点抓取边缘容差（屏幕像素）：连接点画在元素**边上**，严格 point-in-bounds
 *  会在贴边/压点时出界——指示器闪烁、按点抓空（用户实测）。命中失败时按此
 *  容差取环内最近元素（连线命中检测 8px 同款口径）。 */
export const ANCHOR_GRAB_TOLERANCE_SCREEN = 8;

/** 悬停命中：返回被压住的控件（line 工具下按下在控件上 = 锚定起点）。
 *  严格命中优先；未命中按边缘容差取环内最近元素（连接点在边上——贴边
 *  悬停/按压点必须仍命中，否则指示器闪烁、起点抓空）。
 *  线 / 画笔 / isConnectionTarget() === false 的件不参与（isPickable）。
 *  命中返回宿主几何（局部矩形 + θ，docs/05 §8——锚点/最近边随旋转感知）；
 *  容差环按世界 AABB（保守外接），轴宿主按到轴段的距离。
 *  消费方：LineDrawSession（拉线起点吸附）与 LineEndpointDrag（重锚定命中）。
 */
export function hitWidget(
  vmEngine: IVmEngineService,
  viewport: IViewportService,
  p: { x: number; y: number },
): { id: string; geom: IHostGeom } | null {
  for (const vm of vmEngine.getVmByPoint({ x: p.x, y: p.y } as Point)) {
    if (isPickable(vm)) return { id: vm.id, geom: vm.getHostGeom() };
  }
  const tol = ANCHOR_GRAB_TOLERANCE_SCREEN / (viewport.vpScale$.value || 1);
  const cands = vmEngine.getVmsInRect({
    x: p.x - tol,
    y: p.y - tol,
    width: tol * 2,
    height: tol * 2,
  });
  for (const vm of cands) {
    if (isPickable(vm) && ringDistance(vm, p) <= tol) return { id: vm.id, geom: vm.getHostGeom() };
  }
  return null;
}

/** quick-add 资格（specs/sequence-diagram §4.8）：选中态四向连接点（refreshHandles）
 *  与抓取（maybeAnchorGrab）共用单源。轴宿主不出四点（消息从轴上任意高度起线，
 *  四向连接点只会聚在轴中段）、isConnectionTarget() === false 的件不出；线 / 画笔
 *  不在资格内（既有口径）。旋转件的禁用仍由调用处按 θ 判 */
export function canQuickAdd(
  vm:
    | { type: string; getAxisAnchor?: unknown; isConnectionTarget?: () => boolean }
    | null
    | undefined,
): boolean {
  if (!vm || vm.type === 'LINE' || vm.type === 'PEN') return false;
  return !isAxisHost(vm) && vm.isConnectionTarget?.() !== false;
}

/** 连线拾取排除项（两段循环共用）：PEN 不参与（2026-10-08 用户拍板）——画笔元素
 *  不作为连线锚定/快捷创建目标（线画开路径，与笔画交叉会误抓）；
 *  isConnectionTarget() === false 的件跳过继续取下层（specs/sequence-diagram
 *  §4.8——指针落在激活条上时取到下层的生命线） */
function isPickable(vm: Pick<IBaseWidgetVm, 'type'>): boolean {
  if (vm.type === 'LINE' || vm.type === 'PEN') return false;
  return (vm as IBaseWidgetVm).isConnectionTarget?.() !== false;
}

/** 容差环距离：轴宿主按到**轴段**的距离——生命线包围盒 120 宽，贴包围盒外沿
 *  8px 按下离轴还有 50 多 px，不该起消息（头框是实心块，严格命中已覆盖）；
 *  其他件按到包围盒的距离 */
function ringDistance(vm: IBaseWidgetVm, p: { x: number; y: number }): number {
  const axis = vm.getAxisAnchor?.() ?? null;
  if (axis) {
    return Math.hypot(p.x - axis.x, Math.max(axis.top - p.y, 0, p.y - axis.bottom));
  }
  const b = vm.getBounds();
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** 选中形状的最近连接点外移点（抓取判定按**外移点**——轮廓锚点外 24px；
 *  maybeShapeAnchorGrab 抓取与 hover 同口径。anchors = outlineAnchorsOf
 *  单源——可见圆点即抓取热区，非矩形形状不再点在这儿、抓在别处） */
export function nearestAnchorDot(
  anchors: readonly IPt[],
  world: { x: number; y: number },
  scale: number,
): { j: JoinDir; d: number } {
  return JOINS.map((j, i) => ({ j, a: anchorDotCenter(anchors[i]!, j, 0, scale) }))
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
