/**
 * 组织架构导航（specs/tree-diagrams §8.1，Phase 3）：↑ 父、↓ 最近的子
 * （无子/折叠 = 不动）、←→ 前/后兄弟——**不跨叔节点**（与脑图不同：组织架构
 * 层级语义强，跨叔跳转会迷路）。spanOf 沿 x 轴（org 恒上→下）。
 */
import type { INavNode } from './types';

/** 兄弟内导航（到边界 = null，不上溯叔） */
function sibling(node: INavNode, dir: -1 | 1): string | null {
  if (!node.parent) return null;
  const idx = node.parent.children.indexOf(node);
  const next = node.parent.children[idx + dir];
  return next ? next.id : null;
}

/** 最近的子：唯一子直返；多个子取与父中线 x 区间相交/最近者（spanOf 判据） */
function nearestChild(
  node: INavNode,
  spanOf: (id: string) => { start: number; end: number } | null,
): string | null {
  const kids = node.children;
  if (kids.length === 0) return null; // 折叠节点在 buildNavTree 已剪成叶子
  if (kids.length === 1) return kids[0]!.id;
  const own = spanOf(node.id);
  if (!own) return kids[0]!.id;
  const mid = (own.start + own.end) / 2;
  let best = kids[0]!;
  let bestDist = Infinity;
  for (const k of kids) {
    const s = spanOf(k.id);
    if (!s) continue;
    if (s.start <= mid && s.end >= mid) return k.id; // 中线落在区间内
    const dist = Math.min(Math.abs(s.start - mid), Math.abs(s.end - mid));
    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  return best.id;
}

export function orgNavigate(
  currentId: string,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  ctx: {
    root: INavNode;
    byId: Map<string, INavNode>;
    spanOf: (id: string) => { start: number; end: number } | null;
  },
): string | null {
  const current = ctx.byId.get(currentId) ?? ctx.root;
  switch (key) {
    case 'ArrowUp':
      return current.parent ? current.parent.id : null;
    case 'ArrowDown':
      return nearestChild(current, ctx.spanOf);
    case 'ArrowLeft':
      return sibling(current, -1);
    case 'ArrowRight':
      return sibling(current, 1);
  }
}

/** 删除焦点落点：后兄弟 → 前兄弟 → 父；根删除无落点（= 删整图） */
export function orgFocusAfterDelete(
  nodeId: string,
  ctx: { byId: Map<string, INavNode> },
): string | null {
  const node = ctx.byId.get(nodeId);
  if (!node) return null;
  if (!node.parent) return null;
  const after = sibling(node, 1);
  if (after) return after;
  const before = sibling(node, -1);
  if (before) return before;
  return node.parent.id;
}
