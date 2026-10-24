import { BehaviorSubject, Subject } from 'rxjs';
import type { IRect } from './common/geometry';
import { ServiceRegistry } from './platform/registry/serviceRegistry';
import { DataEngineService } from './platform/dataEngine/dataEngineService';
import type { GroupService } from './platform/selector/groupService';
import { BoardCommands } from './boardCommands';
import { BoardOutputs } from './boardStreams';
import { BoardFacade } from './boardFacade';
import { composeBoard } from './boardComposition';
import { RectEditorService } from './platform/rectEditor/rectEditorService';
import { RefLineService } from './platform/refLine/refLineService';
import { LayerService } from './platform/layer/layerService';
import { KeyboardService } from './platform/keyboard/keyboardService';
import { ClipboardService } from './platform/clipboard/clipboardService';
import { ShapeService } from './widgets/shape/shapeService';
import { TextService } from './widgets/text/textService';
import { EditingService } from './platform/textEngine/editingService';
import { LineService } from './widgets/line/lineService';
import { PenService } from './widgets/pen/penService';
import { EraserService } from './widgets/eraser/eraserService';
import { StickyService } from './widgets/sticky/stickyService';
import { ImageService } from './widgets/image/imageService';
import { AssetStore } from './platform/dataEngine/assetStore';
import { ImageTextureCache } from './widgets/image/imageTextureCache';
import { ProjectFileService } from './platform/projectFile/projectFileService';
import { StorageStatusService } from './platform/storage/storageStatusService';
import { MindService } from './widgets/mind/mindService';
import { ContextMenuService } from './platform/contextMenu/contextMenuService';
import { AwarenessService } from './platform/awareness/awarenessService';
import { AwarenessVm } from './platform/awareness/awarenessVm';
import { NetworkService } from './platform/network/networkService';
import { TextRenderService } from './platform/textEngine/textRenderService';
import { SpatialIndex } from './platform/spatial/spatialIndex';
import { CullingService } from './platform/spatial/cullingService';
import type {
  IProjectExportOptions,
  IProjectExportResult,
  IProjectImportOptions,
  IProjectImportResult,
} from './types/projectFile';
import type { IBoardCommandHost } from './boardHost';
import type { IBoardConfig } from './boardConfig';
import { buildActionBarSchema } from './boardActionBar';
import { updateSelectedStyle } from './styleCommands';
import { getSelectionBounds, getMindAddButtons, toScreenPoint } from './boardQueries';
import { disposeBoard } from './boardTeardown';
import { buildBoardDebugSnapshot } from './boardDebug';
import { exportProject, importProject } from './boardProject';
import type {
  IActionBarSchema,
  IHistoryService,
  IMindAddButtonsState,
  ISelectorService,
  ShapeType,
  IViewportService,
  IVmEngineService,
} from './types';

/**
 * BoardSDK — 组合根门面（docs/04 §3）：显式装配全部服务。
 * 对外只暴露「rxjs 输出流（读）+ 命令方法（写）」，UI 框架通过胶水层消费。
 * 纯委托（17 条流 getter + 31 条命令）在基类 BoardFacade；实现分区
 * （specs/api-surface）：组装 boardComposition / 命令 boardCommands +
 * alignCommands·exportCommand·styleCommands / 输出流 boardStreams / ActionBar
 * boardActionBar / 查询 boardQueries / 销毁 boardTeardown / 调试 boardDebug /
 * 项目门面 boardProject——本文件只留字段、生命周期与单行委托。
 */
