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
  nearestJoin,
  quantizeJoin,
  r2,
  routeElbow,
  nodeAnchorPoint,
  type IPt,
  type JoinDir,
} from './lineMath';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import type { IHostGeom, IRect } from '../../common/geometry';
import type { LineHoverOverlay } from './lineHoverOverlay';
import { hitWidget } from './lineHitTest';

/** 拉线过程路由落库节流（外部审查：每个 pointermove 全量写 Yjs 无节流） */
const DRAW_MOVE_THROTTLE_MS = 34;

const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 拉线宿主：LineService 实现——overlay 反馈通道 + 双创建链共享的会话默认值 */
export interface ILineDrawHost {
  readonly overlay: Pick<LineHoverOverlay, 'showDrawFeedback' | 'hideDrawFeedback'> | null;
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
}

/**
 * 拉线状态机（自 LineService 拆出，specs/split-large-files §4.2）：line 工具
 * 按下→拖出→松手 + quick-add 连接点拉线共用管线。持有 drawingId/pendingMove/
 * moveTimer/startAnchor；命中检测走 lineHitTest（与端点拖拽共用）。
 * 松手顺序契约（外部审查，2026-09-21）：先 flush（终帧必达）再清 drawingId
 * 再 settle——applyMove 按 drawingId 查 model，先置空会让 flush 静默失效。
 */
export class LineDrawSession extends Disposable {
  private drawingId: string | null = null;
  private pendingMove: IPointerEventInfo | null = null;
  private moveTimer = 0;
  private startAnchorState: { nodeId: string | null; join: JoinDir | null; point: IPt } | null =
    null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly history: IHistoryService,
    private readonly host: ILineDrawHost,
  ) {
    super();
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

  pointerDown(e: IPointerEventInfo): void {
    this.host.overlay?.hideDrawFeedback();
    const hit = hitWidget(this.vmEngine, this.viewport, e.world);
    const join = hit ? nearestJoin(hit.geom.rect, e.world, hit.geom.rotation) : null;
    // 锚点单源经 vm.getAnchorPoint（ShapeVm 覆写轮廓交点；§7.1 第 3 层）
    const point = (hit && join ? nodeAnchorPoint(this.vmEngine, hit.id, hit.geom, join) : null) ??
      (hit && join ? anchorOf(hit.geom.rect, join, hit.geom.rotation) : null) ?? {
        x: e.world.x,
        y: e.world.y,
      };
    this.startAnchorState = { nodeId: hit?.id ?? null, join, point };
    const id = genId();
    this.drawingId = id;
    this.engine.add({
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
    } as never);
  }

  pointerMove(e: IPointerEventInfo): void {
    // 悬停连接点指示器（仅未绘制时；绘制中的端点吸附反馈属批次 2）。
    // 最近连接点放大高亮（视觉响应替代 hover 态——指示器本身不可命中）
    if (!this.drawingId) {
      const hit = hitWidget(this.vmEngine, this.viewport, e.world);
      if (hit) {
        const active = JOINS.indexOf(nearestJoin(hit.geom.rect, e.world, hit.geom.rotation));
        this.host.overlay?.showDrawFeedback(hit.geom, active); // 连线工具目标反馈：紧贴边中点
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
    const model = this.engine.getModelById(this.drawingId!);
    if (!model) return;
    // 悬停控件 → 端点吸附到边锚点（docs/08 §3）；指示器同步显示目标连接点
    // （绘制中的吸附反馈——用户实测「连入元素时也要触发指示器」）
    const hit = hitWidget(this.vmEngine, this.viewport, e.world);
    const join = hit ? nearestJoin(hit.geom.rect, e.world, hit.geom.rotation) : null;
    if (hit) {
      // 连线工具的目标反馈：连接点**紧贴边中点**（与选中态快速创建点是两套逻辑）
      this.host.overlay?.showDrawFeedback(hit.geom, JOINS.indexOf(join!));
    } else {
      this.host.overlay?.hideDrawFeedback();
    }
    const end = (hit && join ? nodeAnchorPoint(this.vmEngine, hit.id, hit.geom, join) : null) ??
      (hit && join ? anchorOf(hit.geom.rect, join, hit.geom.rotation) : null) ?? {
        x: e.world.x,
        y: e.world.y,
      };
    // 避让节点用世界 AABB（旋转宿主保守外接）；出线方向量化到最近轴
    // （旋转宿主的走廊方向旋转感知——穿体修复，docs/05 §8）
    const hostAabb = (g: IHostGeom | null): IRect | null =>
      g ? rotatedRectBounds(g.rect, g.rotation) : null;
    const startNodeGeom =
      this.startAnchorState?.nodeId != null
        ? (this.vmEngine.getVmById(this.startAnchorState.nodeId)?.getHostGeom() ?? null)
        : null;
    const startNodeBounds = hostAabb(startNodeGeom);
    const route = routeElbow({
      start: this.startAnchorState!.point,
      startJoin:
        this.startAnchorState!.join && startNodeGeom
          ? quantizeJoin(this.startAnchorState!.join, startNodeGeom.rotation)
          : this.startAnchorState!.join,
      end,
      endJoin: join && hit ? quantizeJoin(join, hit.geom.rotation) : join,
      startNode: startNodeBounds,
      endNode: hostAabb(hit ? hit.geom : null),
    });
    model.update({
      points: route.map((p) => [r2(p.x), r2(p.y)] as [number, number]),
      endNodeId: hit?.id ?? null,
      endJoin: join,
    } as never);
  }

  /** 连线落定（line 模式松手 / 连接点拖拽共用）：未拖出删除，否则保留选中 */
  settle(id: string): void {
    const model = this.engine.getModelById(id);
    if (model) {
      const data = model.toJSON() as unknown as { points: Array<[number, number]> };
      const [a, b] = data.points;
      // 起终点重合（未拖出）→ 删除（docs/08 §7）
      if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) {
        this.engine.removeByIds([id]);
      } else {
        this.history.stopCapturing();
        this.selector.setSelected([id]);
        // 工具保持激活（docs/08 §10 批次 1，参考同款）：连续画线不必反复切工具；
        // Esc/V 即回 cursor（app.clearSelection 本就 setCursorMode('cursor')）
      }
    }
    this.startAnchorState = null;
  }

  override dispose(): void {
    if (this.moveTimer) window.clearTimeout(this.moveTimer);
    super.dispose();
  }
}
