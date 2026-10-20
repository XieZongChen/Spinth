import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import { LineTypeSchema, type IActionBarOption } from '../../types';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
  IVmEngineService,
  ShapeType,
  LineType,
} from '../../types';
import {
  anchorOf,
  dotOffsetCenter,
  effectivePath,
  nearestJoin,
  quantizeJoin,
  r2,
  routeElbow,
  type IPt,
  type JoinDir,
} from './lineMath';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import type { LineVm } from './lineVm';
import type { IHostGeom, IRect } from '../../common/geometry';
import type { Point } from 'pixi.js';
import { LineHoverOverlay } from './lineHoverOverlay';
import { LineQuickAdd, type ILineAnchorData } from './lineQuickAdd';
import { LineAnchorFollow } from './lineAnchorFollow';
import { LineEndpointDrag } from './lineEndpointDrag';
import { LineSegTextSlide } from './lineSegTextSlide';
import { LineTextEditor } from './lineTextEditor';

/** 拉线过程路由落库节流（外部审查：每个 pointermove 全量写 Yjs 无节流） */
const DRAW_MOVE_THROTTLE_MS = 34;

/**
 * 连接线交互层（docs/08 §7）：line 工具按下→拖出→松手；
 * 悬停控件吸附边锚点（nearestJoin）；ELBOWED 拉线过程实时正交路由；
 * 绑定后节点移动 → 线跟随重路由（订阅节点 onStateChanged$）。
 * 线上文字：双击已选中的线 → 在双击位置 ratio 处编辑（onLineDblClick，2026-09-30
 * 拍板单击不进编辑——线身单击是段滑移/胶囊手势，docs/08 §10.3）。
 */
const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 锚点抓取边缘容差（屏幕像素）：连接点画在元素**边上**，严格 point-in-bounds
 *  会在贴边/压点时出界——指示器闪烁、按点抓空（用户实测）。命中失败时按此
 *  容差取环内最近元素（连线命中检测 8px 同款口径）。 */
const ANCHOR_GRAB_TOLERANCE_SCREEN = 8;

/** 线型三选项单源（docs/04 §2 工具默认参数节）：工具坞常驻二级菜单与 ActionBar 线型 popover 共用 */
export const LINE_TYPE_OPTIONS: IActionBarOption[] = [
  { id: 'STRAIGHT', label: '直线', icon: 'line-straight' },
  { id: 'ELBOWED', label: '折线', icon: 'line-elbow' },
  { id: 'CURVE', label: '曲线', icon: 'line-curve' },
];

/** 线宽四档（2026-10-14 线宽笔宽批）：1/2/4/8，默认 2——icon 粗细横线示意；
 *  flyout 第二组与 ActionBar popover 共用；超越既有设计两档（2/5） */
export const LINE_WIDTH_STEPS = [1, 2, 4, 8] as const;
export const LINE_WIDTH_OPTIONS: IActionBarOption[] = LINE_WIDTH_STEPS.map((n) => ({
  id: String(n),
  label: `${n} 像素线宽`,
  icon: `line-width-${n}`,
}));

export class LineService extends Disposable {
  /** 工具默认线型（会话级，docs/04 §2——新线默认 ELBOWED 是 2026-09 拍板）：
   *  双创建链（本服务拉线 + quick-add 连接点建线）共享 */
  private defaultType: LineType = 'ELBOWED';
  readonly defaultLineType$ = new BehaviorSubject<LineType>('ELBOWED');

  /** quick-add 落新形状的默认型读法（组合根注入 ShapeService 会话态——
   *  消 quick-add 硬编码 'rect' 与工具坞默认型的漂移，busyProbe 同模式） */
  quickAddShapeTypeProbe: () => ShapeType = () => 'rect';

  /** 工具默认线宽（会话级，docs/04 §2）：四档 1/2/4/8，默认 2——双创建链共享 */
  private defaultWidth = 2;
  readonly defaultStrokeWidth$ = new BehaviorSubject<number>(2);

