import { Disposable } from '../../base/disposable';
import { type IHostGeom, type IRect } from '../../common/geometry';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import type { IDataEngineService, ISelectorService, IVmEngineService } from '../../types';
import {
  anchorOf,
  mergeCollinear,
  pinKeepMiddle,
  quantizeJoin,
  r2,
  routeElbow,
  type IPt,
  type JoinDir,
} from './lineMath';
import type { LineVm } from './lineVm';
import type { ILineAnchorData } from './lineQuickAdd';

/** points 内容级同值判定（reattach 幂等守卫） */
function samePoints(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);
}

/**
 * 连线锚定跟随协作者（自 lineService 拆出，2026-10-05 A1 整理批刀 4）：
 * 「模型 → 路由」域——锚定节点变化时线的重算（写模型 reattach / 切型重路由
 * rerouteLine）、拖拽预览期视觉跟随（previewFollow 零模型写）、锚定形状被删
 * 的解绑（unbindFrom）。无手势会话状态，依赖全注入，无 host 回调。
 */

export class LineAnchorFollow extends Disposable {
  /** 探针：最后一帧预览路由（E2E 断言拖动中跟随） */
  private previewFollowLast: Array<[number, number]> | null = null;

  constructor(
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
  ) {
    super();
  }

  get previewFollowDebug(): Array<[number, number]> | null {
    return this.previewFollowLast;
  }

