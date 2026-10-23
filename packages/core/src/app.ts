import { BehaviorSubject, Subject } from 'rxjs';
import type { IRect } from './common/geometry';
import { BoardApplication } from './platform/viewport/boardApplication';
import { ServiceRegistry } from './platform/registry/serviceRegistry';
import { DataEngineService } from './platform/dataEngine/dataEngineService';
import { GroupService } from './platform/selector/groupService';
import { buildDebugSnapshot } from './debugSnapshot';
import { BoardCommands } from './boardCommands';
import { composeBoard } from './boardComposition';
import { RectEditorService } from './platform/rectEditor/rectEditorService';
import { RefLineService } from './platform/refLine/refLineService';
import { LayerService } from './platform/layer/layerService';
import { KeyboardService } from './platform/keyboard/keyboardService';
import { ClipboardService } from './platform/clipboard/clipboardService';
import { SHAPE_TYPE_OPTIONS, ShapeService } from './widgets/shape/shapeService';
import { FONT_SIZE_OPTIONS } from './widgets/text/textVm';
import { TextService } from './widgets/text/textService';
import { EditingService } from './platform/textEngine/editingService';
import { LINE_TYPE_OPTIONS, LINE_WIDTH_OPTIONS } from './widgets/line/lineService';
import { LineService } from './widgets/line/lineService';
import { PEN_COLOR_PALETTE, PEN_WIDTH_OPTIONS } from './widgets/pen/penService';
import { PenService } from './widgets/pen/penService';
import { EraserService } from './widgets/eraser/eraserService';
import { STICKY_COLOR_OPTIONS } from './widgets/sticky/stickyVm';
import { StickyService } from './widgets/sticky/stickyService';
import { ImageService } from './widgets/image/imageService';
import { AssetStore } from './platform/dataEngine/assetStore';
import { ImageTextureCache } from './widgets/image/imageTextureCache';
import { ProjectFileService } from './platform/projectFile/projectFileService';
import { ProjectFileError } from './platform/projectFile/projectFileError';
import { StorageStatusService } from './platform/storage/storageStatusService';
import { INITIAL_STORAGE_STATUS, type IStorageStatus } from './types/storage';
import type {
  IProjectExportOptions,
  IProjectExportResult,
  IProjectImportOptions,
  IProjectImportResult,
} from './types/projectFile';
import { MindService } from './widgets/mind/mindService';
import { BRANCH_COLORS } from './widgets/mind/mindMapModel';
import {
  ContextMenuService,
  type IContextMenuState,
} from './platform/contextMenu/contextMenuService';
import { AwarenessService } from './platform/awareness/awarenessService';
import { AwarenessVm } from './platform/awareness/awarenessVm';
import { NetworkService } from './platform/network/networkService';
import { TextRenderService } from './platform/textEngine/textRenderService';
import { SpatialIndex } from './platform/spatial/spatialIndex';
import { CullingService } from './platform/spatial/cullingService';
import { unionRects } from './common/geometry';
import type { AlignMode, DistributeAxis } from './platform/selector/alignOps';
import type {
  CursorMode,
  IActionBarOption,
  IActionBarItem,
  IActionBarSchema,
  IBaseWidgetVm,
  IHistoryService,
  IMindAddButtonsState,
  ISelectorService,
  ShapeType,
  IViewportService,
  IVmEngineService,
} from './types';

/** ActionBar 色板（视觉规格：与各控件 Service 默认色一致的语义色） */
const SHAPE_PALETTE = ['#e8f0fb', '#d1fae5', '#fde8e8', '#fef3c7', '#ede9fe', '#f1f5f9'];
/** 连线/画笔共用色板（与 PEN_COLOR_PALETTE 同源——2026-10-11 提名导出消内联双份） */
const LINE_PALETTE: readonly string[] = PEN_COLOR_PALETTE;

/** 连线箭头选项（起点/终点两个字段共用；icon = @spinth/react Icon 语义名） */
const ARROW_BAR_OPTIONS: IActionBarOption[] = [
  { id: 'none', label: '无箭头', icon: 'arrow-none' },
  { id: 'arrow', label: '开箭头', icon: 'arrow-open' },
  { id: 'solid', label: '实心箭头', icon: 'arrow-solid' },
  { id: 'diamond', label: '菱形箭头', icon: 'arrow-diamond' },
];

/** 字号档位（docs/17 §4 排版打磨批 B：option.id 为数字串，updateSelectedStyle
 *  侧数值化；text 型选项——PopoverControl 文本渲染分支） */

/** 行高档位（lineHeight per-实例批：倍数语义；TEXT/STICKY 专属，LINE 不暴露）。
 *  含各类型默认值（TEXT/SHAPE 1.5、STICKY 1.45）——默认档可显可选可切回；
 *  value 匹配不到 option 时触发钮会落 FALLBACK 圆点（2026-10-16 用户实测揪出） */
