/**
 * 脑图导航 / 焦点转移 / 视窗跟随纯逻辑（docs/11 §7）。
 *
 * 既有设计把这套规则埋在 VM 与 Service 里（`mindFocusController.ts` +
 * `services/helpers.ts` 的 getNearestSibling/getNearestChild/getFocusAfterDelete/
 * getRootDirection + `utils.ts` 的 alignLine/intersectDistance）。spinth 把数学抽成
 * 纯函数：输入是轻量导航树 `INavNode`（不依赖 Yjs / PIXI），便于把边界情形单测锁死。
 *
 * 与既有设计的对应关系逐函数标注，参数语义一一对齐（不是近似实现）。
 */

/** 轻量导航树节点（MindService 从 MindNodeModel 构建；parent 反向引用建树时填） */
export interface INavNode {
  id: string;
  /** 自身 direction（仅根的直接子节点落盘，深层缺省——有效值沿父链回溯） */
  direction?: 'left' | 'right';
  parent: INavNode | null;
  children: INavNode[];
}

/** 一维区间（节点在屏幕上的 y 跨度 / 可视区跨度） */
export interface ISpan {
  top: number;
  bottom: number;
}

/** rootInsertSide 的结构子集入参（INavNode 天然满足） */
export interface IRootSideInput {
  direction?: 'left' | 'right';
  children: ReadonlyArray<{ direction?: 'left' | 'right' }>;
}

/** 屏幕像素矩形（焦点跟随用；left/right/top/bottom 四边） */
export interface IScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 有效侧向：自身有值取自身，否则沿父链继承（既有设计 MindNodeModel.getDirection） */
export function effectiveDirection(node: INavNode): 'left' | 'right' {
  let n: INavNode | null = node;
  while (n) {
    if (n.direction === 'left' || n.direction === 'right') return n.direction;
    n = n.parent;
  }
  return 'right';
}

/**
 * 根层插入侧（既有设计 getRootDirection，三规则）：
 * ① 根自身有 direction → 同向；② 子数 < 3 → 右；③ 否则插少的一侧。
 * 未落 direction 的子节点按 right 计数（既有设计 `item.get('direction') === 'left'` 语义）。
 * 入参是结构子集，避免为了取插入侧构建整棵导航树。
 */
export function rootInsertSide(root: IRootSideInput): 'left' | 'right' {
  if (root.direction === 'left' || root.direction === 'right') return root.direction;
  if (root.children.length < 3) return 'right';
  let left = 0;
  let right = 0;
  for (const c of root.children) {
    if (c.direction === 'left') left++;
    else right++;
  }
  return left < right ? 'left' : 'right';
}

/**
 * 同侧兄弟（既有设计 getNearestSibling）：
 * 先在同侧逐位扫描；到同侧数据边界时上溯父的兄弟（叔节点）再下钻到其端点子节点。
 * 跨父时**不带侧向过滤**（叔节点整棵都在同一侧，既有设计同样不过滤）。
 */
export function nearestSibling(node: INavNode, dir: 'before' | 'after'): INavNode | undefined {
  const parent = node.parent;
  if (!parent) return undefined; // 根节点无兄弟

  const idx = parent.children.indexOf(node);
  const last = parent.children.length - 1;
  const atBoundary = (idx === 0 && dir === 'before') || (idx === last && dir === 'after');

  if (atBoundary) {
    const parentSibling = nearestSibling(parent, dir);
    if (!parentSibling || parentSibling.children.length === 0) return undefined;
    const pick = dir === 'before' ? parentSibling.children.length - 1 : 0;
    return parentSibling.children[pick];
  }

  const side = effectiveDirection(node);
  const delta = dir === 'before' ? -1 : 1;
  for (let i = idx + delta; i >= 0 && i < parent.children.length; i += delta) {
    const item = parent.children[i]!;
    if (effectiveDirection(item) === side) return item;
  }
  return undefined;
}

/**
 * 视图最近的子节点（既有设计 getNearestChild）：
 * ① 只有一个子 → 直接返回；② 父中点落在某子区间内 → 该子；
 * ③ 否则取区间端点离父中点最近者（子节点顺序排列，距离先减后增，可提前收敛）。
 * `side` 仅根节点传（按左右分侧）。
 */
export function nearestChild(
  node: INavNode,
  spanOf: (n: INavNode) => ISpan | null,
  side?: 'left' | 'right',
): INavNode | undefined {
  const children = side
    ? node.children.filter((c) => effectiveDirection(c) === side)
    : node.children;
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];

  const parentSpan = spanOf(node);
  if (!parentSpan) return children[0];
  const mid = (parentSpan.top + parentSpan.bottom) / 2;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < children.length; i++) {
    const s = spanOf(children[i]!);
    if (!s) continue;
    if (s.bottom >= mid && s.top <= mid) return children[i];
    const dist = Math.min(Math.abs(s.top - mid), Math.abs(s.bottom - mid));
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    } else {
      break; // 距离已开始变大
    }
  }
  return children[bestIdx];
}

