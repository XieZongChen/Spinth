import { describe, expect, it } from 'vitest';
import {
  collapseGroupParticipants,
  collectInvolvedGroupIds,
  computeGroupZOrderContraction,
  expandIdsToGroups,
  filterMarqueeByGroups,
  partitionGroupable,
  toggleIdWithGroups,
  type GroupOf,
  type MembersOf,
} from '../platform/selector/groupOps';
import type { ILayerItem } from '../platform/layer/layerOps';

/** 组籍/成员注入桩：membersOf 顺序即 zOrder 序（契约由调用方保证） */
function stub(
  groupOfMap: Record<string, string | undefined>,
  membersMap: Record<string, string[]>,
) {
  return {
    groupOf: ((id: string) => groupOfMap[id]) as GroupOf,
    membersOf: ((g: string) => membersMap[g] ?? []) as MembersOf,
  };
}

const R = (x: number, y: number, w = 10, h = 10) => ({ x, y, width: w, height: h });

describe('expandIdsToGroups（docs/18 §4.1）', () => {
  it('组员扩展为存活成员全集（membersOf 的 zOrder 序），无组照直', () => {
    const { groupOf, membersOf } = stub({ a: 'G1', b: 'G1' }, { G1: ['b', 'a'] });
    expect(expandIdsToGroups(['a', 'x', 'b'], groupOf, membersOf)).toEqual(['b', 'a', 'x']);
  });

  it('同组重复输入只展开一次', () => {
    const { groupOf, membersOf } = stub({ a: 'G1', b: 'G1' }, { G1: ['a', 'b'] });
    expect(expandIdsToGroups(['a', 'b'], groupOf, membersOf)).toEqual(['a', 'b']);
  });

  it('单员组语义消解：扩展 = 自身', () => {
    const { groupOf, membersOf } = stub({ c: 'G2' }, { G2: ['c'] });
    expect(expandIdsToGroups(['c'], groupOf, membersOf)).toEqual(['c']);
  });
});

describe('toggleIdWithGroups（docs/18 §4.2）', () => {
  const { groupOf, membersOf } = stub({ a: 'G1', b: 'G1' }, { G1: ['b', 'a'] });

  it('全不在选 → 整组加入', () => {
    expect(toggleIdWithGroups(['x'], 'a', groupOf, membersOf)).toEqual(['x', 'b', 'a']);
  });

  it('整组在选 → 整组移除', () => {
    expect(toggleIdWithGroups(['x', 'b', 'a'], 'a', groupOf, membersOf)).toEqual(['x']);
  });

  it('Alt 单选残留 → 命中该组时整组移除（不留半组中间态）', () => {
    expect(toggleIdWithGroups(['x', 'a'], 'b', groupOf, membersOf)).toEqual(['x']);
  });

  it('无关切换不得抹掉 Alt 进入组状态（其他组残留成员不被重扩）', () => {
    expect(toggleIdWithGroups(['a'], 'x', groupOf, membersOf)).toEqual(['a', 'x']);
  });

  it('无组命中 = 普通单 id 切换', () => {
    expect(toggleIdWithGroups(['x'], 'x', groupOf, membersOf)).toEqual([]);
    expect(toggleIdWithGroups(['x'], 'y', groupOf, membersOf)).toEqual(['x', 'y']);
  });
});

describe('filterMarqueeByGroups（docs/18 §4.3 整组全入框）', () => {
  const { groupOf, membersOf } = stub({ a: 'G1', b: 'G1', c: 'G2' }, { G1: ['a', 'b'], G2: ['c'] });
  const boundsOf = (id: string) => ({ a: R(0, 0), b: R(20, 0), c: R(40, 0), x: R(100, 100) })[id]!;

  it('整组全入框 → 保留成员全集（即便个别成员未进 hitIds）', () => {
    const marquee = R(-5, -5, 50, 20);
    expect(filterMarqueeByGroups(['a'], marquee, boundsOf, groupOf, membersOf)).toEqual(['a', 'b']);
  });

  it('半组出框 → 该组整体剔除', () => {
    const marquee = R(-5, -5, 25, 20); // 框住 a、框不到 b
    expect(filterMarqueeByGroups(['a', 'b'], marquee, boundsOf, groupOf, membersOf)).toEqual([]);
  });

  it('无组元素照旧相交即选', () => {
    const marquee = R(95, 95, 20, 20); // 只擦到 x 边缘（相交非全含）
    expect(filterMarqueeByGroups(['x'], marquee, boundsOf, groupOf, membersOf)).toEqual(['x']);
  });

  it('单员组视同无组：相交即选（不走组的全含口径）', () => {
    const marquee = R(35, -5, 12, 20); // 与 c 相交但未全含
    expect(filterMarqueeByGroups(['c'], marquee, boundsOf, groupOf, membersOf)).toEqual(['c']);
  });
});