const LINE_HEIGHT_OPTIONS: IActionBarOption[] = [1.2, 1.4, 1.45, 1.5, 1.6, 2.0].map((n) => ({
  id: String(n),
  label: `${n} 倍行高`,
  text: String(n),
}));

/** 文字对齐三态（TEXT/STICKY） */
const ALIGN_OPTIONS: IActionBarOption[] = [
  { id: 'left', label: '左对齐', icon: 'align-left' },
  { id: 'center', label: '居中', icon: 'align-center' },
  { id: 'right', label: '右对齐', icon: 'align-right' },
];

/** 排版项工厂（value 显式带控件常量默认——触发钮显示当前档位/态）；
 *  行高与对齐同为 TEXT/STICKY 专属（LINE 单行居多不暴露，见批 3 同源化注记） */
const typoItems = (
  data: Record<string, unknown>,
  def: { fontSize: number; align: 'left' | 'center' | 'right'; lineHeight: number },
  withAlign: boolean,
  withLineHeight: boolean,
): IActionBarItem[] => {
  const items: IActionBarItem[] = [
    {
      id: 'fontSize',
      kind: 'popover',
      label: '字号',
      value: String(data.fontSize ?? def.fontSize),
      options: FONT_SIZE_OPTIONS,
    },
    {
      id: 'textColor',
      kind: 'popover',
      label: '文字颜色',
      value: String(data.textColor ?? ''),
      options: LINE_PALETTE.map((hex) => ({ id: hex, label: hex, swatch: hex })),
    },
  ];
  if (withLineHeight) {
    items.push({
      id: 'lineHeight',
      kind: 'popover',
      label: '行高',
      value: String(data.lineHeight ?? def.lineHeight),
      options: LINE_HEIGHT_OPTIONS,
    });
  }
  if (withAlign) {
    items.push({
      id: 'align',
      kind: 'popover',
      label: '对齐',
      value: String(data.align ?? def.align),
      options: ALIGN_OPTIONS,
    });
  }
  return items;
};

export interface IBoardConfig {
  docId: string;
  /** Phase 3 接入；空 = 本地模式 */
  wsUrl?: string;
  userName?: string;
  editable?: boolean;
  /** 启动资产维护链（存量迁移 + GC，默认开）。DEV/测试环境建议关——
   *  GC 全库扫描（indexedDB.databases() × 每 doc 盘上重建）在并行页面下
   *  是 IO 压力源，E2E 仅专项用例显式开启 */
  assetMaintenance?: boolean;
}

/**
 * BoardSDK — 组合根（docs/04 §3）：显式装配全部服务。
 * 对外只暴露「rxjs 输出流（读）+ 命令方法（写）」，UI 框架通过胶水层消费。
 */

export class BoardSDK {
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  registry = new ServiceRegistry();
  /** 命令区实现（批 A 三分）——门面方法单行委托至此 */
  commands = new BoardCommands(this);
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  viewport: IViewportService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  engine: DataEngineService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  vmEngine: IVmEngineService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  history: IHistoryService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  selector: ISelectorService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  shapeService: ShapeService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  rectEditor: RectEditorService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  refLine: RefLineService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  layer: LayerService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  group: GroupService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  textService: TextService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  editingService: EditingService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  lineService: LineService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  penService: PenService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  eraserService: EraserService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  stickyService: StickyService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  imageService: ImageService | null = null;
  /** 图片资产层（Batch 2 资产服务）：组合根建、vm/service 注入共享 */
  assetStore: AssetStore | null = null;
  /** @internal 图片纹理缓存（同 assetId 共享、引用计数租约）：组合根建，
   *  IMAGE VM 注入共享；销毁顺序晚于 vmEngine、早于 assetStore.close */
  imageTextures: ImageTextureCache | null = null;
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
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  mindService: MindService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  contextMenu: ContextMenuService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  keyboard: KeyboardService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  clipboard: ClipboardService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  textRender: TextRenderService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  spatial: SpatialIndex | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  culling: CullingService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  awareness: AwarenessService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  awarenessVm: AwarenessVm | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  network: NetworkService | null = null;
  /** @internal 项目文件（docs/20 §5.2）：组合根构造注入，门面方法见 exportProject/importProject */
  projectFile: ProjectFileService | null = null;
  /** @internal 存储状态（docs/02 §6.1）：组合根构造注入，门面见 storageStatus$/refreshStorageStatus */
  storageStatus: StorageStatusService | null = null;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
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

  // ---------- 输出流（react 胶水层只读消费） ----------

