import { describe, expect, it } from 'vitest';
import {
  alignLine,
  effectiveDirection,
  focusAfterDelete,
  focusFollowDelta,
  intersectDistance,
  nearestChild,
  nearestSibling,
  rootInsertSide,
  type INavNode,
  type ISpan,
} from '../widgets/mind/mindNav';

interface ISpec {
  id: string;
  direction?: 'left' | 'right';
  children?: ISpec[];
}

/** 构建轻量导航树（parent 反向引用） */
function tree(spec: ISpec): INavNode {
  const build = (s: ISpec, parent: INavNode | null): INavNode => {
    const node: INavNode = { id: s.id, direction: s.direction, parent, children: [] };
    node.children = (s.children ?? []).map((c) => build(c, node));
    return node;
  };
  return build(spec, null);
}

function findOrNull(root: INavNode, id: string): INavNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findOrNull(c, id);
    if (hit) return hit;
  }
  return null;
}

function find(root: INavNode, id: string): INavNode {
  const hit = findOrNull(root, id);
  if (!hit) throw new Error(`node not found: ${id}`);
  return hit;
}

/** 固定高度 20、按顺序堆叠的 span 表（父中点判定用） */
const spansByOrder = (ids: string[], gap = 0, height = 20): ((n: INavNode) => ISpan | null) => {
  const tops = new Map<string, number>();
  ids.forEach((id, i) => tops.set(id, i * (height + gap)));
  return (n) => {
    const top = tops.get(n.id);
    return top === undefined ? null : { top, bottom: top + height };
  };
};

/** 显式 span 表（[id, top, bottom]） */
const spanMap = (rows: Array<[string, number, number]>): ((n: INavNode) => ISpan | null) => {
  const map = new Map(rows.map(([id, top, bottom]) => [id, { top, bottom }]));
  return (n) => map.get(n.id) ?? null;
};

