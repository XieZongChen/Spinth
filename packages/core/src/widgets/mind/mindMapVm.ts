import { Graphics, Point } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { rectContainsPoint, rectsIntersect, type IRect } from '../../common/geometry';
import type { MindMapData } from '../../types';
import { MIND_COLORS } from './mindNodeVm';
import { MindNodeModel } from './mindNodeModel';
import { MindNodeVm } from './mindNodeVm';
import { layoutMindTree, type ILayoutNode, type ILayoutResult } from './mindLayout';
import { rootT, rootStartX, rootEnd, nodeConnectorPath, ROOT_CP_RATIO } from './mindDrawerMath';
import type { MindMapModel } from './mindMapModel';

/** 连线宽度（既有设计 constants.LINE_WIDTH = 4；根连线同宽） */
const MIND_LINE_WIDTH = 4;

/**
 * 脑图整图视图（docs/11 §4，2026-09 编排决策）：
 * - 树内节点 Vm 由本类统一 build/destroy（childrenChange$ 增量）；
 * - **布局合批**：任何树变化（结构/文本）→ 微任务一次全量 layoutMindTree +
 *   位置差异应用（纯函数布局 O(树) 代价可忽略；「每节点 render 排自己 children
 *   + 逐级冒泡」的既有设计形态在 spinth 简化为全量计算 + 差异应用——满足规格的
 *   「同帧多变化只收敛一次」，增量逐节点重排留给性能专项评估）；
 * - 根锚定：容器原点 = 根节点左上角（布局负坐标自然向左上展开）；
 *   整图 rect 只在拖拽时变（防 layout→写 rect→再 layout 循环）。
 */
export class MindMapVm extends BaseWidgetVm<MindMapData & IRect> {
  private readonly nodeVms = new Map<string, MindNodeVm>();
  private readonly nodeUnbinds = new Map<string, Array<() => void>>();
  private readonly drawer = new Graphics();
  private relayoutScheduled = false;
  private lastLayout: ILayoutResult | null = null;
  /** 上次广播时的布局 bbox——树生长/收缩检测（变化才进 diff 键集） */
  private lastBbox: IRect | null = null;

