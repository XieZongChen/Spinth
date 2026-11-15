import { describe, expect, it } from 'vitest';
import { layoutOrgTree, ORG_LEVEL_GAP, ORG_SIBLING_GAP } from '../widgets/tree/layout/org';
import { orgConnectorPath, ORG_LINE } from '../widgets/tree/connector/org';
import { orthogonalPath } from '../widgets/tree/connector/orthogonal';
import { orgNavigate, orgFocusAfterDelete } from '../widgets/tree/nav/org';
import {
  orgPresentation,
  ORG_CARD,
  ORG_TITLE,
  clampOrgCardWidth,
} from '../widgets/tree/kinds/org/style';
import type { ILayoutNode } from '../widgets/tree/layout/types';
import type { INavNode } from '../widgets/tree/nav/types';

/** 组织架构纯逻辑单测（specs/tree-diagrams §5.4/§6.4/§8.1/§7.4，Phase 3a）。 */

function n(id: string, width: number, height: number, children: ILayoutNode[] = []): ILayoutNode {
  return { id, width, height, children };
}

describe('org 布局（specs §5.4）', () => {
  const TREE = n('CEO', 120, 44, [
    n('A', 100, 40, [n('A1', 80, 36), n('A2', 80, 36)]),
    n('B', 100, 40),
    n('C', 100, 60, [n('C1', 90, 36)]),
  ]);

  it('同层节点 y 严格相等；层顶 = 上一层最大底边 + GAP', () => {
    const r = layoutOrgTree(TREE);
    expect(r.positions.get('A')!.y).toBe(r.positions.get('B')!.y);
    expect(r.positions.get('B')!.y).toBe(r.positions.get('C')!.y);
    expect(r.positions.get('A1')!.y).toBe(r.positions.get('A2')!.y);
    expect(r.positions.get('C1')!.y).toBe(r.positions.get('A1')!.y);
    // 层顶：第一层 = 根高 44 + GAP = 100；第二层 = 第一层最大底边(100+60) + GAP
    expect(r.positions.get('A')!.y).toBe(44 + ORG_LEVEL_GAP);
    expect(r.positions.get('A1')!.y).toBe(100 + 60 + ORG_LEVEL_GAP);
  });

  it('父在子跨度中心：父中线 x = 子块中心', () => {
    const r = layoutOrgTree(TREE);
    const ceo = r.positions.get('CEO')!;
    const a1 = r.positions.get('A1')!;
    const c = r.positions.get('C')!;
    const c1 = r.positions.get('C1')!;
    // 块边界 = 首/末子**子树**边缘（孙层最左 / 末子与孙右缘取大）
    const blockStart = a1.x; // A 子树最左（A1 无余量 = 槽位起点）
    const blockEnd = Math.max(c.x + 100, c1.x + 90);
    expect(ceo.x + 60).toBeCloseTo((blockStart + blockEnd) / 2, 6);
  });

  it('子树不重叠：同层节点水平间隔 ≥ SIBLING_GAP', () => {
    const r = layoutOrgTree(TREE);
    const row = ['A', 'B', 'C']
      .map((id) => ({ id, p: r.positions.get(id)! }))
      .sort((x, y) => x.p.x - y.p.x);
    for (let i = 1; i < row.length; i++) {
      const prevRight = row[i - 1]!.p.x + 100;
      expect(row[i]!.p.x - prevRight).toBeGreaterThanOrEqual(ORG_SIBLING_GAP - 1e-6);
    }
    // 孙层：A1/A2 相邻子块间隔 = GAP；孙块不出 A 子树（A1 右缘不越 B 子树起点）
    const b = r.positions.get('B')!;
    const a1 = r.positions.get('A1')!;
    const a2 = r.positions.get('A2')!;
    expect(a2.x - (a1.x + 80)).toBeCloseTo(ORG_SIBLING_GAP, 6);
    const bSubtreeLeft = b.x - (Math.max(100, 90) - 100) / 2; // B 子树宽 = max(100,...)
    expect(a2.x + 80).toBeLessThanOrEqual(bSubtreeLeft - ORG_SIBLING_GAP + 1e-6);
  });

  it('单子：子与父同 x 中线（竖直连线无折弯）', () => {
    const r = layoutOrgTree(n('r', 100, 40, [n('c', 80, 36)]));
    const c = r.positions.get('c')!;
    expect(c.x + 40).toBe(50); // 父中线 50
  });

  it('levels 输出每节点层深', () => {
    const r = layoutOrgTree(TREE);
    expect(r.levels.get('CEO')).toBe(0);
    expect(r.levels.get('B')).toBe(1);
    expect(r.levels.get('C1')).toBe(2);
  });

  it('折叠输入（children 已剔除）：隐藏子树不参与布局', () => {
    const r = layoutOrgTree(n('r', 100, 40, [n('a', 80, 36), n('b', 80, 36, [])]));
    expect(r.positions.has('a')).toBe(true);
    expect(r.positions.size).toBe(3); // r + a + b（b 折叠无子）
  });
});

