import { type BehaviorSubject, type Subject } from 'rxjs';
import { Disposable } from '../../../base/disposable';
import { isEditableTarget } from '../../../platform/keyboard/shortcuts';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../../types';
import type { TreeMapVm } from './../vm/treeMapVm';
import type { TreeNodeModel } from './../model/treeNodeModel';
import type { TreeMapModel, IMindNodeSpec } from './../model/treeMapModel';
import { TreeNodeEditor } from './../edit/treeNodeEditor';
import { TreeOps } from './../ops/treeOps';
import { TreeDragController } from './../drag/treeDragController';
import { TreeFocusController } from './../focus/treeFocusController';
import { TreeToolController } from './../tool/treeToolController';
import type { IRect } from '../../../common/geometry';

/**
 * 脑图交互层（docs/11 §7-8）：mind 工具建图 + Tab/Enter/Delete 节点操作 +
 * 方向键焦点导航 + 节点拖拽重排 + 双击节点文本编辑。
 * TreeFocusController 焦点 ID 不存 Yjs（瞬态本地状态）。
 */

export class TreeService extends Disposable {
  /** 焦点节点 ID（app.ts awareness 读、测试直接读写——getter/setter 转发保契约，
   *  状态归属 TreeFocusController，批刀 3 拆出；setter 纯赋值不广播，同原字段语义） */
  get focusedNodeId(): string | null {
    return this.focusCtl.focusedNodeId;
  }
  set focusedNodeId(id: string | null) {
    this.focusCtl.focusedNodeId = id;
  }
  /** 焦点节点变化（移动/建删/点击落点）——AddButtons 等跟随 UI 的重算触发器 */
  get focusChanged$(): Subject<void> {
    return this.focusCtl.focusChanged$;
  }
  /** mind 幽灵抑制（react ToolGhost 消费；工具域在 TreeToolController，批刀 4 拆出） */
  get ghostSuppressed$(): BehaviorSubject<boolean> {
    return this.toolCtl.ghostSuppressed$;
  }

  /** dev 调试探针：焦点树的节点几何（世界 rect + 文案 + 折叠/可见态；
   *  E2E 断言节点/浮层相对位置与折叠可见性用——specs/tree-diagrams §14.2） */
  get nodesDebug(): Array<{
    id: string;
    text: string;
    worldRect: IRect;
    collapsed: boolean;
    visible: boolean;
    hiddenCount: number;
  }> {
    const f = this.getFocused();
    if (!f) return [];
    type Row = {
      id: string;
      text: string;
      worldRect: IRect;
      collapsed: boolean;
      visible: boolean;
      hiddenCount: number;
    };
    const out: Row[] = [];
    // 后序统计隐藏后代数（与 TreeMapVm.toLayoutSpec 同式——O(n) 一次）
    const size = (n: TreeNodeModel): number => 1 + n.children.reduce((a, c) => a + size(c), 0);
    const walk = (n: TreeNodeModel, underCollapsed: boolean): void => {
      const r = f.vm.getNodeRect(n.id);
      const collapsed = n.isCollapsed();
      const hidden = collapsed ? n.children.reduce((a, c) => a + size(c), 0) : 0;
      if (r) {
        out.push({
          id: n.id,
          text: n.toJSON().text,
          worldRect: {
            x: f.vm.root.x + r.x,
            y: f.vm.root.y + r.y,
            width: r.width,
            height: r.height,
          },
          collapsed,
          // Vm 对全部节点持位；探针的 visible = 布局可见（不在折叠子树内）
          visible: !underCollapsed,
          hiddenCount: hidden,
        });
      }
      for (const c of n.children) walk(c, underCollapsed || collapsed);
    };
    walk(f.mapModel.root, false);
    return out;
  }

  /** dev 调试探针：落点预置块（E2E/单测断言落点位置——数据探针优先于截图） */
  get dropPreviewDebug(): IRect | null {
    return this.dragCtl.dropPreviewDebug;
  }

  /** 节点文本编辑 descriptor 工厂（2026-09-26 自本服务拆出、2026-10-06 批 3 收编
   *  统一会话——深度样式/树落库/键位/焦点回调在此声明，textarea 生命周期在
   *  PlainTextKernel，docs/17 §3） */
  private readonly editor: TreeNodeEditor;
  /** 树写 + 节点操作协作者（2026-10-06 批刀 1 自本服务拆出） */
  private readonly treeOps: TreeOps;
  /** 拖拽重排协作者（2026-10-06 批刀 2 自本服务拆出，会话状态归属协作者） */
  private readonly dragCtl: TreeDragController;
  /** 焦点域协作者（2026-10-06 批刀 3 自本服务拆出，焦点状态归属协作者） */
  private readonly focusCtl: TreeFocusController;
  /** mind 工具域协作者（2026-10-06 批刀 4 自本服务拆出，建图与幽灵抑制归属协作者） */
  private readonly toolCtl: TreeToolController;