  /** 组装前输出流兜底（批 B：bridge 订阅早于 composeBoard 完成——null 服务
   *  读 getter 曾整树崩（ghostSuppressed/editBlocked 实锤族）；各流返回与
   *  真实初值同源的 BehaviorSubject，组装完成后真值流接管（订阅方拿到的是
   *  fallback 实例的消费者在组装完成前已存在的极早期 bridge 订阅——react
   *  connectBoard 在 onReady 后才挂，实际无消费者，兜底仅防初始化窗口崩溃） */
  private fallbacks = {
    cursorMode: null as BehaviorSubject<CursorMode> | null,
    shapeType: null as BehaviorSubject<ShapeType> | null,
    vpScale: null as BehaviorSubject<number> | null,
    vpBounds: null as BehaviorSubject<IRect> | null,
    editable: null as BehaviorSubject<boolean> | null,
    docState: null as BehaviorSubject<'idle'> | null,
    wsState: null as BehaviorSubject<'off'> | null,
    persistState: null as BehaviorSubject<'saved'> | null,
    storageStatus: null as BehaviorSubject<IStorageStatus> | null,
    selected: null as BehaviorSubject<string[]> | null,
    canUndo: null as BehaviorSubject<boolean> | null,
    canRedo: null as BehaviorSubject<boolean> | null,
  };

  get cursorMode$(): BehaviorSubject<CursorMode> {
    return (
      this.viewport?.cursorMode$ ??
      (this.fallbacks.cursorMode ??= new BehaviorSubject<CursorMode>('cursor'))
    );
  }

  /** 形状工具默认创建型（会话级，docs/04 §2 形状默认型小节；工具坞二级菜单消费） */
  get defaultShapeType$(): BehaviorSubject<ShapeType> {
    return (
      this.shapeService?.defaultShapeType$ ??
      (this.fallbacks.shapeType ??= new BehaviorSubject<ShapeType>('rect'))
    );
  }

  get defaultShapeType(): ShapeType {
    return this.shapeService?.defaultShapeType ?? 'rect';
  }

  /** 工具默认参数聚合表（各 service 会话态流合成；docs/04 §2 工具默认参数节）——
   *  react 单字段镜像 + Toolbar 按 mode/key 查表。**嵌套结构**（线宽笔宽批升级）：
   *  一工具多参数（line 存 {type,width}、pen 存 {color,width}），外层 key = CursorMode、
   *  内层 key = 参数名、value = 选项 id */
  private readonly defaultToolOptionsBs = new BehaviorSubject<
    Record<string, Record<string, string>>
  >({});

  syncToolOption(tool: string, key: string, v: string): void {
    const cur = this.defaultToolOptionsBs.value;
    const curTool = cur[tool] ?? {};
    if (curTool[key] === v) return;
    this.defaultToolOptionsBs.next({ ...cur, [tool]: { ...curTool, [key]: v } });
  }

  get defaultToolOptions$(): BehaviorSubject<Record<string, Record<string, string>>> {
    return this.defaultToolOptionsBs;
  }

  get vpScale$(): BehaviorSubject<number> {
    return this.viewport?.vpScale$ ?? (this.fallbacks.vpScale ??= new BehaviorSubject<number>(1));
  }

  get vpBounds$(): BehaviorSubject<IRect> {
    return (
      this.viewport?.vpBounds$ ??
      (this.fallbacks.vpBounds ??= new BehaviorSubject<IRect>({ x: 0, y: 0, width: 0, height: 0 }))
    );
  }

  get editable$(): BehaviorSubject<boolean> {
    return (
      this.viewport?.editable$ ?? (this.fallbacks.editable ??= new BehaviorSubject<boolean>(true))
    );
  }

  get docState$() {
    return (
      this.engine?.docState$ ?? (this.fallbacks.docState ??= new BehaviorSubject<'idle'>('idle'))
    );
  }

  /** ws 连接态（docs/10 §2；本地模式恒 'off'） */
  get wsState$() {
    return this.engine?.wsState$ ?? (this.fallbacks.wsState ??= new BehaviorSubject<'off'>('off'));
  }

  /** 物理断网（阻断编辑；ws 断连仅提示不阻断——docs/10 §4）。组装前兜底
   *  false（批 B：bridge 订阅早于 boardCompletion 完成） */
  get editBlocked$() {
    if (this.network) return this.network.editBlocked$;
    this.editBlockedFallback ??= new BehaviorSubject<boolean>(false);
    return this.editBlockedFallback;
  }
  private editBlockedFallback: BehaviorSubject<boolean> | null = null;

  /** 本地落盘态（Batch 1 · 1.15）：failed=写失败退避中（配额满等），
   *  UI 顶栏「已同步」不得再与 wsState 混同 */
  get persistState$() {
    return (
      this.engine?.persistState$ ??
      (this.fallbacks.persistState ??= new BehaviorSubject<'saved'>('saved'))
    );
  }

