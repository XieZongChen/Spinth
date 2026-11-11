import type { ShapeType, LineType, CursorMode } from './types';
import { setTextTheme } from './platform/textEngine/theme';
import type { AlignMode, DistributeAxis } from './platform/selector/alignOps';
import type { ICollapsedPart } from './platform/selector/groupOps';
import type { IBoardCommandHost } from './boardHost';
import {
  alignSelection as alignSelectionImpl,
  distributeSelection as distributeSelectionImpl,
  nudgeSelected as nudgeSelectedImpl,
  collectCollapsedParticipants as collectCollapsedParticipantsImpl,
  type IAlignParticipant,
} from './alignCommands';
import { exportPNG as exportPNGImpl } from './exportCommand';

/**
 * BoardSDK 命令区（Batch 2 · app.ts 三分批 A，2026-10-18）：原门面 856-1192 行
 * 命令方法整体迁出——BoardSDK 保留同名单行委托（公开 API 与桩测注入面零改动）。
 * ctx 是宿主 BoardSDK 的窄引用（服务字段直读——组装完成即非空，访问式与原
 * 门面 optional chaining 等价）。
 * 对齐/分布/微移族在 alignCommands.ts、PNG 导出在 exportCommand.ts
 * （specs/api-surface Step 4）——本类只留委托与剩余命令；实现导入带 Impl
 * 后缀，避免与同名委托方法混淆（防未来重构误递归）。
 */
export class BoardCommands {
  /** 宿主窄契约（IBoardCommandHost——字段名即契约；type-only import，
   *  避免 app.ts ↔ boardCommands.ts 值环） */
  constructor(private ctx: IBoardCommandHost) {}

  /** 主题切换（app 壳 theme.ts 的 applyTheme 时机调用——core 默认文字色随之；
   *  refreshAll 强制重画，textVm 以主题版本守卫判定全量重建，docs/17 C2） */
  setTheme(theme: 'light' | 'dark'): void {
    setTextTheme(theme);
    this.ctx.vmEngine?.refreshAll();
  }

  setCursorMode(mode: CursorMode): void {
    // 只读钳制（docs/21 §4）：宿主可编程调写工具时落为 cursor，视图工具
    // （cursor/hand）放行——否则 UI 宣称"可以画"（ToolGhost/二级菜单）而
    // viewport 已丢弃全部指针。无 viewport（未组装/桩）不钳制；空格临时抓手
    // 走 ViewportService 内部直调，不经此闸门
    const vp = this.ctx.viewport;
    const target =
      vp && !vp.editable$.value && mode !== 'cursor' && mode !== 'hand' ? 'cursor' : mode;
    // 同模式切换不清选区（工具栏重复点击「选择」曾把选区抹掉——脑图 Tab/Enter
    // 依赖「MIND_MAP 在选区中」，静默失效，2026-09 Phase 4 审查实测揪出）；
    // 换工具才清——工具语义切换本来就该丢弃当前选中上下文
    if (vp?.cursorMode$.value !== target) {
      this.ctx.selector?.setSelected([]);
    }
    vp?.setCursorMode(target);
  }

  /** 工具坞二级菜单 → 形状默认创建型（zod 校验在 service；会话级不持久化） */
  setDefaultShapeType(t: ShapeType): void {
    this.ctx.shapeService?.setDefaultShapeType(t);
  }

  /** 工具坞二级菜单聚合写通道（按工具+参数分发到各 service setter，docs/04 §2；
   *  线宽笔宽批起一工具多参数——嵌套键分发） */
  setDefaultToolOption(tool: CursorMode, key: string, id: string): void {
    if (tool === 'shape' && key === 'type')
      this.ctx.shapeService?.setDefaultShapeType(id as ShapeType);
    else if (tool === 'line' && key === 'type')
      this.ctx.lineService?.setDefaultLineType(id as LineType);
    else if (tool === 'line' && key === 'width')
      this.ctx.lineService?.setDefaultStrokeWidth(Number(id));
    else if (tool === 'pen' && key === 'color') this.ctx.penService?.setDefaultPenColor(id);
    else if (tool === 'pen' && key === 'width')
      this.ctx.penService?.setDefaultStrokeWidth(Number(id));
    else if (tool === 'sticky' && key === 'color')
      this.ctx.stickyService?.setDefaultStickyColor(id);
    else if (tool === 'text' && key === 'fontSize')
      this.ctx.textService?.setDefaultFontSize(Number(id));
    else if (tool === 'eraser' && key === 'size') this.ctx.eraserService?.setRadius(Number(id));
  }

