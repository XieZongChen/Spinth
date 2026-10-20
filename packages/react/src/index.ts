/**
 * @spinth/react — spinth SDK 的 React 胶水层（docs/12）。
 * 只读镜像（spinthStore）+ 命令（spinthCommands）+ DOM UI 组件。
 */

export { useSpinthStore, type SpinthUiState } from './store/spinthStore';
export { spinthCommands, bindBoard, unbindBoard } from './store/commands';
export { connectBoard } from './store/bridge';
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
export { Icon, type IconName, type IconProps } from './components/Icon';
export { Tooltip } from './components/Tooltip';