  constructor(
    private viewport: IViewportService,
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private history: IHistoryService,
    editing: IEditingService,
  ) {
    super();
    this.editor = new TreeNodeEditor(
      viewport,
      engine,
      vmEngine,
      history,
      {
        // 编辑态 Tab：建子并聚焦（新节点 id 回传给编辑器继续编辑）
        addChildFocused: () => {
          this.addChild();
          return this.focusedNodeId;
        },
        // 关闭编辑器后的条件化焦点恢复（交互流已接管则不覆写，docs/11 §9 末条）
        restoreFocusAfterEdit: (nodeId) => {
          if (this.focusedNodeId === nodeId || this.focusedNodeId === null) {
            this.focusedNodeId = nodeId;
            this.emitFocus();
          }
        },
        // 进入编辑即建立焦点态（AddButtons/ActionBar 跟随重算触发）
        focusEditedNode: (nodeId) => {
          this.focusedNodeId = nodeId;
          this.emitFocus();
        },
      },
      editing,
    );
    this.treeOps = new TreeOps(engine, history, selector, {
      getFocused: () => this.getFocused(),
      setFocusedNode: (id) => this.writeFocus(id),
    });
    this.addDisposable(this.treeOps);
    this.dragCtl = new TreeDragController(viewport, engine, vmEngine, selector, this.treeOps, {
      setFocusedNode: (id) => this.writeFocus(id),
      createMindMap: (x, y, spec) => this.createMindMap(x, y, spec),
    });
    this.addDisposable(this.dragCtl);
    this.focusCtl = new TreeFocusController(viewport, engine, vmEngine, selector, history, {
      isDragging: () => this.dragCtl.active,
    });
    this.addDisposable(this.focusCtl);
    this.toolCtl = new TreeToolController(viewport, engine, vmEngine, selector, history, {
      setFocusedNode: (id) => this.writeFocus(id),
    });
    this.addDisposable(this.toolCtl);
  }

  /** 焦点写入统一出口（各协作者 host 回调共用：= focusedNodeId 赋值 + emitFocus） */
  private writeFocus(id: string | null): void {
    this.focusedNodeId = id;
    this.emitFocus();
  }