  /** 画布件数（Batch 1 · 1.23 空态引导用——react 层不得读 __debug） */
  get modelCount(): number {
    return this.engine?.modelCount ?? 0;
  }

  /** 手动重试落盘（幂等） */
  retryPersist(): void {
    this.engine?.retryPersist();
  }

  /** 浏览器持久化授权 + 站点配额（docs/02 §6.1——与 persistState$ 不混同） */
  get storageStatus$() {
    return (
      this.storageStatus?.status$ ??
      (this.fallbacks.storageStatus ??= new BehaviorSubject<IStorageStatus>(INITIAL_STORAGE_STATUS))
    );
  }

  /** 刷新存储状态（面板打开/窗口可见/写失败时由宿主调用；并发合并） */
  refreshStorageStatus(): void {
    void this.storageStatus?.refresh();
  }

  /** 用户手势申请持久化（单飞；结果经 storageStatus$ 的 persistOutcome 到达） */
  requestStoragePersist(): void {
    void this.storageStatus?.requestPersist();
  }

  get selected$() {
    return (
      this.selector?.selected$ ?? (this.fallbacks.selected ??= new BehaviorSubject<string[]>([]))
    );
  }

  get canUndo$() {
    return (
      this.history?.canUndo$ ?? (this.fallbacks.canUndo ??= new BehaviorSubject<boolean>(false))
    );
  }

  get canRedo$() {
    return (
      this.history?.canRedo$ ?? (this.fallbacks.canRedo ??= new BehaviorSubject<boolean>(false))
    );
  }

  get contextMenuOptions$(): BehaviorSubject<IContextMenuState> {
    // 组装前兜底（批 B 输出流族最后一员）：静止菜单
    if (this.contextMenu) return this.contextMenu.options$;
    this.ctxMenuFallback ??= new BehaviorSubject<IContextMenuState>({
      show: false,
      x: 0,
      y: 0,
      onWidget: false,
      canPaste: false,
    });
    return this.ctxMenuFallback;
  }

  /** 拖拽进行中通知（ActionBar 隐藏跟随） */
  get dragMove$(): Subject<void> {
    if (this.selector) return this.selector.dragMove$;
    this.dragMoveFallback ??= new Subject<void>();
    return this.dragMoveFallback;
  }

  /** mind 幽灵抑制（指针悬停已有脑图）——ToolGhost 消费（2026-09-22 幽灵 DOM 化）。
   *  批 B 三分后组装在 boardComposition、bridge 订阅可能早于组装完成——
   *  BehaviorSubject(false) 兜底（mindService 就绪后返回真值流） */
  get mindGhostSuppressed$(): import('rxjs').BehaviorSubject<boolean> {
    if (this.mindService) return this.mindService.ghostSuppressed$;
    this.mindGhostFallback ??= new BehaviorSubject<boolean>(false);
    return this.mindGhostFallback;
  }
  private mindGhostFallback: BehaviorSubject<boolean> | null = null;

  /** 脑图焦点节点变化（导航/建删/点击落点——AddButtons 重算触发器之一）。
   *  组装前兜底 dead Subject（批 B 同 mindGhostSuppressed） */
  get mindFocusChanged$(): Subject<void> {
    if (this.mindService) return this.mindService.focusChanged$;
    this.mindFocusFallback ??= new Subject<void>();
    return this.mindFocusFallback;
  }
  private mindFocusFallback: Subject<void> | null = null;
  private ctxMenuFallback: BehaviorSubject<IContextMenuState> | null = null;
  private dragMoveFallback: Subject<void> | null = null;

  /** 选中元素世界坐标外接矩形（无选中返回 null） */
  getSelectionBounds(): IRect | null {
    const ids = this.selector?.selected$.value ?? [];
    // 4.9 节点级选中：ActionBar（含删除按钮）定位到**焦点节点本体**；根焦点同样如此
    // ——既有设计 actionBar 跟的是 selectedBounds，而点根选中的是那个 MIND_NODE。
    // 挂整树 bbox 会让根焦点时的浮动栏飘到整棵树上方（用户实测：删除按钮位置异常）
    if (ids.length === 1) {
      const vm = this.vmEngine?.getVmById(ids[0]!);
      if (vm?.type === 'MIND_MAP') {
        const st = this.mindService?.getFocusedState();
        if (st) return st.worldRect;
      }
    }
    const bounds = ids
      .map((id) => this.vmEngine?.getVmById(id)?.getBounds())
      .filter((b): b is IRect => !!b);
    return unionRects(bounds);
  }

  /** 世界 → 屏幕（canvas 内局部坐标；UI 定位再补画布偏移） */
  toScreenPoint(p: { x: number; y: number }): { x: number; y: number } {
    return this.viewport!.toScreen(p);
  }

