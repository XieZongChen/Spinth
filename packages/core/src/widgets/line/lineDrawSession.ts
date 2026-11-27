import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type {
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
  IVmEngineService,
  LineType,
} from '../../types';
import {
  anchorOf,
  collectRouteObstacles,
  quantizeJoin,
  r2,
  routeSelfLoop,
  routeElbow,
  nodeAnchorPoint,
  type IPt,
  type JoinDir,
} from './lineMath';
import { isAxisHost, resolveAnchorPick, type ILineDrawPolicy } from './lineAxisAnchor';
import {
  LINE_DRAFT_ORIGIN,
  LineMessageDraft,
  type IMessageDraft,
  type IStartAnchor,
} from './lineMessageDraft';
import { selfLoopSpanOf } from './lineSelfLoopSpan';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import { quantizeGrid } from '../../common/grid';
import type { IHostGeom, IPoint, IRect } from '../../common/geometry';
import type { LineHoverOverlay } from './lineHoverOverlay';
import { hitWidget } from './lineHitTest';

/** 拉线过程路由落库节流（外部审查：每个 pointermove 全量写 Yjs 无节流） */
const DRAW_MOVE_THROTTLE_MS = 34;

const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 轴宿主的轴（非轴宿主 / 无轴 = null） */
const axisOfVm = (
  vm: { getAxisAnchor?: unknown } | null | undefined,
  geom: IHostGeom,
): { x: number; top: number; bottom: number } | null =>
  isAxisHost(vm) ? vm.getAxisAnchor(geom) : null;

type Hit = ReturnType<typeof hitWidget>;

/** 拉线宿主：LineService 实现——overlay 反馈通道 + 双创建链共享的会话默认值 */
export interface ILineDrawHost {
  readonly overlay: Pick<LineHoverOverlay, 'showDrawFeedback' | 'hideDrawFeedback'> | null;
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
  /** 网格吸附开关探针（specs/flowchart-closeout §9.2 自由线端点；组合根注入，缺省关） */
  gridSnapOn(): boolean;
  /** 线落定回调（specs/flowchart-closeout §7.3）：同边余线重排 + 本线终路由
   *  经 anchorFollow 单源（避障/spread/探针）；在 settle 事务关闭前调用 =
   *  重排写入并入本次创建（一步撤销）。 */
  onSettled?(): void;
  /** 拉线策略（specs/sequence-diagram §4.3）：缺省 undefined = 既有连线路径；
   *  时序图工具经 LineService.drawPolicyProbe 注入消息预设 */
  getDrawPolicy?(): ILineDrawPolicy | undefined;
}

/**
 * 拉线状态机（自 LineService 拆出，specs/split-large-files §4.2）：line 工具
 * 按下→拖出→松手 + quick-add 连接点拉线共用管线。持有 drawingId/pendingMove/
 * moveTimer/startAnchor；命中检测走 lineHitTest（与端点拖拽共用）。
 * 落点走 resolveAnchorPick 单源（specs/sequence-diagram §4.2）：轴宿主按指针侧
 * 选边、端口 4 位小数；其他宿主与此前逐字节一致（无端口键）。有拉线策略时走
 * 消息路径（lineMessageDraft：草稿不入撤销栈、落定重建终线）。
 * 松手顺序契约（外部审查，2026-09-21）：先 flush（终帧必达）再清 drawingId
 * 再 settle——applyMove 按 drawingId 查 model，先置空会让 flush 静默失效。
 */