  initialize(): void {
    this.viewport.registerGlobalEventListener('mind', {
      onPointerDown: (e) => this.toolCtl.onMindDown(e),
      onPointerMove: (e) => this.toolCtl.onMindMove(e),
    });
    // 选中态键入 → 进编辑并全量替换（既有设计 baseNodeVm.handleTextKeyDown）：
    // 捕获阶段拦下按键，避免同一按键又被工具快捷键消费（既有设计靠编辑器吃键，
    // spinth 无「选中态 DOM 编辑器」，改在捕获阶段 stopPropagation）
    // （node/无 DOM 环境下 SDK 仍可构造：与 viewportService 的 navigator 守卫同款）
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onTypeToEdit, { capture: true });
      window.addEventListener('compositionstart', this.onCompositionStart, { capture: true });
    }
    // 切出 mind 工具时复位幽灵抑制（抑制语义只属于 mind 模式——react ToolGhost 消费）
    this.addDisposable(
      () => {
        if (typeof window === 'undefined') return;
        window.removeEventListener('keydown', this.onTypeToEdit, { capture: true });
        window.removeEventListener('compositionstart', this.onCompositionStart, { capture: true });
      },
      this.viewport.cursorMode$.subscribe((mode) => {
        if (mode !== 'mind') this.ghostSuppressed$.next(false);
      }),
      // 选区变化 → 焦点重置（4.9 节点级选中；逻辑在 TreeFocusController.applySelection）
      this.selector.selected$.subscribe((ids) => this.focusCtl.applySelection(ids)),
    );
  }

  // ---- mind 工具：建图与幽灵抑制（docs/11 §8；工具域在 TreeToolController，批刀 4 拆出） ----

  /** 建图入口（dragCtl 拖出成图 host 回调 & E2E 用；聚焦新图根在协作者内） */
  createMindMap(x: number, y: number, rootSpec?: IMindNodeSpec): string {
    return this.toolCtl.createMindMap(x, y, rootSpec);
  }

  // ---- 节点操作（Tab/Enter/Delete） ----

  /** 获取当前焦点脑图 Vm + 节点 Model（焦点域在 TreeFocusController，批刀 3 拆出） */
  private getFocused(): { vm: TreeMapVm; mapModel: TreeMapModel; node: TreeNodeModel } | null {
    return this.focusCtl.getFocused();
  }

  /** 焦点节点当前分支色（ActionBar 色板当前值） */
  getFocusedLineColor(): string | null {
    return this.focusCtl.getFocusedLineColor();
  }

  /** 设置焦点节点分支色（ActionBar 写入） */
  setFocusedNodeColor(hex: string): void {
    this.focusCtl.setFocusedNodeColor(hex);
  }

  /** 是否处于「单选脑图且有焦点节点」态（删除等通用命令的节点级分流条件） */
  isNodeFocused(): boolean {
    return this.focusCtl.isNodeFocused();
  }

  /** 焦点节点快照（MindAddButtons 定位源） */
  getFocusedState(): ReturnType<TreeFocusController['getFocusedState']> {
    return this.focusCtl.getFocusedState();
  }

  /** Tab / AddButtons：建子节点并聚焦（树写域在 TreeOps，批刀 1 拆出）。
   *  返回 false = 无脑图可建（键盘层不吞 Tab——原生焦点序列放行，
   *  specs/a11y-closeout §5.9 键盘陷阱修复）。谓词与 treeOps 同源
   *  getFocused()（focusedNodeId 空时回退根——有图即建根子），不用
   *  getFocusedState()（其快照依赖几何，桩环境恒 null） */
  addChild(direction?: 'left' | 'right'): boolean {
    if (!this.focusCtl.getFocused()) return false;
    this.treeOps.addChild(direction);
    return true;
  }

  /** Enter / AddButtons：建同级节点（根上退化建子）。返回 false 语义同 addChild */
  addSibling(): boolean {
    if (!this.focusCtl.getFocused()) return false;
    this.treeOps.addSibling();
    return true;
  }

  /** Delete / AddButtons：删节点（删根 = 删整图） */
  deleteFocused(): void {
    this.treeOps.deleteFocused();
  }

  // ---- 折叠（specs/tree-diagrams §4.5/§8.4；数据写在 TreeOps，一次切换一步撤销） ----

  /** 焦点节点设折叠态（ActionBar treeCollapsed 写入口）。编辑态先退出会话
   *  （commit 落库已输入文本）再写。返回 false = 无焦点/不可折叠（无子） */
  setCollapsedFocused(next: boolean): boolean {
    const f = this.getFocused();
    if (!f || f.node.children.length === 0) return false;
    this.exitNodeEdit(true);
    this.treeOps.setCollapsed(f.mapModel.id, f.node.id, next);
    this.emitFocus();
    return true;
  }

  /** 切换选中树图排列（ActionBar treeOrientation 写入口；一步撤销零节点写） */
  setOrientation(mapId: string, orientation: 'horizontal' | 'vertical'): void {
    this.treeOps.setOrientation(mapId, orientation);
  }

  /** 焦点节点折叠/展开切换（快捷键 Cmd/Ctrl+. 入口） */
  toggleCollapseFocused(): boolean {
    const f = this.getFocused();
    if (!f) return false;
    return this.setCollapsedFocused(!f.node.isCollapsed());
  }

  /** 折叠徽标命中（selector 按下树节点时先于此询问，specs §8.4：命中则建
   *  选中/焦点并展开，不建拖拽会话）。返回徽标节点 id 或 null；只读态不消费
   *  （只读下指针分发整条丢弃，不会到达此处） */
  hitToggle(mapId: string, world: { x: number; y: number }): string | null {
    const vm = this.vmEngine.getVmById(mapId) as TreeMapVm | undefined;
    if (!vm) return null;
    const hit = vm.hitBadge({ x: world.x, y: world.y } as never);
    return hit ? hit.model.id : null;
  }

  /** 点击徽标 = 展开该节点（ITreeDragDelegate 契约；编辑中的文本先落库） */
  toggleCollapseAt(mapId: string, nodeId: string): void {
    this.exitNodeEdit(true);
    this.treeOps.setCollapsed(mapId, nodeId, false);
  }

  // ---- 方向键导航（docs/11 §7，规则来自 mindNav 纯函数） ----

  /**
   * 智能方向导航（规则在 mindNav 纯函数 + TreeFocusController，批刀 3 拆出）：
   * 返回 true = 本次按键已由脑图消费（键盘层据此跳过 1px 微移）。
   */
  navigate(key: string): boolean {
    return this.focusCtl.navigate(key);
  }

  // ---- 拖拽重排（docs/11 §6；会话状态与落库在 TreeDragController，批刀 2 拆出） ----

  /** cursor 模式按下在脑图节点上（非根）：启动拖拽 */
  startDrag(mapId: string, nodeId: string, world: { x: number; y: number }): boolean {
    return this.dragCtl.startDrag(mapId, nodeId, world);
  }

  /** 拖拽中：DropArea hitTest；返回落点或 null（空白=成新图） */
  dragMove(world: { x: number; y: number }): boolean {
    return this.dragCtl.dragMove(world);
  }

  /** 松手三分支：moved（搬移重选）/ new-map（拖出成图）/ click（焦点落按下节点） */
  dragEnd(world: { x: number; y: number }): 'moved' | 'new-map' | 'click' | null {
    return this.dragCtl.dragEnd(world);
  }

  get isDragging(): boolean {
    return this.dragCtl.active;
  }

  /** ITreeDragDelegate.isDragMoved（specs/edge-auto-scroll §5.2）：节点拖拽已过
   *  判拖阈值——边缘自动滚屏的启用条件（缺省视为未拖起） */
  get isDragMoved(): boolean {
    return this.dragCtl.moved;
  }

  /** 按下子节点即建立节点级选中态（selector 委托；ITreeDragDelegate 契约） */
  focusNode(_mapId: string, nodeId: string): void {
    this.focusCtl.focusNode(_mapId, nodeId);
  }

  /** 节点级选中态判定（selector 选区框隐藏用；根焦点 = 整图选中语义） */
  isNodeSelected(): boolean {
    return this.focusCtl.isNodeSelected();
  }

  /** 焦点节点的选区框矩形（根/子节点统一；selector 委托） */
  getFocusFrame(): IRect | null {
    return this.focusCtl.getFocusFrame();
  }

  /** 按下根节点：焦点重置根（selector 委托，4.9） */
  focusRoot(mapId: string): void {
    this.focusCtl.focusRoot(mapId);
  }

  /** 框选节点级命中（4.9，docs/11 §0 修订；selector 委托） */
  focusFromMarquee(rect: IRect, mapId: string): void {
    this.focusCtl.focusFromMarquee(rect, mapId);
  }

  // ---- 节点文本编辑（docs/11 §0）——textarea 生命周期在 mindNodeEditor.ts，
  //      本服务只保留激活入口与焦点归属（host 回调见构造器） ----

  /**
   * 单击已选中脑图（通用激活通道入口，docs/11 §0）：命中哪个节点就编辑哪个；
   * 未命中节点（点在树空白处）不动。既有设计「选中态元素上再点一次左键 → 编辑态」
   * 对脑图节点同样生效（mindSelector 订阅 singleEdited$）。
   */
  enterNodeEditAt(mapId: string, world: { x: number; y: number }): boolean {
    return this.editor.enterNodeEditAt(mapId, world);
  }

  /**
   * 选中态键入字符 → 进编辑并用该字符替换原文本（既有设计：选中态键入任意单字符
   * 触发 setEditor + selectAll，随后输入即全量替换）。空格与带修饰键的组合不触发。
   */
  private onTypeToEdit = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    // IME 合成首键：Windows keydown 是 Process；macOS/Chrome 的合成首键 keydown
    // 携带真实字符但 keyCode=229 且 isComposing 仍 false（先于 compositionstart
    // 到达）。两条路都不能走 replaceWith——拼音首字母会立即落库并同步给协同用户、
    // 取消合成后原文案被毁（首键竞态）。统一走「进编辑 + 全选」等 IME 落字
    const isProcess = e.key === 'Process';
    const isIme = isProcess || e.isComposing || e.keyCode === 229;
    if (!isIme && (e.key === ' ' || e.key.length !== 1)) return;
    if (isEditableTarget(e.target)) return; // 已在自己的编辑器/输入框里
    if (this.viewport.cursorMode$.value !== 'cursor') return;
    const f = this.getFocused();
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    this.enterNodeEdit(
      f.mapModel.id,
      f.node.id,
      isIme ? { selectAll: true } : { replaceWith: e.key },
    );
  };

  /** 输入法开始合成：进编辑并全选（既有设计 compositionstart 同款，Safari 事件顺序兼容） */
  private onCompositionStart = (e: CompositionEvent): void => {
    if (isEditableTarget(e.target)) return;
    if (this.viewport.cursorMode$.value !== 'cursor') return;
    const f = this.getFocused();
    if (!f) return;
    this.enterNodeEdit(f.mapModel.id, f.node.id, { selectAll: true });
  };

  enterNodeEdit(
    mapId: string,
    nodeId: string,
    opts: { replaceWith?: string; selectAll?: boolean } = {},
  ): void {
    this.editor.enterNodeEdit(mapId, nodeId, opts);
  }

  /** 退出节点编辑；commit=true 落库（空文本保留——删除节点走 Delete 键） */
  exitNodeEdit(commit: boolean): void {
    this.editor.exitNodeEdit(commit);
  }

  /** 焦点变化统一出口：广播 + 视窗跟随（逻辑在 TreeFocusController，批刀 3 拆出） */
  private emitFocus(): void {
    this.focusCtl.emitFocus();
  }

  override dispose(): void {
    this.exitNodeEdit(false);
    super.dispose(); // 四协作者级联释放（focusCtl 内完成 focusChanged$）
  }
}
