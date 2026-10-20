import type { AlignMode, BoardSDK, CursorMode, DistributeAxis } from '@spinth/core';

/**
 * 命令模块（docs/12 §2）：纯转发 BoardSDK 方法，不产生本地状态、不进 store。
 * Board 组件挂载时 bindBoard，卸载时置空。
 */
let board: BoardSDK | null = null;

export function bindBoard(sdk: BoardSDK): void {
  board = sdk;
}

export function unbindBoard(): void {
  board = null;
}

export const spinthCommands = {
  setCursorMode(mode: CursorMode): void {
    board?.setCursorMode(mode);
  },
  /** 工具坞常驻二级菜单聚合写通道（按工具分发到各 service setter，docs/04 §2——会话级不持久化） */
  setDefaultToolOption(tool: CursorMode, key: string, id: string): void {
    board?.setDefaultToolOption(tool, key, id);
  },
  setPageScale(scale: number): void {
    board?.setPageScale(scale);
  },
  zoomIn(): void {
    board?.zoomIn();
  },
  zoomOut(): void {
    board?.zoomOut();
  },
  zoomToFit(): void {
    board?.zoomToFit();
  },
  undo(): void {
    board?.undo();
  },
  /** 手动重试本地落盘（Batch 1 · 1.15：保存失败徽标入口，幂等） */
  retryPersist(): void {
    board?.retryPersist();
  },
  redo(): void {
    board?.redo();
  },
  removeSelected(): void {
    board?.removeSelected();
  },
  async copySelected(): Promise<void> {
    await board?.copySelected();
  },
  async cutSelected(): Promise<void> {
    await board?.cutSelected();
  },
  /** 粘贴到当前视口中心（右键菜单用；带坐标粘贴走 SDK pasteAt） */
  pasteAtCenter(): void {
    board?.pasteAtScreenCenter();
  },
  bringToFront(): void {
    board?.bringToFront();
  },
  sendToBack(): void {
    board?.sendToBack();
  },
  closeContextMenu(): void {
    board?.closeContextMenu();
  },
  /** ActionBar 样式写入（schema 字段；一个事务覆盖全部选中） */
  updateSelectedStyle(patch: Record<string, unknown>): void {
    board?.updateSelectedStyle(patch);
  },
  // ---- 多选几何命令（ActionBar 多选八键，docs/05 §7） ----
  /** 对齐六向（以参与集最小包围盒为基准；锚定线不参与） */
  alignSelection(mode: AlignMode): void {
    board?.alignSelection(mode);
  },
  /** 导出 PNG（docs/03 §8）：selection = 选中集，canvas = 整画布 */
  exportPNG(mode: 'selection' | 'canvas'): void {
    board?.exportPNG(mode);
  },
  /** 分布两向（等距化相邻间隙，两端不动；≥3 参与者） */
  distributeSelection(axis: DistributeAxis): void {
    board?.distributeSelection(axis);
  },
  // ---- 编组（docs/18 §3；快捷键在 core keyboard 层，此处为 ActionBar 入口） ----
  /** 编组：选中 ≥2 且全可组（自由元素） */
  groupSelection(): void {
    board?.groupSelection();
  },
  /** 解组：选中集涉及任一组即整组解 */
  ungroupSelection(): void {
    board?.ungroupSelection();
  },
  // ---- 脑图节点（MindAddButtons 入口，docs/11 §8） ----
  /** 建子节点并聚焦；根下 direction 决定侧向 */
  mindAddChild(direction?: 'left' | 'right'): void {
    board?.mindAddChild(direction);
  },
  /** 建同级节点并聚焦 */
  mindAddSibling(): void {
    board?.mindAddSibling();
  },
  /** 删焦点节点（根 = 删整图） */
  mindDeleteFocused(): void {
    board?.mindDeleteFocused();
  },
};