export class BoardSDK extends BoardFacade implements IBoardCommandHost {
  // ---------- @internal 组装/命令层（批 B 三分）共享服务字段 ----------
  // 原逐字段重复的 @internal 注释合并为本区块头（specs/api-surface Step 5）。
  // 字段保持 public 可写：桩测注入（boardSdkDispose/alignCommand 等）与
  // DEV 句柄（window.__spinth）依赖可写性——禁止改成 private/#private。
  registry = new ServiceRegistry();
  /** 命令区实现（批 A 三分）——委托面在 BoardFacade 基类 */
  readonly commands = new BoardCommands(this);
  /** 输出流区实现（specs/api-surface Step 2）——委托面在 BoardFacade 基类；
   *  构造器只存宿主引用（类字段初始化顺序 = 声明顺序，此刻服务字段尚 null） */
  protected readonly outputs = new BoardOutputs(this);
  viewport: IViewportService | null = null;
  engine: DataEngineService | null = null;
  vmEngine: IVmEngineService | null = null;
  history: IHistoryService | null = null;
  selector: ISelectorService | null = null;
  shapeService: ShapeService | null = null;
  rectEditor: RectEditorService | null = null;
  refLine: RefLineService | null = null;
  layer: LayerService | null = null;
  group: GroupService | null = null;
  textService: TextService | null = null;
  editingService: EditingService | null = null;
  lineService: LineService | null = null;
  penService: PenService | null = null;
  eraserService: EraserService | null = null;
  stickyService: StickyService | null = null;
  mindService: MindService | null = null;
  contextMenu: ContextMenuService | null = null;
  keyboard: KeyboardService | null = null;
  clipboard: ClipboardService | null = null;
  textRender: TextRenderService | null = null;
  spatial: SpatialIndex | null = null;
  culling: CullingService | null = null;
  awareness: AwarenessService | null = null;
  awarenessVm: AwarenessVm | null = null;
  network: NetworkService | null = null;
  /** 图片资产层（Batch 2 资产服务）：组合根建、vm/service 注入共享 */
  assetStore: AssetStore | null = null;
  /** 图片纹理缓存（同 assetId 共享、引用计数租约）：组合根建，IMAGE VM 注入
   *  共享；销毁顺序晚于 vmEngine、早于 assetStore.close */
  imageTextures: ImageTextureCache | null = null;
  imageService: ImageService | null = null;
  /** 启动资产维护（dataURL 迁移 + GC，Batch 2 二期）统计——E2E/调试探针。
   *  docs/assets/partial/ms 为 GC 侧可选追加（中断/预算统计），未跑 GC 时缺省 */
  lastAssetMaintenance: {
    migrated: number;
    removed: number;
    when: number;
    docs?: number;
    assets?: number;
    partial?: 'none' | 'budget' | 'cancelled';
    ms?: number;
  } | null = null;
  /** 项目文件（docs/20 §5.2）：组合根构造注入，门面方法见 exportProject/importProject */
  projectFile: ProjectFileService | null = null;
  /** 存储状态（docs/02 §6.1）：组合根构造注入，门面见 storageStatus$/refreshStorageStatus */
  storageStatus: StorageStatusService | null = null;
  initialized = false;

  /** 任意控件数据变化（低频：落库/远端/undo；拖拽中不触发）——ActionBar 等刷新触发器 */
  readonly widgetsChanged$ = new Subject<void>();

  async initialize(config: IBoardConfig, root: HTMLElement, signal?: AbortSignal): Promise<void> {
    // StrictMode 双挂载防御：被中止的实例在每个 await 后退出并自毁，
    // 避免两个实例同时写同一 IndexedDB 文档（CRDT 合并出重复控件）
    const throwIfAborted = (): void => {
      if (signal?.aborted) {
        throw new DOMException('BoardSDK.initialize aborted', 'AbortError');
      }
    };
    // 组装体在 boardComposition.ts（批 B 三分）——async：内部含 engine/
    // viewport 的 await；时序语义注释见彼处
    await composeBoard(this, config, root, throwIfAborted);
  }

  // ---------- 会话态查询与写通道（直读服务字段，不走委托基类） ----------

  get defaultShapeType(): ShapeType {
    return this.shapeService?.defaultShapeType ?? 'rect';
  }