  /**
   * 脑图焦点节点 +/- 按钮定位源（docs/12 §4）：焦点节点屏幕外接矩形 + 侧向标志。
   * 拉取式（同 getActionBarSchema 模式）——bridge 在焦点/树/视口变化时重算。
   */
  getMindAddButtons(): IMindAddButtonsState | null {
    if (!this.mindService) return null;
    if (this.mindService.isDragging) return null; // 拖拽重排中隐藏
    if (this.viewport!.cursorMode$.value !== 'cursor') return null;
    const f = this.mindService.getFocusedState();
    if (!f) return null;
    const a = this.viewport!.toScreen({ x: f.worldRect.x, y: f.worldRect.y });
    const c = this.viewport!.toScreen({
      x: f.worldRect.x + f.worldRect.width,
      y: f.worldRect.y + f.worldRect.height,
    });
    const sl = this.viewport!.toScreen({ x: f.slotLeft, y: 0 });
    const sr = this.viewport!.toScreen({ x: f.slotRight, y: 0 });
    return {
      bounds: { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y },
      isRoot: f.isRoot,
      direction: f.direction,
      slotLeft: sl.x,
      slotRight: sr.x,
    };
  }

  /**
   * ActionBar schema v2（docs/12 §4/§5，2026-10-03 参考视频对齐）：单选按
   * 控件类型出样式项，多选仅通用动作。schema 是纯数据（字段名 + 中文文案 +
   * 选项图标/色块 + 当前值），@spinth/react 按 kind 渲染——多级形态：popover
   * 字段一级只占「当前值图标 + ▾」一个按钮位，选项收进二级面板；文字说明
   * 收进 tooltip（label）。**各类型只维护本函数内的 schema，样式与交互全部
   * 由 @spinth/react 统一承载**。
   */
  getActionBarSchema(): IActionBarSchema | null {
    const ids = this.selector?.selected$.value ?? [];
    if (ids.length === 0) return null;
    if (ids.length > 1) {
      // 多选：几何命令八键（docs/05 §7）+ react 侧通用删除。禁用态按**可移动
      // 参与数**（与命令参与集同源 resolver——锚定线不计，2026-10-10 审查处置：
      // 按选中数会让「形状+锚定线」2 选时对齐键可点但 no-op 死点击）；分布键
      // <3 参与者显示但禁用（参考同款）。参与数按组折叠后计（docs/18 §5）：
      // 整组 = 1 个参与体
      const participants = this.commands.collectCollapsedParticipants().length;
      const alignDisabled = participants < 2;
      const distDisabled = participants < 3;
      // 组切换单钮（docs/18 §3.4）：恰一整组/兜底态显示「解组」，其余「编组」
      // （合并/收编/改籍）；schema 随 widgetsChanged$ 重算——编组落库后选区
      // 不变，按钮自动翻转
      const g = this.group?.getGroupActionState() ?? { id: 'group' as const, disabled: true };
      return {
        type: '*',
        items: [
          {
            id: 'align-left',
            kind: 'action',
            label: '左对齐',
            icon: 'obj-align-left',
            disabled: alignDisabled,
          },
          {
            id: 'align-hcenter',
            kind: 'action',
            label: '水平居中对齐',
            icon: 'obj-align-hcenter',
            disabled: alignDisabled,
          },
          {
            id: 'align-right',
            kind: 'action',
            label: '右对齐',
            icon: 'obj-align-right',
            disabled: alignDisabled,
          },
          {
            id: 'align-top',
            kind: 'action',
            label: '顶对齐',
            icon: 'obj-align-top',
            disabled: alignDisabled,
          },
          {
            id: 'align-vcenter',
            kind: 'action',
            label: '垂直居中对齐',
            icon: 'obj-align-vcenter',
            disabled: alignDisabled,
          },
          {
            id: 'align-bottom',
            kind: 'action',
            label: '底对齐',
            icon: 'obj-align-bottom',
            disabled: alignDisabled,
          },
          {
            id: 'dist-h',
            kind: 'action',
            label: '横向分布',
            icon: 'obj-dist-h',
            disabled: distDisabled,
          },
          {
            id: 'dist-v',
            kind: 'action',
            label: '纵向分布',
            icon: 'obj-dist-v',
            disabled: distDisabled,
          },
          {
            id: g.id,
            kind: 'action',
            label: g.id === 'group' ? '编组' : '解组',
            icon: g.id,
            disabled: g.disabled,
          },
        ],
      };
    }
    const vm = this.vmEngine?.getVmById(ids[0]!);
    const model = vm ? this.engine?.getModelById(vm.id) : undefined;
    if (!vm || !model) return null;
    const data = model.toJSON() as unknown as Record<string, unknown>;
    const swatches = (palette: readonly string[]): IActionBarOption[] =>
      palette.map((hex) => ({ id: hex, label: hex, swatch: hex }));
    switch (vm.type) {
      case 'SHAPE':
        return {
          type: vm.type,
          items: [
            // 图形类型四态（身份属性放首位；切换几何不变、文字内接随型自动重排
            // ——insetRectOf 渲染现成；解锁 ellipse/diamond 的 UI 入口）。
            // 选项与工具坞二级菜单同源（SHAPE_TYPE_OPTIONS 单源，2026-10-11）
            {
              id: 'shapeType',
              kind: 'popover',
              label: '图形类型',
              value: String(data.shapeType ?? 'rect'),
              options: SHAPE_TYPE_OPTIONS,
            },
            {
              id: 'color',
              kind: 'popover',
              label: '填充色',
              value: String(data.color ?? ''),
              options: swatches(SHAPE_PALETTE),
            },
            {
              id: 'borderStyle',
              kind: 'popover',
              label: '边框',
              value: String(data.borderStyle ?? 'solid'),
              options: [
                { id: 'solid', label: '实线', icon: 'border-solid' },
                { id: 'dashed', label: '虚线', icon: 'border-dashed' },
                { id: 'none', label: '无边框', icon: 'border-none' },
              ],
            },
            // 图形内文字排版（docs/17 §6）：def.align 传 center——形状文字默认居中，
            // 触发钮显示正确档位；字号/行高档后 reflowHeight 经 autoHeight 重排
            ...typoItems(data, { fontSize: 16, align: 'center', lineHeight: 1.5 }, true, true),
          ],
        };
      case 'LINE':
        return {
          type: vm.type,
          items: [
            // 选项与工具坞二级菜单同源（LINE_TYPE_OPTIONS 单源，2026-10-11）
            {
              id: 'lineType',
              kind: 'popover',
              label: '线型',
              value: String(data.lineType ?? 'STRAIGHT'),
              options: LINE_TYPE_OPTIONS,
            },
            {
              id: 'strokeWidth',
              kind: 'popover',
              label: '线宽',
              value: String(data.strokeWidth ?? 2),
              options: LINE_WIDTH_OPTIONS,
            },
            {
              id: 'dashed',
              kind: 'toggle',
              label: '虚线',
              icon: 'select-all',
              value: Boolean(data.dashed),
            },
            {
              id: 'startArrow',
              kind: 'popover',
              label: '起点箭头',
              value: String(data.startArrow ?? 'none'),
              options: ARROW_BAR_OPTIONS,
            },
            {
              id: 'endArrow',
              kind: 'popover',
              label: '终点箭头',
              value: String(data.endArrow ?? 'arrow'),
              options: ARROW_BAR_OPTIONS,
            },
            {
              id: 'color',
              kind: 'popover',
              label: '颜色',
              value: String(data.color ?? ''),
              options: swatches(LINE_PALETTE),
            },
            ...typoItems(data, { fontSize: 12, align: 'left', lineHeight: 1.4 }, false, false),
          ],
        };
      case 'PEN':
        return {
          type: vm.type,
          items: [
            {
              id: 'strokeWidth',
              kind: 'popover',
              label: '笔宽',
              value: String(data.strokeWidth ?? 4),
              options: PEN_WIDTH_OPTIONS,
            },
            {
              id: 'color',
              kind: 'popover',
              label: '颜色',
              value: String(data.color ?? ''),
              options: swatches(LINE_PALETTE),
            },
          ],
        };
      case 'STICKY':
        return {
          type: vm.type,
          items: [
            {
              id: 'color',
              kind: 'popover',
              label: '便签色',
              value: String(data.color ?? '#fff3b0'),
              options: STICKY_COLOR_OPTIONS,
            },
            ...typoItems(data, { fontSize: 15, align: 'left', lineHeight: 1.45 }, true, true),
          ],
        };
      case 'TEXT':
        // 排版项（docs/17 §4：value 带控件常量默认——触发钮显示当前档位/态）
        return {
          type: vm.type,
          items: typoItems(data, { fontSize: 16, align: 'left', lineHeight: 1.5 }, true, true),
        };
      case 'IMAGE':
        return { type: vm.type, items: [] };
      case 'MIND_MAP': {
        // 4.9 节点级选中：焦点为子节点时按节点出操作集（分支色——自身落盘
        // 整棵子树继承）；根/无焦点走通用（删除 = 删整图）
        if (this.mindService?.isNodeFocused()) {
          return {
            type: vm.type,
            items: [
              {
                id: 'lineColor',
                kind: 'popover',
                label: '分支色',
                value: this.mindService.getFocusedLineColor() ?? '',
                options: swatches(BRANCH_COLORS),
              },
            ],
          };
        }
        return { type: vm.type, items: [] };
      }
      default:
        return { type: vm.type, items: [] };
    }
  }

