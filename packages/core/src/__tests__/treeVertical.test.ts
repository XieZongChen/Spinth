import { describe, expect, it } from 'vitest';
import { layoutMindTree } from '../widgets/tree/layout/mindHorizontal';
import { layoutMindTreeVertical } from '../widgets/tree/layout/mindVertical';
import type { ILayoutNode } from '../widgets/tree/layout/types';
import { DropArea } from '../widgets/tree/drop/dropArea';
import { fakeBlockRect } from '../widgets/tree/drop/preview';
import { mindNavigate, mindNavigateVertical } from '../widgets/tree/nav/mind';
import type { INavNode } from '../widgets/tree/nav/types';

/** 脑图竖向单测（specs/tree-diagrams §5.3/§8.1/§8.3，Phase 2a）：
 *  转置对称、竖向导航键位映射、dropArea 轴参数化、预置块竖向。 */

const FIXTURE: ILayoutNode = {
  id: 'root',
  width: 120,
  height: 40,
  children: [
    {
      id: 'A',
      width: 80,
      height: 20,
      direction: 'right',
      children: [
        { id: 'A1', width: 50, height: 16 },
        { id: 'A2', width: 70, height: 24 },
      ],
    },
    { id: 'B', width: 60, height: 30, direction: 'right' },
    {
      id: 'L1',
      width: 90,
      height: 20,
      direction: 'left',
      children: [{ id: 'L1a', width: 40, height: 16 }],
    },
  ],
};

/** 节点宽高互换（转置输入——与 mindVertical 同式） */
function transposeNode(n: ILayoutNode): ILayoutNode {
  return {
    id: n.id,
    width: n.height,
    height: n.width,
    direction: n.direction,
    children: n.children?.map(transposeNode),
  };
}

describe('竖向布局 = 横向的严格转置（specs §5.3）', () => {
  it('夹具宽高互换跑横向、坐标互换 === 原夹具竖向（转置结构锁死）', () => {
    const hT = layoutMindTree(transposeNode(FIXTURE)); // 物理转置图的横向
    const v = layoutMindTreeVertical(FIXTURE);
    expect(v.positions.size).toBe(hT.positions.size);
    for (const [id, hp] of hT.positions) {
      const vp = v.positions.get(id)!;
      expect(vp.x).toBe(hp.y);
      expect(vp.y).toBe(hp.x);
    }
    expect(v.bbox).toEqual({
      x: hT.bbox.y,
      y: hT.bbox.x,
      width: hT.bbox.height,
      height: hT.bbox.width,
    });
  });

  it('单子链：子在父正下方 offset、同 x 中线（连线应为直线，无台阶）', () => {
    const v = layoutMindTreeVertical({
      id: 'r',
      width: 100,
      height: 30,
      children: [{ id: 'c', width: 60, height: 20, direction: 'right' }],
    });
    const c = v.positions.get('c')!;
    expect(c.y).toBe(30 + 100); // 父高 + 根层偏移
    expect(c.x + 30).toBe(50); // 子中心 x === 父中心 x（根 w=100 → 50）
  });

  it('上侧子树 y 为负（允许负 y，bbox 含上侧展开）', () => {
    const v = layoutMindTreeVertical({
      id: 'r',
      width: 100,
      height: 30,
      children: [{ id: 'up', width: 60, height: 20, direction: 'left' }],
    });
    expect(v.positions.get('up')!.y).toBeLessThan(0);
    expect(v.bbox.y).toBeLessThan(0);
  });

  it('根层水平平衡：首末子本体中点对齐根中点（转置性质）', () => {
    const v = layoutMindTreeVertical({
      id: 'r',
      width: 100,
      height: 30,
      children: [
        { id: 'a', width: 60, height: 20, direction: 'right' },
        { id: 'b', width: 60, height: 20, direction: 'right' },
      ],
    });
    const a = v.positions.get('a')!;
    const b = v.positions.get('b')!;
    const mid = (a.x + 30 + b.x + 30) / 2; // 子本体中心 x（子 w=60）
    expect(Math.abs(mid - 50)).toBeLessThan(1e-6); // 根中心 x = w/2
  });
});

