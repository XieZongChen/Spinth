/**
 * BoardSDK 门面基类（specs/api-surface Step 5 行数兜底 rung 2）：17 条输出流
 * getter 与 31 条命令委托上移至此——全部是纯委托（只经 commands / outputs
 * 两个注入点），零自持状态。BoardSDK extends 本类并注入两个字段；运行时
 * 形状不变（继承成员仍在实例原型链上，`in sdk` 与 Pick<BoardSDK, K> 不受
 * 影响）。
 *
 * 本类不 import 任何宿主实现值（BoardCommands/BoardOutputs 仅 type）：
 * 依赖方向 app.ts → boardFacade.ts 单向，无环。
 */
import { BehaviorSubject, Subject } from 'rxjs';
import type { IRect } from './common/geometry';
import type { AlignMode, DistributeAxis } from './platform/selector/alignOps';
import type { CursorMode, ShapeType } from './types';
import type { IContextMenuState } from './platform/contextMenu/contextMenuService';
import type { BoardCommands } from './boardCommands';
import type { BoardOutputs } from './boardStreams';

export abstract class BoardFacade {
  /** 命令区实现——派生类（BoardSDK）字段注入 */
  protected abstract readonly commands: BoardCommands;
  /** 输出流区实现——派生类（BoardSDK）字段注入 */
  protected abstract readonly outputs: BoardOutputs;

  // ---------- 输出流（react 胶水层只读消费；实现在 boardStreams.ts） ----------

  get cursorMode$(): BehaviorSubject<CursorMode> {
    return this.outputs.cursorMode$;
  }

  /** 形状工具默认创建型（会话级，docs/04 §2 形状默认型小节；工具坞二级菜单消费） */
  get defaultShapeType$(): BehaviorSubject<ShapeType> {
    return this.outputs.defaultShapeType$;
  }

  get vpScale$(): BehaviorSubject<number> {
    return this.outputs.vpScale$;
  }

  get vpBounds$(): BehaviorSubject<IRect> {
    return this.outputs.vpBounds$;
  }

  get editable$(): BehaviorSubject<boolean> {
    return this.outputs.editable$;
  }

  get docState$() {
    return this.outputs.docState$;
  }

  /** ws 连接态（docs/10 §2；本地模式恒 'off'） */
  get wsState$() {
    return this.outputs.wsState$;
  }

  /** 物理断网（阻断编辑；ws 断连仅提示不阻断——docs/10 §4）。组装前兜底 false */
  get editBlocked$() {
    return this.outputs.editBlocked$;
  }

  /** 本地落盘态（Batch 1 · 1.15）：failed=写失败退避中（配额满等），
   *  UI 顶栏「已同步」不得再与 wsState 混同 */
  get persistState$() {
    return this.outputs.persistState$;
  }

  /** 浏览器持久化授权 + 站点配额（docs/02 §6.1——与 persistState$ 不混同） */
  get storageStatus$() {
    return this.outputs.storageStatus$;
  }

  get selected$() {
    return this.outputs.selected$;
  }

  get canUndo$() {
    return this.outputs.canUndo$;
  }

  get canRedo$() {
    return this.outputs.canRedo$;
  }

  get contextMenuOptions$(): BehaviorSubject<IContextMenuState> {
    return this.outputs.contextMenuOptions$;
  }

  /** 拖拽进行中通知（ActionBar 隐藏跟随） */
  get dragMove$(): Subject<void> {
    return this.outputs.dragMove$;
  }

  /** mind 幽灵抑制（指针悬停已有脑图）——ToolGhost 消费（2026-09-22 幽灵 DOM 化） */
  get mindGhostSuppressed$(): import('rxjs').BehaviorSubject<boolean> {
    return this.outputs.mindGhostSuppressed$;
  }

  /** 脑图焦点节点变化（导航/建删/点击落点——AddButtons 重算触发器之一） */
  get mindFocusChanged$(): Subject<void> {
    return this.outputs.mindFocusChanged$;
  }

  /** 网格吸附开关（specs/flowchart-closeout §9.2）：视图偏好流（不写文档） */
  get gridSnap$(): BehaviorSubject<boolean> {
    return this.outputs.gridSnap$;
  }

  // ---------- 命令委托（实现在 BoardCommands 及其分块模块） ----------

  setGridSnap(on: boolean): void {
    return this.commands.setGridSnap(on);
  }
  setTheme(theme: 'light' | 'dark'): void {
    return this.commands.setTheme(theme);
  }

  setCursorMode(mode: CursorMode): void {
    return this.commands.setCursorMode(mode);
  }

  setDefaultShapeType(t: ShapeType): void {
    return this.commands.setDefaultShapeType(t);
  }

  setDefaultToolOption(tool: CursorMode, key: string, id: string): void {
    return this.commands.setDefaultToolOption(tool, key, id);
  }

  updateEditable(v: boolean): void {
    return this.commands.updateEditable(v);
  }

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate?: boolean): void {
    return this.commands.setPageScale(scale, focus, immediate);
  }

  zoomIn(): void {
    return this.commands.zoomIn();
  }

  zoomOut(): void {
    return this.commands.zoomOut();
  }

  zoomToFit(): void {
    return this.commands.zoomToFit();
  }

  undo(): void {
    return this.commands.undo();
  }

  redo(): void {
    return this.commands.redo();
  }

  removeSelected(): void {
    return this.commands.removeSelected();
  }

  mindAddChild(direction?: 'left' | 'right'): void {
    return this.commands.mindAddChild(direction);
  }

  mindAddSibling(): void {
    return this.commands.mindAddSibling();
  }

  mindDeleteFocused(): void {
    return this.commands.mindDeleteFocused();
  }

  bringToFront(): void {
    return this.commands.bringToFront();
  }

  sendToBack(): void {
    return this.commands.sendToBack();
  }

  bringForward(): void {
    return this.commands.bringForward();
  }

  sendBackward(): void {
    return this.commands.sendBackward();
  }

  alignSelection(mode: AlignMode): void {
    return this.commands.alignSelection(mode);
  }

  exportPNG(mode: 'selection' | 'canvas'): void {
    return this.commands.exportPNG(mode);
  }

  distributeSelection(axis: DistributeAxis): void {
    return this.commands.distributeSelection(axis);
  }

  canGroupSelection(): boolean {
    return this.commands.canGroupSelection();
  }

  groupSelection(): void {
    return this.commands.groupSelection();
  }

  canUngroupSelection(): boolean {
    return this.commands.canUngroupSelection();
  }

  ungroupSelection(): void {
    return this.commands.ungroupSelection();
  }

  async copySelected(): Promise<void> {
    return this.commands.copySelected();
  }

  async cutSelected(): Promise<void> {
    return this.commands.cutSelected();
  }

  pasteAt(target: { x: number; y: number }): void {
    return this.commands.pasteAt(target);
  }

  pasteAtScreenCenter(): void {
    return this.commands.pasteAtScreenCenter();
  }

  closeContextMenu(): void {
    return this.commands.closeContextMenu();
  }

  /** 键盘打开右键菜单（Shift+F10/Menu 键路径，specs/a11y-closeout §5.6） */
  openContextMenuFromKeyboard(): void {
    return this.commands.openContextMenuFromKeyboard();
  }
}
