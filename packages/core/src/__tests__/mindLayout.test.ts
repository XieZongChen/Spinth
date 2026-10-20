import { describe, expect, it } from 'vitest';
import {
  layoutMindTree,
  VERTICAL_MARGIN_CROSS,
  type ILayoutNode,
} from '../widgets/mind/mindLayout';

const n = (
  id: string,
  width = 60,
  height = 20,
  children?: ILayoutNode[],
  direction?: 'left' | 'right',
): ILayoutNode => ({ id, width, height, children, direction });

describe('脑图自排版（docs/11 §4）', () => {
  it('单根：位置 (0,0)，bbox 即根尺寸', () => {
    const r = layoutMindTree(n('root', 100, 40));
    expect(r.positions.get('root')).toEqual({ x: 0, y: 0 });
    expect(r.bbox).toEqual({ x: 0, y: 0, width: 100, height: 40 });
  });

  it('右侧两子：水平偏移 100，垂直堆叠间距 50 且整体居中于根', () => {
    const root = n('root', 100, 40, [n('a'), n('b')]);
    const r = layoutMindTree(root);
    const a = r.positions.get('a')!;
    const b = r.positions.get('b')!;
    expect(a.x).toBe(100 + 100); // parentWidth + HORIZONTAL_OFFSET_ROOT
    // 堆叠高 = 20+50+20 = 90，startY = 20 - 45 = -25 → a.y = -25 + 0 = -25（子树 bbox 顶 0）
    expect(a.y).toBe(-25);
    expect(b.y).toBe(a.y + 20 + 50);
    // 子组中心对齐根中心：(a.y + b.y + 20)/2 == 20
    expect((a.y + b.y + 20) / 2).toBe(20);
  });

  it('左右分侧：left 子在根左侧（x 为负），两侧互不干扰', () => {
    const root = n('root', 100, 40, [
      n('r1', 60, 20, undefined, 'right'),
      n('l1', 60, 20, undefined, 'left'),
    ]);
    const r = layoutMindTree(root);
    expect(r.positions.get('l1')!.x).toBe(-100 - 60);
    expect(r.positions.get('r1')!.x).toBe(200);
    expect(r.bbox.x).toBeLessThan(0); // 包围盒扩到左侧
    expect(r.bbox.width).toBeGreaterThan(100);
  });

  it('孙节点偏移 48（次级以下用 NODE 间距）；子树嵌套 y 相对父传播', () => {
    const root = n('root', 100, 40, [n('a', 60, 20, [n('a1', 50, 16), n('a2', 50, 16)])]);
    const r = layoutMindTree(root);
    const a1 = r.positions.get('a1')!;
    const a = r.positions.get('a')!;
    expect(a1.x).toBe(a.x + 60 + 48); // 父宽 + NODE offset
    // a 子树内堆叠间距 4，且不含末尾外边距（既有设计 reduce 口径）→ 孙节点块严格居中于 a
    const a2 = r.positions.get('a2')!;
    expect((a1.y + a2.y + 16) / 2).toBe(a.y + 10);
  });

  it('唯一子节点 / 中间子节点与父节点严格居中（父子连线是直线的前提）', () => {
    // 唯一子：子中心必须等于父中心（差 1px 就会在连线上出现台阶/S 弯）
    const one = layoutMindTree(n('root', 100, 40, [n('a', 60, 20)]));
    expect(one.positions.get('a')!.y + 10).toBe(20);

    // 三子：中间那个同样严格居中（既有设计 reduce 无初始值 → 不含末尾外边距）
    const three = layoutMindTree(
      n('root', 100, 40, [n('a', 60, 20), n('b', 60, 20), n('c', 60, 20)]),
    );
    expect(three.positions.get('b')!.y + 10).toBe(20);

    // 深层同理：非根父节点的唯一子也严格居中
    const nested = layoutMindTree(n('root', 100, 40, [n('a', 60, 20, [n('a1', 50, 16)])]));
    expect(nested.positions.get('a1')!.y + 8).toBe(nested.positions.get('a')!.y + 10);
  });

  it('根层间距动态收紧：上一子树自身拉开的距离越大，间距越接近下限 38', () => {
    // 叶子（子树 = 本体，lastBottom=0）→ 保持 VERTICAL_MARGIN_SECOND = 50
    const leaves = layoutMindTree(n('root', 100, 40, [n('a', 60, 20), n('b', 60, 20)]));
    const ay = leaves.positions.get('a')!.y;
    const by = leaves.positions.get('b')!.y;
    expect(by - ay).toBe(20 + 50);

    // 上一个子节点带高子树（子树在节点下方延伸很多）→ 间距收紧到 38
    const withSub = layoutMindTree(
      n('root', 100, 40, [n('a', 60, 20, [n('a1'), n('a2'), n('a3'), n('a4')]), n('b', 60, 20)]),
    );
    const b = withSub.positions.get('b')!;
    // 间距作用在「子树盒」之间：a 的盒子底 = 其子树最靠下的节点底（本 fixture 为 a4）
    const aBoxBottom = Math.max(
      ...['a', 'a1', 'a2', 'a3', 'a4'].map((id) => withSub.positions.get(id)!.y + 20),
    );
    expect(b.y - aBoxBottom).toBeCloseTo(VERTICAL_MARGIN_CROSS); // 收紧到下限（叶子场景才是 50）
  });

  it('根垂直平衡：左右两侧高度不同时各自居中根', () => {
    const root = n('root', 100, 40, [
      n('r1', 60, 20, [n('r1c'), n('r1d'), n('r1e')]),
      n('l1', 60, 20, undefined, 'left'),
    ]);
    const r = layoutMindTree(root);
    // 侧内子树都以根中心 20 为中心
    const l = r.positions.get('l1')!;
    expect(l.y + 10).toBeCloseTo(20);
  });

  it('左树深层向左生长（回归 2026-09 实测：左树孙子曾长进父子之间）', () => {
    const root = n('root', 100, 40, [
      n('l1', 60, 20, [n('l1a'), n('l1b')], 'left'),
      n('r1', 60, 20, [n('r1a')], 'right'),
    ]);
    const r = layoutMindTree(root);
    const l1 = r.positions.get('l1')!;
    const l1a = r.positions.get('l1a')!;
    const l1b = r.positions.get('l1b')!;
    expect(l1.x).toBeLessThan(0); // 一级左子在根左侧
    // 孙节点整体在 l1 左侧（右缘不超过 l1 左缘），而非插在 l1 与根之间
    expect(l1a.x + 60).toBeLessThanOrEqual(l1.x);
    expect(l1b.x + 60).toBeLessThanOrEqual(l1.x);
    // 右树不受影响：深层仍向右生长
    const r1a = r.positions.get('r1a')!;
    expect(r1a.x).toBeGreaterThan(r.positions.get('r1')!.x);
  });
});
