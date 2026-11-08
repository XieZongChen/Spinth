import { Point } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  MARQUEE_TRACTION_SCREEN,
  MarqueeSession,
  type IMarqueeContext,
} from '../platform/selector/selectorMarquee';
import { DRAG_TRACTION_SCREEN } from '../common/interaction';
import type { IRect } from '../common/geometry';

/**
 * 框选会话单测（specs/marquee-auto-scroll §8.1 T1-T8）：阈值屏幕口径 / 锁存 /
 * 去重 / 幂等 / 矩形绝对导出 / finish / cancel / 组过滤。直接构造会话 +
 * vi.fn 桩 ctx——编排上报语义另见 selectorEdgeScroll.test.ts（P1-P4）。
 */

function createHarness(opts: { types?: Record<string, string>; groups?: unknown } = {}) {
  let hits = ['w1'];
  const types = opts.types ?? {};
  const vmsOf = (ids: string[]) => ids.map((id) => ({ id, type: types[id] ?? 'SHAPE' }));
  const setSelected = vi.fn();
  const selectorVm = { show: vi.fn(), update: vi.fn(), hide: vi.fn() };
  const focusFromMarquee = vi.fn();
  const ctx = {
    vmEngine: {
      getVmByRect: () => vmsOf(hits),
      getVmById: (id: string) => vmsOf(hits).find((v) => v.id === id),
    },
    setSelected,
    mindDragDelegate: () => ({ focusFromMarquee }),
    selectorVm,
  } as unknown as IMarqueeContext;

  const make = (startWorld = new Point(0, 0), startScreen = { x: 0, y: 0 }) =>
    new MarqueeSession(ctx, startWorld, startScreen, (opts.groups ?? null) as never);

  return {
    make,
    setHits: (next: string[]) => (hits = next),
    setSelected,
    selectorVm,
    focusFromMarquee,
  };
}

const screen = (x: number, y: number) => ({ x, y });

describe('MarqueeSession（specs/marquee-auto-scroll T1-T8）', () => {
  it('T1 起拖判据是屏幕口径：world 远/screen 近不触发，且判据只门控滚屏不门控选中', () => {
    expect(MARQUEE_TRACTION_SCREEN).toBe(DRAG_TRACTION_SCREEN); // 单一来源（D2）
    const h = createHarness();
    const m = h.make(new Point(0, 0), screen(0, 0));
    // 世界差 1000、屏幕差 9：滚屏判据不触发
    m.move(new Point(1000, 0), screen(9, 0));
    expect(m.moved).toBe(false);
    // 但矩形与选中照常更新（阈值只门控滚屏，specs §4 D2/R4）
    expect(h.setSelected).toHaveBeenCalledTimes(1);
    expect(h.selectorVm.update).toHaveBeenCalledTimes(1);
    // 屏幕差恰为 10（含边界）→ 触发
    m.move(new Point(1000, 0), screen(10, 0));
    expect(m.moved).toBe(true);
  });

  it('T2 判据锁存：越过阈值后回移到起点附近不复位', () => {
    const h = createHarness();
    const m = h.make(new Point(0, 0), screen(0, 0));
    m.move(new Point(15, 0), screen(15, 0));
    expect(m.moved).toBe(true);
    m.move(new Point(2, 0), screen(2, 0));
    expect(m.moved).toBe(true);
  });

  it('T3 幂等：同一 (world, screen) 重复 move → 矩形照常重绘、setSelected 只一次', () => {
    const h = createHarness();
    const m = h.make(new Point(0, 0), screen(0, 0));
    m.move(new Point(50, 40), screen(50, 40));
    m.move(new Point(50, 40), screen(50, 40));
    m.move(new Point(50, 40), screen(50, 40));
    expect(h.setSelected).toHaveBeenCalledTimes(1);
    // 矩形每帧重绘，不受去重影响（D4）
    expect(h.selectorVm.update).toHaveBeenCalledTimes(3);
    const rects = h.selectorVm.update.mock.calls.map((c) => c[0] as IRect);
    expect(rects[1]).toEqual(rects[0]);
    expect(rects[2]).toEqual(rects[0]);
  });

  it('T4 去重：命中集不变连发 5 帧只写一次；命中集变化 → 第二次', () => {
    const h = createHarness();
    const m = h.make();
    for (let i = 0; i < 5; i++) m.move(new Point(20 + i, 0), screen(20 + i, 0));
    expect(h.setSelected).toHaveBeenCalledTimes(1);
    h.setHits(['w1', 'w2']);
    m.move(new Point(60, 0), screen(60, 0));
    expect(h.setSelected).toHaveBeenCalledTimes(2);
    expect(h.setSelected).toHaveBeenLastCalledWith(['w1', 'w2']);
  });

  it('T5 首帧空命中也必须写一次 setSelected([])（哨兵 null，R3）', () => {
    const h = createHarness();
    h.setHits([]);
    const m = h.make();
    m.move(new Point(30, 0), screen(30, 0));
    m.move(new Point(60, 0), screen(60, 0));
    expect(h.setSelected).toHaveBeenCalledTimes(1);
    expect(h.setSelected).toHaveBeenCalledWith([]);
  });

  it('T6 矩形恒由 start/cur 绝对导出：任意序列 + 同输入重复得到同矩形（规则 1）', () => {
    const h = createHarness();
    const m = h.make(new Point(200, 300), screen(0, 0));
    m.move(new Point(100, 50), screen(20, 0)); // 反向：cur < start
    m.move(new Point(500, 800), screen(40, 0)); // 正向
    m.move(new Point(100, 50), screen(20, 0)); // 回到首帧输入
    const rects = h.selectorVm.update.mock.calls.map((c) => c[0] as IRect);
    expect(rects[0]).toEqual({ x: 100, y: 50, width: 100, height: 250 });
    expect(rects[1]).toEqual({ x: 200, y: 300, width: 300, height: 500 });
    expect(rects[2]).toEqual(rects[0]); // 无增量累加：重复输入得同矩形
  });

  it('T7 finish：隐藏蓝框 + MIND_MAP 命中触发 focusFromMarquee（既有语义）', () => {
    const h = createHarness({ types: { m1: 'MIND_MAP' } });
    h.setHits(['m1']);
    const m = h.make();
    m.move(new Point(80, 0), screen(80, 0));
    m.finish(['m1']);
    expect(h.selectorVm.hide).toHaveBeenCalledTimes(1);
    expect(h.focusFromMarquee).toHaveBeenCalledTimes(1);
    const [rect, id] = h.focusFromMarquee.mock.calls[0] as [IRect, string];
    expect(id).toBe('m1');
    expect(rect).toEqual({ x: 0, y: 0, width: 80, height: 0 });
  });

  it('T8 cancel 只隐藏蓝框、选中集不变；组 filter 被调用并生效', () => {
    const h = createHarness();
    const m = h.make();
    m.move(new Point(30, 0), screen(30, 0));
    const callsBefore = h.setSelected.mock.calls.length;
    m.cancel();
    expect(h.selectorVm.hide).toHaveBeenCalledTimes(1);
    expect(h.setSelected.mock.calls.length).toBe(callsBefore);

    const filter = vi.fn((hitIds: string[]) => (hitIds.length ? ['g1'] : []));
    const g = createHarness({ groups: { createMarqueeFilter: () => filter } });
    const gm = g.make();
    gm.move(new Point(30, 0), screen(30, 0));
    expect(filter).toHaveBeenCalledTimes(1);
    expect(g.setSelected).toHaveBeenCalledWith(['g1']);
  });
});