describe('collapseGroupParticipants（docs/18 §5 对齐组参与体）', () => {
  const { groupOf, membersOf } = stub({ a: 'G1', b: 'G1' }, { G1: ['a', 'b'] });

  it('整组在集 → 折叠为单参与体（bounds = union，成员保持输入序）', () => {
    const parts = [
      { id: 'a', bounds: R(0, 0, 10, 10) },
      { id: 'b', bounds: R(20, 5, 10, 10) },
      { id: 'c', bounds: R(100, 0, 10, 10) },
    ];
    const out = collapseGroupParticipants(parts, groupOf, membersOf);
    expect(out).toHaveLength(2);
    expect(out[0]!.groupId).toBe('G1');
    expect(out[0]!.bounds).toEqual(R(0, 0, 30, 15));
    expect(out[0]!.members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(out[1]!.groupId).toBeUndefined();
    expect(out[1]!.members).toHaveLength(1);
  });

  it('部分在集（Alt 进组）→ 成员按单体参与', () => {
    const parts = [{ id: 'a', bounds: R(0, 0, 10, 10) }];
    const out = collapseGroupParticipants(parts, groupOf, membersOf);
    expect(out).toHaveLength(1);
    expect(out[0]!.groupId).toBeUndefined();
    expect(out[0]!.members.map((m) => m.id)).toEqual(['a']);
  });
});

describe('partitionGroupable / collectInvolvedGroupIds（docs/18 §3）', () => {
  it('全可组才建组：partition 按 reject 整命令拒绝用', () => {
    const out = partitionGroupable(['a', 'b', 'm'], (id) => id !== 'm');
    expect(out.groupable).toEqual(['a', 'b']);
    expect(out.rejected).toEqual(['m']);
  });

  it('涉及组去重保首次出现序', () => {
    const { groupOf } = stub({ a: 'G1', b: 'G1', c: 'G2' }, {});
    expect(collectInvolvedGroupIds(['c', 'a', 'b'], groupOf)).toEqual(['G2', 'G1']);
  });
});

describe('computeGroupZOrderContraction（docs/18 §3.3 归拢）', () => {
  const items = (list: Array<[string, string]>): ILayerItem[] =>
    list.map(([id, zOrder]) => ({ id, zOrder, bounds: R(0, 0) }));

  it('成员夹层归拢：连续区段置于最高成员处，夹层非成员压到块下', () => {
    // z 序：y < a < x < b——a、b 编组，x 夹在中间，归拢后 a、b 连续且都在 x 之上、y 之上
    const src = items([
      ['y', 'a0'],
      ['a', 'a1'],
      ['x', 'a2'],
      ['b', 'a3'],
    ]);
    const changes = computeGroupZOrderContraction(src, ['a', 'b']);
    expect(changes).toHaveLength(2);
    const za = changes.find((c) => c.id === 'a')!.zOrder;
    const zb = changes.find((c) => c.id === 'b')!.zOrder;
    expect(za < zb).toBe(true); // 成员相对序保持
    expect('a2' < za).toBe(true); // 块整体高于夹层非成员 x（a2）
    expect('a3' < zb).toBe(true); // 仍低于原最高成员上侧（此处无上侧，sanity）
  });

  it('上侧有非成员：块居于其下', () => {
    const src = items([
      ['a', 'a0'],
      ['b', 'a1'],
      ['x', 'a2'],
      ['y', 'a3'],
    ]);
    const changes = computeGroupZOrderContraction(src, ['a', 'b']);
    const za = changes.find((c) => c.id === 'a')!.zOrder;
    const zb = changes.find((c) => c.id === 'b')!.zOrder;
    expect(za < zb && zb < 'a2').toBe(true); // 连续且在 x（a2）之下——块占原最高成员层位
  });

  it('全员无他人：边界 null 链仍连续升序', () => {
    const src = items([
      ['a', 'a0'],
      ['b', 'a1'],
    ]);
    const changes = computeGroupZOrderContraction(src, ['a', 'b']);
    expect(changes).toHaveLength(2);
    expect(changes[0]!.zOrder < changes[1]!.zOrder).toBe(true);
  });

  it('单成员/空集：零变更', () => {
    const src = items([
      ['a', 'a0'],
      ['x', 'a1'],
    ]);
    expect(computeGroupZOrderContraction(src, ['a'])).toEqual([]);
    expect(computeGroupZOrderContraction(src, [])).toEqual([]);
  });
});
