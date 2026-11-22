import { BehaviorSubject, Subject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { isTreeWidgetType } from '../../types';
import { markRender } from '../../common/render';
import type { IPoint, IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IEdgeAutoScrollService,
  IFrameLookup,
  IHistoryService,
  ITreeDragDelegate,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import { SelectorVm, syncSelectionFrame } from './selectorVm';
import { buildFrameMarqueeFilter, MarqueeSession, type IMarqueeContext } from './selectorMarquee';
import { treePointerDown } from './selectorTreeGate';
import { SelectionVm } from '../selection/selectionVm';
import {
  applyDragMove,
  cancelDrag,
  commitDrag,
  createDragState,
  type DragState,
  type ISelectorDragContext,
} from './selectorDragOps';
import type { RefLineService } from '../refLine/refLineService';
import type { GroupService } from './groupService';

/**
 * 选中服务（docs/05 §3）：cursor 模式的点选/框选/拖拽。
 * 拖拽中只做视觉反馈（vm.root.position + 选区框），松手统一 transact 落库——数据流铁律的例外条款。
 */
export class SelectorService extends Disposable implements ISelectorService {
  readonly selected$ = new BehaviorSubject<string[]>([]);
  /** 拖拽中的每帧通知：RectEditor 等跟随框订阅它实时重定位 */
  readonly dragMove$ = new Subject<void>();
  /** 脑图节点级拖拽代理（组合根晚绑定，避免 selector↔mind 构造环） */
  treeDragDelegate: ITreeDragDelegate | null = null;

  /** 网格吸附开关探针（specs/flowchart-closeout §9.2；组合根注入 gridSnap
   *  服务。缺省关——测试/未组装零行为差） */
  gridSnapOn: () => boolean = () => false;

  private dragState: DragState | null = null;
  /** 拖拽操作上下文（initialize 后构造；ops 无状态——状态归本类字段） */
  private dragCtx!: ISelectorDragContext;
  /** 框选会话（状态封装于会话内；本类只持可空引用参与 isDragging 判定） */
  private marquee: MarqueeSession | null = null;
  /** 框选会话上下文（initialize 后构造） */
  private marqueeCtx!: IMarqueeContext;
  /** 脑图节点级拖拽进行中（委托 MindService，docs/11 §6） */
  private treeDragging = false;
  /** 按下时该脑图是否已选中（松手未拖动 → 激活编辑的判据，同通用拖拽的 wasSelected） */
  private treeDragWasSelected = false;
  /** 手柄/旋转手势抑制单击激活：生命周期 = 手势本身（rectEditor down 置位、
   *  手势终止单源清除）；本类只读判定——blur/多指/pointercancel 都不是手势
   *  终止，泄掉即松手误进编辑（edit 早退保留预览 scale，框与图形脱节）。 */
  suppressClickActivation = false;
  private selectorVm!: SelectorVm;
  private selectionVm!: SelectionVm;

  constructor(
    private viewport: IViewportService,
    private vmEngine: IVmEngineService,
    private engine: IDataEngineService,
    private history: IHistoryService,
    /** 惰性获取参考线服务：与 RefLineService 相互依赖，组合根用 getter 解环 */
    private getRefLine: () => RefLineService,
    /** 编组服务惰性获取（docs/18 §4）：null = 无组语义（单测桩环境老行为） */
    getGroups: () => GroupService | null = () => null,
    private edgeScroll: IEdgeAutoScrollService | null = null,
    /** 容器归属查询惰性获取（specs/container-frame §6.4，getGroups 同款解环）：
     *  null = 无容器语义（拖拽/删除不级联、落库不判父——既有单测桩零改动） */
    private getFrames: () => IFrameLookup | null = () => null,
  ) {
    super();
    this.getGroups = getGroups;
  }

  private getGroups: () => GroupService | null;

  initialize(): void {
    this.selectorVm = new SelectorVm(this.viewport.optionLayer);
    this.selectionVm = new SelectionVm(
      this.viewport.optionLayer,
      () => this.viewport.vpScale$.value,
    );
    // 拖拽操作 ctx（specs/split-large-files §4.5）：onDragCommitted 转发可空字段
    this.dragCtx = {
      viewport: this.viewport,
      vmEngine: this.vmEngine,
      engine: this.engine,
      history: this.history,
      selectionVm: this.selectionVm,
      dragMove$: this.dragMove$,
      gridSnapOn: () => this.gridSnapOn(),
      getRefLine: () => this.getRefLine(),
      syncSelectionVm: () => this.syncSelectionVm(),
      onDragCommitted: (ids, dx, dy) => this.onDragCommitted?.(ids, dx, dy),
      // 容器归属（specs/container-frame §4.4）：commitDrag 事务内回写（I6）
      reconcileParents: (ids, rectOf) => this.getFrames()?.reconcileParents(ids, rectOf),
    };
    this.marqueeCtx = {
      vmEngine: this.vmEngine,
      setSelected: (ids) => this.setSelected(ids),
      treeDragDelegate: () => this.treeDragDelegate,
      selectorVm: this.selectorVm,
    };
    this.addDisposable(this.selected$.subscribe(() => this.syncSelectionVm()));

    this.viewport.registerGlobalEventListener('cursor', {
      onPointerDown: (e) => this.onPointerDown(e),
      onPointerMove: (e) => this.onPointerMove(e),
      onPointerUp: (e) => this.onPointerUp(e),
      onPointerUpOutside: (e) => this.onPointerUp(e),
      // 手势取消（Batch 1 · 1.9/1.10）：pointercancel/blur/切工具——终止不落库。
      // 拖拽预览回弹（数据从未写入，root 停在预览位须复位）；框选蓝框隐藏
      onPointerCancel: () => this.onPointerCancel(),
    });

    // 选中元素数据变化（远端/undo）→ 选区框跟随
    this.addDisposable(
      this.engine.onModelCreated$.subscribe(() => this.syncSelectionVm()),
      this.selected$.subscribe(() => this.subscribeSelectedVms()),
      // 选中元素被删（undo 删除/远端删除——不走 removeSelected 的路径）：
      // 从选区剔除已删 id，否则选区框没人重画、残留在原位置
      // （拖出成新图后 undo：新图被回滚，框留在原地，2026-09-22 用户实测揪出）
      this.engine.onModelRemoved$.subscribe((ids) => {
        const dead = new Set(ids);
        if (this.selected$.value.some((id) => dead.has(id))) {
          this.setSelected(this.selected$.value.filter((id) => !dead.has(id)));
        } else {
          this.syncSelectionVm(); // 框内元素被删也重画（多选成员被 undo）
        }
      }),
    );
  }

  private vmSubscriptions = new Map<string, () => void>();

  /** dev 调试：选区框当前矩形 */
  get __selectionFrame(): IRect | null {
    return this.selectionVm.bounds;
  }

  /** 订阅选中 vm 的状态变化，实时同步选区框 */
  private subscribeSelectedVms(): void {
    for (const dispose of this.vmSubscriptions.values()) dispose();
    this.vmSubscriptions.clear();
    for (const id of this.selected$.value) {
      const vm = this.vmEngine.getVmById(id);
      if (!vm) continue;
      const sub = vm.onStateChanged$.subscribe(() => this.syncSelectionVm());
      this.vmSubscriptions.set(id, () => sub.unsubscribe());
    }
  }

  setSelected(ids: string[]): void {
    const prev = this.selected$.value;
    // 派发 onSelected$（diff 增删）
    const prevSet = new Set(prev);
    const nextSet = new Set(ids);
    for (const vm of this.vmEngine.getAllVms()) {
      const now = nextSet.has(vm.id);
      if (prevSet.has(vm.id) !== now) {
        vm.onSelected$.next(now);
      }
    }
    this.selected$.next(ids);
  }

  removeSelected(): void {
    const ids = this.selected$.value;
    if (ids.length === 0) return;
    // 容器连子删（specs/container-frame §4.6）：单事务一步 undo；被删容器的
    // 子元素不在选区——expandForCascade 展开后整批 removeByIds
    const frames = this.getFrames();
    const all = frames ? frames.expandForCascade(ids) : ids;
    this.engine.removeByIds(all);
    this.setSelected([]);
  }

  /** 缩放流程中由 RectEditor 调用：选区框实时跟随被缩放的形状 */
  updateSelectionFrame(rect: IRect): void {
    this.selectionVm.moveTo(rect);
  }

  // ---------- pointer handlers ----------

  /** 连线手势下探（组合根注入 LineService.handleGestureDown） */
  lineGestureHook: ((world: IPoint) => boolean) | null = null;

  get isDragging(): boolean {
    return this.dragState !== null || this.marquee !== null || this.treeDragging;
  }

  /** 元素拖拽预览中的 id（culling 复核用；框选/脑图拖拽不走 dragState，恒空） */
  get previewIds(): readonly string[] {
    return this.dragState?.ids ?? [];
  }

  private onPointerDown(e: IPointerEventInfo): void {
    // 连线手势优先（docs/08 §10 批次 2）：单选连线的端点手柄抓取
    if (this.lineGestureHook?.(e.world)) return;
    const hits = this.vmEngine.getVmByPoint(e.world);
    const top = hits[0];
    // 脑图节点级拖拽优先于整图拖拽（docs/11 §6）：按下在非根节点 → MindService
    // 接管本次指针序列；根节点/未命中节点落回下方通用路径（整图拖拽/框选）。
    // 判定体拆至 selectorTreeGate（审查返工 400 行拆分，逻辑逐字搬移）
    if (top && isTreeWidgetType(top.type) && this.treeDragDelegate) {
      const gate = treePointerDown(
        this.treeDragDelegate,
        top,
        e,
        (id) => this.selected$.value.includes(id),
        (ids) => this.setSelected(ids),
      );
      if (gate.kind === 'consumed') return;
      if (gate.kind === 'dragging') {
        this.treeDragWasSelected = gate.wasSelected;
        this.treeDragging = true;
        return;
      }
      // focus-root / pass：落回通用路径（选整图 / 框选）
    }
    if (top) {
      const wasSelected = !e.shiftKey && this.selected$.value.includes(top.id);
      let ids = this.selected$.value;
      const groups = this.getGroups();
      if (e.shiftKey) {
        // 组原子切换（docs/18 §4.2）：命中组员整组加/移除；无组 = 单 id 切换
        ids = groups
          ? groups.toggleIds(ids, top.id)
          : ids.includes(top.id)
            ? ids.filter((i) => i !== top.id)
            : [...ids, top.id];
        this.setSelected(ids);
      } else if (e.altKey) {
        // Alt 直选单体（docs/18 §4.2 进组）：跳过组扩展；已在单选态保持
        // （再点已选中 → 激活编辑的语义不受影响）
        if (!(ids.length === 1 && ids[0] === top.id)) {
          ids = [top.id];
          this.setSelected(ids);
        }
      } else if (!ids.includes(top.id)) {
        // 组员 → 整组选中（docs/18 §4.1）；单员组扩展 = 自身，老行为零漂移
        ids = groups ? groups.expandIds([top.id]) : [top.id];
        this.setSelected(ids);
      }
      // 容器级联展开（specs/container-frame §4.4）：会话 ids = 展开后全集（预览/
      //  落库/取消带子），selectedIds 保持展开前（归属判定只对用户选中的件）；
      //  纯线选区 + 容器混拖照常（展开集里有非线件）
      const frames = this.getFrames();
      const sessionIds = frames ? frames.expandForCascade(ids) : ids;
      // initial（per-id）= getLocalRect（commitDrag/预览的输入语义——数据矩形）；
      // initialUnion = 世界 AABB union（选区框视觉，θ≠0 外接矩形大于数据矩形）。
      // 纯线选区在 createDragState 内部拒绝（空操作会话的 ActionBar 停隐
      // 副作用——完整因果见 selectorDragOps 注释，2026-11 三轮审查下沉）
      const dragState = createDragState(this.dragCtx, sessionIds, e, wasSelected, ids);
      if (dragState) this.dragState = dragState;
    } else {
      if (!e.shiftKey && this.selected$.value.length > 0) {
        this.setSelected([]);
      }
      // 容器归并闭包按手势建一次（specs/container-frame §4.3；构建拆至
      // buildFrameMarqueeFilter——平台层不 import widgets/frame）
      const groups = this.getGroups();
      this.marquee = new MarqueeSession(
        this.marqueeCtx,
        e.world,
        e.screen,
        groups,
        buildFrameMarqueeFilter(this.getFrames(), groups),
      );
    }
  }

  private onPointerMove(e: IPointerEventInfo): void {
    if (this.treeDragging && this.treeDragDelegate) {
      this.treeDragDelegate.dragMove(e.world);
      // 浮层（ActionBar/＋ 按钮）拖拽中隐藏：桥接层订阅 dragMove$（docs/12 §3）。
      // 脑图节点拖拽走独立通道，此前不发此流 → 拖拽中浮动栏压在节点上
      this.dragMove$.next();
      this.edgeScroll?.update(e.screen, this.treeDragDelegate.isDragMoved ?? false);
      return;
    }
    if (this.dragState) {
      applyDragMove(this.dragCtx, this.dragState, e);
      this.edgeScroll?.update(e.screen, this.dragState.moved);
      return;
    }
    if (this.marquee) {
      this.marquee.move(e.world, e.screen);
      this.edgeScroll?.update(e.screen, this.marquee.moved);
    }
  }

  private onPointerCancel(): void {
    this.edgeScroll?.stop();
    if (this.dragState) {
      cancelDrag(this.dragCtx, this.dragState); // 预览回弹 + 参考线收起；清空归本类
      this.dragState = null;
    }
    if (this.marquee) {
      this.marquee.cancel();
      this.marquee = null;
    }
    if (this.treeDragging) {
      this.treeDragDelegate?.dragCancel?.();
      this.treeDragging = false;
    }
    this.syncSelectionVm();
    markRender();
  }

  private onPointerUp(e: IPointerEventInfo): void {
    // 手势抑制只读不消费：手势的 window up 稍后到达才由 rectEditor 清除
    const suppressClick = this.suppressClickActivation;
    this.edgeScroll?.stop();
    if (this.treeDragging && this.treeDragDelegate) {
      const result = this.treeDragDelegate.dragEnd(e.world);
      this.treeDragging = false;
      // 未拖动（单击）= 与通用路径同款激活语义：**再点已选中的脑图节点 → 进编辑**。
      // 此前这里直接 return：点子节点永远走不到下面的激活分支，只有根（startDrag
      // 对根返回 false、走通用路径）能进编辑（用户实测：子节点无法进入编辑态）
      if (
        result === 'click' &&
        this.singleClickActivate &&
        !e.shiftKey &&
        !suppressClick && // 手势抑制同拦（与 dragState/final 分支统一；防御性——脑图无手柄）
        this.treeDragWasSelected
      ) {
        const top = this.vmEngine.getVmByPoint(e.world)[0];
        if (top && this.selected$.value.includes(top.id))
          this.onActivate?.(top.id, top.type, e.world);
      }
      return;
    }
    if (this.dragState) {
      const d = this.dragState;
      commitDrag(this.dragCtx, d); // moved 分支：transact + onDragCommitted + stopCapturing
      this.dragState = null;
      this.getRefLine().hideMatches();
      this.syncSelectionVm();
      // 未拖动且按下时就已选中 = 单击已选中元素 → 激活编辑（docs/05 §3；
      // 原实现提前 return 导致该路径不可达——线上文字实测揪出，TEXT 编辑同受益）。
      // 单选限定（Batch 1 · 1.5，2026-10-17 审查）：多选/编组整组态下再点成员
      // 是「确认选区」语义，不应打开该件编辑器（其余成员仍选中态却出了编辑框）。
      // 手柄手势抑制同拦本分支：多指下第二指在手势期点已选中件，up 不得激活
      if (!d.moved && d.wasSelected) this.maybeActivateOnClick(e, suppressClick);
      return;
    }
    if (this.marquee) {
      const m = this.marquee;
      this.marquee = null; // 先置空再收尾——收尾回调期 isDragging 已为 false（原时序）
      m.finish(this.selected$.value);
      return;
    }
    this.maybeActivateOnClick(e, suppressClick);
  }

  /** 单击已选中件的编辑激活（拖拽未起分支与常规收尾同判定——抽出消双份）：
   *  shift 加选/手势抑制/非单选不激活；命中点在选中集内才触发 onActivate */
  private maybeActivateOnClick(e: IPointerEventInfo, suppressClick: boolean): void {
    if (!this.singleClickActivate || e.shiftKey || suppressClick) return;
    if (this.selected$.value.length !== 1) return;
    const top = this.vmEngine.getVmByPoint(e.world)[0];
    if (top && this.selected$.value.includes(top.id)) {
      this.onActivate?.(top.id, top.type, e.world);
    }
  }

  /** 编辑激活回调（单击已选中元素时触发；BoardSDK 注入 textService/lineService 编辑入口） */
  onActivate: ((id: string, type: string, world?: { x: number; y: number }) => void) | null = null;
  /** 拖拽松手落库后、stopCapturing 前的钩子（BoardSDK 注入锚定线急切重路由，docs/05 §4.3） */
  onDragCommitted: ((ids: string[], dx: number, dy: number) => void) | null = null;
  private singleClickActivate = true;

  private syncSelectionVm(): void {
    // 同步逻辑拆至 syncSelectionFrame（审查返工 400 行拆分，语义逐字搬移）
    syncSelectionFrame({
      selectionVm: this.selectionVm,
      ids: this.selected$.value,
      getVmById: (id) => this.vmEngine.getVmById(id),
      getFocusFrame: () => this.treeDragDelegate?.getFocusFrame?.(),
      dragMoved: !!this.dragState?.moved,
    });
  }

  /** 公开重画入口：脑图焦点变化（Tab 建子/方向键导航）不改 selected$，由组合根
   *  接 focusChanged$ 驱动——焦点框是节点唯一选中视觉，必须跟随 */
  refreshSelectionFrame(): void {
    this.syncSelectionVm();
  }
}