  /** 解绑：线的 startNodeId/endNodeId 指向被删形状 → 置 null（points 不动） */
  unbindFrom(ids: string[]): void {
    const removed = new Set(ids);
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type !== 'LINE' || removed.has(vm.id)) continue;
      const model = this.engine.getModelById(vm.id);
      if (!model) continue;
      const data = model.toJSON() as unknown as ILineAnchorData;
      const patch: Record<string, unknown> = {};
      if (data.startNodeId && removed.has(data.startNodeId)) {
        patch.startNodeId = null;
        patch.startJoin = null;
      }
      if (data.endNodeId && removed.has(data.endNodeId)) {
        patch.endNodeId = null;
        patch.endJoin = null;
      }
      if (Object.keys(patch).length > 0) model.update(patch as never);
    }
  }

  /** 节点移动时重算关联线（由组合根在 vm onStateChanged$ 上调用）。
   *  宿主几何 = IHostGeom（局部矩形 + θ，docs/05 §8——旋转宿主锚点随边中点转） */
  reattach(nodeId: string, geom: IHostGeom): void {
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type !== 'LINE') continue;
      const model = this.engine.getModelById(vm.id);
      if (!model) continue;
      const data = model.toJSON() as unknown as ILineAnchorData;
      const pts = this.routeLinePoints(
        data,
        data.startNodeId === nodeId ? geom : null,
        data.endNodeId === nodeId ? geom : null,
      );
      // points 同值跳过（内容级——数组引用永不相等，Object.is 跳过失效）：
      // 几何命令（对齐/分布）在事务后急切 reattach，onStateChanged$ 微任务相
      // 会以相同输入重入——不拦会写出幻影事务（视觉无变化却多吃一步 undo）
      if (pts && !samePoints(data.points, pts)) model.update({ points: pts } as never);
    }
  }

  /**
   * 拖拽预览期的连线实时跟随（docs/08 §3；用户实测「拖动中连线掉在原地、
   * 松手才跳」）：对锚定于被拖控件的线按**预览宿主几何**（getHostGeom
   * 对预览位置/旋转敏感）重算路由，仅视觉重绘不写模型（docs/00 铁律 4——手势期零
   * Yjs 写）；松手落库触发既有 reattach 写真值并覆盖预览。
   * 每帧 O(线数) toJSON——线多时换邻接线反查表（docs/16 §1 预留）。
   */
  readonly previewFollow = (): void => {
    const moving = new Set(this.selector.selected$.value);
    if (moving.size === 0) return;
    this.previewFollowLast = null;
    for (const lvm of this.vmEngine.getAllVms()) {
      if (lvm.type !== 'LINE') continue;
      const model = this.engine.getModelById(lvm.id);
      if (!model) continue;
      const data = model.toJSON() as unknown as ILineAnchorData;
      const startMoving = !!data.startNodeId && moving.has(data.startNodeId);
      const endMoving = !!data.endNodeId && moving.has(data.endNodeId);
      if (!startMoving && !endMoving) continue;
      const startGeom = startMoving
        ? (this.vmEngine.getVmById(data.startNodeId!)?.getHostGeom() ?? null)
        : null;
      const endGeom = endMoving
        ? (this.vmEngine.getVmById(data.endNodeId!)?.getHostGeom() ?? null)
        : null;
      const pts = this.routeLinePoints(data, startGeom, endGeom);
      if (pts) {
        (lvm as LineVm).previewRoute(pts.map((p) => ({ x: p[0], y: p[1] })));
        this.previewFollowLast = pts; // 探针：最后一帧预览路由（E2E 断言拖动中跟随）
      }
    }
  };

  /**
   * 按两端锚定状态重算折线（reattach 写模型 / previewFollow 走视觉的共用核心）。
   * startGeom/endGeom 传 null = 该端不重锚（保持现点）；避让节点用世界 AABB
   * （rotatedRectBounds——旋转宿主保守外接，docs/05 §8 降级口径）。未锚定返回 null。
   */
  /** 端点锚点单源：vm.getAnchorPoint（ShapeVm 覆写为轮廓交点，G-04；预览感知）
   *  ——vm 缺失（桩/极端时序）回退 bbox anchorOf(geom)，t 缺省 0.5 = 边中点
   *  （specs/flowchart-closeout §7.1 第 3 层：不再直接调 anchorOf） */
  private anchorOfNode(
    nodeId: string | null,
    geom: IHostGeom | null,
    join: JoinDir | null,
    t: number,
  ): IPt | null {
    if (!join) return null;
    if (!geom) return null;
    const vm = nodeId ? this.vmEngine.getVmById(nodeId) : null;
    if (vm) return vm.getAnchorPoint(join, t);
    return anchorOf(geom.rect, join, geom.rotation, t);
  }

  private routeLinePoints(
    data: ILineAnchorData,
    startGeom: IHostGeom | null,
    endGeom: IHostGeom | null,
  ): Array<[number, number]> | null {
    if (!startGeom && !endGeom) return null;
    const pts = data.points.map((p) => ({ x: p[0], y: p[1] }));

    if (data.lineType !== 'ELBOWED') {
      // STRAIGHT：只替换锚定端点（既有语义；θ 感知——锚点随边中点旋转）
      if (startGeom && data.startJoin) {
        const a = this.anchorOfNode(
          data.startNodeId,
          startGeom,
          data.startJoin,
          data.startPort ?? 0.5,
        );
        if (a) pts[0] = { x: a.x, y: a.y };
      }
      if (endGeom && data.endJoin) {
        const b = this.anchorOfNode(data.endNodeId, endGeom, data.endJoin, data.endPort ?? 0.5);
        if (b) pts[pts.length - 1] = { x: b.x, y: b.y };
      }
      return pts.map((p) => [r2(p.x), r2(p.y)] as [number, number]);
    }

    if (data.pinned) {
      // 用户手滑段锁定（批次 3 waypoint，docs/08 §10）：拐点用户优先——两端
      // 重贴锚点（锚定跟随保持连通），中间拐点保持（锚定节点移动 U 形不丢）。
      // mergeCollinear 清锚点重贴可能产生的重合点（新锚点恰落旧拐点 → 零长段，
      // 段手柄/滑移几何随之退化）
      const startAnchor = this.anchorOfNode(
        data.startNodeId,
        startGeom,
        data.startJoin,
        data.startPort ?? 0.5,
      );
      const endAnchor = this.anchorOfNode(
        data.endNodeId,
        endGeom,
        data.endJoin,
        data.endPort ?? 0.5,
      );
      return mergeCollinear(pinKeepMiddle(pts, startAnchor, endAnchor)).map(
        (p) => [r2(p.x), r2(p.y)] as [number, number],
      );
    }

    // ELBOWED：全路径重路由（两端锚点 + 两端节点避让——避让用世界 AABB）
    const startPoint =
      this.anchorOfNode(data.startNodeId, startGeom, data.startJoin, data.startPort ?? 0.5) ??
      pts[0]!;
    const endPoint =
      this.anchorOfNode(data.endNodeId, endGeom, data.endJoin, data.endPort ?? 0.5) ??
      pts[pts.length - 1]!;
    const hostAabb = (id: string | null, fallback: IHostGeom | null): IRect | null => {
      if (fallback) return rotatedRectBounds(fallback.rect, fallback.rotation);
      if (!id) return null;
      const g = this.vmEngine.getVmById(id)?.getHostGeom();
      return g ? rotatedRectBounds(g.rect, g.rotation) : null;
    };
    const startNode = hostAabb(data.startNodeId, startGeom);
    const endNode = hostAabb(data.endNodeId, endGeom);
    const route = routeElbow({
      start: startPoint,
      // 出线方向旋转感知（docs/05 §8 穿体修复）：锚点 θ 数学独立，走廊方向
      // 按边法向旋转后量化到最近轴
      startJoin:
        data.startJoin && startGeom
          ? quantizeJoin(data.startJoin, startGeom.rotation)
          : data.startJoin,
      end: endPoint,
      endJoin:
        data.endJoin && endGeom ? quantizeJoin(data.endJoin, endGeom.rotation) : data.endJoin,
      startNode,
      endNode,
    });
    return route.map((p) => [r2(p.x), r2(p.y)] as [number, number]);
  }

  /**
   * lineType 切回 ELBOWED 时全路径重路由：STRAIGHT 期间锚定端点可能已漂移
   * （拖拽锚定节点时 STRAIGHT 只替换端点，不维护正交走廊），切型后按当前
   * 两端锚点重算。自由线（无锚定）不路由——切型仅改渲染方式。
   * 由组合根在 lineType diff 上调用；写回 points 不含 lineType，天然收敛。
   */
  rerouteLine(id: string): void {
    const vm = this.vmEngine.getVmById(id);
    const model = this.engine.getModelById(id);
    if (!vm || !model || vm.type !== 'LINE') return;
    const data = model.toJSON() as unknown as {
      lineType: 'STRAIGHT' | 'ELBOWED' | 'CURVE';
      startNodeId: string | null;
      endNodeId: string | null;
      startJoin: JoinDir | null;
      endJoin: JoinDir | null;
      startPort?: number;
      endPort?: number;
      points: Array<[number, number]>;
    };
    if (data.lineType !== 'ELBOWED') return;
    if (!data.startNodeId && !data.endNodeId) return;
    const startGeom = data.startNodeId
      ? (this.vmEngine.getVmById(data.startNodeId)?.getHostGeom() ?? null)
      : null;
    const endGeom = data.endNodeId
      ? (this.vmEngine.getVmById(data.endNodeId)?.getHostGeom() ?? null)
      : null;
    const start = this.anchorOfNode(
      data.startNodeId,
      startGeom,
      data.startJoin,
      data.startPort ?? 0.5,
    ) ?? { x: data.points[0]![0], y: data.points[0]![1] };
    const last = data.points[data.points.length - 1]!;
    const end = this.anchorOfNode(data.endNodeId, endGeom, data.endJoin, data.endPort ?? 0.5) ?? {
      x: last[0],
      y: last[1],
    };
    const route = routeElbow({
      start,
      startJoin: startGeom
        ? quantizeJoin(data.startJoin ?? 'right', startGeom.rotation)
        : data.startJoin,
      end,
      endJoin: endGeom ? quantizeJoin(data.endJoin ?? 'left', endGeom.rotation) : data.endJoin,
      startNode: startGeom ? rotatedRectBounds(startGeom.rect, startGeom.rotation) : null,
      endNode: endGeom ? rotatedRectBounds(endGeom.rect, endGeom.rotation) : null,
    });
    // 切回 ELBOWED = 全量重路由 → pinned 复位（自动路由接管，docs/08 §10 批次 3）
    model.update({
      points: route.map((q) => [r2(q.x), r2(q.y)] as [number, number]),
      pinned: false,
    } as never);
  }
}