  get defaultStrokeWidth(): number {
    return this.defaultWidth;
  }

  /** 工具坞/ActionBar 写通道：档位制（sticky 色板外拒绝先例——非档位值静默拒绝） */
  setDefaultStrokeWidth(w: number): void {
    if (!LINE_WIDTH_STEPS.includes(w as (typeof LINE_WIDTH_STEPS)[number])) return;
    if (w === this.defaultWidth) return;
    this.defaultWidth = w;
    this.defaultStrokeWidth$.next(w);
  }

  get defaultLineType(): LineType {
    return this.defaultType;
  }

  /** 工具坞二级菜单写通道（zod 校验；非手势无编辑冲突面，不做模式自查） */
  setDefaultLineType(t: LineType): void {
    const parsed = LineTypeSchema.parse(t);
    if (parsed === this.defaultType) return;
    this.defaultType = parsed;
    this.defaultLineType$.next(parsed);
  }

  private drawingId: string | null = null;
  private pendingMove: IPointerEventInfo | null = null;
  /** 悬停/选中浮层协作者（A1 整理批刀 2：指示器/端点圆/段条/幽灵预览 + 快照） */
  private overlay: LineHoverOverlay | null = null;
  /** quick-add 协作者（A1 整理批刀 3：连接点手势 + quickAddPlan 单一决策） */
  private quickAdd: LineQuickAdd | null = null;
  /** 锚定跟随协作者（A1 整理批刀 4：reattach/rerouteLine/previewFollow/unbind） */
  private anchorFollow: LineAnchorFollow | null = null;
  /** 端点拖拽协作者（A1 整理批刀 5：重锚定/解绑手势） */
  private endpointDragCtl: LineEndpointDrag | null = null;
  /** 文字/段滑移协作者（A1 整理批刀 6：textRatio 滑移 + waypoint 段滑移） */
  private segTextSlide: LineSegTextSlide | null = null;
  /** 手势忙态探针（组合根注入：rectEditor 缩放中等——悬停指示器抑制） */
  busyProbe: (() => boolean) | null = null;
  private moveTimer = 0;
  private startAnchor: { nodeId: string | null; join: JoinDir | null; point: IPt } | null = null;

  /** 线上文字编辑协作者（A1 整理批刀 1：TipTap 生命周期/节流落库/镂空喂框） */
  private textEditor: LineTextEditor | null = null;
  /** 编辑中的线 id（各处会话守卫读——协作者状态经此最小暴露） */
  private get editingLineId(): string | null {
    return this.textEditor?.editingWidgetId ?? null;
  }

  constructor(
    private viewport: IViewportService,
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private history: IHistoryService,
    editing: IEditingService,
  ) {
    super();
    this.textEditor = new LineTextEditor(this.engine, this.vmEngine, editing, {
      hideEditOverlays: () => {
        // 编辑期手柄全收（refreshHandles 有编辑守卫不再 show；此处收掉进入前
        // 已显示的端点圆/段条——2026-10-02 实测编辑框内压着胶囊手柄）
        this.overlay?.hideHandles();
      },
      refreshHandles: (ids) => {
        // 仍单选该线才恢复（原判定语义保持）
        const selected = this.selector.selected$.value;
        if (ids.length === 1 && selected.length === 1 && selected[0] === ids[0]) {
          this.overlay?.refreshHandles(ids);
        }
      },
    });
    this.addDisposable(this.textEditor);
  }

