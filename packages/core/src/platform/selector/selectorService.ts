import { Point, Rectangle } from 'pixi.js';
import { BehaviorSubject, Subject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { IPoint, IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IEdgeAutoScrollService,
  IHistoryService,
  IMindDragDelegate,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import { SelectorVm, marqueeRectOf, type MarqueeState } from './selectorVm';
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
  mindDragDelegate: IMindDragDelegate | null = null;

  private dragState: DragState | null = null;
  /** 拖拽操作上下文（initialize 后构造；ops 无状态——状态归本类字段） */
  private dragCtx!: ISelectorDragContext;
  private marquee: MarqueeState | null = null;
  /** marquee 组过滤闭包（docs/18 §4.3）：手势开始建、结束清；null = 无组语义 */
  private marqueeGroupFilter: ((hitIds: string[], rect: IRect) => string[]) | null = null;
  /** 脑图节点级拖拽进行中（委托 MindService，docs/11 §6） */
  private mindDragging = false;
  /** 按下时该脑图是否已选中（松手未拖动 → 激活编辑的判据，同通用拖拽的 wasSelected） */
  private mindDragWasSelected = false;
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
      getRefLine: () => this.getRefLine(),
      onDragCommitted: (ids, dx, dy) => this.onDragCommitted?.(ids, dx, dy),
      syncSelectionVm: () => this.syncSelectionVm(),
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
    this.engine.removeByIds(ids);
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
    return this.dragState !== null || this.marquee !== null || this.mindDragging;
  }

  private onPointerDown(e: IPointerEventInfo): void {
    // 连线手势优先（docs/08 §10 批次 2）：单选连线的端点手柄抓取
    if (this.lineGestureHook?.(e.world)) return;
    const hits = this.vmEngine.getVmByPoint(e.world);
    const top = hits[0];
    // 脑图节点级拖拽优先于整图拖拽（docs/11 §6）：按下在非根节点 → MindService
    // 接管本次指针序列；根节点/未命中节点落回下方通用路径（整图拖拽/框选）
    if (top && top.type === 'MIND_MAP' && this.mindDragDelegate) {
      const node = (
        top as unknown as {
          hitNode(p: Point): { model: { id: string } } | null;
        }
      ).hitNode(e.world);
      // 按下时该脑图是否已在选区（松手未拖动 = 再点已选中 → 激活编辑，同通用路径）
      this.mindDragWasSelected = this.selected$.value.includes(top.id);
      if (node && this.mindDragDelegate.startDrag(top.id, node.model.id, e.world)) {
        // 按下即建立节点级选中态（先于 setSelected：选区框同步时 isNodeSelected
        // 已可判定，整树框不闪现——松手 click 分支的焦点覆写同值幂等）
        this.mindDragDelegate.focusNode?.(top.id, node.model.id);
        this.setSelected([top.id]);
        this.mindDragging = true;
        return;
      }
      // 4.9 点根 = 整图选中 + 焦点重置根（selected$ 订阅对同图旧焦点不重置，
      // 此处精确通知——既有设计点根即选整图的语义）
      if (node) {
        this.mindDragDelegate.focusRoot?.(top.id);
      }
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
      // initial（per-id）= getLocalRect（commitDrag/预览的输入语义——数据矩形）；
      // initialUnion = 世界 AABB union（选区框视觉，θ≠0 外接矩形大于数据矩形）
      const dragState = createDragState(this.dragCtx, ids, e, wasSelected);
      if (dragState) this.dragState = dragState;
    } else {
      if (!e.shiftKey && this.selected$.value.length > 0) {
        this.setSelected([]);
      }
      this.marquee = { start: e.world.clone(), cur: e.world.clone() };
      // 组索引快照按手势建一次（docs/18 §4.3：拖框期间组籍/成员不变）
      this.marqueeGroupFilter = this.getGroups()?.createMarqueeFilter() ?? null;
      this.selectorVm.show(marqueeRectOf(this.marquee));
    }
  }

  private onPointerMove(e: IPointerEventInfo): void {
    if (this.mindDragging && this.mindDragDelegate) {
      this.mindDragDelegate.dragMove(e.world);
      // 浮层（ActionBar/＋ 按钮）拖拽中隐藏：桥接层订阅 dragMove$（docs/12 §3）。
      // 脑图节点拖拽走独立通道，此前不发此流 → 拖拽中浮动栏压在节点上
      this.dragMove$.next();
      this.edgeScroll?.update(e.screen, this.mindDragDelegate.isDragMoved ?? false);
      return;
    }
    if (this.dragState) {
      applyDragMove(this.dragCtx, this.dragState, e);
      this.edgeScroll?.update(e.screen, this.dragState.moved);
      return;
    }
    if (this.marquee) {
      this.marquee.cur = e.world.clone();
      const rect = marqueeRectOf(this.marquee);
      this.selectorVm.update(rect);
      const hits = this.vmEngine.getVmByRect(
        new Rectangle(rect.x, rect.y, rect.width, rect.height),
      );
      let hitIds = hits.map((vm) => vm.id);
      if (this.marqueeGroupFilter) {
        // 整组全入框口径（docs/18 §4.3）：过程即最终结果，不闪变
        hitIds = this.marqueeGroupFilter(hitIds, rect);
      }
      this.setSelected(hitIds);
    }
  }

  private onPointerCancel(): void {
    this.edgeScroll?.stop();
    if (this.dragState) {
      cancelDrag(this.dragCtx, this.dragState); // 预览回弹 + 参考线收起；清空归本类
      this.dragState = null;
    }
    if (this.marquee) {
      this.marquee = null;
      this.marqueeGroupFilter = null;
      this.selectorVm.hide();
    }
    if (this.mindDragging) {
      this.mindDragDelegate?.dragCancel?.();
      this.mindDragging = false;
    }
    this.syncSelectionVm();
    markRender();
  }

  private onPointerUp(e: IPointerEventInfo): void {
    this.edgeScroll?.stop();
    if (this.mindDragging && this.mindDragDelegate) {
      const result = this.mindDragDelegate.dragEnd(e.world);
      this.mindDragging = false;
      // 未拖动（单击）= 与通用路径同款激活语义：**再点已选中的脑图节点 → 进编辑**。
      // 此前这里直接 return：点子节点永远走不到下面的激活分支，只有根（startDrag
      // 对根返回 false、走通用路径）能进编辑（用户实测：子节点无法进入编辑态）
      if (
        result === 'click' &&
        this.singleClickActivate &&
        !e.shiftKey &&
        this.mindDragWasSelected
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
      // 是「确认选区」语义，不应打开该件编辑器（其余成员仍选中态却出了编辑框）
      if (
        !d.moved &&
        d.wasSelected &&
        this.singleClickActivate &&
        !e.shiftKey &&
        this.selected$.value.length === 1
      ) {
        const hits = this.vmEngine.getVmByPoint(e.world);
        const top = hits[0];
        if (top && this.selected$.value.includes(top.id)) {
          this.onActivate?.(top.id, top.type, e.world);
        }
      }
      return;
    }
    if (this.marquee) {
      const rect = marqueeRectOf(this.marquee);
      this.marquee = null;
      this.marqueeGroupFilter = null;
      this.selectorVm.hide();
      // 4.9 框选节点级命中：MIND_MAP 命中后委托脑图服务细化焦点——框中根本体 =
      // 整图（焦点回根），框中子节点 bbox = 节点级选中（docs/11 §0 修订）
      for (const id of this.selected$.value) {
        const vm = this.vmEngine.getVmById(id);
        if (vm?.type === 'MIND_MAP') this.mindDragDelegate?.focusFromMarquee?.(rect, id);
      }
      return;
    }
    // 单击「已选中」的元素 = 进入编辑（docs/05 §3；编辑入口由外部注入）
    if (this.singleClickActivate && !e.shiftKey) {
      const hits = this.vmEngine.getVmByPoint(e.world);
      const top = hits[0];
      if (top && this.selected$.value.includes(top.id)) {
        this.onActivate?.(top.id, top.type, e.world);
      }
    }
  }

  /** 编辑激活回调（单击已选中元素时触发；BoardSDK 注入 textService/lineService 编辑入口） */
  onActivate: ((id: string, type: string, world?: { x: number; y: number }) => void) | null = null;
  /** 拖拽松手落库后、stopCapturing 前的钩子（BoardSDK 注入锚定线急切重路由，docs/05 §4.3） */
  onDragCommitted: ((ids: string[], dx: number, dy: number) => void) | null = null;
  private singleClickActivate = true;

  private syncSelectionVm(): void {
    const ids = this.selected$.value;
    if (ids.length === 0 || this.dragState?.moved) {
      this.selectionVm.hide();
      return;
    }
    // 脑图焦点节点（根或子节点）：选区框画在**节点本体**上——既有设计点任意
    // MIND_NODE 都是这个视觉（框整棵树是 spinth 早期形态；只给根画框则子节点
    // 看起来「没有选中态」）
    if (ids.length === 1) {
      const focusFrame = this.mindDragDelegate?.getFocusFrame?.();
      if (focusFrame) {
        this.selectionVm.showBounds([focusFrame]);
        return;
      }
      // 单选连线不画 bbox 框（批次 3.6，参考同款）：points bbox 对 U 形线
      // 会补出第四边——看起来像个大蓝矩形框住中央空区。线选中态 = 线本体 +
      // 端点圆/段条手柄（lineService.refreshHandles）；ActionBar 定位走独立
      // getSelectionBounds 不受影响。多选含线仍画 union 框（组语义）。
      const only = this.vmEngine.getVmById(ids[0]!);
      if (only?.type === 'LINE') {
        this.selectionVm.hide();
        return;
      }
    }
    const bounds = ids
      .map((id) => this.vmEngine.getVmById(id)?.getBounds())
      .filter((b): b is IRect => !!b);
    this.selectionVm.showBounds(bounds);
  }

  /** 公开重画入口：脑图焦点变化（Tab 建子/方向键导航）不改 selected$，
   *  由组合根接 focusChanged$ 驱动——选区框跟随焦点节点（4.9 单层化后
   *  焦点框是节点唯一选中视觉，必须跟随） */
  refreshSelectionFrame(): void {
    this.syncSelectionVm();
  }
}
