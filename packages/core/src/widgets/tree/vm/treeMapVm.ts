import { Graphics, Point } from 'pixi.js';
import { BaseWidgetVm } from '../../../base/baseWidgetVm';
import { markRender } from '../../../common/render';
import { rectContainsPoint, rectsIntersect, type IRect } from '../../../common/geometry';
import type { IWidgetData, MindMapData } from '../../../types';
import type { TreeOrientation } from '../../../types/tree';
import { TreeNodeModel } from '../model/treeNodeModel';
import { TreeNodeVm } from './treeNodeVm';
import { drawTreeConnectors } from './treeDrawer';
import type { ILayoutNode, ILayoutResult } from '../layout/types';
import type { TreeMapModel } from '../model/treeMapModel';
import type { ITreeKind } from '../registry';
import { mindKind } from '../kinds/mind';

/**
 * 树形图整图视图基类（docs/11 §4，2026-09 编排决策；specs/tree-diagrams §3.2）：
 * - 树内节点 Vm 由本类统一 build/destroy（childrenChange$ 增量）；
 * - **布局合批**：任何树变化（结构/文本）→ 微任务一次全量布局 +
 *   位置差异应用（纯函数布局 O(树) 代价可忽略；「每节点 render 排自己 children
 *   + 逐级冒泡」的既有设计形态在 spinth 简化为全量计算 + 差异应用——满足规格的
 *   「同帧多变化只收敛一次」，增量逐节点重排留给性能专项评估）；
 * - 根锚定：容器原点 = 根节点左上角（布局负坐标自然向左上展开）；
 *   整图 rect 只在拖拽时变（防 layout→写 rect→再 layout 循环）。
 * 布局/连线经 kind 策略分派（骨架无种类分支）。
 */
export class TreeMapVm<D extends IWidgetData = IWidgetData> extends BaseWidgetVm<D> {
  readonly kind: ITreeKind;

  private readonly nodeVms = new Map<string, TreeNodeVm>();
  private readonly nodeUnbinds = new Map<string, Array<() => void>>();
  private readonly drawer = new Graphics();
  private relayoutScheduled = false;
  private lastLayout: ILayoutResult | null = null;
  /** 上次广播时的布局 bbox——树生长/收缩检测（变化才进 diff 键集） */
  private lastBbox: IRect | null = null;

  constructor(kind: ITreeKind) {
    super({
      id: '',
      type: kind.type,
      zOrder: '',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    } as D);
    this.kind = kind;
    this.root.eventMode = 'none';
    this.root.addChild(this.drawer);
  }

  /** 物理轴：读图字段 orientation（缺省回 kind 默认；spec §4.4 切换零节点写）。
   *  public——focusController 的 spanOf 主轴、徽标锚定、拖拽落点共消费 */
  get orientation(): TreeOrientation {
    const o = (this.state as { orientation?: TreeOrientation }).orientation;
    return o ?? this.kind.defaultOrientation;
  }

  private get mapModel(): TreeMapModel | null {
    return this.model as unknown as TreeMapModel | null;
  }

  override render(_prev: D, next: D): void {
    this.root.position.set(next.x, next.y);
    this.root.scale.set(1);
    const model = this.mapModel;
    if (model?.hasRoot()) {
      this.attachTree(model.root);
    }
    this.scheduleRelayout();
  }

  private treeAttached = false;

  /** 订阅树模型（首次 render / 数据就绪后）。结构订阅在 syncTree 内逐节点挂——
   *  只订根曾漏掉深层子树：Tab 建链 ≥2 层后 Y 树对、Vm 树缺节点（2026-09 实测） */
  private attachTree(rootModel: TreeNodeModel): void {
    if (this.treeAttached) return;
    this.treeAttached = true;
    this.syncTree(rootModel);
  }

  /** Vm 树与 Model 树对齐：建缺失 + 销毁多余（先应用更新再销毁——docs/11 §3），
   *  新建节点挂 observeSelf（文本变化 → refresh + 重排） */
  private syncTree(rootModel: TreeNodeModel): void {
    const alive = new Set<string>();
    const walk = (node: TreeNodeModel, depth: number): void => {
      alive.add(node.id);
      if (!this.nodeVms.has(node.id)) {
        const vm = new TreeNodeVm(node, depth, this.kind.style);
        this.nodeVms.set(node.id, vm);
        this.root.addChild(vm as never);
        // 逐节点订阅：结构变化（childrenChange$）驱动 syncTree + 重排；
        // 文本变化（observeSelf）驱动 refresh + 重排。解绑函数登记到
        // nodeUnbinds——节点删除/整图销毁时摘除（先前丢弃 unbind 是悬挂订阅）
        const unbinds: Array<() => void> = [];
        const sub = node.childrenChange$.subscribe(() => {
          this.syncTree(rootModel);
          this.scheduleRelayout();
        });
        unbinds.push(() => sub.unsubscribe());
        unbinds.push(
          node.observeSelf(() => {
            vm.refresh(node.toJSON().text);
            this.scheduleRelayout();
          }),
        );
        this.nodeUnbinds.set(node.id, unbinds);
      }
      for (const c of node.children) walk(c, depth + 1);
    };
    walk(rootModel, 0);
    for (const [id, vm] of [...this.nodeVms]) {
      if (!alive.has(id)) {
        for (const u of this.nodeUnbinds.get(id) ?? []) u();
        this.nodeUnbinds.delete(id);
        vm.destroy({ children: true });
        this.nodeVms.delete(id);
      }
    }
  }

