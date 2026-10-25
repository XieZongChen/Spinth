/**
 * @spinth/react — spinth SDK 的 React 胶水层（docs/12）。
 * 只读镜像（spinthStore）+ 命令（spinthCommands）+ DOM UI 组件。
 */

export { useSpinthStore, type SpinthUiState } from './store/spinthStore';
export { spinthCommands, bindBoard, unbindBoard } from './store/commands';
export { connectBoard } from './store/bridge';
// 项目文件公共面（docs/20 §5.1——app 壳只消费 @spinth/react，经此转发 core 契约）
export {
  ProjectFileError,
  type ProjectFileErrorCode,
  type IProjectExportOptions,
  type IProjectExportResult,
  type IProjectImportOptions,
  type IProjectImportResult,
  type IProjectWarning,
} from '@spinth/core';
// 存储状态公共面（docs/02 §6.1——app 壳只消费 @spinth/react；格式化单源）
export {
  formatBytes,
  formatPercent,
  type IStorageStatus,
  type StoragePersistence,
  type StoragePressure,
} from '@spinth/core';
// 多标签会话公共面（docs/21——app 壳取标签角色；角色不是 SDK 能力，经此转发）
export {
  INITIAL_TAB_SESSION_STATE,
  TabSessionService,
  createBrowserLockPort,
  type ITabSessionState,
} from '@spinth/core';
// 可访问性公共面（specs/a11y-closeout）：app 壳面板定位读安全区；
// useRovingFocus/Announcer（批次 B W1/W4）随后续步骤导出
export { readSafeInsets, parseInsetPx, type ISafeInsets } from './a11y/safeArea';
export { Board } from './components/Board';
export { Toolbar } from './components/Toolbar';
export { ToolFlyout } from './components/ToolFlyout';
export { ZoomControl } from './components/ZoomControl';
export { ContextMenu } from './components/ContextMenu';
export { ActionBar } from './components/ActionBar';
export { MindAddButtons } from './components/MindAddButtons';
export { ToolGhost } from './components/ToolGhost';
export { OfflineBar } from './components/OfflineBar';
export { ErrorBoundary } from './components/ErrorBoundary';
export { ErrorState, type IErrorStateProps } from './components/ErrorState';
export { Icon, type IconName, type IconProps } from './components/Icon';
export { Tooltip } from './components/Tooltip';
