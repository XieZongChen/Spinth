import { describe, expect, it } from 'vitest';
import {
  clampFrameZOrder,
  expandContainers,
  fullyContains,
  isAutoAdoptableType,
  mergeFramesIntoSelection,
  remapParentIds,
  resolveParentUpdate,
} from '../widgets/frame/frameOps';
import type { IFrameLookup } from '../types';

/** 容器归属纯逻辑（specs/container-frame §2.4/§4.3/§6.4） */

const R = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

describe('fullyContains / resolveParentUpdate 四态与判定顺序（§2.4）', () => {
  it('fullyContains：等值边界算含；差 1px 不含', () => {
    expect(fullyContains(R(0, 0, 100, 100), R(0, 0, 100, 100))).toBe(true);
    expect(fullyContains(R(0, 0, 100, 100), R(1, 1, 99, 99))).toBe(true);
    expect(fullyContains(R(0, 0, 100, 100), R(-1, 0, 100, 100))).toBe(false);
  });

  it('规则 1：仍全含于当前父 → null（别的容器也全含也不动——滞回）', () => {
    const out = resolveParentUpdate({
      parentId: 'f1',
      parentRect: R(0, 0, 300, 300),
      selfRect: R(10, 10, 50, 50),
      frames: [
        { id: 'f1', zOrder: 'a0', rect: R(0, 0, 300, 300) },
        { id: 'f2', zOrder: 'b0', rect: R(5, 5, 200, 200) },
      ],
    });
    expect(out).toBeNull();
  });

  it('规则 2：无父全含 → 设最上容器；多容器取 zOrder 最上者', () => {
    const frames = [
      { id: 'f1', zOrder: 'a0', rect: R(0, 0, 300, 300) },
      { id: 'f2', zOrder: 'c0', rect: R(0, 0, 300, 300) },
    ];
    expect(
      resolveParentUpdate({
        parentId: undefined,
        parentRect: null,
        selfRect: R(10, 10, 50, 50),
        frames,
      }),
    ).toBe('f2');
    // 命中容器恰为当前父（规则 1 已拦，此处防御同值 → null）
    expect(
      resolveParentUpdate({
        parentId: 'f2',
        parentRect: R(0, 0, 300, 300),
        selfRect: R(10, 10, 50, 50),
        frames,
      }),
    ).toBeNull();
  });

  it('规则 2 换父：旧父不再全含、新容器全含 → 切到新容器', () => {
    const out = resolveParentUpdate({
      parentId: 'f1',
      parentRect: R(0, 0, 60, 60),
      selfRect: R(100, 100, 50, 50),
      frames: [
        { id: 'f1', zOrder: 'a0', rect: R(0, 0, 60, 60) },
        { id: 'f2', zOrder: 'b0', rect: R(90, 90, 200, 200) },
      ],
    });
    expect(out).toBe('f2');
  });

  it('规则 3：完全离开当前父 → undefined（唯一脱离条件）', () => {
    const out = resolveParentUpdate({
      parentId: 'f1',
      parentRect: R(0, 0, 100, 100),
      selfRect: R(200, 200, 50, 50),
      frames: [{ id: 'f1', zOrder: 'a0', rect: R(0, 0, 100, 100) }],
    });
    expect(out).toBeUndefined();
  });

  it('规则 4：相交但不全含（跨界滞回区）→ null 保持原状', () => {
    const out = resolveParentUpdate({
      parentId: 'f1',
      parentRect: R(0, 0, 100, 100),
      selfRect: R(80, 80, 50, 50), // 部分在外
      frames: [{ id: 'f1', zOrder: 'a0', rect: R(0, 0, 100, 100) }],
    });
    expect(out).toBeNull();
  });

  it('孤儿父（parentRect null，父被删/非容器）：不脱离（读取侧降级），仅可换父', () => {
    const stay = resolveParentUpdate({
      parentId: 'f1',
      parentRect: null,
      selfRect: R(500, 500, 50, 50),
      frames: [],
    });
    expect(stay).toBeNull();
    const adopt = resolveParentUpdate({
      parentId: 'f1',
      parentRect: null,
      selfRect: R(10, 10, 50, 50),
      frames: [{ id: 'f2', zOrder: 'a0', rect: R(0, 0, 300, 300) }],
    });
    expect(adopt).toBe('f2');
  });

  it('无父且无全含容器 → null（无动作）', () => {
    expect(
      resolveParentUpdate({
        parentId: undefined,
        parentRect: null,
        selfRect: R(10, 10, 50, 50),
        frames: [{ id: 'f1', zOrder: 'a0', rect: R(90, 90, 50, 50) }],
      }),
    ).toBeNull();
  });
});

describe('expandContainers 去重保序（§4.4/§6.6-7）', () => {
  const lookup = (children: Record<string, string[]>): IFrameLookup => ({
    isFrame: (id) => id in children,
    childIds: (fid) => children[fid] ?? [],
    expandForCascade: (ids) => ids,
    reconcileParents: () => {},
    adoptByLanding: () => {},
    createMarqueeFrameFilter: () => null,
    computeLayerClamps: () => [],
  });

  it('容器 → 并入全部子元素；重复 id 去重；插入序保持', () => {
    const frames = lookup({ f1: ['c1', 'c2'], f2: ['c2', 'c3'] });
    expect(expandContainers(['f1', 'c2', 'f2'], frames)).toEqual(['f1', 'c1', 'c2', 'f2', 'c3']);
  });

  it('非容器原样保留；无子容器 = 自身', () => {
    const frames = lookup({ f1: [] });
    expect(expandContainers(['a', 'f1', 'b'], frames)).toEqual(['a', 'f1', 'b']);
  });
});