  constructor() {
    super({
      id: '',
      type: 'MIND_MAP',
      zOrder: '',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.eventMode = 'none';
    this.root.addChild(this.drawer);
  }

  private get mapModel(): MindMapModel | null {
    return this.model as MindMapModel | null;
  }

  override render(_prev: MindMapData & IRect, next: MindMapData & IRect): void {
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
  private attachTree(rootModel: MindNodeModel): void {
    if (this.treeAttached) return;
    this.treeAttached = true;
    this.syncTree(rootModel);
  }

  /** Vm 树与 Model 树对齐：建缺失 + 销毁多余（先应用更新再销毁——docs/11 §3），
   *  新建节点挂 observeSelf（文本变化 → refresh + 重排） */
  private syncTree(rootModel: MindNodeModel): void {
    const alive = new Set<string>();
    const walk = (node: MindNodeModel, depth: number): void => {
      alive.add(node.id);
      if (!this.nodeVms.has(node.id)) {
        const vm = new MindNodeVm(node, depth);
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
    const layout = layoutMindTree(spec);
    this.lastLayout = layout;
    for (const [id, vm] of this.nodeVms) {
      const p = layout.positions.get(id);
      if (p) vm.position.set(p.x, p.y);
    }
    this.drawConnectors(model.root, layout);
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

  /** MindNodeModel 树 → 布局输入（含各节点测量尺寸——纯函数层零 PIXI 依赖） */
  private toLayoutSpec(node: MindNodeModel): ILayoutNode {
    const vm = this.nodeVms.get(node.id);
    const json = node.toJSON();
    return {
      id: node.id,
      width: vm?.nodeWidth ?? 60,
      height: vm?.nodeHeight ?? 24,
      direction: json.direction,
      children: node.children.map((c) => this.toLayoutSpec(c)),
    };
  }

  /**
   * 连线（docs/11 §5 完整版）：
   * - 根→一级：二次贝塞尔（t 参数曲线起点 + cpX = startX+(endX-startX)·0.2）
   * - 普通：折线 + R8 圆弧拐角（兄弟共享垂直段 midX——鱼骨视觉）
   */
  private drawConnectors(node: MindNodeModel, layout: ILayoutResult): void {
    const g = this.drawer;
    g.clear();
    const rootModel = this.mapModel!.root;
    const rootVm = this.nodeVms.get(rootModel.id);
    if (!rootVm) return;

    const draw = (n: MindNodeModel, isRootChild: boolean): void => {
      const p = layout.positions.get(n.id);
      const vm = this.nodeVms.get(n.id);
      if (!p || !vm) return;

      for (const c of n.children) {
        const cp = layout.positions.get(c.id);
        const cvm = this.nodeVms.get(c.id);
        if (!cp || !cvm) continue;
        const childIsLeft = cp.x < p.x;
        const color = hexToInt(c.getLineColor(MIND_COLORS.lineFallback));

        if (isRootChild) {
          // 根→一级：t 参数起点 + 二次贝塞尔
          const rootRect = { x: p.x, y: p.y, width: vm.nodeWidth, height: vm.nodeHeight };
          const childRect = { x: cp.x, y: cp.y, width: cvm.nodeWidth, height: cvm.nodeHeight };
          const vertDist = Math.abs(
            childRect.y + childRect.height / 2 - (rootRect.y + rootRect.height / 2),
          );
          const t = rootT(vertDist, childIsLeft);
          const sX = rootStartX(rootRect.x + rootRect.width / 2, rootRect.width, t);
          const sY = rootRect.y + rootRect.height / 2;
          const e = rootEnd(childRect, childIsLeft);
          const cpX = sX + (e.x - sX) * ROOT_CP_RATIO;
          const cpY = e.y;
          g.moveTo(sX, sY)
            .quadraticCurveTo(cpX, cpY, e.x, e.y)
            .stroke({ width: MIND_LINE_WIDTH, color, cap: 'round' });
        } else {
          // 普通：鱼骨折线 + 真圆弧拐角（既有设计 drawer.drawNodeLine 四象限分情况）
          const cmds = nodeConnectorPath(
            { x: p.x, y: p.y, width: vm.nodeWidth, height: vm.nodeHeight },
            { x: cp.x, y: cp.y, width: cvm.nodeWidth, height: cvm.nodeHeight },
          );
          for (const cmd of cmds) {
            if (cmd.op === 'moveTo') g.moveTo(cmd.x, cmd.y);
            else if (cmd.op === 'lineTo') g.lineTo(cmd.x, cmd.y);
            else if (cmd.op === 'cubicTo')
              g.bezierCurveTo(cmd.c1x, cmd.c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y);
            else g.arc(cmd.cx, cmd.cy, cmd.r, cmd.start, cmd.end, cmd.ccw);
          }
          g.stroke({ width: MIND_LINE_WIDTH, color, cap: 'round', join: 'round' });
        }
        draw(c, false);
      }
    };
    draw(rootModel, true);
  }

  override hitTestPoint(p: Point): boolean {
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    for (const vm of this.nodeVms.values()) {
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

  /** 节点 rect（root 相对坐标；MindService DropArea 消费） */
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null {
    const vm = this.nodeVms.get(id);
    return vm ? vm.rect : null;
  }

  /** 节点 Vm 访问（节点编辑器取字号/深度用） */
  getNodeVm(id: string): MindNodeVm | null {
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
  hitNode(p: Point): MindNodeVm | null {
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    for (const vm of this.nodeVms.values()) {
      if (rectContainsPoint(vm.rect, { x: lx, y: ly })) return vm;
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

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