export class LineDrawSession extends Disposable {
  private drawingId: string | null = null;
  private pendingMove: IPointerEventInfo | null = null;
  private moveTimer = 0;
  private startAnchorState: IStartAnchor | null = null;
  /** 本次手势的拉线策略（pointerDown 时定格；quick-add 入口无策略 = 既有路径） */
  private policy: ILineDrawPolicy | undefined;
  private readonly message: LineMessageDraft;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly history: IHistoryService,
    private readonly host: ILineDrawHost,
  ) {
    super();
    this.message = new LineMessageDraft(engine, vmEngine, {
      onSettled: () => this.host.onSettled?.(),
      stopCapturing: () => this.history.stopCapturing(),
      select: (id) => this.selector.setSelected([id]),
    });
  }

  get isDrawing(): boolean {
    return this.drawingId !== null;
  }

  get startAnchor(): { nodeId: string | null; join: JoinDir | null; point: IPt } | null {
    return this.startAnchorState;
  }

  /** quick-add 连接点拉线入口（beginSession：建草稿线 + 记起点锚定） */
  beginFromQuickAdd(id: string, anchor: { nodeId: string; join: JoinDir; point: IPt }): void {
    this.drawingId = id;
    this.policy = undefined;
    this.startAnchorState = { nodeId: anchor.nodeId, join: anchor.join, point: anchor.point };
  }

  /** quick-add 手势收尾（endSession）：flush 必须在 drawingId 置空之前
   *  （applyMove 按 drawingId 查 model） */
  endSession(): void {
    this.flush();
    this.drawingId = null;
  }

  /** quick-add 节流移动（与 line 工具管线同款 34ms 节流） */
  queueMove(world: { x: number; y: number }): void {
    this.pendingMove = { world } as IPointerEventInfo;
    if (this.moveTimer) return;
    this.moveTimer = window.setTimeout(() => {
      this.moveTimer = 0;
      if (this.pendingMove) this.applyMove(this.pendingMove);
    }, DRAW_MOVE_THROTTLE_MS);
  }

  /** 画布命中（策略 freeEnds 时忽略控件：两端都落自由点） */
  private hitAt(world: IPoint): Hit {
    return this.policy?.freeEnds ? null : hitWidget(this.vmEngine, this.viewport, world);
  }

  /** 落点单源：轴宿主 = 指针侧 + 轴上端口（r4）；其他 = nearestJoin、无端口 */
  private pickOf(hit: NonNullable<Hit>, world: IPoint) {
    return resolveAnchorPick(this.vmEngine.getVmById(hit.id), hit.geom, world);
  }

  /** 控件边锚点（vm 缺失时回退 bbox anchorOf）；未命中返回 null */
  private anchorPointOf(hit: Hit, join: JoinDir | null, port: number | undefined): IPt | null {
    return (
      (hit && join ? nodeAnchorPoint(this.vmEngine, hit.id, hit.geom, join, port ?? 0.5) : null) ??
      (hit && join ? anchorOf(hit.geom.rect, join, hit.geom.rotation) : null)
    );
  }

  pointerDown(e: IPointerEventInfo): void {
    this.host.overlay?.hideDrawFeedback();
    this.policy = this.host.getDrawPolicy?.();
    const hit = this.hitAt(e.world);
    const pick = hit ? this.pickOf(hit, e.world) : null;
    const join = pick?.join ?? null;
    const port = pick?.port;
    // 有策略且两端必须在轴上：起点不在轴上（普通件 / 空白）→ 不建线，零写入（§4.4 第 1 步）
    if (this.policy?.requireAxisTargets && port === undefined) return;
    // 锚点单源经 vm.getAnchorPoint（ShapeVm 覆写轮廓交点；§7.1 第 3 层）
    const point = this.anchorPointOf(hit, join, port) ?? {
      // 自由起点：网格开时量化（specs/flowchart-closeout §9.2 自由线端点——
      // 与自由终点、端点拖拽 lineEndpointDrag 同款）
      x: this.host.gridSnapOn() ? quantizeGrid(e.world.x) : e.world.x,
      y: this.host.gridSnapOn() ? quantizeGrid(e.world.y) : e.world.y,
    };
    this.startAnchorState = { nodeId: hit?.id ?? null, join, point, port };
    const id = genId();
    this.drawingId = id;
    const data = {
      id,
      type: 'LINE',
      zOrder: this.engine.genInitialOrder(),
      points: [
        [r2(point.x), r2(point.y)],
        [r2(point.x), r2(point.y)],
      ],
      startNodeId: hit?.id ?? null,
      endNodeId: null,
      startJoin: join,
      endJoin: null,
      color: '#4b5563',
      strokeWidth: this.host.getDefaultStrokeWidth(),
      startArrow: 'none',
      endArrow: 'arrow',
      // 新线线型/线宽读会话默认（初始 ELBOWED——2026-09 拍板：现代白板默认正交折线；
      // 两端同轴时路由自然退化为直线；工具坞二级菜单可切，docs/04 §2 会话态优先）
      lineType: this.host.getDefaultLineType(),
    } as never;
    // 只在端口有值时写键：写 undefined 会在 Yjs 里留下键，不再与无端口的线逐字节相等
    if (port !== undefined) Object.assign(data, { startPort: port });
    if (this.policy) {
      // 样式预设优先于会话默认（§4.3）；草稿走非跟踪事务——不入撤销栈（§4.4）
      Object.assign(data, this.policy.style);
      this.engine.transact(() => this.engine.add(data), LINE_DRAFT_ORIGIN);
      return;
    }
    this.engine.add(data);
  }

  pointerMove(e: IPointerEventInfo): void {
    if (!this.drawingId) {
      // 悬停连接点指示器（仅未绘制时）：最近连接点放大高亮（视觉响应替代 hover
      // 态——指示器本身不可命中）
      const hit = hitWidget(this.vmEngine, this.viewport, e.world);
      if (hit) {
        // 连线工具目标反馈：紧贴轮廓锚点；轴宿主 = 轴上指针高度的单点
        this.host.overlay?.showDrawFeedback(
          hit.id,
          hit.geom,
          JOINS.indexOf(this.pickOf(hit, e.world).join),
          e.world,
        );
      } else {
        this.host.overlay?.hideDrawFeedback();
      }
      return;
    }
    this.pendingMove = e;
    if (this.moveTimer) return;
    this.moveTimer = window.setTimeout(() => {
      this.moveTimer = 0;
      if (this.pendingMove) this.applyMove(this.pendingMove);
    }, DRAW_MOVE_THROTTLE_MS);
  }

  pointerUp(_e: IPointerEventInfo): void {
    const id = this.drawingId;
    if (!id) return;
    // 松手先冲刷节流中的最后一帧（终帧必达），再做重合判定。
    // 顺序敏感：flush 必须在 drawingId 置空**之前**——applyMove 按
    // drawingId 查 model，先置空会让 flush 静默失效（外部审查揪出，
    // 2026-09-21）：快速拉线（down→move→up <34ms）points 停在初始
    // 同位两点 → 距离 <4 → 整条线被当「未拖出」删除；快速甩尾则终点截断
    this.flush();
    this.drawingId = null;
    this.host.overlay?.hideDrawFeedback();
    this.settle(id);
  }

  /** 冲刷节流中的 pendingMove（终帧必达） */
  flush(): void {
    if (this.moveTimer) {
      window.clearTimeout(this.moveTimer);
      this.moveTimer = 0;
    }
    if (this.pendingMove) this.applyMove(this.pendingMove);
  }

  /** 路由落库（34ms 节流 + trailing：松手前最后一次 move 必达，终点不丢帧） */
  private applyMove(e: IPointerEventInfo): void {
    this.pendingMove = null;
    const id = this.drawingId!;
    const model = this.engine.getModelById(id);
    if (!model) return;
    // 悬停控件 → 端点吸附到边锚点（docs/08 §3）；指示器同步显示目标连接点
    // （绘制中的吸附反馈——用户实测「连入元素时也要触发指示器」）
    const hit = this.hitAt(e.world);
    const pick = hit ? this.pickOf(hit, e.world) : null;
    const join = pick?.join ?? null;
    if (hit) {
      // 连接点**紧贴轮廓锚点**（与选中态快速创建点是两套逻辑）
      this.host.overlay?.showDrawFeedback(hit.id, hit.geom, JOINS.indexOf(join!), e.world);
    } else {
      this.host.overlay?.hideDrawFeedback();
    }
    const start = this.startAnchorState!;
    const policy = this.policy;
    // 有策略且终点落在轴宿主上：终点与草稿路由走消息路径（§4.4 第 2 步）
    const axis =
      hit && policy && pick?.port !== undefined
        ? axisOfVm(this.vmEngine.getVmById(hit.id), hit.geom)
        : null;
    const end = (hit && axis
      ? this.message.endAnchor(axis, start, hit.id, e.world, policy!)
      : null) ??
      this.anchorPointOf(hit, join, pick?.port) ?? {
        // 自由终点：网格开时量化（specs/flowchart-closeout §9.2 自由线端点——
        // 与端点拖拽 lineEndpointDrag 同款，拉新线与拖旧线端点行为一致）
        x: this.host.gridSnapOn() ? quantizeGrid(e.world.x) : e.world.x,
        y: this.host.gridSnapOn() ? quantizeGrid(e.world.y) : e.world.y,
      };
    // 避让节点用世界 AABB（旋转宿主保守外接）；出线方向量化到最近轴
    // （旋转宿主的走廊方向旋转感知——穿体修复，docs/05 §8）
    const hostAabb = (g: IHostGeom | null): IRect | null =>
      g ? rotatedRectBounds(g.rect, g.rotation) : null;
    const startNodeGeom =
      start.nodeId != null ? (this.vmEngine.getVmById(start.nodeId)?.getHostGeom() ?? null) : null;
    const route =
      (hit && axis ? this.message.route(policy!, start, id, hit.id, hit.geom, end) : null) ??
      // 从 A 拖回 A（同节点）→ 紧凑自环（specs/flowchart-closeout §7.5，G-07）
      (hit && hit.id === start.nodeId && start.join && join
        ? routeSelfLoop({
            start: start.point,
            startJoin: start.join,
            end,
            endJoin: join,
            node: hostAabb(hit.geom)!,
            // 同边多自环嵌套档（§7.5 四轮：预览与落库同源——live 传当帧锚定，
            // 拖拽首帧 endNodeId 尚未落库也不滞后；新线字典序大即显外环无跳变）
            spanScale: selfLoopSpanOf(this.engine, this.vmEngine, id, {
              startNodeId: start.nodeId,
              startJoin: start.join,
              endNodeId: hit.id,
              endJoin: join,
            }),
          })
        : routeElbow({
            start: start.point,
            startJoin:
              start.join && startNodeGeom
                ? quantizeJoin(start.join, startNodeGeom.rotation)
                : start.join,
            end,
            endJoin: join && hit ? quantizeJoin(join, hit.geom.rotation) : join,
            startNode: hostAabb(startNodeGeom),
            endNode: hostAabb(hit ? hit.geom : null),
            // 全局避障（G-06）：拉线过程实时绕行第三节点
            obstacles: collectRouteObstacles(
              this.vmEngine,
              start.point,
              end,
              start.nodeId,
              hit?.id ?? null,
            ),
          }));
    const patch = {
      points: route.map((p) => [r2(p.x), r2(p.y)] as [number, number]),
      endNodeId: hit?.id ?? null,
      endJoin: join,
    };
    // 草稿的逐帧移动走非跟踪事务（§4.4）；无策略 = 既有直写
    if (policy) this.engine.transact(() => model.update(patch as never), LINE_DRAFT_ORIGIN);
    else model.update(patch as never);
  }

  /** 连线落定（line 模式松手 / 连接点拖拽共用）：未拖出删除，否则保留选中。
   *  有策略走消息落定（lineMessageDraft） */
  settle(id: string): void {
    const model = this.engine.getModelById(id);
    if (model) {
      const data = model.toJSON() as unknown as IMessageDraft;
      if (this.policy) this.message.settle(this.policy, id, data);
      else this.settleDefault(id, data);
    }
    this.startAnchorState = null;
  }

  /** 既有落定（无策略）：起终点重合（未拖出）→ 删除（自环例外：两端同节点 = 显式环路，
   *  G-07）；否则落定重排（§7.3）——同边余线让位 + 本线终路由走 anchorFollow 单源
   *  （避障/spread/探针），在 stopCapturing 前 = 并入本次创建一步撤销 */
  private settleDefault(id: string, data: IMessageDraft): void {
    const [a, b] = data.points;
    const selfAnchored = !!data.startNodeId && data.startNodeId === data.endNodeId;
    if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4 && !selfAnchored) {
      this.engine.removeByIds([id]);
      return;
    }
    this.host.onSettled?.();
    this.history.stopCapturing();
    this.selector.setSelected([id]);
    // 工具保持激活（docs/08 §10 批次 1，参考同款）：连续画线不必反复切工具；
    // Esc/V 即回 cursor（app.clearSelection 本就 setCursorMode('cursor')）
  }

  override dispose(): void {
    if (this.moveTimer) window.clearTimeout(this.moveTimer);
    super.dispose();
  }
}
