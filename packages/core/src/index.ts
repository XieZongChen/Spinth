/**
 * @spinth/core — 框架无关的白板 SDK（PIXI 8 + Yjs）。
 * 唯一公开构造入口 createBoard()（docs/04 §3）；UI 框架经胶水层消费输出流与命令。
 */

// zod 运行时配置（jitless）必须先于任何 schema parse 执行（common/zodRuntime.ts）
import './common/zodRuntime';

// 唯一公开构造入口：返回 BOARD_PUBLIC_MEMBERS 冻结投影（specs/runtime-narrowing
// §3.4）；内部组合根类 BoardSDK 不导出（core 单测与 friend 装配走 src/app.ts）
export { createBoard } from './createBoard';
export type { IBoardConfig } from './boardConfig';

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

// 多标签写者会话（docs/21——app 壳消费的宿主工具，角色不是 SDK 能力，
// 不进 BoardPublicApi，也不挂 BoardSDK）
export { TabRoleSchema, INITIAL_TAB_SESSION_STATE } from './types';
export type { TabRole, ITabSessionState, ITabLockHandle, ITabLockPort } from './types';
export {
  TabSessionService,
  TAB_LOCK_PREFIX,
  PROMOTION_DELAY_MS,
  PROMOTION_FALLBACK_MS,
} from './platform/tabSession/tabSessionService';
export type { ITabSessionOptions } from './platform/tabSession/tabSessionService';
export { createBrowserLockPort } from './platform/tabSession/browserLockPort';

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
 * 宿主公共面 = 生命周期 + 输出流 + 查询 + 命令——由 boardPublicApi.ts 的
 * `BOARD_PUBLIC_MEMBERS` allowlist 显式列举（新增公开成员必须手动加表，
 * 未归类成员令 typecheck 红，分类编译锁见彼处三条 `_BoardKeys*`）。
 * 类型与运行时同源收窄：createBoard() 返回该 allowlist 的冻结投影，
 * internal 服务字段不可枚举、不可读、不可调用（specs/runtime-narrowing）；
 * DEV 调试入口经 @spinth/core/dev 子路径，不在此面。
 */
export type { BoardPublicApi, BoardPublicMember } from './boardPublicApi';
export { BOARD_PUBLIC_MEMBERS } from './boardPublicApi';

// 产品身份常量单一源在 version.ts（docs/20 §5.3：项目文件模块需要版本号，
// 从 index.ts import 会成环）——此处仅 re-export，公共面不变
export { SPINTH_NAME, SPINTH_VERSION, CURRENT_PHASE, type Phase } from './version';
