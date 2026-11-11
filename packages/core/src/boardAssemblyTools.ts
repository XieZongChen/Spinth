import { Rectangle } from 'pixi.js';
import { KeyboardService } from './platform/keyboard/keyboardService';
import { ClipboardService } from './platform/clipboard/clipboardService';
import { ContextMenuService } from './platform/contextMenu/contextMenuService';
import { NetworkService } from './platform/network/networkService';
import { AwarenessService } from './platform/awareness/awarenessService';
import { AwarenessVm } from './platform/awareness/awarenessVm';
import { PenService } from './widgets/pen/penService';
import { EraserService } from './widgets/eraser/eraserService';
import { StickyService } from './widgets/sticky/stickyService';
import { ImageService } from './widgets/image/imageService';
import { MindService } from './widgets/mind/mindService';
import { countDanglingLines } from './widgets/line/linePrune';
import { ViewportService } from './platform/viewport/viewportService';
import type { IBoardConfig } from './boardConfig';
import type { BoardSDK } from './app';

/**
 * 装配阶段 10：工具与外围服务（specs/split-large-files §4.9 顺序契约步骤 10，
 * 原位置 300–440）。contextMenu 先于 keyboard；mind 先于 awareness。
 */
export function assembleTools(sdk: BoardSDK, config: IBoardConfig): void {
  sdk.penService = new PenService(sdk.viewport!, sdk.engine!, sdk.history!);
  sdk.penService.defaultColor$.subscribe((v) => sdk.syncToolOption('pen', 'color', v));
  sdk.penService.defaultStrokeWidth$.subscribe((v) =>
    sdk.syncToolOption('pen', 'width', String(v)),
  );
  sdk.penService.initialize();
  sdk.eraserService = new EraserService(sdk.viewport!, sdk.engine!, sdk.vmEngine!, sdk.history!);
  sdk.eraserService.initialize();
  sdk.eraserService.radiusPx$.subscribe((v) => sdk.syncToolOption('eraser', 'size', String(v)));
  sdk.stickyService = new StickyService(sdk.viewport!, sdk.engine!, sdk.history!, sdk.selector!);
  sdk.stickyService.initialize();
  sdk.stickyService.defaultColor$.subscribe((v) => sdk.syncToolOption('sticky', 'color', v));
  // 资产层（Batch 2 资产服务首版）：贴图入库、文档只存 spinth-asset:<hash>；
  // AssetStore 本体已在第 1 步前置创建（P0 修复，见上）；vm 创建时注入
  // 解析器（onVmCreated 订阅块接线）
  sdk.imageService = new ImageService(
    sdk.viewport!,
    sdk.engine!,
    sdk.history!,
    sdk.selector!,
    sdk.assetStore!,
    sdk.vmEngine!,
  );
  sdk.imageService.initialize();
  sdk.contextMenu = new ContextMenuService(
    sdk.viewport!,
    sdk.selector!,
    sdk.vmEngine!,
    () => sdk.clipboard !== null && sdk.clipboard.hasBuffer,
    () => sdk.viewport?.cursorMode$.value ?? 'cursor',
    () => sdk.editingService?.exitActive(),
    // 断头线计数（specs/flowchart-closeout §7.6）：右键菜单「清理悬空连线」禁用态
    () =>
      countDanglingLines({
        getAllVms: () => sdk.vmEngine?.getAllVms() ?? [],
        getModelById: (id) => sdk.engine?.getModelById(id),
      }),
  );
  sdk.contextMenu.initialize();
  // 物理断网守卫（docs/10 §4 两态拆分：editBlocked 与 wsState 无关）。
  // blockOnOffline 仅协同模式开（审查 4.7 重评拍板：本地模式 IndexedDB
  // 离线可用，navigator.onLine 误判不该误伤单机编辑）
  sdk.network = new NetworkService({ blockOnOffline: !!config.wsUrl });
  sdk.network.initialize();

  sdk.keyboard = new KeyboardService(sdk.viewport!, {
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
    mindAddChild: () => sdk.mindService?.addChild() ?? false,
    mindAddSibling: () => sdk.mindService?.addSibling() ?? false,
    mindNavigate: (key) => sdk.mindService?.navigate(key) ?? false,
  });
  sdk.keyboard.isBlocked = () => sdk.network?.editBlocked$.value ?? false;
  // UI 模态浮层快捷键闸门（specs/a11y-closeout §5.5/§13.5-1）：右键菜单或
  // 宿主浮层（项目菜单/存储面板）任一开着，hotkeys 全静默（D3——菜单内容
  // 基于打开瞬间的选中集，撤销/删除会让它指向已失效对象）。宿主谓词经
  // config 注入（@spinth/react 的 data-spinth-ui-modal 标记查询）。
  // 闭包惰性引用 contextMenu（先于此构造，顺序已有注释）
  sdk.keyboard.isUiModalOpen = () =>
    (sdk.contextMenu?.options$.value.show ?? false) || (config.isUiModalOpen?.() ?? false);
  (sdk.viewport as ViewportService).isEditBlocked = () => sdk.network?.editBlocked$.value ?? false;
  sdk.keyboard.initialize();
  sdk.clipboard = new ClipboardService(
    sdk.engine!,
    sdk.vmEngine!,
    sdk.selector!,
    sdk.viewport!,
    sdk.history!,
  );
  sdk.clipboard.initialize();
  sdk.clipboard.onPasteImage = (blob) => sdk.imageService?.pasteImage(blob);
  sdk.clipboard.onPastePlainText = (text) => sdk.textService?.pasteText(text);
  sdk.mindService = new MindService(
    sdk.viewport!,
    sdk.engine!,
    sdk.vmEngine!,
    sdk.selector!,
    sdk.history!,
    sdk.editingService!,
  );
  sdk.mindService.initialize();
  // 脑图节点级拖拽接线（docs/11 §6）：cursor 指针序列按下在非根节点上时
  // 由 MindService 接管——4.4 曾是零调用死代码， roadmap 标 ✅ 但用户拖不动
  sdk.selector!.mindDragDelegate = sdk.mindService;
  // 脑图焦点变化（Tab 建子/方向键导航/点击）不改 selected$——选区框
  // 经此驱动重画到焦点节点（单层化后焦点框是节点唯一选中视觉）
  sdk.mindService.focusChanged$.subscribe(() => sdk.selector?.refreshSelectionFrame());

  // awareness（docs/10 §3）：仅协同模式（wsProvider 存在）；本地模式零开销
  const wsProvider = sdk.engine!.wsProvider;
  if (wsProvider) {
    sdk.awareness = new AwarenessService(
      wsProvider.awareness,
      sdk.viewport!,
      sdk.selector!,
      config.userName ?? '匿名',
    );
    sdk.awarenessVm = new AwarenessVm(
      sdk.viewport!.optionLayer,
      sdk.viewport!.renderer!,
      sdk.awareness,
      sdk.viewport!,
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
}
