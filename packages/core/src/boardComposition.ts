import type { IBoardConfig } from './boardConfig';
import type { Token } from './platform/registry/serviceRegistry';
import type { IBaseModel, IBaseWidgetVm, IBaseWidgetVm as _IVm } from './types';
import { Rectangle } from 'pixi.js';
import { Tokens } from './tokens';
import { WIDGET_RUNTIME } from './widgetRuntime';
import { ViewportService } from './platform/viewport/viewportService';
import { DataEngineService } from './platform/dataEngine/dataEngineService';
import { VmEngineService } from './platform/vmEngine/vmEngineService';
import { HistoryService } from './platform/history/historyService';
import { TextRenderService } from './platform/textEngine/textRenderService';
import { SelectorService } from './platform/selector/selectorService';
import { RectEditorService } from './platform/rectEditor/rectEditorService';
import { RefLineService } from './platform/refLine/refLineService';
import { LayerService } from './platform/layer/layerService';
import { GroupService } from './platform/selector/groupService';
import { KeyboardService } from './platform/keyboard/keyboardService';
import { ClipboardService } from './platform/clipboard/clipboardService';
import { ContextMenuService } from './platform/contextMenu/contextMenuService';
import { NetworkService } from './platform/network/networkService';
import { AwarenessService } from './platform/awareness/awarenessService';
import { AwarenessVm } from './platform/awareness/awarenessVm';
import { ShapeService } from './widgets/shape/shapeService';
import { TextService } from './widgets/text/textService';
import { EditingService } from './platform/textEngine/editingService';
import { LineService } from './widgets/line/lineService';
import { PenService } from './widgets/pen/penService';
import { EraserService } from './widgets/eraser/eraserService';
import { StickyService } from './widgets/sticky/stickyService';
import { ImageService } from './widgets/image/imageService';
import { ImageVm } from './widgets/image/imageVm';
import { ImageTextureCache } from './widgets/image/imageTextureCache';
import { browserImageCodec } from './widgets/image/imageCodec';
import { MindService } from './widgets/mind/mindService';
import { SpatialIndex } from './platform/spatial/spatialIndex';
import { CullingService } from './platform/spatial/cullingService';
import { AssetStore, assetIdOf, isAssetSrc } from './platform/dataEngine/assetStore';
import { createDocFromSnapshot } from './platform/dataEngine/dbProvider';
import {
  ASSET_MAINTENANCE_DELAY_MS,
  runAssetMaintenance,
} from './platform/dataEngine/assetMigration';
import { ProjectFileService } from './platform/projectFile/projectFileService';
import {
  StorageStatusService,
  createBrowserStorageManager,
} from './platform/storage/storageStatusService';
import { SPINTH_VERSION } from './version';
import type { BoardSDK } from './app';

/**
 * BoardSDK 组装体（Batch 2 · app.ts 三分批 B，2026-10-18）：原 initialize()
 * 275 行组装+接线整体迁出——时序注释原样保留（组装时序是语义：vmEngine 先于
 * engine.initialize 订阅、横切订阅先于恢复数据到达……见各段注释）。
 * sdk 即宿主门面（组装即字段赋值过程——批 B 以 friend 函数形式访问 private
 * 字段；非公开 API，BoardSDK.initialize 是唯一调用方）。
 */