describe('org 连线（specs §6.4）', () => {
  it('正交总线：竖线 → 母线 → 竖线；拐角 R8 圆弧', () => {
    const cmds = orgConnectorPath({
      parent: { x: 0, y: 0, width: 100, height: 40 },
      child: { x: 200, y: 200, width: 80, height: 36 },
      side: null,
      depth: 1,
      lineColor: ORG_LINE,
    });
    const moves = cmds.filter((c) => c.op === 'moveTo');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ x: 50, y: 40 }); // 父底中心
    const arcs = cmds.filter((c) => c.op === 'arc');
    expect(arcs).toHaveLength(2); // 两个拐角
    const lines = cmds.filter((c) => c.op === 'lineTo');
    const last = lines[lines.length - 1]!;
    expect(last).toMatchObject({ x: 240, y: 200 }); // 子顶中心
  });

  it('同 x（单子/居中）：共线退化 = 纯竖线（无弧无水平段）', () => {
    const cmds = orgConnectorPath({
      parent: { x: 0, y: 0, width: 100, height: 40 },
      child: { x: 10, y: 150, width: 80, height: 36 },
      side: null,
      depth: 1,
      lineColor: ORG_LINE,
    });
    expect(cmds.filter((c) => c.op === 'arc')).toHaveLength(0);
    expect(cmds).toHaveLength(2); // moveTo + lineTo
    expect(cmds[1]).toMatchObject({ x: 50, y: 150 });
  });

  it('orthogonalPath：共线中点自动退化', () => {
    const cmds = orthogonalPath([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 100 },
    ]);
    expect(cmds).toHaveLength(2);
  });
});

describe('org 导航（specs §8.1）', () => {
  const mkTree = (): { root: INavNode; byId: Map<string, INavNode> } => {
    const root: INavNode = { id: 'r', parent: null, children: [] };
    const a: INavNode = { id: 'a', parent: root, children: [] };
    const b: INavNode = { id: 'b', parent: root, children: [] };
    const a1: INavNode = { id: 'a1', parent: a, children: [] };
    root.children = [a, b];
    a.children = [a1];
    const byId = new Map([
      ['r', root],
      ['a', a],
      ['b', b],
      ['a1', a1],
    ]);
    return { root, byId };
  };
  const span = (id: string) => {
    const x: Record<string, [number, number]> = {
      r: [0, 100],
      a: [0, 50],
      b: [50, 100],
      a1: [0, 50],
    };
    const s = x[id];
    return s ? { start: s[0], end: s[1] } : null;
  };

  it('↑ 父 / ↓ 最近的子 / ←→ 兄弟', () => {
    const { root, byId } = mkTree();
    const ctx = { root, byId, spanOf: span };
    expect(orgNavigate('a1', 'ArrowUp', ctx)).toBe('a');
    expect(orgNavigate('a', 'ArrowDown', ctx)).toBe('a1');
    expect(orgNavigate('a', 'ArrowRight', ctx)).toBe('b');
    expect(orgNavigate('b', 'ArrowLeft', ctx)).toBe('a');
  });

  it('兄弟不跨叔：边界 → 不动（null）', () => {
    const { root, byId } = mkTree();
    const ctx = { root, byId, spanOf: span };
    expect(orgNavigate('a1', 'ArrowLeft', ctx)).toBeNull(); // 独子无兄弟
    expect(orgNavigate('b', 'ArrowRight', ctx)).toBeNull(); // 末子不跳叔的子
  });

  it('叶子 ↓ 不动；根 ↑ 不动', () => {
    const { root, byId } = mkTree();
    const ctx = { root, byId, spanOf: span };
    expect(orgNavigate('a1', 'ArrowDown', ctx)).toBeNull();
    expect(orgNavigate('r', 'ArrowUp', ctx)).toBeNull();
  });

  it('删除焦点：后兄弟 → 前兄弟 → 父；根删除无落点', () => {
    const { byId } = mkTree();
    expect(orgFocusAfterDelete('b', { byId })).toBe('a'); // 无后兄弟 → 前
    expect(orgFocusAfterDelete('a', { byId })).toBe('b'); // 后兄弟
    expect(orgFocusAfterDelete('a1', { byId })).toBe('a'); // 独子 → 父
    expect(orgFocusAfterDelete('r', { byId })).toBeNull();
  });
});

describe('org 样式（specs §7.3/§7.4）', () => {
  it('卡片规格：14/600 标题、白卡 #cbd5e1 描边、根描边 2px', () => {
    const p = orgPresentation({ text: 'x' }, 1);
    expect(p.title.fontSize).toBe(14);
    expect(p.title.fontWeight).toBe('600');
    expect(p.fill).toBe('#ffffff');
    expect(p.stroke).toEqual({ color: '#cbd5e1', width: 1 });
    expect(orgPresentation({ text: 'x' }, 0).stroke.width).toBe(2);
    expect(p.radius).toBe(6);
  });

  it('宽钳制：clamp(测量, 120, 260)', () => {
    expect(clampOrgCardWidth(60)).toBe(120);
    expect(clampOrgCardWidth(200)).toBe(200);
    expect(clampOrgCardWidth(400)).toBe(260);
  });

  it('对比度护栏：标题/连线 vs 白底 ≥ 4.5:1（WCAG AA，specs §7.4）', () => {
    // 相对亮度（WCAG 公式）
    const lum = (hex: string): number => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(v[0]!) + 0.7152 * f(v[1]!) + 0.0722 * f(v[2]!);
    };
    const contrast = (a: string, b: string) => {
      const ls = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (ls[0] + 0.05) / (ls[1] + 0.05);
    };
    expect(contrast(ORG_CARD.fill, ORG_TITLE.fill)).toBeGreaterThanOrEqual(7); // 标题 ≥ 7:1
    expect(contrast(ORG_CARD.fill, ORG_LINE)).toBeGreaterThanOrEqual(4.5); // 连线 vs 白卡
  });
});