  initialize(): void {
    this.viewport.registerGlobalEventListener('line', {
      onPointerDown: (e) => this.onPointerDown(e),
      onPointerMove: (e) => this.onPointerMove(e),
      onPointerUp: (e) => this.onPointerUp(e),
      onPointerUpOutside: (e) => this.onPointerUp(e),
      // 手势取消（Batch 1 · 1.9）：打断 ≠ 点击——settle 清零长草稿线（up 同款
      // 收尾；up 内部读 e 处仅 flush 用，占位世界位不影响收尾语义）
      onPointerCancel: () => this.onPointerUp({ world: { x: -1e5, y: -1e5 } } as IPointerEventInfo),
    });
    this.overlay = new LineHoverOverlay(this.viewport, this.vmEngine, this.selector, {
      isSessionBusy: () =>
        Boolean(
          this.drawingId ||
          this.editingLineId ||
          this.endpointDragCtl?.active ||
          this.segTextSlide?.segSlideActive ||
          this.selector.isDragging,
        ) ||
        (this.busyProbe?.() ?? false),
      isEditing: () => this.editingLineId !== null,
      isDrawing: () => this.drawingId !== null,
      quickAddPlanFor: (srcId, sb, anchor, join) =>
        this.quickAdd!.plan(srcId, sb, anchor, join, null),
    });
    this.overlay.initialize();
    this.addDisposable(this.overlay);
    this.quickAdd = new LineQuickAdd(
      this.viewport,
      this.engine,
      this.vmEngine,
      this.selector,
      this.history,
      {
        beginSession: (id, anchor) => {
          this.drawingId = id;
          this.startAnchor = { nodeId: anchor.nodeId, join: anchor.join, point: anchor.point };
        },
        endSession: () => {
          // flush 必须在 drawingId 置空之前（applyMove 按 drawingId 查 model）
          this.flushPendingMove();
          this.drawingId = null;
        },
        throttledMove: (world) => {
          // 与 line 工具管线同款 34ms 节流（onPointerMove 尾部同款三行）
          this.pendingMove = { world } as IPointerEventInfo;
          if (this.moveTimer) return;
          this.moveTimer = window.setTimeout(() => {
            this.moveTimer = 0;
            if (this.pendingMove) this.applyMove(this.pendingMove);
          }, DRAW_MOVE_THROTTLE_MS);
        },
        settle: (id) => this.settleDrawing(id),
        hideOverlays: () => this.overlay?.hideAll(),
        getStartAnchor: () =>
          this.startAnchor as { nodeId: string; join: JoinDir; point: IPt } | null,
        // 双创建链同源：quick-add 建线吃本服务会话默认线型；落新形状吃 ShapeService 会话默认型
        getDefaultLineType: () => this.defaultType,
        getDefaultStrokeWidth: () => this.defaultWidth,
        getDefaultShapeType: () => this.quickAddShapeTypeProbe(),
      },
    );
    this.addDisposable(this.quickAdd);
    this.anchorFollow = new LineAnchorFollow(this.engine, this.vmEngine, this.selector);
    this.addDisposable(this.anchorFollow);
    if (this.overlay) {
      this.endpointDragCtl = new LineEndpointDrag(
        this.viewport,
        this.engine,
        this.vmEngine,
        this.history,
        this.overlay,
        {
          hitTest: (world) => this.hitWidget(world),
        },
      );
      this.addDisposable(this.endpointDragCtl);
      this.segTextSlide = new LineSegTextSlide(
        this.viewport,
        this.engine,
        this.vmEngine,
        this.history,
        this.overlay,
      );
      this.addDisposable(this.segTextSlide);
    }
    // 拖拽预览期的连线实时跟随（docs/08 §3）：通用拖拽与脑图节点拖拽两条
    // 通道都发射 dragMove$——预览 bounds 重路由、仅视觉不写模型
    this.addDisposable(this.selector.dragMove$.subscribe(() => this.anchorFollow?.previewFollow()));
    if (typeof window !== 'undefined') {
      // 双击连线进文字编辑（2026-09-30 用户拍板：单击一律不进编辑）：原生
      // dblclick 只在两次完整 click 时触发——「单击选中后立即按下拖动」不会
      // 产生该事件，天然无伪双击（自定义 350ms/8px 按下时判定的方案正因此
      // 吞拖拽被否）
      window.addEventListener('dblclick', this.onLineDblClick, true);
      this.addDisposable(() => window.removeEventListener('dblclick', this.onLineDblClick, true));
    }
    // 单选连线 → 端点手柄（线几何变化时跟随）
    this.addDisposable(
      this.selector.selected$.subscribe((ids) => this.overlay?.refreshHandles(ids)),
    );
    // 解绑（docs/08 §8）：锚定形状被删 → 该端锚定字段置空，端点保持原位；
    // 与删除同处 500ms 捕获窗（UndoManager 默认）→ 合并为一个撤销单元
    this.addDisposable(
      this.engine.onModelRemoved$.subscribe((ids) => this.anchorFollow?.unbindFrom(ids)),
    );
  }