  /** 网格吸附开关（specs/flowchart-closeout §9.2）：视图偏好——不写文档、
   *  不受只读态限制（只读可开关）；持久化由组装层订阅写 localStorage */
  setGridSnap(on: boolean): void {
    this.ctx.gridSnap?.setEnabled(on);
  }

  updateEditable(v: boolean): void {
    if (v) {
      // 切回可写：只翻闸门 + 恢复写，不恢复工具/选区（无记忆，简单且可预期）
      this.ctx.viewport?.editable$.next(true);
      this.ctx.engine?.setWriteEnabled(true);
      return;
    }
    // 只读降级序列（docs/21 §4）——顺序本身是语义：
    // ① 退编辑会话：开着编辑器转只读会留下可输入的 DOM 而命令层已全禁，
    //    先 flush 收口（可能刚产生一次文本提交，必须先于⑤的拒写）
    this.ctx.editingService?.exitActive();
    // ② 手势收口（恰好一次，不双 cancel）：viewport 路由的手势——写工具 →
    //    setCursorMode('cursor')（viewport 内部对旧模式发 dispatchGestureCancel）；
    //    已 cursor/hand → 直接 cancel 当前模式（取消框选蓝框/抓手拖拽）。只读
    //    闸门(:290)会吞掉后续 up，不收口则交互状态机悬挂在半路。rectEditor 的
    //    缩放/旋转是 window 级监听（不经 viewport handlers），闸门打不到——
    //    单独显式取消（不取消则抬手仍会 commitResize/commitRotate 写库）
    this.ctx.rectEditor?.cancelGesture();
    const mode = this.ctx.viewport?.cursorMode$.value;
    if (mode && mode !== 'cursor' && mode !== 'hand') {
      this.ctx.viewport?.setCursorMode('cursor');
    } else {
      this.ctx.viewport?.dispatchGestureCancel(mode ?? 'cursor');
    }
    // ③ 先翻闸门：其后所有派生状态（工具坞/菜单/schema 拉取）第一次计算就
    //    看到只读，不存在"先可写一帧"
    this.ctx.viewport?.editable$.next(false);
    // ④ 清选区：选区框/ActionBar/MindAddButtons 连带消失（②若走了
    //    setCursorMode 已顺带清一次，这里幂等）；关掉已打开的右键菜单
    //    （元素菜单的写项在只读下全 no-op，开着只剩死按钮）
    this.ctx.selector?.setSelected([]);
    this.ctx.contextMenu?.close();
    // ⑤ 磁盘兜底最后联动（docs/21 §4）：UI 闸门 + writeEnabled 拒写同时生效
    this.ctx.engine?.setWriteEnabled(false);
  }