describe('脑图导航纯逻辑（docs/11 §7，对齐既有设计 mindFocusController）', () => {
  describe('effectiveDirection：侧向沿父链继承', () => {
    it('一级节点带 direction，深层继承', () => {
      const root = tree({
        id: 'root',
        children: [
          {
            id: 'l1',
            direction: 'left',
            children: [{ id: 'l2', children: [{ id: 'l3' }] }],
          },
          { id: 'r1', direction: 'right', children: [{ id: 'r2' }] },
        ],
      });
      expect(effectiveDirection(find(root, 'l2'))).toBe('left');
      expect(effectiveDirection(find(root, 'l3'))).toBe('left');
      expect(effectiveDirection(find(root, 'r2'))).toBe('right');
    });

    it('缺省侧向按 right（既有设计 direction 缺省取 right 的语义）', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }] });
      expect(effectiveDirection(find(root, 'a'))).toBe('right');
    });
  });

  describe('rootInsertSide：根层插入侧三规则', () => {
    it('规则一：根自身有 direction 则同向', () => {
      const root = tree({ id: 'root', direction: 'left', children: [] });
      expect(rootInsertSide(root)).toBe('left');
    });

    it('规则二：子数 < 3 一律插右侧', () => {
      expect(rootInsertSide(tree({ id: 'root' }))).toBe('right');
      expect(rootInsertSide(tree({ id: 'root', children: [{ id: 'a', direction: 'left' }] }))).toBe(
        'right',
      );
      expect(
        rootInsertSide(
          tree({
            id: 'root',
            children: [
              { id: 'a', direction: 'left' },
              { id: 'b', direction: 'left' },
            ],
          }),
        ),
      ).toBe('right');
    });

    it('规则三：子数 ≥ 3 时插少的一侧；相等取右；未落 direction 计右', () => {
      expect(
        rootInsertSide(
          tree({
            id: 'root',
            children: [{ id: 'a' }, { id: 'b' }, { id: 'c', direction: 'left' }],
          }),
        ),
      ).toBe('left');
      expect(
        rootInsertSide(
          tree({
            id: 'root',
            children: [
              { id: 'a' },
              { id: 'b' },
              { id: 'c', direction: 'left' },
              { id: 'd', direction: 'left' },
            ],
          }),
        ),
      ).toBe('right');
    });
  });

  describe('nearestSibling：同侧扫描 + 跨父（叔节点）下钻', () => {
    const root = tree({
      id: 'root',
      children: [
        {
          id: 'p1',
          children: [{ id: 'p1a' }, { id: 'p1b' }],
        },
        {
          id: 'p2',
          children: [{ id: 'p2a' }],
        },
      ],
    });

    it('同父内取相邻兄弟', () => {
      expect(nearestSibling(find(root, 'p1a'), 'after')!.id).toBe('p1b');
      expect(nearestSibling(find(root, 'p1b'), 'before')!.id).toBe('p1a');
    });

    it('同侧过滤：跳过异侧兄弟', () => {
      const mixed = tree({
        id: 'root',
        children: [
          { id: 'l1', direction: 'left' },
          { id: 'r1', direction: 'right' },
          { id: 'l2', direction: 'left' },
        ],
      });
      expect(nearestSibling(find(mixed, 'l2'), 'before')!.id).toBe('l1');
    });

    it('到边界时上溯叔节点并下钻到端点子节点', () => {
      expect(nearestSibling(find(root, 'p1b'), 'after')!.id).toBe('p2a');
      expect(nearestSibling(find(root, 'p2a'), 'before')!.id).toBe('p1b');
    });

    it('叔节点无子节点 / 根节点 → undefined', () => {
      const childless = tree({
        id: 'root',
        children: [{ id: 'p1', children: [{ id: 'p1a' }] }, { id: 'p2' }],
      });
      expect(nearestSibling(find(childless, 'p1a'), 'after')).toBeUndefined();
      expect(nearestSibling(childless, 'before')).toBeUndefined();
    });
  });

  describe('nearestChild：父中点覆盖优先，否则取最近端点', () => {
    it('只有一个子节点直接返回', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }] });
      const spanOf = spansByOrder(['root', 'a']);
      expect(nearestChild(root, spanOf)!.id).toBe('a');
    });

    it('父中点落在某子区间内 → 该子（即使不是最近端点）', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
      // 父区间 [0,100]（中点 50）；a=[0,20] b=[40,60] c=[70,90] → 中点落在 b
      const spanOf = spanMap([
        ['root', 0, 100],
        ['a', 0, 20],
        ['b', 40, 60],
        ['c', 70, 90],
      ]);
      expect(nearestChild(root, spanOf)!.id).toBe('b');
    });

    it('无包含时取端点最近者', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }, { id: 'b' }] });
      const tops = new Map([
        ['root', 100],
        ['a', 0],
        ['b', 70],
      ]);
      const spanOf = (n: INavNode): ISpan | null => {
        const top = tops.get(n.id);
        return top === undefined ? null : { top, bottom: top + 20 };
      };
      // 父中点 110：a 距 90，b 距 30 → b
      expect(nearestChild(root, spanOf)!.id).toBe('b');
    });

    it('根节点按侧过滤', () => {
      const root = tree({
        id: 'root',
        children: [
          { id: 'l1', direction: 'left' },
          { id: 'r1', direction: 'right' },
        ],
      });
      const spanOf = spansByOrder(['root', 'l1', 'r1']);
      expect(nearestChild(root, spanOf, 'left')!.id).toBe('l1');
      expect(nearestChild(root, spanOf, 'right')!.id).toBe('r1');
    });
  });

  describe('focusAfterDelete：后兄弟 → 前兄弟 → 递归到父', () => {
    it('取后一个未删兄弟', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
      expect(focusAfterDelete(new Set(['b']), find(root, 'b'))!.id).toBe('c');
    });

    it('末位时取前一个未删兄弟', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
      expect(focusAfterDelete(new Set(['c']), find(root, 'c'))!.id).toBe('b');
    });

    it('父为根且删的是该侧最后一个次级节点 → 焦点回根', () => {
      const root = tree({
        id: 'root',
        children: [
          { id: 'a', direction: 'left' },
          { id: 'b', direction: 'right' },
        ],
      });
      expect(focusAfterDelete(new Set(['a']), find(root, 'a'))!.id).toBe('root');
    });

    it('父为根且该侧全删 → 焦点回根（不落到另一侧）', () => {
      const root = tree({
        id: 'root',
        children: [
          { id: 'a', direction: 'left' },
          { id: 'a2', direction: 'left' },
          { id: 'b', direction: 'right' },
        ],
      });
      expect(focusAfterDelete(new Set(['a', 'a2']), find(root, 'a'))!.id).toBe('root');
    });

    it('兄弟全删 → 递归到父（父本身未被删）', () => {
      const root = tree({
        id: 'root',
        children: [
          { id: 'left1', direction: 'left' },
          { id: 'p', direction: 'right', children: [{ id: 'c1' }, { id: 'c2' }] },
        ],
      });
      // 删 c1、c2，优先节点 c1：同级无未删兄弟（父非根不过滤侧向）→ 递归到 p
      expect(focusAfterDelete(new Set(['c1', 'c2']), find(root, 'c1'))!.id).toBe('p');
    });

    it('根被删 → 无焦点', () => {
      const root = tree({ id: 'root', children: [{ id: 'a' }] });
      expect(focusAfterDelete(new Set(['root']), root)).toBeUndefined();
    });
  });

  describe('intersectDistance', () => {
    it('相交为正、相离为负', () => {
      expect(intersectDistance(0, 10, 5, 20)).toBe(5);
      expect(intersectDistance(0, 10, 20, 30)).toBe(-10);
      expect(intersectDistance(0, 10, 10, 20)).toBe(0);
    });
  });

  describe('alignLine：三条对齐规则', () => {
    it('任一端已对齐（1e-4 内）返回 0', () => {
      expect(alignLine(0, 10, 0, 50)).toBe(0);
      expect(alignLine(0, 10, 50, 10)).toBe(0);
    });

    it('规则一：A 短于 B → 对齐较近的边（A 在左外侧 → 右移）', () => {
      expect(alignLine(0, 10, 20, 60)).toBe(20);
    });

    it('规则二：A 长于 B 且不包含 → 对齐较远的边（A 右端超出 → 左移）', () => {
      expect(alignLine(0, 100, -20, 40)).toBe(-20);
    });

    it('规则三：A 包含 B → 往超出较少的一头移', () => {
      expect(alignLine(0, 100, 20, 60)).toBe(20);
      expect(alignLine(0, 100, 30, 90)).toBe(-10);
    });
  });

  describe('focusFollowDelta：接近边缘才跟随', () => {
    const win = { left: 0, top: 0, right: 100, bottom: 100 };

    it('完全可见 → 不动', () => {
      expect(focusFollowDelta({ left: 10, top: 10, right: 30, bottom: 30 }, win)).toEqual({
        x: 0,
        y: 0,
      });
    });

    it('右侧超出 → 负向位移（视口右移把节点拉回）', () => {
      const d = focusFollowDelta({ left: 120, top: 10, right: 140, bottom: 30 }, win);
      expect(d.x).toBe(-40);
      expect(d.y).toBe(0);
    });

    it('左侧超出 → 正向位移', () => {
      expect(focusFollowDelta({ left: -50, top: 10, right: -30, bottom: 30 }, win).x).toBe(50);
    });

    it('上下超出按 y 轴对齐', () => {
      expect(focusFollowDelta({ left: 10, top: -40, right: 30, bottom: -20 }, win).y).toBe(40);
      expect(focusFollowDelta({ left: 10, top: 120, right: 30, bottom: 140 }, win).y).toBe(-40);
    });

    it('节点比可视区还大 → 两轴都动', () => {
      const d = focusFollowDelta({ left: -10, top: -10, right: 110, bottom: 110 }, win);
      expect(d.x).not.toBe(0);
      expect(d.y).not.toBe(0);
    });
  });
});