describe('竖向导航键位映射（specs §8.1 表）', () => {
  const navTree: INavNode = {
    id: 'root',
    parent: null,
    children: [
      {
        id: 'up1',
        direction: 'left',
        parent: null as never,
        children: [{ id: 'up1a', parent: null as never, children: [] }],
      },
      { id: 'dn1', direction: 'right', parent: null as never, children: [] },
    ],
  };
  // 补 parent 引用（字面量声明后回填）
  navTree.children[0]!.parent = navTree;
  navTree.children[1]!.parent = navTree;
  (navTree.children[0]!.children[0] as INavNode).parent = navTree.children[0]!;

  const ctx = {
    root: navTree,
    byId: new Map<string, INavNode>([
      ['root', navTree],
      ['up1', navTree.children[0]!],
      ['up1a', navTree.children[0]!.children[0] as INavNode],
      ['dn1', navTree.children[1]!],
    ]),
    spanOf: (id: string) => {
      // 竖向 span = x 区间（转置于横向 y 区间）
      const x: Record<string, [number, number]> = {
        root: [0, 30],
        up1: [-10, 10],
        up1a: [-20, -10],
        dn1: [10, 30],
      };
      const s = x[id];
      return s ? { start: s[0], end: s[1] } : null;
    },
  };

  it('上侧子树：↑ = 子、↓ = 父；下侧镜像', () => {
    expect(mindNavigateVertical('up1', 'ArrowUp', ctx)).toBe('up1a');
    expect(mindNavigateVertical('up1a', 'ArrowDown', ctx)).toBe('up1');
    expect(mindNavigateVertical('dn1', 'ArrowUp', ctx)).toBe('root');
    // 等价性：竖向 ↑ = 横向 ←（同侧子）
    expect(mindNavigate('up1', 'ArrowLeft', ctx)).toBe('up1a');
  });

  it('根：↑/↓ 取上/下侧最近子；←→ 兄弟', () => {
    expect(mindNavigateVertical('root', 'ArrowUp', ctx)).toBe('up1');
    expect(mindNavigateVertical('root', 'ArrowDown', ctx)).toBe('dn1');
    expect(mindNavigateVertical('up1a', 'ArrowRight', ctx)).toBeNull(); // 独子无后兄弟
  });
});

describe('dropArea 轴参数化（specs §8.3 竖向）', () => {
  const mkAxisX = (): DropArea =>
    new DropArea({
      originRect: { x: 0, y: 0, width: 100, height: 40 },
      direction: 'right', // 下侧
      axis: 'x',
      childRects: [
        { rect: { x: 0, y: 100, width: 60, height: 20 } },
        { rect: { x: 100, y: 100, width: 60, height: 20 } },
      ],
      currentTarget: (pos) =>
        pos === 'before' ? { kind: 'asSibling', parentId: 'p', index: 0 } : null,
      childTarget: (pos) => ({ kind: 'asChild', nodeId: 'p', index: pos }),
    });

  it('current 全宽带：本体行内偏左 = before、偏右 = after(null)', () => {
    const a = mkAxisX();
    const hit = a.hitTest({ x: 40, y: 10 });
    expect(hit?.target).toMatchObject({ kind: 'asSibling', index: 0 });
    // 本体右半 = after → currentTarget 返回 null（该桩语义）
    expect(a.hitTest({ x: 80, y: 10 })).toBeNull();
  });

  it('子零高横条：缝隙沿 x 分段定插入下标', () => {
    const a = mkAxisX();
    const hit = a.hitTest({ x: 90, y: 100 });
    expect(hit?.target).toMatchObject({ kind: 'asChild', index: 1 }); // 两子中线之间
  });

  it('区外（轴上远端）不命中', () => {
    const a = mkAxisX();
    expect(a.hitTest({ x: 300, y: 100 })).toBeNull();
  });
});

describe('预置块竖向（specs §6.5 预览与实物同向）', () => {
  it('下侧无兄弟：块在父正下方 offset、水平居中', () => {
    const b = fakeBlockRect({
      dest: { x: 0, y: 0, width: 100, height: 40 },
      before: null,
      after: null,
      direction: 'right',
      offset: 48,
      axis: 'x',
    });
    expect(b.y).toBe(40 + 48);
    expect(b.x).toBe(30); // (100-40)/2
  });

  it('两侧兄弟：块在 x 缝隙居中', () => {
    const b = fakeBlockRect({
      dest: { x: 0, y: 0, width: 100, height: 40 },
      before: { x: 0, y: 100, width: 60, height: 20 },
      after: { x: 100, y: 100, width: 60, height: 20 },
      direction: 'right',
      offset: 48,
      axis: 'x',
    });
    expect(b.x).toBe(60); // 缝隙 [60,100] 居中：60 + (100-60-40)/2
    expect(b.y).toBe(88);
  });
});
