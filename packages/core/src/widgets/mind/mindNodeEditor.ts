import { Disposable } from '../../base/disposable';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  IVmEngineService,
  IViewportService,
  IPlainEditorStyle,
} from '../../types';
import type { MindMapVm } from './mindMapVm';
import type { MindMapModel } from './mindMapModel';
import { findMindNode } from './mindMapModel';
import { MIND_NODE_STYLE, MIND_COLORS, MIND_ROOT_STYLE } from './mindNodeVm';

/**
 * 脑图节点文本编辑协作者（docs/11 §8，自 mindService 拆出的协作者；
 * 2026-10-06 编辑会话批 3 收编统一 EditingService plain 内核）：textarea
 * 生命周期/定位缩放/34ms 节流/blur 落库已在 PlainTextKernel，本类只声明
 * mind 节点的编辑事实——深度决定样式（IPlainEditorStyle）、树落库
 * （setText→observeSelf→重排）、mind 键位（Enter 提交/Tab 建子续编辑/Cmd±
 * 缩放）与焦点归属（host 回调，编辑器不持有焦点状态、不改树结构）。
 */

/** 编辑器 ↔ MindService 的边界：树结构变更与焦点归属留在服务侧 */
export interface IMindEditorHost {
  /** 编辑态 Tab：建子节点并聚焦，返回新子节点 id（无则 null） */
  addChildFocused(): string | null;
  /** 编辑器关闭后的焦点恢复（条件化：交互流已接管焦点则不覆写——blur 晚于
   *  canvas pointerdown 的时序，docs/11 §9 故障表末条） */
  restoreFocusAfterEdit(nodeId: string): void;
  /** 进入编辑即建立该节点的焦点态（AddButtons/ActionBar 跟随重算触发） */
  focusEditedNode(nodeId: string): void;
}

export class MindNodeEditor extends Disposable {
  /** 本协作者发起的会话（isEditing/editingWidgetId 语义；begin 后赋值） */
  private myEditing: { mapId: string; nodeId: string } | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly history: IHistoryService,
    private readonly host: IMindEditorHost,
    private readonly editing: IEditingService,
  ) {
    super();
  }

  /** 是否处于编辑态（编辑态键位分流用） */
  get isEditing(): boolean {
    return this.myEditing !== null;
  }

  get editingWidgetId(): string | null {
    return this.myEditing?.mapId ?? null;
  }

  /**
   * 单击已选中脑图（通用激活通道入口，docs/11 §0）：命中哪个节点就编辑哪个；
   * 未命中节点（点在树空白处）不动。既有设计「选中态元素上再点一次左键 → 编辑态」
   * 对脑图节点同样生效（mindSelector 订阅 singleEdited$）。
   */
  enterNodeEditAt(mapId: string, world: { x: number; y: number }): boolean {
    const vm = this.vmEngine.getVmById(mapId) as MindMapVm | undefined;
    const hit = vm?.hitNode(world as never);
    if (!vm || !hit) return false;
    this.enterNodeEdit(mapId, hit.model.id);
    return true;
  }

  enterNodeEdit(
    mapId: string,
    nodeId: string,
    opts: { replaceWith?: string; selectAll?: boolean } = {},
  ): void {
    const vm = this.vmEngine.getVmById(mapId) as MindMapVm | undefined;
    const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
    const node = model?.hasRoot() ? findMindNode(model.root, nodeId) : null;
    const rect = vm?.getNodeRect(nodeId) ?? null;
    const nodeVm = vm?.getNodeVm(nodeId) ?? null;
    if (!vm || !node || !rect || !nodeVm) return;

    const isRoot = nodeVm.depth === 0;
    // 本会话闭包状态（树落库判重 / undo 边界）
    let committed = false;
    this.editing.begin({
      widgetId: mapId,
      kernel: 'plain',
      nodeKey: nodeId,
      getRect: () => {
        const r = vm.getNodeRect(nodeId);
        return r
          ? { x: vm.root.x + r.x, y: vm.root.y + r.y, width: r.width, height: r.height }
          : { x: 0, y: 0, width: 0, height: 0 };
      },
      getContent: () => node.toJSON().text,
      style: {
        fontSize: nodeVm.fontSize,
        // 行高对齐 pixi Text：像素值 = fontSize（倍数行高编辑瞬间重影）
        lineHeightPx: nodeVm.fontSize,
        color: isRoot ? MIND_COLORS.rootText : MIND_COLORS.nodeText,
        background: isRoot ? MIND_COLORS.rootFill : MIND_COLORS.nodeFill,
        fontWeight: String(nodeVm.depth <= 1 ? 700 : 500),
        borderRadius: MIND_ROOT_STYLE.radius,
        paddingX: isRoot ? MIND_ROOT_STYLE.padX : MIND_NODE_STYLE.padX,
        paddingY: isRoot ? MIND_ROOT_STYLE.padY : MIND_NODE_STYLE.padY,
      } satisfies IPlainEditorStyle,
      plainCursor:
        opts.replaceWith !== undefined
          ? { replaceWith: opts.replaceWith }
          : opts.selectAll
            ? 'selectAll'
            : 'end',
      onCommit: (text) => {
        // 重取（undo 删除后闭包 node 失效）；setText → observeSelf → refresh +
        // relayout（既有链路，树自动重排——kernel 随后重取 getRect 跟随）
        const m = this.engine.getModelById(mapId) as MindMapModel | undefined;
        const n = m?.hasRoot() ? findMindNode(m.root, nodeId) : null;
        if (n && n.toJSON().text !== text) {
          n.setText(text);
          committed = true;
        }
      },
      emptyTextPolicy: 'keep',
      onEnter: () => this.host.focusEditedNode(nodeId),
      onExit: (_isEmpty, meta) => {
        this.myEditing = null;
        if (!meta.discarded) {
          if (committed) this.history.stopCapturing();
          this.host.restoreFocusAfterEdit(nodeId);
        }
      },
      onPlainKeyDown: (e) => {
        if (e.isComposing) return false; // 输入法合成中不抢键（既有设计 composing 保护）
        // Enter 提交退出；Shift+Enter 保持换行（textarea 默认行为即换行）
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.exitNodeEdit(true);
          return true;
        }
        // Tab 建子节点并继续编辑新节点（既有设计编辑态 Tab → insertChild + select）
        if (e.key === 'Tab') {
          e.preventDefault();
          this.exitNodeEdit(true); // 先把当前文本落库（焦点仍在被编辑节点）
          const newId = this.host.addChildFocused();
          if (newId) this.enterNodeEdit(mapId, newId);
          return true;
        }
        // 编辑态 Cmd/Ctrl + ± = 缩放画布（既有设计 textEditor/baseNodeVm 同款转发）
        const meta2 = e.metaKey || e.ctrlKey;
        if (meta2 && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          this.viewport.zoomIn();
          return true;
        }
        if (meta2 && (e.key === '-' || e.key === '_')) {
          e.preventDefault();
          this.viewport.zoomOut();
          return true;
        }
        return false;
      },
    });
    this.myEditing = { mapId, nodeId };
  }

  /** 退出节点编辑；commit=true 落库（空文本保留——删除节点走 Delete 键）；
   *  commit=false = Esc 丢弃（pending 不落库、不恢复焦点） */
  exitNodeEdit(commit: boolean): void {
    this.editing.exitActive(commit ? undefined : { discard: true });
  }
}