  /** 微任务合批：同帧多次树变化只布局一次（docs/11 §0） */
  private scheduleRelayout(): void {
    if (this.relayoutScheduled) return;
    this.relayoutScheduled = true;
    queueMicrotask(() => {
      this.relayoutScheduled = false;
      this.applyLayout();
    });
  }

  private applyLayout(): void {
    const model = this.mapModel;
    if (!model?.hasRoot()) return;
    const spec = this.toLayoutSpec(model.root);
    const layout = this.kind.layout(this.orientation).layout(spec);
    this.lastLayout = layout;
    for (const [id, vm] of this.nodeVms) {
      const p = layout.positions.get(id);
      if (p) {
        vm.visible = true;
        vm.position.set(p.x, p.y);
      } else {
        // 折叠隐藏后代：Vm 保留（增量同步简单）但不渲染不命中（specs §8.4）
        vm.visible = false;
      }
    }
    this.syncBadges(spec);
    drawTreeConnectors(this.drawer, this.kind, this.orientation, model.root, layout, this.nodeVms);
    markRender();
    // 布局是派生视觉、不产生 Yjs 状态变更——但选区框/ActionBar/AddButtons 都按
    // 「渲染完成后广播」契约重读几何（docs/11 §0）。不广播则它们永远停在布局
    // 前的 0×0 锚点：选区框塌缩成点、操作栏不随选中元素居中（2026-09 实测）。
    // bbox 变化时把几何键带进 diff（值 = 派生 bbox 非 state 值；键存在性是
    // app.ts 横切订阅的触发语义，值无消费方——vmEngine 只读 zOrder）：树生长/
    // 收缩 = 宿主几何变化，与形状缩放同语义触发锚定线 reattach。此前 diff
    // 恒空 → 树编辑（根文字换行增高等）后锚定线停在旧锚点（2026-10-10 E2E 实测）
    const b = layout.bbox;
    const diff: Record<string, unknown> = {};
    if (
      !this.lastBbox ||
      this.lastBbox.x !== b.x ||
      this.lastBbox.y !== b.y ||
      this.lastBbox.width !== b.width ||
      this.lastBbox.height !== b.height
    ) {
      diff.x = b.x;
      diff.y = b.y;
      diff.width = b.width;
      diff.height = b.height;
      this.lastBbox = { ...b };
    }
    this.onStateChanged$.next({ diff, local: true });
  }

  /** TreeNodeModel 树 → 可见布局输入（含各节点测量尺寸——纯函数层零 PIXI 依赖）。
   *  折叠节点的 children 剔除（specs §5.1 输入可见树）；hiddenCount 后序统计
   *  一次完成（禁止每节点 O(子树) 重算）——徽标显示隐藏后代数 */
  private toLayoutSpec(node: TreeNodeModel): ILayoutNode & { hiddenCount: number } {
    const vm = this.nodeVms.get(node.id);
    const json = node.toJSON();
    const collapsed = json.collapsed === true;
    const childSpecs = collapsed ? [] : node.children.map((c) => this.toLayoutSpec(c));
    const hiddenCount = collapsed
      ? node.children.reduce((acc, c) => acc + 1 + this.subtreeSize(c), 0)
      : childSpecs.reduce((acc, c) => acc + c.hiddenCount, 0);
    return {
      id: node.id,
      width: vm?.nodeWidth ?? 60,
      height: vm?.nodeHeight ?? 24,
      direction: json.direction,
      children: childSpecs,
      hiddenCount,
    };
  }

  private subtreeSize(node: TreeNodeModel): number {
    return 1 + node.children.reduce((acc, c) => acc + this.subtreeSize(c), 0);
  }

  /** 徽标同步：折叠节点（hiddenCount>0）显示 +N，锚在朝子侧边中点（根恒右下角）。
   *  一次 DFS 展平（id → 继承侧 + hiddenCount），全体 O(n)。竖向时 left=上侧、
   *  right=下侧（物理轴映射在 TreeNodeVm.badgeCenter 内按 vertical 翻转） */
  private syncBadges(spec: ILayoutNode & { hiddenCount: number }): void {
    const vertical = this.orientation === 'vertical';
    const info = new Map<string, { side: 'left' | 'right'; hiddenCount: number }>();
    const walk = (n: ILayoutNode & { hiddenCount: number }, side: 'left' | 'right'): void => {
      const s = n.direction ?? side;
      info.set(n.id, { side: s, hiddenCount: n.hiddenCount });
      for (const c of (n.children ?? []) as Array<ILayoutNode & { hiddenCount: number }>) {
        walk(c, s);
      }
    };
    walk(spec, 'right');
    for (const [id, vm] of this.nodeVms) {
      const st = info.get(id);
      if (!st || st.hiddenCount <= 0 || id === spec.id) vm.setBadge(null, 'right', vertical);
      else vm.setBadge(st.hiddenCount, st.side, vertical);
    }
  }

