import { Disposable } from '../../base/disposable';
import type { IHostGeom, IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IHistoryService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import { quantizeGrid } from '../../common/grid';
import {
  anchorOf,
  collectRouteObstacles,
  inverseRotatePoint,
  routeSelfLoop,
  nearestJoin,
  nodeAnchorPoint,
  quantizeJoin,
  r2,
  routeElbow,
  type JoinDir,
} from './lineMath';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import type { LineVm } from './lineVm';
import type { LineHoverOverlay } from './lineHoverOverlay';
import type { ILineAnchorData } from './lineQuickAdd';
/**
 * 端点拖拽协作者（自 lineService 拆出，2026-10-05 A1 整理批刀 5）：
 * 单选连线拖端点手柄重锚定 / 拖离解绑（批次 2）。previewRoute 视觉预览 +
 * 松手单事务落库；pointercancel 走 Up 同款收尾（pending 落库语义对打断安全，
 * 外部审查 S1）。命中判定（hitWidget ①③ 共用）经 host 回调。
 */
const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

export interface ILineEndpointDragHost {
  /** 画布命中（宿主 hitWidget：严格命中 + 边缘容差回退，①绘制管线共用） */
  hitTest(world: { x: number; y: number }): { id: string; geom: IHostGeom } | null;
  /** 网格吸附开关（specs/flowchart-closeout §9.2：自由端点量化；组合根注入） */
  gridSnapOn(): boolean;
}

export class LineEndpointDrag extends Disposable {
  private session: {
    id: string;
    which: 'start' | 'end';
    pending: {
      points: Array<[number, number]>;
      nodeId: string | null;
      join: JoinDir | null;
      port: number | null;
    } | null;
  } | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly history: IHistoryService,
    private readonly overlay: LineHoverOverlay,
    private readonly host: ILineEndpointDragHost,
  ) {
    super();
  }

  /** 会话进行中（宿主手势守卫/悬停抑制读） */
  get active(): boolean {
    return this.session !== null;
  }

  /** 建立拖拽会话（handleGestureDown 端点命中分支调用；返回 true 消费手势） */
  begin(id: string, which: 'start' | 'end'): boolean {
    this.session = { id, which, pending: null };
    this.overlay.hideHandles(); // 拖拽中手柄隐藏（路由重算，旧段位置失效；由 previewRoute + 指示器接管视觉）
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, { once: true });
    // pointercancel → Up 同款收尾（pending 落库语义对打断安全，外部审查 S1）
    window.addEventListener('pointercancel', this.onUp);
    return true;
  }

  private readonly onMove = (e: PointerEvent): void => {
    const d = this.session;
    if (!d) return;
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    const model = this.engine.getModelById(d.id);
    if (!model) return;
    const data = model.toJSON() as unknown as ILineAnchorData;
    const hit = this.host.hitTest(world);
    const join = hit ? nearestJoin(hit.geom.rect, world, hit.geom.rotation) : null;
    // 沿边参数（specs/flowchart-closeout §7.4）：指针在命中边上的投影 t ∈ [0,1]
    // （局部系，θ 感知——旋转宿主先逆变换再投影）；命中边 + port 一起落库固定该端
    let port: number | null = null;
    if (hit && join) {
      const r = hit.geom.rect;
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const local =
        hit.geom.rotation === 0 ? world : inverseRotatePoint(world, center, hit.geom.rotation);
      const raw =
        join === 'top' || join === 'bottom'
          ? (local.x - r.x) / (r.width || 1)
          : (local.y - r.y) / (r.height || 1);
      port = r2(Math.min(1, Math.max(0, raw)));
    }
    // 锚点单源经 vm.getAnchorPoint（ShapeVm 覆写轮廓交点；§7.1 第 3 层）
    const anchor = (hit && join
      ? nodeAnchorPoint(this.vmEngine, hit.id, hit.geom, join, port ?? 0.5)
      : null) ??
      (hit && join ? anchorOf(hit.geom.rect, join, hit.geom.rotation, port ?? 0.5) : null) ?? {
        // 自由端：网格开时量化端点世界坐标（已锚定端不量化——宿主决定，§9.2）
        x: this.host.gridSnapOn() ? quantizeGrid(world.x) : world.x,
        y: this.host.gridSnapOn() ? quantizeGrid(world.y) : world.y,
      };
    // 吸附反馈：目标元素连接点亮起（悬停目标时）
    if (hit) this.overlay.showDrawFeedback(hit.id, hit.geom, JOINS.indexOf(join!));
    else this.overlay.hideDrawFeedback();
    const pts = data.points.map((p) => ({ x: p[0], y: p[1] }));
    // 避让节点用世界 AABB（旋转宿主保守外接，docs/05 §8）
    const hostAabb = (g: { geom: IHostGeom } | null): IRect | null =>
      g ? rotatedRectBounds(g.geom.rect, g.geom.rotation) : null;
    const nodeAabb = (id: string | null): IRect | null => {
      if (!id) return null;
      const g = this.vmEngine.getVmById(id)?.getHostGeom();
      return g ? rotatedRectBounds(g.rect, g.rotation) : null;
    };
    let route: Array<{ x: number; y: number }>;
    let nodeId: string | null;
    // 从 A 拖回 A（重锚定到另一端同一节点）→ 紧凑自环（§7.5，G-07）
    const selfLoopHit =
      hit && join && d.which === 'end'
        ? data.startNodeId && hit.id === data.startNodeId && data.startJoin
        : data.endNodeId && hit?.id === data.endNodeId && data.endJoin;
    if (d.which === 'end') {
      route =
        selfLoopHit && hit && join && data.startJoin
          ? routeSelfLoop({
              start: pts[0]!,
              startJoin: data.startJoin,
              end: anchor,
              endJoin: join,
              node: hostAabb(hit)!,
            })
          : routeElbow({
              start: pts[0]!,
              startJoin: data.startJoin,
              end: anchor,
              endJoin: join && hit ? quantizeJoin(join, hit.geom.rotation) : join,
              startNode: nodeAabb(data.startNodeId),
              endNode: hostAabb(hit),
              // 全局避障（G-06）：重锚定预览实时绕行第三节点
              obstacles: collectRouteObstacles(
                this.vmEngine,
                pts[0]!,
                anchor,
                data.startNodeId,
                hit?.id ?? null,
              ),
            });
      nodeId = hit?.id ?? null;
    } else {
      route =
        selfLoopHit && hit && join && data.endJoin
          ? routeSelfLoop({
              start: anchor,
              startJoin: join,
              end: pts[pts.length - 1]!,
              endJoin: data.endJoin,
              node: hostAabb(hit)!,
            })
          : routeElbow({
              start: anchor,
              startJoin: join && hit ? quantizeJoin(join, hit.geom.rotation) : join,
              end: pts[pts.length - 1]!,
              endJoin: data.endJoin,
              startNode: hostAabb(hit),
              endNode: nodeAabb(data.endNodeId),
              obstacles: collectRouteObstacles(
                this.vmEngine,
                anchor,
                pts[pts.length - 1]!,
                hit?.id ?? null,
                data.endNodeId,
              ),
            });
      nodeId = hit?.id ?? null;
    }
    const solid = route.map((p) => [r2(p.x), r2(p.y)] as [number, number]);
    d.pending = { points: solid, nodeId, join, port };
    (this.vmEngine.getVmById(d.id) as LineVm).previewRoute(route);
    this.overlay.showEndpointHandles(
      [route[0]!, route[route.length - 1]!],
      this.viewport.vpScale$.value || 1,
      d.which === 'start' ? 0 : 1,
    );
  };

  private readonly onUp = (): void => {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp); // once 监听显式移除（cancel 路径防泄漏）
    window.removeEventListener('pointercancel', this.onUp);
    const d = this.session;
    this.session = null;
    this.overlay.hideDrawFeedback();
    if (!d) return;
    const model = this.engine.getModelById(d.id);
    if (!model) return;
    if (d.pending) {
      // 单事务落库（一次撤销）；拖离 = nodeId/join 置空（自由端）。
      // 端点重锚定 = 回自动路由（pinned 复位，docs/08 §10 批次 3）
      const patch: Record<string, unknown> =
        d.which === 'end'
          ? {
              points: d.pending.points,
              endNodeId: d.pending.nodeId,
              endJoin: d.pending.join,
              // 命中即写 port 固定该端（§7.4）；拖离 = 自由端，port 随锚定一并
              // 清除。注意：Yjs 对 undefined 走 set 保留 key（读回 undefined，
              // dataProcessor 语义），消费方统一 ?? 兜底——非物理删字段；
              // 未写过 port 的线此处为 no-op（Object.is 同值跳过，零幻影写）
              endPort: d.pending.nodeId ? d.pending.port : undefined,
              pinned: false,
            }
          : {
              points: d.pending.points,
              startNodeId: d.pending.nodeId,
              startJoin: d.pending.join,
              startPort: d.pending.nodeId ? d.pending.port : undefined,
              pinned: false,
            };
      // 锚定不变式（docs/18 §2）：转锚定即脱组——锚定线位置由锚定系统拥有，
      // 编组语义无意义；同事务清除，一步 undo
      if (d.pending.nodeId) patch.groupId = undefined;
      model.update(patch as never);
      this.history.stopCapturing();
    }
    this.overlay.refreshHandles([d.id]);
  };
}
