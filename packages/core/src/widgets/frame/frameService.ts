import { DragCreateServiceBase } from '../base/dragCreateServiceBase';
import { genId } from '../../utils/id';
import { isTreeWidgetType } from '../../types';
import type {
  IDataEngineService,
  IEditingService,
  IFrameLookup,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import type { IRect } from '../../common/geometry';
import { FRAME_DEFAULT_COLOR, FRAME_DEFAULT_SIZE, FRAME_MIN_SIZE } from './frameGeometry';
import {
  clampFrameZOrder,
  expandContainers,
  isAutoAdoptableType,
  mergeFramesIntoSelection,
  resolveParentUpdate,
} from './frameOps';
import { FrameTitleEditor } from './frameTitleEditor';

/** model.toJSON() 的宽松读取形状（几何摊平 + 归属/锚定字段；Record 兜其余键） */
type FrameWidgetSnapshot = {
  id: string;
  type: string;
  zOrder: string;
  parentId?: string;
  startNodeId?: string | null;
  endNodeId?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
} & Record<string, unknown>;

/**
 * 容器工具与归属服务（specs/container-frame §4.1/§4.2/§6.4）：
 * - 创建：DragCreateServiceBase 模板（单击默认尺寸按下点居中/拖拽跟手/网格吸附），
 *   不收养既有元素（§0.2 拍板）；
 * - 归属（I5 唯一写入口）：自动归属的落点判定 adoptByLanding——创建即归属
 *   （onModelCreated$ 订阅：只服务工具在事务外新建的件）与粘贴收尾（ClipboardService
 *   在粘贴批之后调用）共用同一套参与资格；拖放/微移落点（reconcileParents——只在
 *   事务内调用，I6）；右键移出（detachSelection）。undo·redo 恢复不重判；
 * - 级联：expandForCascade（拖拽/删除/复制带子）；设父同事务钳制容器到子
 *   之下（I3——图层命令另经 computeLayerClamps；粘贴靠容器先入批，创建数据
 *   即正确）。
 * 事务内禁读 vm 几何/zOrder（§6.6-1）——一律 model.toJSON()（权威同步值）。
 */
export class FrameService extends DragCreateServiceBase implements IFrameLookup {
  protected readonly scope = 'frame' as const;
  protected readonly defaultSize = FRAME_DEFAULT_SIZE;
  protected override readonly minDraftSize = FRAME_MIN_SIZE;

  /** 基类 history/selector 是 private——本类命令路径要直用，显式持引用 */
  private readonly historyRef: IHistoryService;
  private readonly selectorRef: ISelectorService;
  /** 标题编辑协作者（§4.10，treeNodeEditor 同款拆分） */
  private readonly titleEditor: FrameTitleEditor | null;
  /** 批量上下文标记：Y.Doc 顶层事务进行中（粘贴批 / undo·redo 恢复 / replay·
   *  远端插入）。工具创建（DragCreate 与各 service 的 add）在事务外——add 的
   *  内层事务收尾之后才发 onModelCreated$；批量路径则发在事务体或观察者相里。
   *  beforeAll/afterAll 严格配对，观察者派生的嵌套事务并入同一次收尾 */
  private inBatchTransaction = false;
  private readonly beginBatch = (): void => {
    this.inBatchTransaction = true;
  };
  private readonly endBatch = (): void => {
    this.inBatchTransaction = false;
  };

  /** 基类构造是 protected（模板基类不直接实例化）——子类显式公开（SymbolService 同款） */
  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    selector: ISelectorService,
    history: IHistoryService,
    private readonly editingService: IEditingService | null,
  ) {
    super(viewport, engine, history, selector);
    this.historyRef = history;
    this.selectorRef = selector;
    this.titleEditor = new FrameTitleEditor(viewport, engine, vmEngine, history, editingService);
  }

  override initialize(): void {
    super.initialize();
    // 批量上下文标记（HistoryService 监听 yDoc 事件同款先例，不改引擎/历史）
    const doc = this.engine.yDoc;
    doc.on('beforeAllTransactions', this.beginBatch);
    doc.on('afterAllTransactions', this.endBatch);
    this.addDisposable(
      () => {
        doc.off('beforeAllTransactions', this.beginBatch);
        doc.off('afterAllTransactions', this.endBatch);
      },
      // 创建即归属（§4.2）：工具新建控件落入容器 → 写 parentId。与创建同一
      // undo 捕获窗（创建工具在 up 才 stopCapturing）——一次 undo 回退到底。
      // FRAME/树/连线在 reconcileOne 拒绝
      this.engine.onModelCreated$.subscribe((m) => this.adoptOnCreate(m.id)),
    );
  }

  override createWidget(x: number, y: number, width: number, height: number): string {
    const id = genId();
    // 样式缺省走 schema parse（title ''/borderStyle solid/color 缺省白——老文档
    // 零迁移口径），只写类型/层级/几何/显式底色
    this.engine.add({
      id,
      type: 'FRAME',
      zOrder: this.engine.genInitialOrder(),
      color: FRAME_DEFAULT_COLOR,
      x,
      y,
      width,
      height,
    } as never);
    return id;
  }

  // ---------- IFrameLookup：查询与级联 ----------

  isFrame(id: string): boolean {
    const data = this.engine.getModelById(id)?.toJSON() as { type?: string } | undefined;
    return data?.type === 'FRAME';
  }

  childIds(frameId: string): string[] {
    const out: Array<{ id: string; z: string }> = [];
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.id === frameId || vm.type === 'FRAME' || isTreeWidgetType(vm.type)) continue;
      const data = this.widgetData(vm.id);
      if (!data || data.parentId !== frameId) continue;
      if (data.type === 'LINE' && (data.startNodeId || data.endNodeId)) continue; // I2 锚定线运行时排除
      out.push({ id: vm.id, z: data.zOrder });
    }
    out.sort((a, b) => (a.z < b.z ? -1 : 1));
    return out.map((o) => o.id);
  }

  expandForCascade(ids: string[]): string[] {
    return expandContainers(ids, this);
  }

  /** 容器清单（zOrder/几何一律读 model——vm root 是微任务合批旧值，§6.6-1） */
  private liveFrames(): Array<{ id: string; zOrder: string; rect: IRect }> {
    const out: Array<{ id: string; zOrder: string; rect: IRect }> = [];
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type !== 'FRAME') continue;
      const data = this.widgetData(vm.id);
      if (!data) continue;
      out.push({
        id: vm.id,
        zOrder: data.zOrder,
        rect: { x: data.x, y: data.y, width: data.width, height: data.height },
      });
    }
    return out;
  }

  // ---------- 归属（I5 唯一写入口） ----------

  /** 归属三态判定并落库（§2.4）。只在事务内调用（I6：与触发操作同一事务）；
   *  rectOf = 移动后矩形——算术或 model 读，事务内不许读 vm（§6.6-1） */
  reconcileParents(ids: string[], rectOf: (id: string) => IRect): void {
    for (const id of ids) this.reconcileOne(id, rectOf);
  }

  /** 创建即归属（§4.2）：只服务「工具在事务外新建」的件——守卫后交给
   *  adoptByLanding（参与资格同源）。只读宿主不写。批量上下文的创建事件
   *  **不重判**——重判会让副本、恢复件与原状态分叉（审查三轮 P2；真引擎回归
   *  frameAdoptionFidelity.test）：undo·redo 恢复的是既有状态；粘贴副本的归属
   *  由 ClipboardService 在粘贴批收尾后显式调 adoptByLanding（§4.7）。
   *  拖动/微移落点不经此处，仍是 §2.4 三态滞回 */
  adoptOnCreate(id: string): void {
    if (!this.viewport.editable$.value) return;
    if (this.inBatchTransaction) return;
    this.adoptByLanding([id]);
  }

  /** 自动归属的落点判定（§4.2/§4.7，创建与粘贴收尾共用）：只处理「无父且可自动
   *  归属」的件，完全落进某存活容器（多容器取最上者）即设父并钳制其层级（I3）；
   *  跨出边界保持顶层。矩形 = 落库值直读 model。
   *  - 已带 parentId 的件不动：归属是既定事实（粘贴桶映射 / 快照给足）。交给三态
   *    判据会把「框外子」按完全离开清父——副本与原件分叉；
   *  - 画笔与连线不参与（isAutoAdoptableType）：模型矩形是占位值。
   *  调用方负责事务与撤销窗收口 */
  adoptByLanding(ids: string[]): void {
    for (const id of ids) {
      const data = this.widgetData(id);
      if (!data || data.parentId !== undefined || !isAutoAdoptableType(data.type)) continue;
      this.reconcileOne(id, (x) => this.modelRectOf(x));
    }
  }

  private reconcileOne(id: string, rectOf: (id: string) => IRect): void {
    const data = this.widgetData(id);
    if (!data) return;
    if (data.type === 'FRAME' || isTreeWidgetType(data.type)) return; // 容器/树不归属（I1/§0.3）
    // 生命线不进容器（specs/sequence-diagram §2.5 S5：schema 无 parentId + 写侧拒绝）
    if (data.type === 'LIFELINE') return;
    // 连线一律不参与落点判定（I2）：线不随拖拽 / 微移平移（LineVm.commitDrag 空操作），
    // 调用方的 rectOf 对会话内每个 id 都给「初值 + 位移」的虚拟位置——按它判定会把
    // 没动的自由线收进容器（E2E C-18 修前实锤）。锚定线另由读取侧排除（childIds）
    if (data.type === 'LINE') return;
    const frames = this.liveFrames().filter((f) => f.id !== id);
    const hasParent = data.parentId !== undefined && frames.some((f) => f.id === data.parentId);
    // 父容器可能同在本次移动集（shift 多选拖容器+其子）——rectOf 已含位移，
    // 不得退回 model 旧值
    const parentId = hasParent ? data.parentId : undefined;
    const parentRect = parentId ? rectOf(parentId) : null;
    const update = resolveParentUpdate({
      parentId,
      parentRect,
      selfRect: rectOf(id),
      frames,
    });
    if (update === null) return;
    this.engine.getModelById(id)?.update({ parentId: update } as never);
    // I3 钳制（审查返工 P1）：清父分支（undefined）不钳——已与该容器无父子关系
    if (typeof update === 'string') this.clampFrameBelowChildren(update);
  }

  // ---------- 图层钳制（I3）与移出 ----------

  /** 归属钳制（审查返工 P1）：设父后容器必须在子之下——否则「先有内容、后画
   *  泳道、再拖入」时容器 zOrder 更高、白底不透明盖住子元素。只在调用方的
   *  事务内使用（不开事务、不 stopCapturing——自开会把一次拖拽裂成两个 undo
   *  项）；读 model 现算（§6.6-1——vm root 是合批旧值）。图层命令另有钳制入口
   *  （computeLayerClamps）；粘贴不做事后钳制而是容器先入批——同事务内紧随
   *  创建的写入对刚建 vm 的观察者不可见（yjs 不为本事务新建的类型登记变更） */
  private clampFrameBelowChildren(frameId: string): void {
    const key = clampFrameZOrder(this.allZOrders(), frameId, this.childIds(frameId));
    if (key === null) return; // 容器已在全部子之下——零写
    this.engine.getModelById(frameId)?.update({ zOrder: key } as never);
  }

  /** 图层命令的容器额外钳制（§4.8）：post = 调用方叠加 delta 后的 zOrder 表；
   *  多容器顺序钳制（前一容器的落位进表再算下一个，防同区间 key 冲突）。
   *  平台层（layerService）经 IFrameLookup 消费——platform 不 import widgets */
  computeLayerClamps(
    post: ReadonlyArray<{ id: string; zOrder: string }>,
  ): Array<{ id: string; zOrder: string }> {
    const table = new Map(post.map((p) => [p.id, p.zOrder] as const));
    const out: Array<{ id: string; zOrder: string }> = [];
    for (const vm of this.vmEngine.getAllVms()) {
      if (vm.type !== 'FRAME') continue;
      const items = [...table].map(([id, zOrder]) => ({ id, zOrder }));
      const key = clampFrameZOrder(items, vm.id, this.childIds(vm.id));
      if (key !== null) {
        out.push({ id: vm.id, zOrder: key });
        table.set(vm.id, key);
      }
    }
    return out;
  }

  /** 框选容器归并闭包（§4.3）：容器清单/子表按手势快照一次（拖框期间文档
   *  不变——groupFilter 同款口径）；无容器返回 null。组互斥（不拆组）经
   *  groups 投影现算命中集涉及的组 */
  createMarqueeFrameFilter(
    groups: {
      groupOf(id: string): string | undefined;
      membersOf(groupId: string): string[];
    } | null,
  ): ((hitIds: string[], marquee: IRect) => string[]) | null {
    const frameList = this.liveFrames().map((f) => ({ id: f.id, rect: f.rect }));
    if (frameList.length === 0) return null;
    return (hitIds: string[], marquee: IRect): string[] => {
      // 本次结果涉及的、存活成员 ≥2 的组的全部成员（§4.3 第 2 步）
      const groupedIds = new Set<string>();
      if (groups) {
        for (const id of hitIds) {
          const g = groups.groupOf(id);
          if (!g) continue;
          const members = groups.membersOf(g);
          if (members.length >= 2) for (const m of members) groupedIds.add(m);
        }
      }
      return mergeFramesIntoSelection({
        ids: hitIds,
        marquee,
        frames: frameList,
        childIdsOf: (fid) => this.childIds(fid),
        groupedIds,
      });
    };
  }

  /** 右键「移出容器」（§5.3）：选中集里有 parentId 的全部清父，单事务一步
   *  undo。锚定线拒绝（I2）：清一个任何路径都不读的 stale 字段只会产出
   *  无意义 undo 项 */
  detachSelection(): void {
    if (!this.viewport.editable$.value) return;
    const ids = this.selectorRef.selected$.value.filter((id) => this.detachable(id));
    if (ids.length === 0) return;
    this.engine.transact(() => {
      for (const id of ids) {
        this.engine.getModelById(id)?.update({ parentId: undefined } as never);
      }
    });
    this.historyRef.stopCapturing();
  }

  /** 可移出判定：持有 parentId 且非锚定线（I2 写侧拒绝同款） */
  private detachable(id: string): boolean {
    const d = this.widgetData(id);
    if (d === undefined || d.parentId === undefined) return false;
    return !(d.type === 'LINE' && (d.startNodeId || d.endNodeId));
  }

  /** 「移出容器」可用态（菜单禁用判定）：选中集存在可移出件且可写 */
  canDetachSelection(): boolean {
    if (!this.viewport.editable$.value) return false;
    return this.selectorRef.selected$.value.some((id) => this.detachable(id));
  }

  /** 标题编辑入口（§4.10：单击已选中容器经 onActivate 分派至此；只读早退在
   *  协作者内）。editor 未组装（editingService null）时静默 no-op */
  enterTitleEdit(id: string): boolean {
    return this.titleEditor?.enterTitleEdit(id) ?? false;
  }

  // ---------- 读取工具 ----------

  private widgetData(id: string): FrameWidgetSnapshot | undefined {
    return this.engine.getModelById(id)?.toJSON() as never;
  }

  private modelRectOf(id: string): IRect {
    const d = this.widgetData(id);
    return { x: d?.x ?? 0, y: d?.y ?? 0, width: d?.width ?? 0, height: d?.height ?? 0 };
  }

  private allZOrders(): Array<{ id: string; zOrder: string }> {
    return this.vmEngine
      .getAllVms()
      .map((vm) => ({ id: vm.id, zOrder: this.widgetData(vm.id)?.zOrder ?? '' }));
  }
}
