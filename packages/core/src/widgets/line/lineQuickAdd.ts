import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type { IHostGeom, IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
  IViewportService,
  LineType,
  ShapeType,
} from '../../types';
import {
  anchorOf,
  quantizeJoin,
  r2,
  branchSlotOffset,
  nearestJoin,
  QUICK_ADD_GAP,
  routeElbow,
  type IPt,
  type JoinDir,
} from './lineMath';
import { Rectangle } from 'pixi.js';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';

/**
 * quick-add 协作者（自 lineService 拆出，2026-10-05 A1 整理批刀 3）：
 * 连接点按下建线跟随 + 点击 quick-add（quickAddPlan 单一决策：方向空闲
 * 正对 / 落位被无连线孤立元素占只连线 / 方向已有带连线元素一上一下交替
 * 错开——参考2026-10-02 视频三段合并，docs/08 §10）。
 * 拉线会话状态（drawingId/startAnchor/节流通道）归属宿主——经
 * ILineQuickAddHost 窄面交互（MindNodeEditor 模式）。
 */

const OPPOSITE_JOIN: Record<JoinDir, JoinDir> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const JOIN_NORMAL: Record<JoinDir, IPt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** 连线锚定相关字段（countEdgeLines/hasAnyLine 的 toJSON 投影；宿主 reattach 共用） */
export interface ILineAnchorData {
  startNodeId: string | null;
  endNodeId: string | null;
  startJoin: JoinDir | null;
  endJoin: JoinDir | null;
  points: Array<[number, number]>;
  lineType: 'STRAIGHT' | 'ELBOWED' | 'CURVE';
  pinned: boolean;
}

/** 宿主回调：拉线会话状态与节流通道（①绘制管线归属宿主） */
export interface ILineQuickAddHost {
  /** 开始拉线会话（写 drawingId/startAnchor） */
  beginSession(id: string, anchor: { nodeId: string; join: JoinDir; point: IPt }): void;
  /** 结束会话：flush 节流尾帧 + 清 drawingId（顺序敏感——先 flush 再清） */
  endSession(): void;
  /** 节流落库通道（与 line 工具管线共用 pendingMove/moveTimer） */
  throttledMove(world: { x: number; y: number }): void;
  /** 连线落定（未拖出删除 / 否则保留选中） */
  settle(id: string): void;
  /** 会话期浮层收场 */
  hideOverlays(): void;
  /** 读起点锚（quickAddConnectedShape 用） */
  getStartAnchor(): { nodeId: string; join: JoinDir; point: IPt } | null;
  /** 会话默认线型/线宽（与 line 工具拉线同源——双创建链统一，docs/04 §2） */
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
  /** quick-add 落新形状的默认型（组合根注入 ShapeService 会话态） */
  getDefaultShapeType(): ShapeType;
}