  /** ActionBar 样式写入：一个事务覆盖全部选中（schema 字段经 zod strip 防越权） */
  updateSelectedStyle(patch: Record<string, unknown>): void {
    const ids = this.selector?.selected$.value ?? [];
    if (ids.length === 0 || !this.viewport?.editable$.value) return;
    // 4.9：脑图节点级选中的样式写入分流（分支色走 MindService 落节点，
    // 不经 widget 级 update——MIND_MAP schema 对树内字段是放行的 z.unknown）
    if (
      ids.length === 1 &&
      typeof patch.lineColor === 'string' &&
      patch.lineColor.startsWith('#')
    ) {
      const vm = this.vmEngine?.getVmById(ids[0]!);
      if (vm?.type === 'MIND_MAP' && this.mindService?.isNodeFocused()) {
        this.mindService.setFocusedNodeColor(patch.lineColor);
        return;
      }
    }
    // 排版档位数值化（option id 是数字串，schema 期望 number——同 lineColor
    // hex 特判的 per-字段分流先例；per-字段条件覆写，不给 patch 引入不存在的键）
    const patch2: Record<string, unknown> = { ...patch };
    if (patch.fontSize !== undefined) patch2.fontSize = Number(patch.fontSize);
    if (patch.strokeWidth !== undefined) patch2.strokeWidth = Number(patch.strokeWidth);
    if (patch.lineHeight !== undefined) patch2.lineHeight = Number(patch.lineHeight);
    this.engine!.transact(() => {
      for (const id of ids) {
        this.engine?.getModelById(id)?.update(patch2 as never);
      }
    });
    if (
      patch2.fontSize !== undefined ||
      patch2.lineHeight !== undefined ||
      patch2.shapeType !== undefined
    ) {
      // 高度重排：autoHeight 只在编辑提交路径触发，外部改字号/行高/切图形类型
      // （内接几何变化，docs/17 §6 autoHeight）需显式重测——在主事务后、
      // stopCapturing 前，reflowHeight 的事务并入同一撤销项
      for (const id of ids) {
        this.textService?.reflowHeight(id);
      }
    }
    this.history?.stopCapturing();
  }