  /** 写命令统一只读守卫（Batch 1 · 1.13）：键盘 handler 层有闸门，但 react
   *  命令面（ActionBar/右键菜单）与宿主直调不经键盘——命令层自守不可绕过 */
  private assertEditable(): boolean {
    return !!this.ctx.viewport?.editable$.value;
  }

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate?: boolean): void {
    this.ctx.viewport?.setPageScale(scale, focus, immediate);
  }

  zoomIn(): void {
    this.ctx.viewport?.zoomIn();
  }

  zoomOut(): void {
    this.ctx.viewport?.zoomOut();
  }

  zoomToFit(): void {
    this.ctx.viewport?.zoomToFit();
  }

  undo(): void {
    if (!this.assertEditable()) return;
    this.ctx.history?.undo();
  }

  redo(): void {
    if (!this.assertEditable()) return;
    this.ctx.history?.redo();
  }

  removeSelected(): void {
    if (!this.assertEditable()) return;
    // 4.9：单选脑图且焦点为子节点 → 删节点（删根/整图仍走通用路径删整图）
    if (this.ctx.mindService?.isNodeFocused()) {
      this.ctx.mindService.deleteFocused();
      return;
    }
    this.ctx.selector?.removeSelected();
  }

  // ---- 脑图节点（MindAddButtons / 快捷键共用入口，docs/11 §8） ----

  /** 建子节点并聚焦；根下 direction 决定侧向（Tab 不传 = 默认右侧） */
  mindAddChild(direction?: 'left' | 'right'): void {
    if (!this.assertEditable()) return;
    this.ctx.mindService?.addChild(direction);
  }

  /** 建同级节点并聚焦 */
  mindAddSibling(): void {
    if (!this.assertEditable()) return;
    this.ctx.mindService?.addSibling();
  }

  /** 删焦点节点（根 = 删整图） */
  mindDeleteFocused(): void {
    if (!this.assertEditable()) return;
    this.ctx.mindService?.deleteFocused();
  }

  bringToFront(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('front');
  }

  sendToBack(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('back');
  }

  bringForward(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('forward');
  }

  sendBackward(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('backward');
  }

  /** 键盘微移（docs/09 §2）——实现在 alignCommands.ts（specs/api-surface Step 4） */
  nudgeSelected(dx: number, dy: number, _shift: boolean): void {
    nudgeSelectedImpl(this.ctx, dx, dy, _shift);
  }

  /** 多选几何命令：对齐六向（docs/05 §7）——实现在 alignCommands.ts */
  alignSelection(mode: AlignMode): void {
    alignSelectionImpl(this.ctx, mode);
  }

  /** 导出 PNG（docs/03 §8）——实现在 exportCommand.ts */
  exportPNG(mode: 'selection' | 'canvas'): void {
    exportPNGImpl(this.ctx, mode);
  }

  /** 多选几何命令：分布两向——实现在 alignCommands.ts */
  distributeSelection(axis: DistributeAxis): void {
    distributeSelectionImpl(this.ctx, axis);
  }

  /** 编组（docs/18 §3.1）：Mod+G / ActionBar「编组」入口；≥2 全可组才建 */
  canGroupSelection(): boolean {
    return this.ctx.group?.canGroupSelection() ?? false;
  }

  groupSelection(): void {
    if (!this.ctx.viewport?.editable$.value) return;
    this.ctx.group?.groupSelection();
  }

  /** 解组（docs/18 §3.2）：Mod+Shift+G；选中集涉及任一组即整组解 */
  canUngroupSelection(): boolean {
    return this.ctx.group?.canUngroupSelection() ?? false;
  }

  ungroupSelection(): void {
    if (!this.ctx.viewport?.editable$.value) return;
    this.ctx.group?.ungroupSelection();
  }

  /** 参与集 + 组折叠（docs/18 §5，ActionBar 多选禁用态消费）——实现在
   *  alignCommands.ts（specs/api-surface Step 4 后仍是本类公开方法） */
  collectCollapsedParticipants(): ICollapsedPart<IAlignParticipant>[] {
    return collectCollapsedParticipantsImpl(this.ctx);
  }

  /** 程序化复制/剪切（右键菜单用；快捷键走 document 原生事件通道） */
  async copySelected(): Promise<void> {
    if (!this.assertEditable()) return;
    await this.ctx.clipboard?.copySelected(false);
  }

  async cutSelected(): Promise<void> {
    if (!this.assertEditable()) return;
    await this.ctx.clipboard?.copySelected(true);
  }

  pasteAt(target: { x: number; y: number }): void {
    this.ctx.clipboard?.pasteAt(target);
  }

  /** 粘贴到当前视口中心（右键菜单「粘贴」） */
  pasteAtScreenCenter(): void {
    const b = this.ctx.viewport!.vpBounds$.value;
    this.ctx.clipboard?.pasteAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }

  closeContextMenu(): void {
    this.ctx.contextMenu?.close();
  }

  /** 键盘打开右键菜单（specs/a11y-closeout §5.6——Shift+F10/Menu 的命令面） */
  openContextMenuFromKeyboard(): void {
    this.ctx.contextMenu?.openFromKeyboard();
  }
}
