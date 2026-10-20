import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PenService } from '../widgets/pen/penService';

/**
 * penService 桩测试（docs/15 §5 覆盖率候选——覆盖率 3%）：绘制管线编排——
 * 起笔建模型 / 60ms 采样节流 / 收笔边界（单点删 vs 成笔 stopCapturing）/
 * drawingId 生命周期。stub 模式照 plainTextKernel 先例（捕获 handlers +
 * engine/history stub + fake timers 驱动节流窗口）。
 */

function makeHarness() {
  const handlers: Record<string, ((e?: { world: { x: number; y: number } }) => void) | undefined> =
    {};
  const added: Array<Record<string, unknown>> = [];
  const removed: string[][] = [];
  const appended: Array<[number, number]> = [];
  const model = {
    appendPoint: (p: [number, number]) => appended.push(p),
    toJSON: vi.fn(() => ({
      points: [
        [0, 0],
        [1, 1],
      ],
    })), // ≥2 点（成笔路径）
  };
  const engine = {
    add: vi.fn((w: Record<string, unknown>) => added.push(w)),
    getModelById: vi.fn(() => model),
    removeByIds: vi.fn((ids: string[]) => removed.push(ids)),
    genInitialOrder: () => 'a0',
  };
  const history = { stopCapturing: vi.fn() };
  const svc = new PenService(
    {
      registerGlobalEventListener: (_m: string, h: typeof handlers) => Object.assign(handlers, h),
    } as never,
    engine as never,
    history as never,
  );
  svc.initialize();
  return { handlers, added, removed, appended, model, engine, history };
}

const at = (x: number, y: number): { world: { x: number; y: number } } => ({ world: { x, y } });

describe('penService 绘制管线（60ms 采样 + 收笔边界）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('起笔：建 PEN 模型（单起点 + 默认黑；默认档零字段——strokeWidth=4 不落库）', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(100, 50));
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({
      type: 'PEN',
      points: [[100, 50]],
      color: '#1f2937',
    });
    expect('strokeWidth' in (h.added[0] as Record<string, unknown>)).toBe(false); // 回落 schema default 4
  });

  it('60ms 采样节流：窗口内连续 move 只采一点，越窗追加', () => {
    const h = makeHarness();
    // fake timers 把 performance.now 归零——先推进过节流窗（真实环境时钟恒 >60ms）
    vi.advanceTimersByTime(200);
    h.handlers.onPointerDown!(at(0, 0));
    h.handlers.onPointerMove!(at(10, 0)); // 首窗采样
    h.handlers.onPointerMove!(at(20, 0)); // 同窗丢弃
    h.handlers.onPointerMove!(at(30, 0)); // 同窗丢弃
    expect(h.appended).toEqual([[10, 0]]);
    vi.advanceTimersByTime(61);
    h.handlers.onPointerMove!(at(40, 0)); // 越窗采样
    expect(h.appended).toEqual([
      [10, 0],
      [40, 0],
    ]);
  });

  it('收笔：≥2 点成笔 → stopCapturing 且不删除', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(0, 0));
    h.handlers.onPointerMove!(at(50, 0));
    h.handlers.onPointerUp!();
    expect(h.history.stopCapturing).toHaveBeenCalledTimes(1);
    expect(h.removed).toHaveLength(0);
  });

  it('收笔：单点未拖 → 删除（点击不成笔）', () => {
    const h = makeHarness();
    h.model.toJSON.mockReturnValue({ points: [[0, 0]] });
    h.handlers.onPointerDown!(at(0, 0));
    h.handlers.onPointerUp!();
    expect(h.removed).toHaveLength(1);
    expect(h.history.stopCapturing).not.toHaveBeenCalled();
  });

  it('up 后 drawingId 清空：后续 move 不再采样', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(0, 0));
    h.handlers.onPointerUp!();
    vi.advanceTimersByTime(61);
    h.handlers.onPointerMove!(at(99, 99));
    expect(h.appended).toHaveLength(0);
  });
});
