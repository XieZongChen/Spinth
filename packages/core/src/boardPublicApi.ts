/**
 * BoardSDK 公共面 allowlist（specs/api-surface §3.7）：宿主可依赖的**唯一**
 * 名单——公开面 = 门面合同（生命周期 + 输出流 + 查询 + 命令）；内部 = 服务
 * 字段、组装态、调试探针、兜底字段、仅组合根用的写通道（syncToolOption）。
 *
 * 三条编译期分类锁堵旧 Omit blocklist 的两个洞：
 * - 新增成员未归类 → `_BoardKeysClassified` 红（不是静默公开）；
 * - 名单写了不存在的成员（拼写错误，Omit 对幽灵键静默放行的教训）→
 *   `_BoardKeysExist` 红。
 * 仅类型层收窄：运行时仍导出完整类（运行时收窄需破坏性版本，挂账）。
 */
import type { BoardSDK } from './app';

export const BOARD_PUBLIC_MEMBERS = [
  // 生命周期
  'initialize',
  'dispose',
  // 输出流（19）
  'widgetsChanged$',
  'cursorMode$',
  'defaultShapeType$',
  'defaultToolOptions$',
  'vpScale$',
  'vpBounds$',
  'editable$',
  'docState$',
  'wsState$',
  'editBlocked$',
  'persistState$',
  'storageStatus$',
  'selected$',
  'canUndo$',
  'canRedo$',
  'contextMenuOptions$',
  'dragMove$',
  'mindGhostSuppressed$',
  'mindFocusChanged$',
  // 查询（6）
  'modelCount',
  'defaultShapeType',
  'getSelectionBounds',
  'toScreenPoint',
  'getMindAddButtons',
  'getActionBarSchema',
  // 命令（38）
  'setTheme',
  'setCursorMode',
  'setDefaultShapeType',
  'setDefaultToolOption',
  'updateEditable',
  'setPageScale',
  'zoomIn',
  'zoomOut',
  'zoomToFit',
  'undo',
  'redo',
  'removeSelected',
  'mindAddChild',
  'mindAddSibling',
  'mindDeleteFocused',
  'bringToFront',
  'sendToBack',
  'bringForward',
  'sendBackward',
  'alignSelection',
  'distributeSelection',
  'groupSelection',
  'ungroupSelection',
  'canGroupSelection',
  'canUngroupSelection',
  'copySelected',
  'cutSelected',
  'pasteAt',
  'pasteAtScreenCenter',
  'closeContextMenu',
  'openContextMenuFromKeyboard',
  'updateSelectedStyle',
  'exportPNG',
  'exportProject',
  'importProject',
  'retryPersist',
  'refreshStorageStatus',
  'requestStoragePersist',
] as const satisfies readonly (keyof BoardSDK)[];

export type BoardPublicMember = (typeof BOARD_PUBLIC_MEMBERS)[number];

/** 非公共成员：服务字段、组装/调试/兜底、仅组合根使用的方法 */
export type BoardInternalMember =
  | 'registry'
  | 'commands'
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
  | 'imageTextures'
  | 'lastAssetMaintenance'
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
  | 'projectFile'
  | 'storageStatus'
  | 'initialized'
  | 'syncToolOption'
  | '__debug'
  | 'disposed'
  | 'cullingForgetSub';

export type BoardPublicApi = Pick<BoardSDK, BoardPublicMember>;

// —— 编译期分类锁：任一约束不满足，tsc 在别名声明处报错 ——
// 私有成员（defaultToolOptionsBs/outputs 等）不在 keyof BoardSDK 里，无需分类。
type AssertNever<T extends never> = T;
type Classified = BoardPublicMember | BoardInternalMember;

/** 新增了成员但没归类 */
export type _BoardKeysClassified = AssertNever<Exclude<keyof BoardSDK, Classified>>;
/** 同一成员既公开又内部 */
export type _BoardKeysDisjoint = AssertNever<Extract<BoardPublicMember, BoardInternalMember>>;
/** 名单写了不存在的成员（拼写错误） */
export type _BoardKeysExist = AssertNever<Exclude<Classified, keyof BoardSDK>>;