  /** 工具默认参数聚合表（各 service 会话态流合成；docs/04 §2 工具默认参数节）——
   *  react 单字段镜像 + Toolbar 按 mode/key 查表。**嵌套结构**（线宽笔宽批升级）：
   *  一工具多参数（line 存 {type,width}、pen 存 {color,width}），外层 key = CursorMode、
   *  内层 key = 参数名、value = 选项 id。写通道与 __debug 读 .value 均在本文件
   *  （specs/api-surface §3.4：写通道不是纯输出，不迁 BoardOutputs） */
  private readonly defaultToolOptionsBs = new BehaviorSubject<
    Record<string, Record<string, string>>
  >({});

  /** @internal 组合根写通道（boardComposition 种子写入；仅组合根调用） */
  syncToolOption(tool: string, key: string, v: string): void {
    const cur = this.defaultToolOptionsBs.value;
    const curTool = cur[tool] ?? {};
    if (curTool[key] === v) return;
    this.defaultToolOptionsBs.next({ ...cur, [tool]: { ...curTool, [key]: v } });
  }

  get defaultToolOptions$(): BehaviorSubject<Record<string, Record<string, string>>> {
    return this.defaultToolOptionsBs;
  }

  /** 画布件数（Batch 1 · 1.23 空态引导用——react 层不得读 __debug） */
  get modelCount(): number {
    return this.engine?.modelCount ?? 0;
  }

  /** 手动重试落盘（幂等） */
  retryPersist(): void {
    this.engine?.retryPersist();
  }

  /** 刷新存储状态（面板打开/窗口可见/写失败时由宿主调用；并发合并） */
  refreshStorageStatus(): void {
    void this.storageStatus?.refresh();
  }

  /** 用户手势申请持久化（单飞；结果经 storageStatus$ 的 persistOutcome 到达） */
  requestStoragePersist(): void {
    void this.storageStatus?.requestPersist();
  }

  // ---------- 查询（实现在 boardQueries.ts） ----------

  getSelectionBounds(): IRect | null {
    return getSelectionBounds(this);
  }

  toScreenPoint(p: { x: number; y: number }): { x: number; y: number } {
    return toScreenPoint(this, p);
  }

  getMindAddButtons(): IMindAddButtonsState | null {
    return getMindAddButtons(this);
  }

  /** ActionBar schema v2（docs/12 §4/§5）——构建器在 boardActionBar.ts
   *  （specs/api-surface Step 3 迁出，逐字段语义不变）；多选参与数经回调注入
   *  （只在多选分支计算，与迁移前调用时机一致） */
  getActionBarSchema(): IActionBarSchema | null {
    return buildActionBarSchema(this, () => this.commands.collectCollapsedParticipants().length);
  }

  /** ActionBar 样式写入（实现在 styleCommands.ts，specs/api-surface Step 4 迁出；
   *  不走 BoardCommands——避免给命令类加一个只有门面在用的方法） */
  updateSelectedStyle(patch: Record<string, unknown>): void {
    return updateSelectedStyle(this, patch);
  }

  /** dev 调试用：渲染链各层数量（window.__spinth.__debug）——适配器在
   *  boardDebug.ts（specs/api-surface Step 5 迁出），聚合仍在 debugSnapshot.ts */
  get __debug() {
    return buildBoardDebugSnapshot(this);
  }

  /** 导出当前画布为 .spinth.zip（docs/20 §5.3）——门面在 boardProject.ts */
  async exportProject(opts?: IProjectExportOptions): Promise<IProjectExportResult> {
    return exportProject(this, opts);
  }

  /** 导入项目文件为新的本地画布（docs/20 §7：校验全通过才写库，不触碰当前画布） */
  async importProject(file: Blob, opts?: IProjectImportOptions): Promise<IProjectImportResult> {
    return importProject(this, file, opts);
  }

  /** 销毁序列唯一真源在 boardTeardown.ts（specs/api-surface Step 5 迁出） */
  dispose(): void {
    disposeBoard(this);
  }

  /** @internal 组装/命令层（批 B 三分）共享字段 */
  disposed = false;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  cullingForgetSub: { unsubscribe(): void } | null = null;
}
