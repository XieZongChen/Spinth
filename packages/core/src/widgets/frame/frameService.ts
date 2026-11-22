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
import { clampFrameZOrder, expandContainers, resolveParentUpdate } from './frameOps';

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
 * - 归属（I5 唯一写入口）：创建即归属（onModelCreated$ 订阅）、拖放/微移落点
 *   （reconcileParents——只在事务内调用，I6）、右键移出（detachSelection）；
 * - 级联：expandForCascade（拖拽/删除/复制带子）+ clampFrame（I3 容器在子之下）。
 * 事务内禁读 vm 几何/zOrder（§6.6-1）——一律 model.toJSON()（权威同步值）。
 */
export class FrameService extends DragCreateServiceBase implements IFrameLookup {
  protected readonly scope = 'frame' as const;
  protected readonly defaultSize = FRAME_DEFAULT_SIZE;
  protected override readonly minDraftSize = FRAME_MIN_SIZE;

  /** 基类 history/selector 是 private——本类命令路径要直用，显式持引用 */
  private readonly historyRef: IHistoryService;
  private readonly selectorRef: ISelectorService;

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
  }

  override initialize(): void {
    super.initialize();
    // 创建即归属（§4.2）：任意工具新建控件落入容器 → 写 parentId。与创建同一
    // undo 捕获窗（创建工具在 up 才 stopCapturing）——一次 undo 回退到底。
    // 粘贴/导入/undo 恢复同流触发：§2.4 规则 1「仍全含于当前父 → null」保证
    // 对已正确归属的批量恢复零多余写；FRAME/树/锚定线在 reconcileOne 拒绝。
    this.addDisposable(this.engine.onModelCreated$.subscribe((m) => this.adoptOnCreate(m.id)));
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

  /** 创建即归属（§4.2）：矩形 = 落库值直读 model。只读宿主（恢复/导入）不写 */
  adoptOnCreate(id: string): void {
    if (!this.viewport.editable$.value) return;
    this.reconcileOne(id, (x) => this.modelRectOf(x));
  }

  private reconcileOne(id: string, rectOf: (id: string) => IRect): void {
    const data = this.widgetData(id);
    if (!data) return;
    if (data.type === 'FRAME' || isTreeWidgetType(data.type)) return; // 容器/树不归属（I1/§0.3）
    if (data.type === 'LINE' && (data.startNodeId || data.endNodeId)) return; // 锚定线写侧拒绝（I2）
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
  }

  // ---------- 图层钳制（I3）与移出 ----------

  /** 容器 zOrder 钳到其全部子元素之下：读 model 现算，单事务 + 独立撤销项
   *  （归属/图层/粘贴三处钳制的单源；粘贴路径在自身事务内直接调
   *  clampFrameZOrder 纯函数，不走本方法避免嵌套事务） */
  clampFrame(frameId: string): void {
    if (!this.isFrame(frameId)) return;
    const items = this.allZOrders();
    const key = clampFrameZOrder(items, frameId, this.childIds(frameId));
    if (key === null) return;
    this.engine.transact(() => {
      this.engine.getModelById(frameId)?.update({ zOrder: key } as never);
    });
    this.historyRef.stopCapturing();
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

  /** 右键「移出容器」（§5.3）：选中集里有 parentId 的全部清父，单事务一步 undo */
  detachSelection(): void {
    if (!this.viewport.editable$.value) return;
    const ids = this.selectorRef.selected$.value.filter((id) => {
      const d = this.widgetData(id);
      return d !== undefined && 'parentId' in d && d.parentId !== undefined;
    });
    if (ids.length === 0) return;
    this.engine.transact(() => {
      for (const id of ids) {
        this.engine.getModelById(id)?.update({ parentId: undefined } as never);
      }
    });
    this.historyRef.stopCapturing();
  }

  /** 「移出容器」可用态（菜单禁用判定）：选中集存在 parentId 且可写 */
  canDetachSelection(): boolean {
    if (!this.viewport.editable$.value) return false;
    return this.selectorRef.selected$.value.some((id) => {
      const d = this.widgetData(id);
      return d !== undefined && d.parentId !== undefined;
    });
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
