import { Subject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import type { MindMapVm } from './mindMapVm';
import type { MindNodeModel } from './mindNodeModel';
import type { MindMapModel } from './mindMapModel';
import { findMindNode, buildNavTree, nodeDirection } from './mindMapModel';
import { MIND_COLORS } from './mindNodeVm';
import {
  effectiveDirection,
  focusFollowDelta,
  nearestChild,
  nearestSibling,
  type INavNode,
  type ISpan,
} from './mindNav';

/**
 * 脑图焦点域协作者（自 mindService 拆出，2026-10-06 批刀 3）：docs/11 §7——
 * 焦点状态机（focusedNodeId 瞬态不存 Yjs）+ 焦点广播（focusChanged$）+ 视窗安全区
 * 跟随 + 方向键导航编排 + selector 委托的节点级选中（focusNode/focusRoot/
 * focusFromMarquee/getFocusFrame）+ 焦点节点查询面（AddButtons/ActionBar 消费）。
 * 焦点状态归属本类；宿主经 getter/setter 转发保 public 契约；拖拽会话守卫
 * （拖拽中不跟随）经 host 回调读取。
 */

/**
 * 焦点跟随的安全区（屏幕像素，docs/11 §7）：左右上取既有设计 WINDOW_FOCUS_PADDING=10；
 * 下边加大到 96 让开底部工具坞与右下缩放胶囊（既有设计是左侧工具栏 76，spinth 的 UI
 * 重设计把工具栏移到画布底部悬浮，让位方向随之改）。
 */
const FOCUS_PADDING = { left: 10, right: 10, top: 10, bottom: 96 } as const;

/** MindService ↔ 焦点域的边界：拖拽会话态留在服务侧（「拖拽中不跟随」守卫） */
export interface IMindFocusHost {
  isDragging(): boolean;
}

export class MindFocusController extends Disposable {
  /** 焦点节点 ID（选中态导航的目标；null = 无焦点） */
  focusedNodeId: string | null = null;
  /** 焦点节点变化（移动/建删/点击落点）——AddButtons 等跟随 UI 的重算触发器 */
  readonly focusChanged$ = new Subject<void>();
  /** 焦点高亮当前所在脑图（选区丢图时清除高亮用） */
  private focusMapId: string | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly history: IHistoryService,
    private readonly host: IMindFocusHost,
  ) {
    super();
  }

  /** 获取当前焦点脑图 Vm + 节点 Model */
  getFocused(): { vm: MindMapVm; mapModel: MindMapModel; node: MindNodeModel } | null {
    const mapId = this.selector.selected$.value.find((id) => {
      const vm = this.vmEngine.getVmById(id);
      return vm?.type === 'MIND_MAP';
    });
    if (!mapId) return null;
    const vm = this.vmEngine.getVmById(mapId) as MindMapVm | undefined;
    const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
    if (!vm || !model?.hasRoot()) return null;
    const node = findMindNode(model.root, this.focusedNodeId ?? model.root.id);
    if (!node) {
      this.focusedNodeId = null; // 自愈：焦点指向已删除节点（如 undo）时清空
      return null;
    }
    return { vm, mapModel: model, node };
  }

  /** 焦点节点当前分支色（ActionBar 色板当前值；getLineColor 含父链继承） */
  getFocusedLineColor(): string | null {
    const f = this.getFocused();
    if (!f) return null;
    return f.node.getLineColor(MIND_COLORS.lineFallback);
  }

  /** 设置焦点节点分支色（ActionBar 写入；自身落盘——「分支主题设一次色整棵子树
   * 继承」，docs/11 §2；空 hex 忽略） */
  setFocusedNodeColor(hex: string): void {
    const f = this.getFocused();
    if (!f || !hex.startsWith('#')) return;
    const yNode = f.node.yMap;
    yNode.doc!.transact(() => yNode.set('lineColor', hex));
    this.history.stopCapturing();
  }

  /** 是否处于「单选脑图且有焦点节点」态（删除等通用命令的节点级分流条件；
   *  根焦点返回 false——根操作与整图等价，走通用路径删整图即可） */
  isNodeFocused(): boolean {
    const f = this.getFocused();
    return !!f && f.node !== f.mapModel.root;
  }

  /** 焦点节点快照（MindAddButtons 定位源——世界坐标 rect + 侧向标志） */
  getFocusedState(): {
    mapId: string;
    nodeId: string;
    isRoot: boolean;
    direction: 'left' | 'right';
    worldRect: IRect;
    slotLeft: number;
    slotRight: number;
  } | null {
    const f = this.getFocused();
    if (!f) return null;
    const { vm, mapModel, node } = f;
    const rect = vm.getNodeRect(node.id);
    if (!rect) return null;
    const worldRect = {
      x: vm.root.x + rect.x,
      y: vm.root.y + rect.y,
      width: rect.width,
      height: rect.height,
    };
    // 槽位边 = **焦点节点本体**左右边（既有设计 mindAddBtn：xStart = x − 直径 − 间距、
    // xEnd = x + width + 间距）。曾扩到「同侧后代最远端」——根节点的左右按钮因此飞到
    // 整棵树两端，与「在根旁边加一级分支」的语义不符。
    // 布局上父→子水平间隔为根层 100 / 深层 48，均大于按钮占位（直径 28 + 间距 8 = 36），
    // 因此按钮落在间隔内、不会压到子节点。
    const slotLeft = worldRect.x;
    const slotRight = worldRect.x + worldRect.width;
    return {
      mapId: mapModel.id,
      nodeId: node.id,
      isRoot: node === mapModel.root,
      direction: nodeDirection(node),
      worldRect,
      slotLeft,
      slotRight,
    };
  }

  /**
   * 智能方向：左树的 ← 是子节点、→ 是父节点（右树相反）；↑↓ 走同侧兄弟（到边界上溯叔节点）；
   * 根节点 ←/→ 分别取左/右子树里视图最近的子节点。
   * 返回 true = 本次按键已由脑图消费（键盘层据此跳过 1px 微移——既有设计方向键在脑图
   * 选中态下同样不会平移整图）。
   */
  navigate(key: string): boolean {
    const f = this.getFocused();
    if (!f) return false;
    const { vm, mapModel, node } = f;
    const { root, byId } = buildNavTree(mapModel.root);
    const current = byId.get(node.id) ?? root;
    const isRoot = current.parent === null;
    const isLeft = effectiveDirection(current) === 'left';
    const spanOf = this.navSpanOf(vm);

    const focusTo = (next: INavNode | undefined): void => {
      if (!next) return;
      this.focusedNodeId = next.id;
      this.emitFocus();
    };

    switch (key) {
      case 'ArrowLeft':
        if (isRoot) focusTo(nearestChild(current, spanOf, 'left'));
        else if (isLeft) focusTo(nearestChild(current, spanOf));
        else focusTo(current.parent ?? undefined);
        return true;
      case 'ArrowRight':
        if (isRoot) focusTo(nearestChild(current, spanOf, 'right'));
        else if (isLeft) focusTo(current.parent ?? undefined);
        else focusTo(nearestChild(current, spanOf));
        return true;
      case 'ArrowUp':
        focusTo(nearestSibling(current, 'before'));
        return true;
      case 'ArrowDown':
        focusTo(nearestSibling(current, 'after'));
        return true;
      default:
        return false;
    }
  }

  /** 节点在脑图局部坐标下的 y 区间（nearestChild 的"视图最近"判据；同坐标系内相对比较即可） */
  private navSpanOf(vm: MindMapVm): (n: INavNode) => ISpan | null {
    return (n) => {
      const r = vm.getNodeRect(n.id);
      return r ? { top: r.y, bottom: r.y + r.height } : null;
    };
  }

  /** 按下子节点即建立节点级选中态（selector 委托，先于 setSelected——
   *  选区框同步时 isNodeSelected 已可判定，整树框不闪现） */
  focusNode(_mapId: string, nodeId: string): void {
    this.focusedNodeId = nodeId;
    this.emitFocus();
  }

  /** 节点级选中态判定（selector 选区框隐藏用；根焦点 = 整图选中语义） */
  isNodeSelected(): boolean {
    return this.isNodeFocused();
  }

  /**
   * 焦点节点的选区框矩形（根/子节点统一）。既有设计点任意 MIND_NODE（含根）都会让
   * SelectionVm 在**节点本体**上画蓝框（`calculateStageBounds` 对 MIND_NODE 取
   * `getNodeBounds()`）；spinth 之前只在根焦点画框、子节点仅靠本体描边，视觉上
   * 「点子节点没有选中框」（分支色本身是蓝色时完全看不出来）。
   */
  getFocusFrame(): IRect | null {
    const f = this.getFocused();
    if (!f) return null;
    const rect = f.vm.getNodeRect(f.node.id);
    if (!rect) return null;
    return {
      x: f.vm.root.x + rect.x,
      y: f.vm.root.y + rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  /** 按下根节点（selector 委托，4.9）：焦点重置根——同图旧焦点在子节点时
   *  selected$ 订阅不会重置，此处精确覆盖 */
  focusRoot(mapId: string): void {
    const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
    if (!model?.hasRoot()) return;
    this.focusedNodeId = model.root.id;
    this.emitFocus();
  }

  /** 框选节点级命中（4.9，docs/11 §0 修订）：框中根本体 = 整图（焦点回根）；
   *  否则框中首个子节点 bbox（相交判定，既有设计 MIND_NODE 参与 hitTestRect）=
   *  节点级选中。选中集（widget id）由 selector 管理，此处只细化焦点 */
  focusFromMarquee(rect: IRect, mapId: string): void {
    const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
    const vm = this.vmEngine.getVmById(mapId) as MindMapVm | undefined;
    if (!model?.hasRoot() || !vm) return;
    // getNodeRect 是节点局部 rect，换算到世界坐标再与框选矩形求交（getFocusFrame 同款）
    const worldRect = (
      id: string,
    ): { x: number; y: number; width: number; height: number } | null => {
      const r = vm.getNodeRect(id);
      return r
        ? { x: vm.root.x + r.x, y: vm.root.y + r.y, width: r.width, height: r.height }
        : null;
    };
    const intersects = (r: { x: number; y: number; width: number; height: number }): boolean =>
      r.x < rect.x + rect.width &&
      r.x + r.width > rect.x &&
      r.y < rect.y + rect.height &&
      r.y + r.height > rect.y;
    const rootRect = worldRect(model.root.id);
    if (rootRect && intersects(rootRect)) {
      this.focusRoot(mapId);
      return;
    }
    const firstHit = (n: MindNodeModel): string | null => {
      for (const c of n.children) {
        const r = worldRect(c.id);
        if (r && intersects(r)) return c.id;
        const deep = firstHit(c);
        if (deep) return deep;
      }
      return null;
    };
    const hit = firstHit(model.root);
    if (hit) this.focusNode(mapId, hit);
  }

  /** 选区变化 → 焦点重置（4.9 节点级选中）：选区不含脑图 = 清选中；
   *  选区含脑图且焦点无效（点根/框选/切图）= 焦点落该图根（点子节点的
   *  单击分支随后覆盖为精确节点——按下 setSelected 先于此发生，松手覆写） */
  applySelection(ids: string[]): void {
    const mindId = ids.find((id) => this.vmEngine.getVmById(id)?.type === 'MIND_MAP');
    if (!mindId) {
      if (this.focusMapId) this.clearFocusHighlight();
      return;
    }
    if (!this.getFocused() || this.focusMapId !== mindId) {
      const model = this.engine.getModelById(mindId) as MindMapModel | undefined;
      if (model?.hasRoot()) {
        this.focusedNodeId = model.root.id;
        this.emitFocus();
      }
    }
  }

  /** 焦点变化统一出口：广播（AddButtons/ActionBar/awareness/选区框跟随）。
   *  2026-09 单层化后节点不再自画描边——选中视觉 = SelectionVm 框
   *  （getFocusFrame），组合根接 focusChanged$ → refreshSelectionFrame 驱动 */
  emitFocus(): void {
    this.focusChanged$.next();
    const f = this.getFocused();
    if (f) {
      this.focusMapId = f.mapModel.id;
      this.followFocus(f.vm, f.node);
    } else {
      this.clearFocusHighlight();
    }
  }

  /**
   * 焦点视窗跟随（既有设计 mindFocusController.moveToFocus）：节点与可视安全区
   * 在两轴上的相交长度都够时不动，否则哪个轴不足就对齐哪个轴（mindNav.focusFollowDelta）。
   * 与延迟一拍无关的纯读取：节点世界 rect → toScreen；拖拽进行中不跟随（手势优先，
   * 否则拖到边缘时视口会自己跑）。
   */
  private followFocus(vm: MindMapVm, node: MindNodeModel): void {
    if (this.host.isDragging()) return;
    const rect = vm.getNodeRect(node.id);
    if (!rect) return;
    const x = vm.root.x + rect.x;
    const y = vm.root.y + rect.y;
    const tl = this.viewport.toScreen({ x, y });
    const br = this.viewport.toScreen({ x: x + rect.width, y: y + rect.height });
    const size = this.viewport.getClientSize();
    if (!size.width || !size.height) return;
    const delta = focusFollowDelta(
      { left: tl.x, top: tl.y, right: br.x, bottom: br.y },
      {
        left: FOCUS_PADDING.left,
        top: FOCUS_PADDING.top,
        right: size.width - FOCUS_PADDING.right,
        bottom: size.height - FOCUS_PADDING.bottom,
      },
    );
    if (delta.x || delta.y) this.viewport.panBy(delta.x, delta.y);
  }

  private clearFocusHighlight(): void {
    if (!this.focusMapId) return;
    this.focusMapId = null;
    this.focusedNodeId = null;
    this.focusChanged$.next(); // awareness/选区框等订阅者读空焦点
  }

  override dispose(): void {
    this.focusedNodeId = null;
    this.focusChanged$.complete();
    super.dispose();
  }
}