export class LineQuickAdd extends Disposable {
  /** 连接点手势的路标（client 坐标，区分点击与拖拽） */
  private connectorDownClient: { x: number; y: number } | null = null;
  /** 按下即建的草稿线 id（quick-add / settle 收尾引用——宿主 drawingId 同值） */
  private sessionId: string | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly history: IHistoryService,
    private readonly host: ILineQuickAddHost,
  ) {
    super();
  }

  /**
   * 连接点按下（参考同款）：立即创建锚定起点的连线并进入指针跟随，
   * window pointerup 按位移分流——位移 < 4px = 点击（quick-add：连线 +
   * 默认矩形）；否则按拖拽连线落定（命中锚定 / 空白自由端）。
   */
  startConnectorFrom = (anchor: IPt, join: JoinDir, world: { x: number; y: number }): void => {
    // 起点 = 选中形状（连接点归属）；不依赖 hover 链路（CI 慢环境下 hover 状态可能滞后）
    const sel = this.selector.selected$.value;
    const target = sel.length === 1 ? (this.vmEngine.getVmById(sel[0]!) ?? null) : null;
    if (!target || target.type === 'LINE' || target.type === 'PEN') return;
    this.connectorDownClient = this.viewport.worldToClient(world); // 统一 client 口径（点击/拖拽位移判定）
    this.host.hideOverlays();
    const id = genId();
    this.sessionId = id;
    this.host.beginSession(id, { nodeId: target.id, join, point: anchor });
    this.engine.add({
      id,
      type: 'LINE',
      zOrder: this.engine.genInitialOrder(),
      points: [
        [r2(anchor.x), r2(anchor.y)],
        [r2(anchor.x), r2(anchor.y)],
      ],
      startNodeId: target.id,
      endNodeId: null,
      startJoin: join,
      endJoin: null,
      color: '#4b5563',
      strokeWidth: this.host.getDefaultStrokeWidth(),
      startArrow: 'none',
      endArrow: 'arrow',
      // 会话默认线型/线宽（宿主注入——与 line 工具拉线同源）
      lineType: this.host.getDefaultLineType(),
    } as never);
    window.addEventListener('pointermove', this.quickDragMove);
    window.addEventListener('pointerup', this.quickDragUp);
    // 触控/笔被打断（来电/手势导航）时 pointerup 不达——cancel 走 Up 同款
    // 清理与落库，但 moved<4 不触发 quick-add（打断不是点击，外部审查 S1）
    window.addEventListener('pointercancel', this.quickDragCancel);
  };

  private readonly quickDragMove = (e: PointerEvent): void => {
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    // 34ms 节流走宿主通道（与 line 工具管线共用——曾直调落库绕过节流，
    // 每 move 一次 Yjs 全量 points 重写，外部审查 P1 2026-10-03）
    this.host.throttledMove(world);
  };

  /** pointercancel → Up 同款收尾，但取消「点击 = quick-add」语义 */
  private readonly quickDragCancel = (e: PointerEvent): void => this.quickDragUp(e, true);

  private readonly quickDragUp = (e: PointerEvent, cancelled = false): void => {
    window.removeEventListener('pointermove', this.quickDragMove);
    window.removeEventListener('pointerup', this.quickDragUp);
    window.removeEventListener('pointercancel', this.quickDragCancel);
    const down = this.connectorDownClient;
    this.connectorDownClient = null;
    const id = this.sessionId;
    this.sessionId = null;
    this.host.endSession();
    this.host.hideOverlays();
    if (!id) return;
    const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 4;
    if (!moved) {
      if (cancelled) {
        // 打断 ≠ 点击（不 quick-add）也不落库——按下即建的零长草稿线走
        // settle 删除（复审探针实锤：裸退会让零长线残留模型）
        this.host.settle(id);
        return;
      }
      // 点击 = quick-add：连线 + 默认矩形（选中新形状）
      this.quickAddConnectedShape(id);
      return;
    }
    this.host.settle(id);
  };

  /**
   * quick-add：新矩形**尺寸 = 源形状**，落位/路由统一由 plan 决策
   * （方向空闲正对 / 落位被无连线孤立元素占只连线 / 方向已有带连线元素
   * 一上一下交替错开），连线锚定两端（参考2026-10-02 视频三段合并）。
   */
  quickAddConnectedShape(lineId: string): void {
    const s = this.host.getStartAnchor();
    if (!s?.nodeId || !s.join) return;
    const line = this.engine.getModelById(lineId);
    if (!line) return;
    const sb = this.vmEngine.getVmById(s.nodeId)?.getBounds() ?? {
      x: s.point.x,
      y: s.point.y,
      width: 120,
      height: 80,
    };
    const plan = this.plan(s.nodeId, sb, s.point, s.join, lineId);
    if (plan.kind === 'connect') {
      line.update({
        points: plan.route.map((p) => [r2(p.x), r2(p.y)] as [number, number]),
        endNodeId: plan.targetId,
        endJoin: plan.endJoin,
      } as never);
      this.history.stopCapturing(); // 建线 + 锚定 = 单撤销单元
      this.selector.setSelected([lineId]); // 参考同款：选中连线（非目标形状）
      return;
    }
    const shape = this.engine.add({
      id: genId(),
      type: 'SHAPE',
      zOrder: this.engine.genInitialOrder(),
      // 会话默认型（宿主注入 ShapeService——与形状工具创建同源）
      shapeType: this.host.getDefaultShapeType(),
      color: '#e8f0fb',
      borderStyle: 'solid',
      x: plan.rect.x,
      y: plan.rect.y,
      width: plan.rect.width,
      height: plan.rect.height,
    } as never);
    line.update({
      points: plan.route.map((p) => [r2(p.x), r2(p.y)] as [number, number]),
      endNodeId: shape.id,
      endJoin: plan.endJoin,
    } as never);
    this.history.stopCapturing();
    this.selector.setSelected([shape.id]);
  }

  /** quick-add 决策结果（hover 预览与点击共用的单一事实源，预览即结果）。
   *  excludeLineId = 正在 quick-add 的 drawing 线（按下即建且已写 startNodeId，
   *  数分支时须排除自己，否则 connect 分支被永久遮蔽） */
  plan(
    srcId: string,
    sb: IRect,
    anchor: IPt,
    join: JoinDir,
    excludeLineId: string | null,
  ):
    | { kind: 'connect'; targetId: string; bounds: IRect; endJoin: JoinDir; route: IPt[] }
    | { kind: 'create'; rect: IRect; endJoin: JoinDir; route: IPt[] } {
    const hit = this.quickAddTarget(srcId, sb, anchor, join);
    const branches = this.countEdgeLines(srcId, join, excludeLineId);
    if (hit && branches === 0 && !this.hasAnyLine(hit.id)) {
      // 落位被无连线孤立元素占 → 只建连线锚定它（对边参照与拖线吸附同口径；
      // 目标可能旋转——锚点/最近边 θ 感知，避让用世界 AABB，docs/05 §8）
      const endJoin = nearestJoin(hit.geom.rect, anchor, hit.geom.rotation);
      const endAabb = rotatedRectBounds(hit.geom.rect, hit.geom.rotation);
      return {
        kind: 'connect',
        targetId: hit.id,
        bounds: endAabb,
        endJoin,
        route: routeElbow({
          start: anchor,
          startJoin: join,
          end: anchorOf(hit.geom.rect, endJoin, hit.geom.rotation),
          endJoin: quantizeJoin(endJoin, hit.geom.rotation),
          startNode: sb,
          endNode: endAabb,
        }),
      };
    }
    const n = JOIN_NORMAL[join];
    const cx0 = anchor.x + n.x * (QUICK_ADD_GAP + sb.width / 2);
    const cy0 = anchor.y + n.y * (QUICK_ADD_GAP + sb.height / 2);
    // 交替错开（branchSlotOffset）：该边已有 branches 条出线 → 新成员第
    // branches+1 槽（一上一下/一右一左）；落位元素带线但边无出线 → 让第
    // 1 槽；方向空闲 → 正对（偏移 0）。正对位被分支成员占照样建新（视频实锤）
    const stagger = branches >= 1 ? branches : hit ? 1 : 0;
    const off = branchSlotOffset(stagger, n.x !== 0 ? sb.height : sb.width);
    const cx = n.x !== 0 ? cx0 : cx0 - off; // 垂直方向沿 x 交替，起步「先右」= 取负翻转
    const cy = n.x !== 0 ? cy0 + off : cy0; // 水平方向沿 y 交替，起步「先上」
    const rect: IRect = {
      x: cx - sb.width / 2,
      y: cy - sb.height / 2,
      width: sb.width,
      height: sb.height,
    };
    const endJoin = OPPOSITE_JOIN[join];
    return {
      kind: 'create',
      rect,
      endJoin,
      route: routeElbow({
        start: anchor,
        startJoin: join,
        end: anchorOf(rect, endJoin),
        endJoin,
        startNode: sb,
        endNode: rect,
      }),
    };
  }

  /**
   * quick-add 方向占位检测（hover 预览与点击共用）：候选落位矩形（新形状
   * 该出现的位置）压到已有形状 → 返回该形状（取近边锚点距源锚点最近者）；
   * 无 → null（走建新形状口径）。
   */
  private quickAddTarget(
    srcId: string,
    sb: IRect,
    anchor: IPt,
    join: JoinDir,
  ): { id: string; geom: IHostGeom } | null {
    const n = JOIN_NORMAL[join];
    const cx = anchor.x + n.x * (QUICK_ADD_GAP + sb.width / 2);
    const cy = anchor.y + n.y * (QUICK_ADD_GAP + sb.height / 2);
    const rect = new Rectangle(cx - sb.width / 2, cy - sb.height / 2, sb.width, sb.height);
    const hits = this.vmEngine
      .getVmsInRect(rect)
      .filter((v) => v.id !== srcId && v.type !== 'LINE' && v.type !== 'PEN');
    let best: { id: string; geom: IHostGeom; d: number } | null = null;
    for (const v of hits) {
      const g = v.getHostGeom();
      const a = anchorOf(g.rect, nearestJoin(g.rect, anchor, g.rotation), g.rotation);
      const d = Math.hypot(a.x - anchor.x, a.y - anchor.y);
      if (!best || d < best.d) best = { id: v.id, geom: g, d };
    }
    return best;
  }

  /** 源元素某边的已有出线数（交替落位的分支成员计数，2026-10-02）：双端
   *  任一挂在该边即计 1——手动拉的线与 quick-add 建的线同权重（参考视频
   *  初始分支即手动连线）。遍历口径同 unbindFrom。 */
  private countEdgeLines(
    nodeId: string,
    join: JoinDir,
    excludeLineId: string | null = null,
  ): number {
    let count = 0;
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type !== 'LINE' || vm.id === excludeLineId) continue;
      const data = this.engine.getModelById(vm.id)?.toJSON() as unknown as
        ILineAnchorData | undefined;
      if (!data) continue;
      if (
        (data.startNodeId === nodeId && data.startJoin === join) ||
        (data.endNodeId === nodeId && data.endJoin === join)
      )
        count++;
    }
    return count;
  }

  /** 元素是否已挂任何连线（任一线的任一端）——落位元素带线（线不连源）也
   *  算「方向上有带连线的元素」，触发交替错开而非只连线 */
  private hasAnyLine(nodeId: string): boolean {
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type !== 'LINE') continue;
      const data = this.engine.getModelById(vm.id)?.toJSON() as unknown as
        ILineAnchorData | undefined;
      if (data && (data.startNodeId === nodeId || data.endNodeId === nodeId)) return true;
    }
    return false;
  }
}