/**
 * 删除后的焦点（既有设计 getFocusAfterDelete）：
 * 优先同侧后一个未删兄弟 → 再前一个 → 都没有则递归到父（父成为优先节点）。
 * 特例：父为根、且删的是该侧最后一个次级节点 → 焦点回根（避免落到另一侧）。
 * `deleted` 为本次删除的节点 id 集合（单删时只含 priority 自身，语义与多选删除一致）。
 */
export function focusAfterDelete(
  deleted: ReadonlySet<string>,
  priority: INavNode,
): INavNode | undefined {
  const parent = priority.parent;
  if (!parent) return undefined; // 根被删 = 整图删除，无焦点（既有设计仅「同批删多棵树」才切换）

  const siblings =
    parent.parent === null
      ? parent.children.filter((c) => effectiveDirection(c) === effectiveDirection(priority))
      : parent.children;

  if (
    parent.parent === null &&
    deleted.has(priority.id) &&
    (siblings.length === 1 || siblings.filter((s) => deleted.has(s.id)).length === siblings.length)
  ) {
    return parent;
  }

  const idx = siblings.indexOf(priority);
  if (idx < 0) return focusAfterDelete(deleted, parent);

  for (let i = idx; i < siblings.length; i++) {
    const next = siblings[i]!;
    if (!deleted.has(next.id)) return next;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const prev = siblings[i]!;
    if (!deleted.has(prev.id)) return prev;
  }
  return focusAfterDelete(deleted, parent);
}

/** 两区间相交长度：有相交为正，无相交为负（既有设计 intersectDistance） */
export function intersectDistance(
  start1: number,
  end1: number,
  start2: number,
  end2: number,
): number {
  const startMax = Math.max(Math.min(start1, end1), Math.min(start2, end2));
  const endMin = Math.min(Math.max(start1, end1), Math.max(start2, end2));
  return endMin - startMax;
}

/**
 * 线段 A 对齐线段 B 所需的移动量（既有设计 alignLine，注释里的三条对齐规则）：
 * ① A 短于 B → 对齐较近的边；② A 长于 B → 对齐较远的边；③ A 包含 B → 往超出较少的一头移。
 * 任一端已对齐（1e-4 内）返回 0；符号约定「左正右负 / 上正下负」（叠加到节点位移）。
 */
export function alignLine(startA: number, endA: number, startB: number, endB: number): number {
  if (Math.abs(startA - startB) < 0.0001 || Math.abs(endA - endB) < 0.0001) return 0;

  const aIsLongerThanB = Math.abs(endB - startB) - Math.abs(endA - startA) < 0;

  if (aIsLongerThanB && startA < startB && endA > endB) {
    const start = Math.abs(startB - startA);
    const end = Math.abs(endA - endB);
    return start < end ? start : -end;
  } else if (endA < startB || (startA < startB && endA > startB && endA < endB)) {
    return aIsLongerThanB ? Math.abs(endB - endA) : Math.abs(startB - startA);
  } else {
    return -(aIsLongerThanB ? Math.abs(startA - startB) : Math.abs(endA - endB));
  }
}

/**
 * 焦点跟随位移（既有设计 mindFocusController.moveToFocus，坐标统一到屏幕像素）：
 * 节点与可视区在**两轴上的相交长度都 ≥ 节点自身尺寸**时不动；否则哪个轴不足就对齐哪个轴。
 * 返回叠加到视口平移（stage.x/y）上的屏幕像素位移——沿用 alignLine 的符号约定。
 *
 * 注：既有设计把世界坐标（getNodeBounds）直接与 clientRect（屏幕像素）比较，非 100%
 * 缩放下两轴口径不一致；spinth 统一换算到屏幕空间，规则与阈值语义不变。
 */
export function focusFollowDelta(node: IScreenRect, win: IScreenRect): { x: number; y: number } {
  const width = node.right - node.left;
  const height = node.bottom - node.top;
  const ix = intersectDistance(node.left, node.right, win.left, win.right);
  const iy = intersectDistance(node.top, node.bottom, win.top, win.bottom);
  if (width <= ix && height <= iy) return { x: 0, y: 0 };

  const move = { x: 0, y: 0 };
  if (ix < width) move.x = alignLine(node.left, node.right, win.left, win.right);
  if (iy < height) move.y = alignLine(node.top, node.bottom, win.top, win.bottom);
  return move;
}