  /** dev 调试用：渲染链各层数量（window.__spinth.__debug）——聚合在
   *  debugSnapshot.ts（Batch 2 拆分第一刀），此处转发 */
  get __debug() {
    return buildDebugSnapshot({
      engine: this.engine as unknown as { modelMapping?: Map<string, unknown> } | null,
      vmMapping:
        (this.vmEngine as unknown as { vmMapping?: Map<string, IBaseWidgetVm> })?.vmMapping ??
        new Map(),
      selector: this.selector as unknown as {
        __selectionFrame?: IRect | null;
        selected$: { value: string[] };
      } | null,
      rectEditor: this.rectEditor as unknown as {
        __editorFrame?: IRect | null;
        __rotateHandle?: { x: number; y: number } | null;
      } | null,
      widgetChildrenCount: this.viewport
        ? (this.viewport as unknown as { widgetLayer: { children: unknown[] } }).widgetLayer
            .children.length
        : 0,
      renderCount: BoardApplication.renderCount,
      textRender: this.textRender as unknown as {
        stats: { registered: number; snapshot: number; text: number };
      } | null,
      culling: this.culling,
      shapeService: this.shapeService,
      defaultToolOptions: { ...this.defaultToolOptionsBs.value },
      eraserService: this.eraserService,
      lineService: this.lineService as unknown as Record<string, unknown> | null,
      refLine: this.refLine,
      shapeTypeOptionIds: SHAPE_TYPE_OPTIONS.map((o) => o.id),
      mindService: this.mindService,
      awareness: this.awareness,
      imageTextures: this.imageTextures,
      assetStore: this.assetStore,
    });
  }

  // ---------- 命令（批 A 迁出至 BoardCommands，此处单行委托） ----------

  setTheme(theme: 'light' | 'dark'): void {
    return this.commands.setTheme(theme);
  }

  setCursorMode(mode: CursorMode): void {
    return this.commands.setCursorMode(mode);
  }

  setDefaultShapeType(t: ShapeType): void {
    return this.commands.setDefaultShapeType(t);
  }

  setDefaultToolOption(tool: CursorMode, key: string, id: string): void {
    return this.commands.setDefaultToolOption(tool, key, id);
  }

