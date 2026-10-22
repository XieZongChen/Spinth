/**
 * @spinth/core — 框架无关的白板 SDK（PIXI 8 + Yjs）。
 * 唯一组合根：BoardSDK（docs/04 §3）。UI 框架经胶水层消费输出流与命令。
 */

import type { BoardSDK } from './app';
export { BoardSDK } from './app';
export type { IBoardConfig } from './app';

// 多选几何命令（docs/05 §7）
export type { AlignMode, DistributeAxis, IDelta } from './platform/selector/alignOps';

// 公共契约（胶水层与测试消费）
export type {
  WsState,
  IBaseModel,
  IBaseWidgetVm,
  IOnStateChangedInfo,
  IWidgetCapabilities,
  CursorMode,
  DocState,
  IPointerEventInfo,
  IViewportService,
  IDataEngineService,
  IVmEngineService,
  ISelectorService,
  IHistoryService,
  ShapeType,
  ShapeData,
  IWidgetData,
  ImageData,
  IActionBarSchema,
  IActionBarItem,
  IActionBarOption,
  ActionBarItemKind,
  IMindAddButtonsState,
} from './types';

// 项目文件契约（docs/20 §5.1——app 壳消费结果/错误类型，schema/常量供测试）
export {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  ProjectManifestSchema,
  DEFAULT_PROJECT_FILE_LIMITS,
} from './types';
export type {
  ProjectAssetEntry,
  ProjectManifest,
  ProjectWarningCode,
  IProjectWarning,
  IProjectStats,
  IProjectExportResult,
  IProjectImportResult,
  IProjectExportOptions,
  IProjectImportOptions,
  ProjectFileLimits,
} from './types';
export { ProjectFileError } from './platform/projectFile/projectFileError';
export type {
  ProjectFileErrorCode,
  IProjectFileErrorDetails,
} from './platform/projectFile/projectFileError';

// 存储状态契约与纯函数（docs/02 §6.1——app 壳经 @spinth/react 消费；格式化单源）
export { INITIAL_STORAGE_STATUS } from './types';
export type {
  StoragePersistence,
  StoragePressure,
  StoragePersistOutcome,
  IStorageStatus,
  IStorageManager,
} from './types';
export { formatBytes, formatPercent } from './platform/storage/storageMath';

// 形状工具默认创建型（docs/04 §2 形状默认型小节——工具坞二级菜单与 ActionBar 同源）
export { SHAPE_TYPE_OPTIONS } from './widgets/shape/shapeService';
// 工具默认参数选项单源（docs/04 §2 工具默认参数节——工具坞二级菜单与 ActionBar 同源）
export { LINE_TYPE_OPTIONS, LINE_WIDTH_OPTIONS } from './widgets/line/lineService';
export { PEN_COLOR_OPTIONS, PEN_WIDTH_OPTIONS } from './widgets/pen/penService';
export { STICKY_COLOR_OPTIONS } from './widgets/sticky/stickyVm';
export { FONT_SIZE_OPTIONS } from './widgets/text/textVm';
export { ERASER_SIZE_OPTIONS } from './widgets/eraser/eraserService';

export { BRANCH_COLORS, branchColorAt } from './widgets/mind/mindMapModel';
export type { IMindNodeSpec } from './widgets/mind/mindMapModel';
export { layoutMindTree } from './widgets/mind/mindLayout';
export type { ILayoutNode, ILayoutResult } from './widgets/mind/mindLayout';
export {
  MIND_ROOT_STYLE,
  MIND_NODE_STYLE,
  MIND_COLORS,
  NODE_MAX_WIDTH,
} from './widgets/mind/mindNodeVm';

/**
 * BoardSDK 的窄公开面（Batch 2 · 类型层收窄，2026-10-18）：宿主集成契约 =
 * 输出流 getter + 查询 + 命令 + 生命周期——@internal 服务字段（组装/命令层
 * 共享面）与 debug 探针不在此面。BoardSDK 类导出保留（组合根与既有宿主
 * 兼容）；宿主可用 `const board: BoardPublicApi = sdk` 收窄依赖防漂移。
 * 运行时收窄（不导出 internal 字段）需破坏性版本化——挂账。
 */
export type BoardPublicApi = Omit<
  BoardSDK,
  | 'viewport'
  | 'engine'
  | 'vmEngine'
  | 'history'
  | 'selector'
  | 'shapeService'
  | 'rectEditor'
  | 'refLine'
  | 'layer'
  | 'group'
  | 'textService'
  | 'editingService'
  | 'lineService'
  | 'penService'
  | 'eraserService'
  | 'stickyService'
  | 'imageService'
  | 'assetStore'
  | 'projectFile'
  | 'storageStatus'
  | 'mindService'
  | 'contextMenu'
  | 'keyboard'
  | 'clipboard'
  | 'textRender'
  | 'spatial'
  | 'culling'
  | 'awareness'
  | 'awarenessVm'
  | 'network'
  | 'registry'
  | 'commands'
  | 'syncToolOption'
  | 'cullingForgetSub'
  | 'initialized'
  | 'disposed'
  | 'mindGhostFallback'
  | 'mindFocusFallback'
  | 'editBlockedFallback'
  | 'ctxMenuFallback'
  | 'dragMoveFallback'
  | 'fallbacks'
  | 'snapshotCompute'
  | 'compactWorkerUsed'
  | '__debug'
>;

// 产品身份常量单一源在 version.ts（docs/20 §5.3：项目文件模块需要版本号，
// 从 index.ts import 会成环）——此处仅 re-export，公共面不变
export { SPINTH_NAME, SPINTH_VERSION, CURRENT_PHASE, type Phase } from './version';
