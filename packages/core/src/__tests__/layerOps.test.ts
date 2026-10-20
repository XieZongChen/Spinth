import { describe, expect, it } from 'vitest';
import { computeLayerChanges } from '../platform/layer/layerOps';

/** 测试用固定 zOrder（fractional key 字典序） */
function items(
  list: Array<[string, string, { x: number; y: number; width: number; height: number }?]>,
) {
  return list.map(([id, zOrder, bounds]) => ({
    id,
    zOrder,
    bounds: bounds ?? { x: 0, y: 0, width: 100, height: 100 },
  }));
}

describe('computeLayerChanges（docs/04 §5）', () => {
  it('置顶：保持组内相对顺序', () => {
    const src = items([
      ['a', 'a0'],
      ['b', 'a1'],
      ['c', 'a2'],
    ]);
    const changes = computeLayerChanges(src, ['b', 'a'], 'front');
    const za = changes.find((c) => c.id === 'a')!.zOrder;
    const zb = changes.find((c) => c.id === 'b')!.zOrder;
    expect(za < zb).toBe(true); // a 在 b 下（保持原相对顺序），双双大于 a2
    expect(za > 'a2' && zb > za).toBe(true);
  });

  it('置底：低于全部其他元素', () => {
    const src = items([
      ['a', 'a0'],
      ['b', 'a1'],
      ['c', 'a2'],
    ]);
    const changes = computeLayerChanges(src, ['a'], 'back');
    expect(changes[0]!.zOrder < 'a1').toBe(true); // 低于其余元素的最小 key
  });

  it('上移一层：只与空间重叠元素交换（跳过不重叠的）', () => {
    const src = items([
      ['bottom', 'a0', { x: 0, y: 0, width: 100, height: 100 }],
      ['far', 'a1', { x: 1000, y: 1000, width: 50, height: 50 }], // 不重叠，应被跳过
      ['top', 'a2', { x: 10, y: 10, width: 100, height: 100 }],
    ]);
    const changes = computeLayerChanges(src, ['bottom'], 'forward');
    // 与 top 交换：bottom 落到 top 之上（越过不重叠的 far）
    expect(changes).toHaveLength(1);
    expect(changes[0]!.zOrder > 'a2').toBe(true);
  });

  it('上移一层：无重叠邻居时不产生变更', () => {
    const src = items([
      ['far', 'a0', { x: 0, y: 0, width: 50, height: 50 }],
      ['lonely', 'a1', { x: 1000, y: 1000, width: 50, height: 50 }],
    ]);
    expect(computeLayerChanges(src, ['lonely'], 'forward')).toHaveLength(0);
  });

  it('下移一层：与下方重叠元素交换', () => {
    const src = items([
      ['low', 'a0', { x: 0, y: 0, width: 100, height: 100 }],
      ['high', 'a1', { x: 10, y: 10, width: 100, height: 100 }],
    ]);
    const changes = computeLayerChanges(src, ['high'], 'backward');
    expect(changes[0]!.zOrder < 'a0').toBe(true);
  });

  it('多选上移：按从高到低处理避免互相越位', () => {
    const src = items([
      ['a', 'a0'],
      ['b', 'a1'],
      ['c', 'a2'],
    ]);
    const changes = computeLayerChanges(src, ['a', 'b'], 'forward');
    // b → c 之上，a → 原 b 位之上（重叠假设全部成立）
    expect(changes).toHaveLength(2);
    const zb = changes.find((c) => c.id === 'b')!.zOrder;
    const za = changes.find((c) => c.id === 'a')!.zOrder;
    expect(zb > 'a2').toBe(true);
    expect(za > 'a1' && za < zb).toBe(true);
  });
});
