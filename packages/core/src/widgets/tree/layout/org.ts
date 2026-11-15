/**
 * 组织架构布局纯函数（specs/tree-diagrams §5.4，Phase 3）：
 * 按层定 y（层顶 = 上一层最大底边 + LEVEL_GAP）、按子树宽度定 x（自底向上
 * 子树宽度，GAP 间隔）、父在子跨度上居中——「层级对齐」的秩序感，不能由脑图
 * 布局加参数得到（转置会得到「父居中但同层错层」）。
 * 纯函数：不 import PIXI/Yjs/服务；输入可见树（折叠后代已剔除）。
 */
import type { ILayoutNode, ILayoutResult } from './types';

/** 上一层最大底边到下一层层顶 */
export const ORG_LEVEL_GAP = 56;
/** 相邻子树之间 */
export const ORG_SIBLING_GAP = 24;

interface SizedNode {
  node: ILayoutNode;
  depth: number;
  subtreeW: number;
  children: SizedNode[];
}

/** 自底向上：子树宽度 = max(自身宽, Σ子树宽 + GAP*(n-1))；同时一次建层表 */
function sizeUp(node: ILayoutNode, depth: number, byDepth: Map<number, SizedNode[]>): SizedNode {
  const children = (node.children ?? []).map((c) => sizeUp(c, depth + 1, byDepth));
  const blockW =
    children.length === 0
      ? 0
      : children.reduce((a, c) => a + c.subtreeW, 0) + ORG_SIBLING_GAP * (children.length - 1);
  const subtreeW = Math.max(node.width, blockW);
  const sized: SizedNode = { node, depth, subtreeW, children };
  const list = byDepth.get(depth) ?? [];
  list.push(sized);
  byDepth.set(depth, list);
  return sized;
}

/**
 * 上→下布局：positions 相对根左上角（根 (0,0)；子块居中于根 → 同层负 x 可能）。
 * levels 输出每节点层深（org 测试/调试用，specs §5.1）。
 */
export function layoutOrgTree(root: ILayoutNode): ILayoutResult & { levels: Map<string, number> } {
  const byDepth = new Map<number, SizedNode[]>();
  const sizedRoot = sizeUp(root, 0, byDepth);

  // 每层最大高度 → 层顶
  const levelTop = new Map<number, number>();
  let top = 0;
  const maxDepth = Math.max(...byDepth.keys());
  for (let d = 0; d <= maxDepth; d++) {
    levelTop.set(d, top);
    const maxH = Math.max(...(byDepth.get(d) ?? []).map((s) => s.node.height), 0);
    top += maxH + ORG_LEVEL_GAP;
  }

  const positions = new Map<string, { x: number; y: number }>();
  const levels = new Map<string, number>();
  let minX = 0;
  let maxX = root.width;
  let maxY = root.height;

  // 自顶向下：x 槽位（块居中于父中线；单子天然同 x → 竖直连线无折弯）
  const assign = (s: SizedNode, x: number): void => {
    positions.set(s.node.id, { x, y: levelTop.get(s.depth)! });
    levels.set(s.node.id, s.depth);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + s.node.width);
    maxY = Math.max(maxY, levelTop.get(s.depth)! + s.node.height);
    const blockW =
      s.children.length === 0
        ? 0
        : s.children.reduce((a, c) => a + c.subtreeW, 0) +
          ORG_SIBLING_GAP * (s.children.length - 1);
    let cursor = x + s.node.width / 2 - blockW / 2;
    for (const c of s.children) {
      assign(c, cursor + (c.subtreeW - c.node.width) / 2);
      cursor += c.subtreeW + ORG_SIBLING_GAP;
    }
  };
  assign(sizedRoot, 0);

  return {
    positions,
    bbox: { x: minX, y: 0, width: maxX - minX, height: maxY },
    levels,
  };
}
