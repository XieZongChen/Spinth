import type { IRect } from '../../common/geometry';

/**
 * 脑图递归自排版纯函数（docs/11 §4，2026-09 实施批第一步：数学核心独立可测；
 * Vm 编排层（BaseNodeVm/冒泡合批）随后接入）。
 *
 * 规则：根锚定不动；每侧子树堆叠后整体垂直居中于父中心（子树矮 → 子组对齐父，
 * 子树高 → 父天然居中于子树）；childX 左侧父左偏移、右侧父右偏移。
 */

export const HORIZONTAL_OFFSET_ROOT = 100;
export const HORIZONTAL_OFFSET_NODE = 48;
export const VERTICAL_NODE_MARGIN = 4;
export const VERTICAL_MARGIN_SECOND = 50;
/** 跨侧（左右树）间距下限：上一子树自身已拉开距离时根层间距收紧到此值（既有设计 VERTICAL_MARGIN_CROSS） */
export const VERTICAL_MARGIN_CROSS = 38;

export interface ILayoutNode {
  id: string;
  width: number;
  height: number;
  direction?: 'left' | 'right';
  children?: ILayoutNode[];
}

export interface ILayoutResult {
  /** 相对根左上角的位置 */
  positions: Map<string, { x: number; y: number }>;
  bbox: IRect;
}

/**
 * 布局：返回每节点相对位置与整树包围盒（含根）。
 * 根在 (0,0)；childY 堆叠间距 = 根直接子 VERTICAL_MARGIN_SECOND / 其余 VERTICAL_NODE_MARGIN。
 * `subtreeSide` 缺省 = 根层布局（左右两侧，子用 ROOT 偏移/SECOND 间距）；
 * 显式传入 = 非根子树（单侧，子层用 NODE 偏移/NODE 间距——拖出成图等场景）。
 */
export function layoutMindTree(
  root: ILayoutNode,
  opts: { subtreeSide?: 'left' | 'right' } = {},
): ILayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(root.id, { x: 0, y: 0 });

  // subtreeSide：整棵子树朝向（深层节点无 direction 字段，沿父链继承朝向）。
  // 旧实现深层一律右向——左树的孙子长到父节点右侧、插在父子之间（2026-09 实测）
  const side = opts.subtreeSide;
  const sides: Array<'left' | 'right'> = side ? [side] : ['right', 'left'];
  let minTop = 0;
  let maxBottom = root.height;
  let maxRight = root.width;
  let minLeft = 0;

  for (const sd of sides) {
    const kids = (root.children ?? []).filter((c) => (c.direction ?? side ?? 'right') === sd);
    if (kids.length === 0) continue;
    const subtree = layoutSide(kids, sd === 'left', root.width, root.height, !side);
    for (const [id, p] of subtree.positions) positions.set(id, p);
    minTop = Math.min(minTop, subtree.minTop);
    maxBottom = Math.max(maxBottom, subtree.maxBottom);
    if (sd === 'left') minLeft = Math.min(minLeft, subtree.extent);
    else maxRight = Math.max(maxRight, subtree.extent);
  }

  return {
    positions,
    bbox: { x: minLeft, y: minTop, width: maxRight - minLeft, height: maxBottom - minTop },
  };
}

/** 一侧子树堆叠：返回子节点相对根的位置；extent = 该侧最远水平边界（left 为负） */
function layoutSide(
  kids: ILayoutNode[],
  isLeft: boolean,
  parentWidth: number,
  parentHeight: number,
  isRootSide: boolean,
): {
  positions: Map<string, { x: number; y: number }>;
  minTop: number;
  maxBottom: number;
  extent: number;
} {
  const offset = isRootSide ? HORIZONTAL_OFFSET_ROOT : HORIZONTAL_OFFSET_NODE;

  // 1) 逐子递归：先各自整棵排好，再堆叠。深层朝向随本侧镜像（left 子树的
  //    后代全部向左生长）——曾固定右向导致左树深层长进父子之间
  const laid = kids.map((kid) => {
    const inner = layoutMindTree(kid, { subtreeSide: isLeft ? 'left' : 'right' });
    return { kid, inner, height: inner.bbox.height };
  });

  // 2) 垂直堆叠（间距规则见下），随后整体居中于父中心
  let cursorY = 0;
  const stack: Array<{ kid: ILayoutNode; inner: ILayoutResult; top: number }> = [];
  for (let i = 0; i < laid.length; i++) {
    const l = laid[i]!;
    if (i > 0) {
      if (isRootSide) {
        // 根层：间距 = max(50 − 上一个子节点盒子内「节点下方的空白」，38)
        //（既有设计 mindRootVm：上一子树自己已经拉开距离时收紧到 38，叶子节点时保持 50）
        const prev = laid[i - 1]!;
        const shapeYInBox = (prev.inner.positions.get(prev.kid.id)?.y ?? 0) - prev.inner.bbox.y;
        const lastBottom = Math.max(prev.height - (shapeYInBox + prev.kid.height), 0);
        cursorY += Math.max(VERTICAL_MARGIN_SECOND - lastBottom, VERTICAL_MARGIN_CROSS);
      } else {
        cursorY += VERTICAL_NODE_MARGIN;
      }
    }
    stack.push({ ...l, top: cursorY });
    cursorY += l.height;
  }
  // 堆叠总高 = Σ子树高 + Σ（i>0 的间距）——**不含末尾外边距**。
  // 既有设计 mindNodeVm 的 `reduce((total, h) => total + h + 4)` 没有初始值：
  // n=1 时回调根本不执行，n>1 时也只加 n-1 次；根层 mindRootVm 的 offset 同样只在 i>0 累加。
  // 曾按「末尾也加 4」实现 → 唯一子/中间子相对父中心偏 2px → 本该是直线的连线出现台阶。
  const totalH = laid.length === 0 ? 0 : cursorY;
  const parentCenterY = parentHeight / 2;
  const startY = parentCenterY - totalH / 2;
  const placements = stack.map((s) => ({ ...s, baseY: startY + s.top - s.inner.bbox.y }));

  // 3) 根层垂直平衡（既有设计 mindRootVm：首/末子节点**本体**中点围成的区间中点对齐根节点中点）
  if (isRootSide && placements.length > 0) {
    const first = placements[0]!;
    const last = placements[placements.length - 1]!;
    const secondMid = (first.baseY + first.kid.height / 2 + (last.baseY + last.kid.height / 2)) / 2;
    const shift = secondMid - parentHeight / 2;
    if (shift !== 0) for (const e of placements) e.baseY -= shift;
  }

  const positions = new Map<string, { x: number; y: number }>();
  let minTop = Infinity;
  let maxBottom = -Infinity;
  let extent = isLeft ? Infinity : -Infinity;

  for (const s of placements) {
    const childX = isLeft ? -offset - s.kid.width : parentWidth + offset;
    positions.set(s.kid.id, { x: childX, y: s.baseY });
    for (const [id, p] of s.inner.positions) {
      if (id === s.kid.id) continue;
      positions.set(id, { x: childX + p.x, y: s.baseY + p.y });
    }
    minTop = Math.min(minTop, s.baseY + s.inner.bbox.y);
    maxBottom = Math.max(maxBottom, s.baseY + s.inner.bbox.y + s.inner.bbox.height);
    extent = isLeft
      ? Math.min(extent, childX + s.inner.bbox.x)
      : Math.max(extent, childX + s.inner.bbox.x + s.inner.bbox.width);
  }
  void offset;
  return { positions, minTop, maxBottom, extent };
}
