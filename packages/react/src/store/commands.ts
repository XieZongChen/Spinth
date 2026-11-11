import type {
  AlignMode,
  BoardPublicApi,
  CursorMode,
  DistributeAxis,
  IProjectExportOptions,
  IProjectExportResult,
  IProjectImportOptions,
  IProjectImportResult,
} from '@spinth/core';

/**
 * 命令模块（docs/12 §2）：纯转发 `createBoard()` 公共投影的命令方法，不产生
 * 本地状态、不进 store。Board 组件挂载时 bindBoard，卸载时置空。经
 * `BoardPublicApi` 收窄依赖（specs/api-surface Step 6）——allowlist 漏成员
 * 会在此先编译红。
 */
let board: BoardPublicApi | null = null;

export function bindBoard(sdk: BoardPublicApi): void {
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
  /** 刷新存储状态（docs/02 §6.1——面板打开/窗口可见/写失败时调用） */
  refreshStorageStatus(): void {
    board?.refreshStorageStatus();
  },
  /** 用户手势申请浏览器持久化（docs/02 §6.1——结果经 storageStatus$ 到达） */
  requestStoragePersist(): void {
    board?.requestStoragePersist();
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

  /** 网格吸附开关（specs/flowchart-closeout §9.2 视图偏好——右键菜单勾选项） */
  setGridSnap(on: boolean): void {
    board?.setGridSnap(on);
  },

  /** 清理悬空连线（specs/flowchart-closeout §7.6）：返回删除条数（右键菜单） */
  pruneDanglingLines(): number {
    return board?.pruneDanglingLines() ?? 0;
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
  /** 键盘打开右键菜单（Shift+F10/Menu，specs/a11y-closeout §5.6） */
  openContextMenuFromKeyboard(): void {
    board?.openContextMenuFromKeyboard();
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
  // ---- 项目文件（docs/20 §5.3——薄转发；board 未绑定返回 null 沿用空操作语义） ----
  /** 导出当前画布为 .spinth.zip（纯读） */
  async exportProject(opts?: IProjectExportOptions): Promise<IProjectExportResult | null> {
    return (await board?.exportProject(opts)) ?? null;
  },
  /** 导入项目文件为新画布（校验全通过才写库） */
  async importProject(
    file: Blob,
    opts?: IProjectImportOptions,
  ): Promise<IProjectImportResult | null> {
    return (await board?.importProject(file, opts)) ?? null;
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
