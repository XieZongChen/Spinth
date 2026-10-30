import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { LineTypeSchema } from '../../types';
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
import { anchorOf, effectivePath, type IPt, type JoinDir } from './lineMath';
import type { LineVm } from './lineVm';
import type { IHostGeom } from '../../common/geometry';
import type { Point } from 'pixi.js';
import { LineHoverOverlay } from './lineHoverOverlay';
import { LineQuickAdd, type ILineAnchorData } from './lineQuickAdd';
import { LineAnchorFollow } from './lineAnchorFollow';
import { LineEndpointDrag } from './lineEndpointDrag';
import { LineSegTextSlide } from './lineSegTextSlide';
import { LineTextEditor } from './lineTextEditor';
import { LineDrawSession } from './lineDrawSession';
import { LINE_WIDTH_STEPS } from './lineOptions';
import { hitWidget, nearestAnchorDot, nearestLineEndpoint } from './lineHitTest';

/**
 * 连接线交互层（docs/08 §7）：line 工具按下→拖出→松手；
 * 悬停控件吸附边锚点（nearestJoin）；ELBOWED 拉线过程实时正交路由；
 * 绑定后节点移动 → 线跟随重路由（订阅节点 onStateChanged$）。
 * 线上文字：双击已选中的线 → 在双击位置 ratio 处编辑（onLineDblClick，2026-09-30
 * 拍板单击不进编辑——线身单击是段滑移/胶囊手势，docs/08 §10.3）。
 */
// 线型/线宽选项表单源在 lineOptions；re-export 保持消费路径（§3.3 先例）
export { LINE_TYPE_OPTIONS, LINE_WIDTH_STEPS, LINE_WIDTH_OPTIONS } from './lineOptions';

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

  /** 悬停/选中浮层协作者（A1 整理批刀 2：指示器/端点圆/段条/幽灵预览 + 快照） */
  private overlay: LineHoverOverlay | null = null;
  /** 拉线状态机协作者（§4.2：line 工具 + quick-add 共用；initialize 内创建） */
  private drawSession!: LineDrawSession;
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
      onPointerDown: (e) => this.drawSession.pointerDown(e),
      onPointerMove: (e) => this.drawSession.pointerMove(e),
      onPointerUp: (e) => this.drawSession.pointerUp(e),
      onPointerUpOutside: (e) => this.drawSession.pointerUp(e),
      // 手势取消（Batch 1 · 1.9）：打断 ≠ 点击——settle 清零长草稿线（up 同款
      // 收尾；up 内部读 e 处仅 flush 用，占位世界位不影响收尾语义）
      onPointerCancel: () =>
        this.drawSession.pointerUp({ world: { x: -1e5, y: -1e5 } } as IPointerEventInfo),
    });
    this.overlay = new LineHoverOverlay(this.viewport, this.vmEngine, this.selector, {
      isSessionBusy: () =>
        Boolean(
          this.drawSession.isDrawing ||
          this.editingLineId ||
          this.endpointDragCtl?.active ||
          this.segTextSlide?.segSlideActive ||
          this.selector.isDragging,
        ) ||
        (this.busyProbe?.() ?? false),
      isEditing: () => this.editingLineId !== null,
      isDrawing: () => this.drawSession.isDrawing,
      quickAddPlanFor: (srcId, sb, anchor, join) =>
        this.quickAdd!.plan(srcId, sb, anchor, join, null),
    });
    this.overlay.initialize();
    this.addDisposable(this.overlay);
    this.drawSession = new LineDrawSession(
      this.viewport,
      this.engine,
      this.vmEngine,
      this.selector,
      this.history,
      {
        overlay: this.overlay,
        getDefaultLineType: () => this.defaultType,
        getDefaultStrokeWidth: () => this.defaultWidth,
      },
    );
    this.addDisposable(this.drawSession);
    this.quickAdd = new LineQuickAdd(
      this.viewport,
      this.engine,
      this.vmEngine,
      this.selector,
      this.history,
      {
        beginSession: (id, anchor) => this.drawSession.beginFromQuickAdd(id, anchor),
        endSession: () => this.drawSession.endSession(),
        throttledMove: (world) => this.drawSession.queueMove(world),
        settle: (id) => this.drawSession.settle(id),
        hideOverlays: () => this.overlay?.hideAll(),
        getStartAnchor: () =>
          this.drawSession.startAnchor as { nodeId: string; join: JoinDir; point: IPt } | null,
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
          hitTest: (world) => hitWidget(this.vmEngine, this.viewport, world),
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
    if (
      this.viewport.cursorMode$.value !== 'cursor' ||
      this.drawSession.isDrawing ||
      this.editingLineId
    )
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
    if ((this.endpointDragCtl?.active ?? false) || this.drawSession.isDrawing) return false;
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
      const { which, d } = nearestLineEndpoint(pts, world);
      // 远离两端：① 段中点胶囊抓取（显式手柄 > 文字 bbox）；② 线上文字
      // 滑移抓取；③ 段身其余位置（参考线身任意点可拖）；否则交还 selector。
      // 文字编辑入口 = 双击连线（onLineDblClick，单击/拖拽均不进编辑）
      if (d > tol) {
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
    const nearest = nearestAnchorDot(geom, world, this.viewport.vpScale$.value || 1);
    const grabRadius = 12 / (this.viewport.vpScale$.value || 1);
    if (nearest.d > grabRadius) return false;
    this.quickAdd?.startConnectorFrom(anchorOf(geom.rect, nearest.j), nearest.j, world);
    return true;
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
}