  /** 四点跟随转发（rectEditor.resizeMove$ 组合根接线——本体在 LineHoverOverlay） */
  followQuickDots(): void {
    this.overlay?.followQuickDots();
  }

  /** 双击连线 → 进文字编辑（双击位置处创建新文字 / 已有文字保持原 ratio）。
   *  原生 dblclick 只由两次完整 click 触发；第二拍 down-up 的段滑移/文字
   *  会话 moved<4 无操作，随后本事件接管（2026-09-30 拍板：单击不进编辑） */
  private onLineDblClick = (e: MouseEvent): void => {
    // 只认画布双击：capture 相 window 监听会收到 DOM 控件（工具栏/ActionBar）
    // 的双击，坐标换算到画布后若线恰在其后方会误进编辑（外部审查 A3）
    if (!(e.target instanceof HTMLCanvasElement)) return;
    if (this.viewport.cursorMode$.value !== 'cursor' || this.drawingId || this.editingLineId)
      return;
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    for (const vm of this.vmEngine.getVmByPoint({ x: world.x, y: world.y } as Point)) {
      if (vm.type === 'LINE') {
        this.enterTextEdit(vm.id, world);
        return;
      }
    }
  };

  /** dev 探针：悬停连接点（line 工具；null = 无悬停——E2E 断言指示器用） */
  get anchorHoverDebug(): Array<{ x: number; y: number }> | null {
    return this.overlay?.anchorHoverDebug ?? null;
  }

  /** dev 探针：最近连接点下标（JOINS 序 top/right/bottom/left；null = 无悬停） */
  get anchorActiveDebug(): number | null {
    return this.overlay?.anchorActiveDebug ?? null;
  }

  /** dev 探针：拖拽预览期最后一帧的连线视觉路由（null = 预览未触发） */
  get previewFollowDebug(): Array<[number, number]> | null {
    return this.anchorFollow?.previewFollowDebug ?? null;
  }

  /** dev 探针：段中点手柄快照（null = 未显示；E2E 断言段几何，批次 3） */
  get lineSegmentsDebug(): Array<{ x: number; y: number }> | null {
    return this.overlay?.segmentSnapshotDebug ?? null;
  }

  /** dev 探针：hover 段下标（null = 无 hover，批次 3） */
  get lineSegmentActiveDebug(): number | null {
    return this.overlay?.segmentActiveDebug ?? null;
  }

  /** dev 探针：hover 端点下标（0 起点/1 终点，null = 无 hover，批次 3） */
  get lineEndpointActiveDebug(): number | null {
    return this.overlay?.endpointActiveDebug ?? null;
  }

  /** dev 探针：线上文字镂空矩形（世界坐标，null = 无文字/无 vm；编辑期 =
   *  编辑器框实测，非编辑期 = 文字 bbox——E2E 断线与胶囊避字护栏共用） */
  get lineKnockoutDebug(): { x: number; y: number; width: number; height: number } | null {
    const id =
      this.editingLineId ??
      this.selector.selected$.value.find((sid) => this.vmEngine.getVmById(sid)?.type === 'LINE');
    if (!id) return null;
    const vm = this.vmEngine.getVmById(id);
    return vm && vm.type === 'LINE' ? (vm as LineVm).knockoutRectDebug : null;
  }