  override hitTestPoint(p: Point): boolean {
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    for (const vm of this.nodeVms.values()) {
      if (vm.visible === false) continue; // 折叠隐藏后代不参与命中（specs §8.4）
      if (rectContainsPoint(vm.rect, { x: lx, y: ly })) return true;
    }
    return false;
  }

  /** 视觉包围盒（含左树负向展开的 bbox 偏移）：选区框/框选/命中粗筛/参考线共用。
   *  旧实现丢掉 bbox 偏移、以锚点为原点——左树越界部分不在包围盒内（2026-09 审查） */
  override getBounds(): IRect {
    const b = this.state;
    const layout = this.lastLayout;
    if (layout) {
      return {
        x: this.root.x + layout.bbox.x,
        y: this.root.y + layout.bbox.y,
        width: layout.bbox.width,
        height: layout.bbox.height,
      };
    }
    return {
      x: this.root.x,
      y: this.root.y,
      width: b.width * this.root.scale.x,
      height: b.height * this.root.scale.y,
    };
  }

  /** 拖拽预览：initBounds 是包围盒原点（getBounds 语义）；root 锚定 = 原点 − bbox 偏移 + delta */
  override applyDragPreview(initBounds: IRect, dx: number, dy: number): void {
    const bx = this.lastLayout?.bbox.x ?? 0;
    const by = this.lastLayout?.bbox.y ?? 0;
    this.root.position.set(initBounds.x - bx + dx, initBounds.y - by + dy);
  }

  /** 拖拽落库：rect.x/y 存锚点（= 根左上角，创建语义）；bbox 尺寸为派生量不落库
   *  （防 layout→写 rect→再 layout 循环，docs/11 §4） */
  override commitDrag(initBounds: IRect, dx: number, dy: number): void {
    const bx = this.lastLayout?.bbox.x ?? 0;
    const by = this.lastLayout?.bbox.y ?? 0;
    this.model?.updateRect({ x: initBounds.x - bx + dx, y: initBounds.y - by + dy });
  }

  /** 节点 rect（root 相对坐标；TreeService DropArea 消费） */
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null {
    const vm = this.nodeVms.get(id);
    return vm ? vm.rect : null;
  }

  /** 节点 Vm 访问（节点编辑器取字号/深度用） */
  getNodeVm(id: string): TreeNodeVm | null {
    return this.nodeVms.get(id) ?? null;
  }

  /** 节点本体透明度（拖拽重排拖影：本体半透明留原地 + 快照跟随光标，
   *  docs/11 §6「选中节点半透明 + 生成拖影快照」） */
  setNodeAlpha(id: string, alpha: number): void {
    const vm = this.nodeVms.get(id);
    if (!vm || vm.alpha === alpha) return;
    vm.alpha = alpha;
    markRender();
  }

  /** 节点命中（节点级选中/导航用；返回节点 Vm 或 null） */
  hitNode(p: Point): TreeNodeVm | null {
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    for (const vm of this.nodeVms.values()) {
      if (vm.visible === false) continue; // 折叠隐藏后代不参与命中（specs §8.4）
      if (rectContainsPoint(vm.rect, { x: lx, y: ly })) return vm;
    }
    return null;
  }

  /** 节点徽标命中（点击折叠徽标 = 展开——selector 经 hitToggle 消费）。
   *  badgeRect 是节点容器局部坐标，需叠加节点 position（图容器局部）后比对 */
  hitBadge(p: Point): TreeNodeVm | null {
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    for (const vm of this.nodeVms.values()) {
      if (vm.visible === false) continue;
      const b = vm.badgeRect;
      if (b && rectContainsPoint({ ...b, x: b.x + vm.x, y: b.y + vm.y }, { x: lx, y: ly }))
        return vm;
    }
    return null;
  }

  override hitTestRect(r: { x: number; y: number; width: number; height: number }): boolean {
    return rectsIntersect(this.getBounds(), r);
  }

  override dispose(): void {
    for (const unbinds of this.nodeUnbinds.values()) {
      for (const u of unbinds) u();
    }
    this.nodeUnbinds.clear();
    for (const vm of this.nodeVms.values()) vm.destroy({ children: true });
    this.nodeVms.clear();
    super.dispose();
  }
}

/** MIND_MAP 薄子类：注入 mind kind（specs §3.3——两个类型是同骨架的策略实例） */
export class MindMapVm extends TreeMapVm<MindMapData & IRect> {
  constructor() {
    super(mindKind);
  }
}
