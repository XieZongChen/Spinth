import { describe, expect, it, vi } from 'vitest';
import type { IActivationLookup } from '../types/base';
import type { IFrameLookup } from '../types';
import { composeCascadeLookup } from '../widgets/sequence/sequenceCascade';

/**
 * 级联复合查找（specs/sequence-diagram §5.3）：容器的级联钩子与激活条的随行钩子
 * 合成同一个 IFrameLookup——selector / clipboard / layer / alignCommands 的调用点
 * 不认具体类型，注入点换成它即可（零改动）。
 */

function makeParts() {
  const frame = {
    isFrame: vi.fn((id: string) => id === 'f1'),
    childIds: vi.fn(() => ['c1']),
    expandForCascade: vi.fn((ids: string[]) => [...ids, 'c1']),
    reconcileParents: vi.fn(),
    adoptByLanding: vi.fn(),
    computeLayerClamps: vi.fn(() => [{ id: 'f1', zOrder: 'a0' }]),
    createMarqueeFrameFilter: vi.fn(() => null),
  };
  const seq = {
    expandActivations: vi.fn((_ids: string[]) => [] as string[]),
    reconcileActivations: vi.fn(),
    adoptActivationsByLanding: vi.fn(),
  };
  return {
    frame: frame as unknown as IFrameLookup & typeof frame,
    seq: seq as unknown as IActivationLookup & typeof seq,
  };
}

describe('composeCascadeLookup（§5.3）', () => {
  it('展开 = 容器展开 ∪ 激活条展开，去重保序（生命线排在它的条之前）', () => {
    const { frame, seq } = makeParts();
    frame.expandForCascade.mockReturnValue(['lf', 'c1', 'lf']);
    seq.expandActivations.mockReturnValue(['bar1', 'c1', 'bar2']);
    const cascade = composeCascadeLookup(frame, seq);
    expect(cascade.expandForCascade(['lf', 'c1'])).toEqual(['lf', 'c1', 'bar1', 'bar2']);
    expect(frame.expandForCascade).toHaveBeenCalledWith(['lf', 'c1']);
    expect(seq.expandActivations).toHaveBeenCalledWith(['lf', 'c1']);
  });

  it('reconcile / adopt：两者依次调用（容器先、激活条后），实参原样', () => {
    const { frame, seq } = makeParts();
    const cascade = composeCascadeLookup(frame, seq);
    const rectOf = () => ({ x: 0, y: 0, width: 10, height: 10 });
    const order: string[] = [];
    frame.reconcileParents.mockImplementation(() => order.push('frame'));
    seq.reconcileActivations.mockImplementation(() => order.push('seq'));
    frame.adoptByLanding.mockImplementation(() => order.push('frame-adopt'));
    seq.adoptActivationsByLanding.mockImplementation(() => order.push('seq-adopt'));
    cascade.reconcileParents(['a'], rectOf);
    expect(order).toEqual(['frame', 'seq']);
    expect(seq.reconcileActivations).toHaveBeenCalledWith(['a'], rectOf);
    cascade.adoptByLanding(['a', 'b']);
    expect(order).toEqual(['frame', 'seq', 'frame-adopt', 'seq-adopt']);
    expect(frame.adoptByLanding).toHaveBeenCalledWith(['a', 'b']);
    expect(seq.adoptActivationsByLanding).toHaveBeenCalledWith(['a', 'b']);
  });

  it('其余五个方法直通 frame：实参与返回值原样，激活条钩子不参与', () => {
    const { frame, seq } = makeParts();
    const cascade = composeCascadeLookup(frame, seq);
    const groups = { groupOf: () => undefined, membersOf: () => [] as string[] };
    expect(cascade.isFrame('f1')).toBe(true);
    expect(cascade.isFrame('x')).toBe(false);
    expect(cascade.childIds('f1')).toEqual(['c1']);
    expect(cascade.computeLayerClamps([{ id: 'f1', zOrder: 'a0' }])).toEqual([
      { id: 'f1', zOrder: 'a0' },
    ]);
    expect(cascade.createMarqueeFrameFilter(groups)).toBeNull();
    expect(frame.createMarqueeFrameFilter).toHaveBeenCalledWith(groups);
    expect(seq.expandActivations).not.toHaveBeenCalled();
    expect(seq.reconcileActivations).not.toHaveBeenCalled();
    expect(seq.adoptActivationsByLanding).not.toHaveBeenCalled();
  });

  it('seq 为 null（无时序图的组合）：原样返回 frame（同一引用）', () => {
    const { frame } = makeParts();
    expect(composeCascadeLookup(frame, null)).toBe(frame);
  });
});