  /** dev 探针：quick-add 影子预览是否显示 + 内容包围盒（渲染排查用） */
  get ghostPreviewDebug(): boolean {
    return this.overlay?.ghostVisible ?? false;
  }

  /** dev 探针：影子预览形态（rect = 幽灵矩形空闲方向 / line = 灰线连已有形状） */
  get ghostModeDebug(): 'rect' | 'line' | null {
    return this.overlay?.ghostMode ?? null;
  }

  get ghostBoundsDebug(): string {
    return this.overlay?.ghostBounds ?? 'empty';
  }

  /**
   * 连线手势下探（docs/08 §10 批次 2，selector.onPointerDown 首行调用）：
   * 单选连线的端点手柄抓取（拖拽重锚定 / 拖离解绑）——消费返回 true，
   * selector 跳过本次手势。抓取半径 12 屏幕像素（手柄 8px + 余量）。
   */
  handleGestureDown(world: { x: number; y: number }): boolean {
    if ((this.endpointDragCtl?.active ?? false) || this.drawingId) return false;
    const ids = this.selector.selected$.value;
    if (ids.length !== 1) return false;
    const vm = this.vmEngine.getVmById(ids[0]!);
    if (!vm) return false;
    if (vm.type === 'LINE') {
      const model = this.engine.getModelById(vm.id);
      if (!model) return false;
      const data = model.toJSON() as unknown as ILineAnchorData;
      const pts = effectivePath(
        data.points.map((p) => ({ x: p[0], y: p[1] })),
        data.lineType,
      );
      const tol = 12 / (this.viewport.vpScale$.value || 1);
      const dStart = Math.hypot(world.x - pts[0]!.x, world.y - pts[0]!.y);
      const dEnd = Math.hypot(world.x - pts[pts.length - 1]!.x, world.y - pts[pts.length - 1]!.y);
      const which: 'start' | 'end' = dStart <= dEnd ? 'start' : 'end';
      // 远离两端：① 段中点胶囊抓取（显式手柄 > 文字 bbox）；② 线上文字
      // 滑移抓取；③ 段身其余位置（参考线身任意点可拖）；否则交还 selector。
      // 文字编辑入口 = 双击连线（onLineDblClick，单击/拖拽均不进编辑）
      if ((which === 'start' ? dStart : dEnd) > tol) {
        if (this.segTextSlide?.maybeSegmentSlideGrab(vm.id, world, true)) return true;
        if (this.segTextSlide?.maybeTextSlideGrab(vm.id, world)) return true;
        return this.segTextSlide?.maybeSegmentSlideGrab(vm.id, world, false) ?? false;
      }
      return this.endpointDragCtl?.begin(vm.id, which) ?? true;
    }
    // 单选形状：四向连接点抓取（点击 = quick-add / 拖拽 = 拉线）。
    // 删除按钮组件后这是按下建线的唯一入口（此前该路径被上面的 LINE 早退
    // 挡成死代码，按点实际按中的是引力区里的按钮组件，E2E 一直没压到）
    return this.maybeShapeAnchorGrab(world);
  }

  /**
   * 选中形状的连接点抓取（docs/08 §10 批次 2，参考同款）：点击/拖拽四向
   * 连接点 = 从该侧建线（点击 = quick-add、拖拽 = 拉线，同一管线分流）。
   */
  private maybeShapeAnchorGrab(world: { x: number; y: number }): boolean {
    const sel = this.selector.selected$.value;
    if (sel.length !== 1) return false;
    const vm = this.vmEngine.getVmById(sel[0]!);
    if (!vm || vm.type === 'LINE' || vm.getRotation() !== 0) return false; // 旋转件不出四点（docs/05 §8）
    const geom = vm.getHostGeom();
    // 抓取判定按**外移点**（形状外 24px）；连线起点 = 该侧边中点（θ=0——旋转件已禁）
    const nearest = JOINS.map((j) => ({
      j,
      a: dotOffsetCenter(geom.rect, j, 0, this.viewport.vpScale$.value || 1),
    }))
      .map(({ j, a }) => ({ j, a, d: Math.hypot(a.x - world.x, a.y - world.y) }))
      .sort((p, q) => p.d - q.d)[0]!;
    const grabRadius = 12 / (this.viewport.vpScale$.value || 1);
    if (nearest.d > grabRadius) return false;
    this.quickAdd?.startConnectorFrom(anchorOf(geom.rect, nearest.j), nearest.j, world);
    return true;
  }

