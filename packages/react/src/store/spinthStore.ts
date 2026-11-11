import { create } from 'zustand';
import { CURRENT_PHASE, INITIAL_STORAGE_STATUS, SPINTH_VERSION } from '@spinth/core';
import type {
  CursorMode,
  DocState,
  WsState,
  IActionBarSchema,
  IMindAddButtonsState,
  IStorageStatus,
} from '@spinth/core';

/**
 * 只读镜像 store（docs/12 §2）：状态来源只有 SDK 输出流（bridge 写入），
 * 命令走 spinthCommands（分离模块）。高频几何字段后续拆独立 slice。
 */
export interface SpinthUiState {
  sdkVersion: string;
  currentPhase: number;

  docState: DocState;
  /** ws 连接态（docs/10 §2：off=本地模式；驱动重连提示/同步指示，3.4 消费） */
  wsState: WsState;
  /** 物理断网（阻断编辑；docs/10 §4 两态拆分——与 wsState 无关） */
  editBlocked: boolean;
  /** 画布件数（1.23 空态引导） */
  modelCount: number;
  initError: string | null;
  persistState: 'saved' | 'saving' | 'failed';
  /** 浏览器持久化授权 + 站点配额（docs/02 §6.1——与 persistState 不混同） */
  storageStatus: IStorageStatus;
  cursorMode: CursorMode;
  pageScale: number;
  /** 可视世界坐标矩形（vpBounds$ 镜像；DotGrid 定位用） */
  vpBounds: { x: number; y: number; width: number; height: number } | null;
  isOnline: boolean;
  editable: boolean;

  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  contextMenu: {
    show: boolean;
    x: number;
    y: number;
    onWidget: boolean;
    canPaste: boolean;
    canPrune: boolean;
  };
  /** 选中浮动操作栏（docs/12 §4）：schema + 屏幕坐标外接矩形；拖拽中 bounds 置 null 隐藏 */
  actionBar: {
    schema: IActionBarSchema | null;
    bounds: { x: number; y: number; width: number; height: number } | null;
  };
  /** 脑图焦点节点 +/- 按钮（docs/12 §4）：null = 无焦点/拖拽中隐藏 */
  mindAddButtons: IMindAddButtonsState | null;
  /** mind 幽灵抑制（指针悬停已有脑图——ToolGhost 消费，core 语义镜像） */
  mindGhostSuppressed: boolean;
  /** 工具默认参数聚合（docs/04 §2 工具默认参数节——key = CursorMode；Toolbar 常驻二级菜单/ToolGhost 消费） */
  defaultToolOptions: Record<string, Record<string, string>>;
  /** 网格吸附开关（specs/flowchart-closeout §9.2 视图偏好——ContextMenu 勾选项消费） */
  gridSnap: boolean;
}

export const useSpinthStore = create<SpinthUiState>(() => ({
  sdkVersion: SPINTH_VERSION,
  currentPhase: CURRENT_PHASE,
  docState: 'idle',
  wsState: 'off',
  editBlocked: false,
  modelCount: 0,
  persistState: 'saved',
  storageStatus: INITIAL_STORAGE_STATUS,
  initError: null,
  cursorMode: 'cursor',
  pageScale: 1,
  vpBounds: null,
  isOnline: true,
  editable: true,
  selectedCount: 0,
  canUndo: false,
  canRedo: false,
  contextMenu: { show: false, x: 0, y: 0, onWidget: false, canPaste: false, canPrune: false },
  actionBar: { schema: null, bounds: null },
  mindAddButtons: null,
  gridSnap: false,
  mindGhostSuppressed: false,
  defaultToolOptions: {},
}));