describe('clampFrameZOrder（I3 容器恒在子之下）', () => {
  const items = [
    { id: 'f1', zOrder: 'b0' }, // 容器在子之上——需钳制
    { id: 'c1', zOrder: 'a1' },
    { id: 'c2', zOrder: 'a2' },
    { id: 'x', zOrder: 'a0' },
  ];

  it('容器 key ≥ 最小子 key → 返回新 key（介于 lower 与 minChild 之间）', () => {
    const key = clampFrameZOrder(items, 'f1', ['c1', 'c2']);
    expect(key).not.toBeNull();
    expect(key! > 'a0').toBe(true); // 在 x('a0') 之上
    expect(key! < 'a1').toBe(true); // 在最小子 c1('a1') 之下
  });

  it('容器已低于全部子 → null（无需调整）', () => {
    const ok = [
      { id: 'f1', zOrder: 'a0' },
      { id: 'c1', zOrder: 'a1' },
    ];
    expect(clampFrameZOrder(ok, 'f1', ['c1'])).toBeNull();
  });

  it('prev = null 边界：minChild 是全局最小 key 时也能生成（lower null）', () => {
    const noLower = [
      { id: 'f1', zOrder: 'b0' },
      { id: 'c1', zOrder: 'a0' },
    ];
    const key = clampFrameZOrder(noLower, 'f1', ['c1']);
    expect(key).not.toBeNull();
    expect(key! < 'a0').toBe(true);
  });

  it('容器不在表/无子 → null', () => {
    expect(clampFrameZOrder(items, 'gone', ['c1'])).toBeNull();
    expect(clampFrameZOrder(items, 'f1', [])).toBeNull();
  });
});

describe('remapParentIds 桶映射（§4.7）', () => {
  it('批内父 → 新容器 id；批外父 → undefined；无父不入表', () => {
    const idMap = new Map([
      ['old-child', 'new-child'],
      ['old-frame', 'new-frame'],
    ]);
    const out = remapParentIds(
      [
        { id: 'old-child', parentId: 'old-frame' },
        { id: 'old-lone', parentId: 'external-frame' },
        { id: 'old-free' },
      ],
      idMap,
    );
    expect(out.get('new-child')).toBe('new-frame');
    expect(out.get('new-lone')).toBeUndefined(); // 批外父落为顶层
    expect(out.has('old-free')).toBe(false); // 无父快照不入表
  });
});

describe('mergeFramesIntoSelection 框选归并（§4.3 四条规则）', () => {
  const frames = [
    { id: 'f1', rect: R(0, 0, 100, 100) },
    { id: 'f2', rect: R(200, 0, 100, 100) },
  ];
  const childIdsOf = (fid: string): string[] => (fid === 'f1' ? ['c1', 'c2'] : ['c3']);

  it('全含容器入选且子元素剔除；保持原序', () => {
    const ids = ['f1', 'c1', 'c2', 'z1'];
    expect(
      mergeFramesIntoSelection({
        ids,
        marquee: R(-10, -10, 200, 200),
        frames,
        childIdsOf,
        groupedIds: new Set(),
      }),
    ).toEqual(['f1', 'z1']);
  });

  it('半含容器剔除（全含才入选），其子元素若被框单独命中仍可入', () => {
    const ids = ['f1', 'c1', 'z1'];
    // 框只含 f1 左半：f1 剔除；c1 在框内但 f1 未入选 → 不剔
    expect(
      mergeFramesIntoSelection({
        ids,
        marquee: R(-10, -10, 60, 200),
        frames,
        childIdsOf,
        groupedIds: new Set(),
      }),
    ).toEqual(['c1', 'z1']);
  });

  it('容器子元素里有选中组成员 → 容器不入选（不拆组），子元素保留', () => {
    const ids = ['f2', 'c3', 'g1']; // g1 与 c3 同组
    expect(
      mergeFramesIntoSelection({
        ids,
        marquee: R(190, -10, 200, 200),
        frames,
        childIdsOf,
        groupedIds: new Set(['c3', 'g1']),
      }),
    ).toEqual(['c3', 'g1']);
  });

  it('无容器命中原样返回（零开销直通）', () => {
    expect(
      mergeFramesIntoSelection({
        ids: ['a', 'b'],
        marquee: R(0, 0, 10, 10),
        frames: [],
        childIdsOf,
        groupedIds: new Set(),
      }),
    ).toEqual(['a', 'b']);
  });
});

describe('isAutoAdoptableType（创建 / 粘贴落点的参与资格，§2.4）', () => {
  it('自由七类可归属；FRAME / 树 / 画笔 / 连线 / LIFELINE 不参与', () => {
    for (const t of ['SHAPE', 'TEXT', 'STICKY', 'IMAGE', 'SYMBOL']) {
      expect(isAutoAdoptableType(t), t).toBe(true);
    }
    // 生命线不进容器（specs/sequence-diagram §2.5 S5：schema 无 parentId + 双重拒绝）
    for (const t of ['FRAME', 'MIND_MAP', 'ORG_CHART', 'PEN', 'LINE', 'LIFELINE']) {
      expect(isAutoAdoptableType(t), t).toBe(false);
    }
  });
});