  /** 悬停命中：返回被压住的控件（line 工具下按下在控件上 = 锚定起点）。
   *  严格命中优先；未命中按边缘容差取环内最近元素（连接点在边上——贴边
   *  悬停/按压点必须仍命中，否则指示器闪烁、起点抓空）。
   *  PEN 不参与（2026-10-08 用户拍板）：画笔元素不作为连线锚定/快捷创建
   *  目标——线画开路径，与笔画交叉会误抓 */
  /** 命中返回宿主几何（局部矩形 + θ，docs/05 §8——锚点/最近边随旋转感知）；
   *  容差环按世界 AABB（保守外接） */
  private hitWidget(p: { x: number; y: number }): { id: string; geom: IHostGeom } | null {
    for (const vm of this.vmEngine.getVmByPoint({ x: p.x, y: p.y } as Point)) {
      if (vm.type === 'LINE' || vm.type === 'PEN') continue;
      return { id: vm.id, geom: vm.getHostGeom() };
    }
    const tol = ANCHOR_GRAB_TOLERANCE_SCREEN / (this.viewport.vpScale$.value || 1);
    const cands = this.vmEngine.getVmsInRect({
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

  private onPointerDown(e: IPointerEventInfo): void {
    this.overlay?.hideDrawFeedback();
    const hit = this.hitWidget(e.world);
    const join = hit ? nearestJoin(hit.geom.rect, e.world, hit.geom.rotation) : null;
    const point = hit
      ? anchorOf(hit.geom.rect, join!, hit.geom.rotation)
      : { x: e.world.x, y: e.world.y };
    this.startAnchor = { nodeId: hit?.id ?? null, join, point };
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
      strokeWidth: this.defaultWidth,
      startArrow: 'none',
      endArrow: 'arrow',
      // 新线线型/线宽读会话默认（初始 ELBOWED——2026-09 拍板：现代白板默认正交折线；
      // 两端同轴时路由自然退化为直线；工具坞二级菜单可切，docs/04 §2 会话态优先）
      lineType: this.defaultType,
    } as never);
  }

  private onPointerMove(e: IPointerEventInfo): void {
    // 悬停连接点指示器（仅未绘制时；绘制中的端点吸附反馈属批次 2）。
    // 最近连接点放大高亮（视觉响应替代 hover 态——指示器本身不可命中）
    if (!this.drawingId) {
      const hit = this.hitWidget(e.world);
      if (hit) {
        const active = JOINS.indexOf(nearestJoin(hit.geom.rect, e.world, hit.geom.rotation));
        this.overlay?.showDrawFeedback(hit.geom, active); // 连线工具目标反馈：紧贴边中点
      } else {
        this.overlay?.hideDrawFeedback();
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

  /** 路由落库（34ms 节流 + trailing：松手前最后一次 move 必达，终点不丢帧） */
  private applyMove(e: IPointerEventInfo): void {
    this.pendingMove = null;
    const model = this.engine.getModelById(this.drawingId!);
    if (!model) return;
    // 悬停控件 → 端点吸附到边锚点（docs/08 §3）；指示器同步显示目标连接点
    // （绘制中的吸附反馈——用户实测「连入元素时也要触发指示器」）
    const hit = this.hitWidget(e.world);
    const join = hit ? nearestJoin(hit.geom.rect, e.world, hit.geom.rotation) : null;
    if (hit) {
      // 连线工具的目标反馈：连接点**紧贴边中点**（与选中态快速创建点是两套逻辑）
      this.overlay?.showDrawFeedback(hit.geom, JOINS.indexOf(join!));
    } else {
      this.overlay?.hideDrawFeedback();
    }
    const end = hit
      ? anchorOf(hit.geom.rect, join!, hit.geom.rotation)
      : { x: e.world.x, y: e.world.y };
    // 避让节点用世界 AABB（旋转宿主保守外接）；出线方向量化到最近轴
    // （旋转宿主的走廊方向旋转感知——穿体修复，docs/05 §8）
    const hostAabb = (g: IHostGeom | null): IRect | null =>
      g ? rotatedRectBounds(g.rect, g.rotation) : null;
    const startNodeGeom =
      this.startAnchor?.nodeId != null
        ? (this.vmEngine.getVmById(this.startAnchor.nodeId)?.getHostGeom() ?? null)
        : null;
    const startNodeBounds = hostAabb(startNodeGeom);
    const route = routeElbow({
      start: this.startAnchor!.point,
      startJoin:
        this.startAnchor!.join && startNodeGeom
          ? quantizeJoin(this.startAnchor!.join, startNodeGeom.rotation)
          : this.startAnchor!.join,
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

  private onPointerUp(_e: IPointerEventInfo): void {
    const id = this.drawingId;
    if (!id) return;
    // 松手先冲刷节流中的最后一帧（终帧必达），再做重合判定。
    // 顺序敏感：flush 必须在 drawingId 置空**之前**——applyMove 按
    // drawingId 查 model，先置空会让 flush 静默失效（外部审查揪出，
    // 2026-09-21）：快速拉线（down→move→up <34ms）points 停在初始
    // 同位两点 → 距离 <4 → 整条线被当「未拖出」删除；快速甩尾则终点截断
    this.flushPendingMove();
    this.drawingId = null;
    this.overlay?.hideDrawFeedback();
    this.settleDrawing(id);
  }

  private flushPendingMove(): void {
    if (this.moveTimer) {
      window.clearTimeout(this.moveTimer);
      this.moveTimer = 0;
    }
    if (this.pendingMove) this.applyMove(this.pendingMove);
  }

  /** 连线落定（line 模式松手 / 连接点拖拽共用）：未拖出删除，否则保留选中 */
  private settleDrawing(id: string): void {
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
    this.startAnchor = null;
  }

  /** 节点移动时重算关联线（app.ts 契约；本体在 LineAnchorFollow 协作者）。
   *  宿主几何 = IHostGeom（局部矩形 + θ，docs/05 §8） */
  reattach(nodeId: string, geom: IHostGeom): void {
    this.anchorFollow?.reattach(nodeId, geom);
  }

  /** 拖拽/旋转预览期的锚定线实时跟随（旋转手势经组合根接线，docs/05 §8） */
  previewFollow(): void {
    this.anchorFollow?.previewFollow();
  }

  /** 切回 ELBOWED 全量重路由（app.ts 契约；本体在 LineAnchorFollow 协作者） */
  rerouteLine(id: string): void {
    this.anchorFollow?.rerouteLine(id);
  }

  // ---------- 线上文字（docs/08 §6；编辑器本体在 LineTextEditor 协作者） ----------

  /** 双击已选中的线 → 进入文字编辑（onLineDblClick 入口；转发协作者） */
  enterTextEdit(id: string, world?: { x: number; y: number }): void {
    this.textEditor?.enterTextEdit(id, world);
  }

  exitEdit(): void {
    this.textEditor?.exitEdit();
  }

  get editingWidgetId(): string | null {
    return this.editingLineId;
  }

  override dispose(): void {
    if (this.moveTimer) window.clearTimeout(this.moveTimer);
    super.dispose();
  }
}