export async function composeBoard(
  sdk: BoardSDK,
  config: IBoardConfig,
  root: HTMLElement,
  throwIfAborted: () => void,
): Promise<void> {
  // 1. 同步构造（vmEngine 必须先于 engine.initialize 订阅，否则 IndexedDB/ws
  //    恢复的数据事件在订阅前发出会被普通 Subject 丢失——刷新恢复失效）
  // 控件 Model/Vm 装配走注册表单循环：加新类型只需 WIDGET_REGISTRY（schema 域）
  // + widgetRuntime.ts 各加一项，此处零改动（specs/api-surface Step 7 三表合一，
  // 此前 token 表/工厂表/手工 register 链多点位重复登记）
  const modelTokens = new Map<string, Token<IBaseModel>>(
    Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.modelToken] as const),
  );
  const vmTokens = new Map<string, Token<IBaseWidgetVm>>(
    Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.vmToken] as const),
  );
  sdk.engine = new DataEngineService(sdk.registry, modelTokens);
  sdk.viewport = new ViewportService();
  // 资产层先于 engine.initialize 创建（P0 修复：onVmCreated$ 注入 resolver
  // 读的是 sdk.assetStore——初始化恢复的 IMAGE VM 创建于 engine.initialize
  // 期间，创建晚了全部错过注入 → 刷新后引用格式图永久灰框）
  sdk.assetStore = new AssetStore();
  // 纹理缓存先于 engine.initialize 创建（恢复期创建的 IMAGE VM 经
  //  onVmCreated$ 注入同一缓存——同图多实例共享一份纹理/一份 URL 计数）
  sdk.imageTextures = new ImageTextureCache(
    {
      open: async (src) => {
        if (!isAssetSrc(src)) return { url: src, release: () => {} };
        const id = assetIdOf(src);
        const url = await sdk.assetStore!.objectURL(id);
        return url ? { url, release: () => sdk.assetStore!.releaseObjectURL(id) } : null; // 资产行缺失 → missing 终态
      },
    },
    browserImageCodec,
  );
  // 纹理服务先于 engine.initialize 注册（IndexedDB 恢复即建 Vm，构造时 resolve；
  // renderer 此刻尚不存在，snapshot 降级 Text 模式，viewport.initialize 后 attach 重评）
  sdk.textRender = new TextRenderService(sdk.viewport);
  sdk.registry
    .registerSingleton(Tokens.DataProcessor, () => sdk.engine!.processor)
    .registerSingleton(Tokens.TextRender, () => sdk.textRender!);
  for (const entry of Object.values(WIDGET_RUNTIME)) {
    sdk.registry
      .register(entry.modelToken, entry.createModel)
      .register(entry.vmToken, entry.createVm);
  }

  sdk.vmEngine = new VmEngineService(
    sdk.engine,
    sdk.registry,
    vmTokens,
    sdk.viewport,
    (sdk.spatial = new SpatialIndex()),
  );
  sdk.vmEngine.initialize();
  // 控件数据变化横切订阅（widgetsChanged$ 广播 + 节点几何变化 → 连线 reattach）。
  // 必须先于 engine.initialize 订阅：onVmCreated$ 是普通 Subject，IndexedDB 恢复的
  // 控件在第 2 步就创建完——订阅晚了会全部漏掉（拖拽松手后 ActionBar 不恢复、
  // 恢复图形拖动连线不跟随，2026-09 用户实测揪出；与 vmEngine 先订同理）。
  // lineService 此时未建，可选链跳过（初始化完成后的变更才会触发 reattach）。
  sdk.vmEngine.onVmCreated$.subscribe((vm) => {
    // 同步注入先于首帧 render（render 在微任务批处理里）——晚了首帧拿不到
    //  端口，引用格式图永久占位。instanceof 直判（无循环依赖）取代旧双断言
    if (vm instanceof ImageVm && sdk.imageTextures) {
      vm.setImageTextures(sdk.imageTextures);
    }
    vm.onStateChanged$.subscribe(({ diff }) => {
      sdk.widgetsChanged$.next();
      if (vm.type === 'LINE') {
        // 线自身几何变化不触发 reattach（防自环）；但 lineType 切回
        // ELBOWED 要重路由（STRAIGHT 期间锚点可能已漂移，2026-09 实测揪出）
        if ('lineType' in diff) sdk.lineService?.rerouteLine(vm.id);
        return;
      }
      const geomChanged = ['x', 'y', 'width', 'height', 'rotation'].some((k) => k in diff);
      if (geomChanged) sdk.lineService?.reattach(vm.id, vm.getHostGeom());
    });
  });
  sdk.textRender.initialize();
  throwIfAborted();

  // 2. 数据恢复（db attach → onModelCreated$ → vmEngine.addWidget 进 widgetLayer，
  //    widgetLayer 是同步字段，此时尚未挂 stage 也安全）
  await sdk.engine.initialize({
    docId: config.docId,
    wsUrl: config.wsUrl,
    userName: config.userName,
    // 只读标签连磁盘写入一起拒绝（docs/21 §4）——editable 从第一帧起就是终值
    writeEnabled: config.editable !== false,
  });
  throwIfAborted();

  // 项目文件门面（docs/20 §5.2）：组合根构造注入（禁全局单例）。getDoc 闭包按
  // docState 判就绪；flushCurrentDoc 包装 persistState 检查——flush 后仍 failed
  // 即 reject，导入层记 CURRENT_DOC_FLUSH_FAILED warning（§5.5）
  sdk.projectFile = new ProjectFileService({
    getDoc: () => {
      const engine = sdk.engine;
      if (!engine || engine.docState$.value !== 'synced') return null;
      return { yDoc: engine.yDoc, yWidgets: engine.yWidgets, docId: config.docId };
    },
    assetStore: sdk.assetStore!,
    appVersion: SPINTH_VERSION,
    createDoc: createDocFromSnapshot,
    flushCurrentDoc: async () => {
      await sdk.engine!.flushLocalWrites();
      if (sdk.engine!.persistState$.value === 'failed') {
        throw new Error('当前文档落盘失败（persistState=failed）');
      }
    },
  });

  // 存储状态服务（docs/02 §6.1）：持久化授权 + 站点配额可见化；无
  // navigator.storage 的环境降级为 unsupported，不影响画布保存
  sdk.storageStatus = new StorageStatusService(createBrowserStorageManager());

  // 3. 渲染就绪（widgetLayer 此时可能已有恢复的控件，首帧即完整）
  await sdk.viewport.initialize(root, { editable: config.editable ?? true });
  throwIfAborted();
  // renderer 就位：纹理服务接入快照生成（此前降级 Text 的 DocDisplay 此处重评）
  sdk.textRender!.attachRenderer(sdk.viewport.renderer!);

  // 4. 交互服务（refLine 与 selector 相互依赖，getter 解环）
  // 视口 culling（docs/16 §1）：vpBounds/数据/创建变化 → renderable 翻转
  // （装配晚于 IndexedDB 恢复，initialize 内立即全量一次）
  sdk.culling = new CullingService(sdk.viewport, sdk.vmEngine, sdk.spatial, [
    sdk.widgetsChanged$,
    sdk.vmEngine.onVmCreated$,
  ]);
  sdk.culling.initialize();
  // 已删件出册（Batch 1 · 1.26）：culled 集合死 id 清理（BoardSDK 无 Disposable
  // 基类——dispose() 里显式退订）
  sdk.cullingForgetSub = sdk.engine.onModelRemoved$.subscribe((ids) => sdk.culling?.forget(ids));
  // 删除也是「文档集合变化」（P0 修复）：widgetsChanged$ 此前只在状态更新时
  // 广播——删件后空态引导不回（bridge 的 modelCount 镜像停在旧值）、ActionBar
  // schema 缓存不失效。invalidate 面统一走本流
  sdk.engine.onModelRemoved$.subscribe(() => sdk.widgetsChanged$.next());
  sdk.history = new HistoryService(sdk.engine);
  sdk.history.initialize();
  sdk.refLine = new RefLineService(sdk.viewport, sdk.vmEngine, () => sdk.selector!, sdk.engine);
  sdk.selector = new SelectorService(
    sdk.viewport,
    sdk.vmEngine,
    sdk.engine,
    sdk.history,
    () => sdk.refLine!,
    () => sdk.group!,
  );
  // 编组（docs/18）：选择聚合层服务——点击扩展/框选口径/建组解组命令
  sdk.group = new GroupService(sdk.engine, sdk.vmEngine, sdk.selector, sdk.history);
  sdk.refLine.initialize();
  sdk.selector.initialize();
  sdk.shapeService = new ShapeService(sdk.viewport, sdk.engine, sdk.history, sdk.selector);
  sdk.shapeService.initialize();
  // 工具默认参数聚合流（docs/04 §2 工具默认参数节）：各 service 流 → 单表
  // （react 单字段镜像 + Toolbar 按 mode 查表——避免 per-tool ×N 样板）
  sdk.shapeService.defaultShapeType$.subscribe((v) => sdk.syncToolOption('shape', 'type', v));
  sdk.rectEditor = new RectEditorService(
    sdk.viewport,
    sdk.vmEngine,
    sdk.selector,
    sdk.engine,
    sdk.history,
    sdk.refLine,
  );
  sdk.rectEditor.initialize();
  sdk.layer = new LayerService(sdk.engine, sdk.vmEngine, sdk.selector, sdk.history);
  // 统一编辑会话（docs/17 批 1：TEXT/STICKY 先接入；LINE 批 2、mind 批 3）
  sdk.editingService = new EditingService(sdk.viewport, sdk.engine, sdk.selector, sdk.history);
  sdk.textService = new TextService(
    sdk.viewport,
    sdk.engine,
    sdk.vmEngine,
    sdk.selector,
    sdk.history,
    sdk.editingService,
  );
  sdk.textService.initialize();
  sdk.textService.defaultFontSize$.subscribe((v) =>
    sdk.syncToolOption('text', 'fontSize', String(v)),
  );
  // 单击已选中的 TEXT/STICKY/SHAPE = 进入编辑（STICKY 共用 TEXT 编辑器——Vm 层
  // 三态协议早有约定、组合根漏接 STICKY 分支曾致便签双击无反应，2026-09-20 补；
  // SHAPE 同通道接入 2026-10-07 docs/17 §6）。
  // LINE **不走单击激活**（2026-09-30 用户拍板：双击连线才进文字编辑——
  // lineService.onLineDblClick 承接；线身单击是段滑移/胶囊手势，selector
  // 兜底激活分支曾把单击转发进编辑，这里删除该转发）
  sdk.selector.onActivate = (id, type, world) => {
    if (type === 'TEXT' || type === 'STICKY' || type === 'SHAPE') sdk.textService?.enterEdit(id);
    // 脑图：再点一次已选中 → 按点击位置命中节点进节点编辑（既有设计同款）
    else if (type === 'MIND_MAP' && world) sdk.mindService?.enterNodeEditAt(id, world);
  };
  sdk.lineService = new LineService(
    sdk.viewport,
    sdk.engine,
    sdk.vmEngine,
    sdk.selector,
    sdk.history,
    sdk.editingService,
  );
  sdk.lineService.defaultLineType$.subscribe((v) => sdk.syncToolOption('line', 'type', v));
  sdk.lineService.defaultStrokeWidth$.subscribe((v) =>
    sdk.syncToolOption('line', 'width', String(v)),
  );
  sdk.lineService.quickAddShapeTypeProbe = () => sdk.shapeService?.defaultShapeType ?? 'rect';
  // 连线手势下探（端点手柄抓取）+ 悬停抑制探针（缩放手势进行中）
  sdk.selector.lineGestureHook = (world) => sdk.lineService?.handleGestureDown(world) ?? false;
  // 拖拽松手的锚定线急切重路由（docs/05 §4.3）：此时 root 仍携带末帧预览位移
  // = 提交后位置，getBounds 直接可用（覆盖 MIND_MAP 宿主——线可锚定整图）；
  // 微任务相（onStateChanged$）的重复 reattach 被 samePoints 同值跳过拦下
  sdk.selector.onDragCommitted = (ids, dx, dy) => {
    if (dx === 0 && dy === 0) return;
    for (const id of ids) {
      const vm = sdk.vmEngine?.getVmById(id);
      if (!vm || vm.type === 'LINE') continue; // 线自身不触发（防自环）
      sdk.lineService?.reattach(id, vm.getHostGeom());
    }
  };
  // 缩放松手的锚定线急切重路由（docs/05 §4.4）：next = commitResize 落库的
  // 目标矩形，与微任务相 reattach 将算出的 bounds 同源；reattach 对无锚定
  // 线的类型（PEN 等）天然 no-op
  sdk.rectEditor.onResizeCommitted = (id, next) => {
    const vm = sdk.vmEngine?.getVmById(id);
    // next = 落库目标局部矩形（rectEditor 语义）；θ 取宿主 state（docs/05 §8）
    sdk.lineService?.reattach(id, { rect: next, rotation: vm?.getRotation() ?? 0 });
  };
  // 旋转手势（docs/05 §8）：拖拽中锚定线实时跟随（用户拍板 2026-10-15——
  // previewFollow 对 root.rotation 预览敏感）；松手急切重路由并同撤销项
  sdk.rectEditor.onRotatePreview = () => sdk.lineService?.previewFollow();
  sdk.rectEditor.onRotateCommitted = (id, theta) => {
    const vm = sdk.vmEngine?.getVmById(id);
    if (!vm) return;
    // θ 用手势参数而非 vm.getRotation()——state 投影是微任务合批，transact
    // 内同步读是旧值（θ 读 0 → samePoints 跳过线写，真写滑到 stopCapturing
    // 之后的微任务相 → undo 裂项，E2E 实锤）；旋转不改 x/y，localRect 可读
    sdk.lineService?.reattach(id, { rect: vm.getLocalRect(), rotation: theta });
  };
  sdk.lineService.busyProbe = () => sdk.rectEditor?.isResizing ?? false;
  sdk.lineService.initialize();
  // 缩放手势期间四向连接点跟随（缩放期 onStateChanged$ 不发射——拖拽同款问题）
  sdk.rectEditor.resizeMove$.subscribe(() => sdk.lineService?.followQuickDots());
  sdk.penService = new PenService(sdk.viewport, sdk.engine, sdk.history);
  sdk.penService.defaultColor$.subscribe((v) => sdk.syncToolOption('pen', 'color', v));
  sdk.penService.defaultStrokeWidth$.subscribe((v) =>
    sdk.syncToolOption('pen', 'width', String(v)),
  );
  sdk.penService.initialize();
  sdk.eraserService = new EraserService(sdk.viewport, sdk.engine, sdk.vmEngine, sdk.history);
  sdk.eraserService.initialize();
  sdk.eraserService.radiusPx$.subscribe((v) => sdk.syncToolOption('eraser', 'size', String(v)));
  sdk.stickyService = new StickyService(sdk.viewport, sdk.engine, sdk.history, sdk.selector);
  sdk.stickyService.initialize();
  sdk.stickyService.defaultColor$.subscribe((v) => sdk.syncToolOption('sticky', 'color', v));
  // 资产层（Batch 2 资产服务首版）：贴图入库、文档只存 spinth-asset:<hash>；
  // AssetStore 本体已在第 1 步前置创建（P0 修复，见上）；vm 创建时注入
  // 解析器（onVmCreated 订阅块接线）
  sdk.imageService = new ImageService(
    sdk.viewport,
    sdk.engine,
    sdk.history,
    sdk.selector,
    sdk.assetStore,
    sdk.vmEngine,
  );
  sdk.imageService.initialize();
  sdk.contextMenu = new ContextMenuService(
    sdk.viewport,
    sdk.selector,
    sdk.vmEngine,
    () => sdk.clipboard !== null && sdk.clipboard.hasBuffer,
    () => sdk.viewport?.cursorMode$.value ?? 'cursor',
  );
  sdk.contextMenu.initialize();
  // 物理断网守卫（docs/10 §4 两态拆分：editBlocked 与 wsState 无关）。
  // blockOnOffline 仅协同模式开（审查 4.7 重评拍板：本地模式 IndexedDB
  // 离线可用，navigator.onLine 误判不该误伤单机编辑）
  sdk.network = new NetworkService({ blockOnOffline: !!config.wsUrl });
  sdk.network.initialize();

  sdk.keyboard = new KeyboardService(sdk.viewport, {
    setCursorMode: (mode) => sdk.setCursorMode(mode),
    zoomIn: () => sdk.zoomIn(),
    zoomOut: () => sdk.zoomOut(),
    zoomTo100: () => sdk.setPageScale(1, undefined, true),
    zoomToFit: () => sdk.zoomToFit(),
    undo: () => {
      if (sdk.viewport!.editable$.value) sdk.undo();
    },
    redo: () => {
      if (sdk.viewport!.editable$.value) sdk.redo();
    },
    removeSelected: () => {
      if (sdk.viewport!.editable$.value) sdk.removeSelected();
    },
    clearSelection: () => {
      sdk.selector?.setSelected([]);
      sdk.setCursorMode('cursor');
    },
    bringForward: () => {
      if (sdk.viewport!.editable$.value) sdk.bringForward();
    },
    sendBackward: () => {
      if (sdk.viewport!.editable$.value) sdk.sendBackward();
    },
    bringToFront: () => {
      if (sdk.viewport!.editable$.value) sdk.bringToFront();
    },
    sendToBack: () => {
      if (sdk.viewport!.editable$.value) sdk.sendToBack();
    },
    groupSelection: () => {
      if (sdk.viewport!.editable$.value) sdk.groupSelection();
    },
    ungroupSelection: () => {
      if (sdk.viewport!.editable$.value) sdk.ungroupSelection();
    },
    nudge: (dx, dy, shift) => sdk.commands.nudgeSelected(dx, dy, shift),
    eraserSize: (delta) => sdk.eraserService?.adjustRadius(delta),
    mindAddChild: () => sdk.mindService?.addChild(),
    mindAddSibling: () => sdk.mindService?.addSibling(),
    mindNavigate: (key) => sdk.mindService?.navigate(key) ?? false,
  });
  sdk.keyboard.isBlocked = () => sdk.network?.editBlocked$.value ?? false;
  (sdk.viewport as ViewportService).isEditBlocked = () => sdk.network?.editBlocked$.value ?? false;
  sdk.keyboard.initialize();
  sdk.clipboard = new ClipboardService(
    sdk.engine,
    sdk.vmEngine,
    sdk.selector,
    sdk.viewport,
    sdk.history,
  );
  sdk.clipboard.initialize();
  sdk.clipboard.onPasteImage = (blob) => sdk.imageService?.pasteImage(blob);
  sdk.clipboard.onPastePlainText = (text) => sdk.textService?.pasteText(text);
  sdk.mindService = new MindService(
    sdk.viewport,
    sdk.engine,
    sdk.vmEngine,
    sdk.selector,
    sdk.history,
    sdk.editingService,
  );
  sdk.mindService.initialize();
  // 脑图节点级拖拽接线（docs/11 §6）：cursor 指针序列按下在非根节点上时
  // 由 MindService 接管——4.4 曾是零调用死代码， roadmap 标 ✅ 但用户拖不动
  sdk.selector.mindDragDelegate = sdk.mindService;
  // 脑图焦点变化（Tab 建子/方向键导航/点击）不改 selected$——选区框
  // 经此驱动重画到焦点节点（单层化后焦点框是节点唯一选中视觉）
  sdk.mindService.focusChanged$.subscribe(() => sdk.selector?.refreshSelectionFrame());

  // awareness（docs/10 §3）：仅协同模式（wsProvider 存在）；本地模式零开销
  const wsProvider = sdk.engine.wsProvider;
  if (wsProvider) {
    sdk.awareness = new AwarenessService(
      wsProvider.awareness,
      sdk.viewport,
      sdk.selector,
      config.userName ?? '匿名',
    );
    sdk.awarenessVm = new AwarenessVm(
      sdk.viewport.optionLayer,
      sdk.viewport.renderer!,
      sdk.awareness,
      sdk.viewport,
      (id) => {
        const vm = sdk.vmEngine?.getVmById(id);
        const b = vm?.getBounds();
        return b ? new Rectangle(b.x, b.y, b.width, b.height) : null;
      },
    );
    // 4.9 节点级选中上报：图 id 在 selectedWidgetIds（既有），节点 id 单独字段
    // （focusChanged$ 随 MindService dispose complete，订阅随之终结）
    sdk.mindService!.focusChanged$.subscribe(() => {
      sdk.awareness!.setMindNodeId(sdk.mindService?.focusedNodeId ?? null);
    });
  }

  sdk.initialized = true;

  // 存储持久化申请（docs/02 §6.1）：浏览器在存储压力下可驱逐 IndexedDB
  // （Safari 尤甚）——启动 refresh 一次，未持久化才申请一次 persist；
  // 失败不抛、不阻塞初始化（此前是 fire-and-forget 丢弃返回值）
  void sdk.storageStatus.initialize().catch(() => {});

  // 资产维护链（Batch 2 二期·单机）：启动 idle 一轮——存量 dataURL 迁移
  // （无条件，幂等）→ 有迁移则 compactNow（旧 dataURL 从盘上历史真正消失）
  // → GC（仅单机态 + 四重安全：undo 栈非空跳过 / 会话启动基线宽限 /
  //   删前重采 refs / Web Locks 单写者——详见 assetGc/第三轮审查处置批）。
  // DEV/测试可关（config.assetMaintenance）——GC 全库扫描在并行页面下是
  // IO 压力源（E2E 曾因此 pagehide 落盘竞态偶红），专项用例显式开启。
  // idle 调度（第三轮审查：固定 3s 定时器撞上启动后的用户交互）+
  // catch 记错（曾静默吞——维护失败不可诊断）。
  // 只读标签不跑维护链（docs/21 §4）：调度与执行前双重断言 editable
  if (config.assetMaintenance !== false && config.editable !== false) {
    const runMaintenance = (): void => {
      const engine = sdk.engine;
      if (sdk.disposed || !engine) return;
      // 双重闸门（docs/21 §4）：与调度条件同源，防未来直接调用绕过调度判定
      if (config.editable === false || config.assetMaintenance === false) return;
      void runAssetMaintenance(sdk, engine, config.docId).catch((err) => {
        console.error('[spinth:asset] 启动维护链失败', err);
      });
    };
    const ric = (
      globalThis as unknown as {
        requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(runMaintenance, { timeout: ASSET_MAINTENANCE_DELAY_MS });
    } else {
      setTimeout(runMaintenance, ASSET_MAINTENANCE_DELAY_MS);
    }
  }
}
