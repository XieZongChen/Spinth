/**
 * BoardSDK 公共面 allowlist（specs/api-surface §3.7）：宿主可依赖的**唯一**
 * 名单——公开面 = 门面合同（生命周期 + 输出流 + 查询 + 命令）；内部 = 服务
 * 字段、组装态、调试探针、兜底字段、仅组合根用的写通道（syncToolOption）。
 *
 * 三条编译期分类锁堵旧 Omit blocklist 的两个洞：
 * - 新增成员未归类 → `_BoardKeysClassified` 红（不是静默公开）；
 * - 名单写了不存在的成员（拼写错误，Omit 对幽灵键静默放行的教训）→
 *   `_BoardKeysExist` 红。
 * 类型 + 运行时双层收窄（specs/runtime-narrowing §3.3）：类型层是下方的
 * `Readonly<Pick>`；运行时层是 `projectBoardPublicApi`——只把 allowlist 成员
 * 定义到冻结投影上，内部字段不可枚举、不可读、不可调用。
 */
import type { BoardSDK } from './app';

export const BOARD_PUBLIC_MEMBERS = [
  // 生命周期
  'initialize',
  'dispose',
  // 输出流（20）
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
  'gridSnap$',
  // 查询（6）
  'modelCount',
  'getSelectionBounds',
  'defaultShapeType',
  'toScreenPoint',
  'getMindAddButtons',
  'getActionBarSchema',
  // 命令（39）
  'setTheme',
  'setCursorMode',
  'setDefaultShapeType',
  'setGridSnap',
  'setDefaultToolOption',
  'updateEditable',
  'zoomIn',
  'zoomOut',
  'setPageScale',
  'undo',
  'redo',
  'zoomToFit',
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
  'pruneDanglingLines',
] as const satisfies readonly (keyof BoardSDK)[];

export type BoardPublicMember = (typeof BOARD_PUBLIC_MEMBERS)[number];

/** 非公共成员：服务字段、组装/调试/兜底、仅组合根使用的方法 */
export type BoardInternalMember =
  | 'registry'
  | 'commands'
  | 'viewport'
  | 'edgeScroll'
  | 'engine'
  | 'vmEngine'
  | 'history'
  | 'gridSnap'
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
  | 'disposed'
  | 'cullingForgetSub'
  | 'gridSnapPersistSub';

export type BoardPublicApi = Readonly<Pick<BoardSDK, BoardPublicMember>>;

/**
 * 运行时 allowlist：只把 BOARD_PUBLIC_MEMBERS 定义到投影上（specs/runtime-narrowing §3.3）。
 * - 方法：首次读取时 bind(source)，缓存函数身份；宿主拿不到未绑定 this。
 * - 流/查询 getter：每次读取都 Reflect.get(source)，保证组装前后切换真实流
 *  （BoardFacade 的流 getter 组装前回退 fallback 流，投影不能在构造时快照）。
 * - 未知键不进投影；Object.freeze 后不可新增/删除/改写。
 * 参数类型用 BoardPublicApi 而不是 BoardSDK：本文件对 app.ts 保持纯类型依赖，
 * BoardSDK 结构上满足该类型。
 */
export function projectBoardPublicApi(source: BoardPublicApi): BoardPublicApi {
  const api: Record<string, unknown> = {};
  const bound = new Map<string, (...args: unknown[]) => unknown>();

  for (const key of BOARD_PUBLIC_MEMBERS) {
    if (!(key in source)) {
      throw new Error(`BOARD_PUBLIC_MEMBER_MISSING: ${key}`);
    }
    Object.defineProperty(api, key, {
      enumerable: true,
      configurable: false,
      get() {
        const value: unknown = Reflect.get(source as object, key);
        if (typeof value !== 'function') return value;
        let fn = bound.get(key);
        if (!fn) {
          fn = value.bind(source) as (...args: unknown[]) => unknown;
          bound.set(key, fn);
        }
        return fn;
      },
    });
  }
  return Object.freeze(api) as unknown as BoardPublicApi;
}

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