  updateEditable(v: boolean): void {
    return this.commands.updateEditable(v);
  }

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate?: boolean): void {
    return this.commands.setPageScale(scale, focus, immediate);
  }

  zoomIn(): void {
    return this.commands.zoomIn();
  }

  zoomOut(): void {
    return this.commands.zoomOut();
  }

  zoomToFit(): void {
    return this.commands.zoomToFit();
  }

  undo(): void {
    return this.commands.undo();
  }

  redo(): void {
    return this.commands.redo();
  }

  removeSelected(): void {
    return this.commands.removeSelected();
  }

  mindAddChild(direction?: 'left' | 'right'): void {
    return this.commands.mindAddChild(direction);
  }

  mindAddSibling(): void {
    return this.commands.mindAddSibling();
  }

  mindDeleteFocused(): void {
    return this.commands.mindDeleteFocused();
  }

  bringToFront(): void {
    return this.commands.bringToFront();
  }

  sendToBack(): void {
    return this.commands.sendToBack();
  }

  bringForward(): void {
    return this.commands.bringForward();
  }

  sendBackward(): void {
    return this.commands.sendBackward();
  }

  alignSelection(mode: AlignMode): void {
    return this.commands.alignSelection(mode);
  }

  exportPNG(mode: 'selection' | 'canvas'): void {
    return this.commands.exportPNG(mode);
  }

  /** 导出当前画布为 .spinth.zip（docs/20 §5.3：门面仅委托） */
  async exportProject(opts?: IProjectExportOptions): Promise<IProjectExportResult> {
    return this.expectProjectFile().exportProject(opts);
  }

  /** 导入项目文件为新的本地画布（docs/20 §7：校验全通过才写库，不触碰当前画布） */
  async importProject(file: Blob, opts?: IProjectImportOptions): Promise<IProjectImportResult> {
    return this.expectProjectFile().importProject(file, opts);
  }

  /** 组装前/释放后调用项目文件门面 → 统一 NOT_READY（与 getDoc 判空同源） */
  private expectProjectFile(): ProjectFileService {
    if (!this.projectFile) {
      throw new ProjectFileError('PROJECT_NOT_READY', '画布未初始化或已释放');
    }
    return this.projectFile;
  }

  distributeSelection(axis: DistributeAxis): void {
    return this.commands.distributeSelection(axis);
  }

  canGroupSelection(): boolean {
    return this.commands.canGroupSelection();
  }

  groupSelection(): void {
    return this.commands.groupSelection();
  }

  canUngroupSelection(): boolean {
    return this.commands.canUngroupSelection();
  }

  ungroupSelection(): void {
    return this.commands.ungroupSelection();
  }

  async copySelected(): Promise<void> {
    return this.commands.copySelected();
  }

  async cutSelected(): Promise<void> {
    return this.commands.cutSelected();
  }

  pasteAt(target: { x: number; y: number }): void {
    return this.commands.pasteAt(target);
  }

  pasteAtScreenCenter(): void {
    return this.commands.pasteAtScreenCenter();
  }

  closeContextMenu(): void {
    return this.commands.closeContextMenu();
  }

  dispose(): void {
    // 幂等（Batch 1 · 1.16）：Board.tsx StrictMode 双挂载会双调 dispose——
    // disposed 标志一刀切（重复 dispose 各服务是未定义行为）
    if (this.disposed) return;
    this.disposed = true;
    // 编辑会话先收口（flush 尾字——先于服务拆序，避免 detach 依赖已拆组件）
    this.editingService?.exitActive();
    this.projectFile?.dispose();
    this.storageStatus?.dispose();
    this.keyboard?.dispose();
    this.clipboard?.dispose();
    this.layer?.dispose();
    this.shapeService?.dispose();
    this.culling?.dispose();
    this.network?.dispose();
    this.awarenessVm?.dispose();
    this.awareness?.dispose();
    this.textRender?.dispose();
    this.rectEditor?.dispose();
    this.refLine?.dispose();
    this.textService?.dispose();
    this.editingService?.dispose();
    this.lineService?.dispose();
    this.penService?.dispose();
    this.eraserService?.dispose();
    this.stickyService?.dispose();
    this.imageService?.dispose();
    this.mindService?.dispose();
    this.contextMenu?.dispose();
    this.selector?.dispose();
    this.history?.dispose();
    this.vmEngine?.dispose(); // 只退订（不逐 VM dispose）——缓存销毁必须自洽
    this.imageTextures?.dispose(); // 无条件销毁全部缓存纹理 + 归还 URL 租约
    this.assetStore?.close(); // 晚于纹理租约归还（revoke 配对完整；已核实
    //   projectFile/storageStatus/imageService 的 dispose 均不依赖本库仍打开）
    this.engine?.dispose();
    this.viewport?.dispose(); // 最后销毁 renderer
    this.registry.dispose();
    this.cullingForgetSub?.unsubscribe();
    this.initialized = false;
  }

  /** @internal 组装/命令层（批 B 三分）共享字段 */
  disposed = false;
  /** @internal 组装/命令层（批 B 三分）共享字段 */
  cullingForgetSub: { unsubscribe(): void } | null = null;
}
