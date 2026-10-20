// @vitest-environment jsdom
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { EraserService } from '../widgets/eraser/eraserService';

/**
 * 分段橡皮 service 落库守卫（docs/04 §8.1；2026-10-10 审计补测——切割几何
 * 由 eraserGeometry.test 覆盖，这里锁三分支编排）：全擦删 / 剩一段 setPoints
 * 保 id / 多段首段原设 + 新建继承样式；每扫掠一个事务；PEN 过滤；up 时
 * stopCapturing；Escape 中途取消 = undo 本手势 + 吃事件。
 * 桩法照 penService.test 先例（捕获 handlers + engine/history stub）。
 */

function makeHarness(strokes: Array<{ id: string; points: Array<[number, number]> }>) {
  const handlers: Record<string, ((e?: { world: { x: number; y: number } }) => void) | undefined> =
    {};
  const removed: string[][] = [];
  const added: Array<Record<string, unknown>> = [];
  const models: Record<string, unknown> = {};

  const shapeUpdate = vi.fn(); // 非 PEN 候选——必须被类型过滤排除，零触碰
  models['shape1'] = { capabilities: { erasable: false }, toJSON: () => ({}), update: shapeUpdate }; // SHAPE 不可擦
  for (const s of strokes) {
    const calls: Array<Record<string, unknown>> = [];
    const store = { data: { points: s.points, color: '#111111', strokeWidth: 3 } };
    models[s.id] = {
      capabilities: { erasable: true }, // 第五刀：能力位判定（strokes 全是 PEN）
      toJSON: () => store.data,
      update: vi.fn((patch: Record<string, unknown>) => {
        calls.push(patch);
        Object.assign(store.data, patch);
      }),
      _calls: calls,
    };
  }

  const engine = {
    transact: vi.fn((fn: () => void) => fn()),
    removeByIds: vi.fn((ids: string[]) => removed.push(ids)),
    getModelById: (id: string) => models[id],
    add: vi.fn((w: Record<string, unknown>) => added.push(w)),
    genInitialOrder: () => 'a0',
  };
  const history = { stopCapturing: vi.fn(), undo: vi.fn() };

  const penVms = strokes.map((s) => ({ id: s.id, type: 'PEN' }));
  const svc = new EraserService(
    {
      registerGlobalEventListener: (_m: string, h: typeof handlers) => Object.assign(handlers, h),
      optionLayer: { addChild: () => {}, removeChild: () => {} },
      vpScale$: new BehaviorSubject(1), // 半径换算 r = 10px / 1 = 10 世界单位
      cursorMode$: new BehaviorSubject('eraser'),
      clientToWorld: (x: number, y: number) => ({ x, y }),
    } as never,
    engine as never,
    { getVmsInRect: () => [...penVms, { id: 'shape1', type: 'SHAPE' }] } as never,
    history as never,
  );
  svc.initialize();
  const at = (x: number, y: number): { world: { x: number; y: number } } => ({ world: { x, y } });
  const model = (id: string) =>
    models[id] as { update: ReturnType<typeof vi.fn>; _calls: Array<Record<string, unknown>> };
  return { handlers, engine, history, removed, added, shapeUpdate, model, at };
}

describe('eraserService 落库三分支（一次扫掠一个事务）', () => {
  it('全擦：短笔画整段入胶囊 → removeByIds（单事务）', () => {
    // 笔画 [[45,0],[55,0]] 全部距点击 (50,0) ≤ 5 < r=10
    const h = makeHarness([
      {
        id: 'p1',
        points: [
          [45, 0],
          [55, 0],
        ],
      },
    ]);
    h.handlers.onPointerDown!(h.at(50, 0));
    h.handlers.onPointerUp!();
    expect(h.removed).toEqual([['p1']]);
    expect(h.engine.transact).toHaveBeenCalledTimes(1);
    expect(h.history.stopCapturing).toHaveBeenCalledTimes(1);
    expect(h.shapeUpdate).not.toHaveBeenCalled(); // PEN 过滤：形状候选零触碰
  });

  it('剩一段：擦掉笔头 → update({points}) 保 id（连续小擦不爆炸新建）', () => {
    const h = makeHarness([
      {
        id: 'p1',
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]);
    h.handlers.onPointerDown!(h.at(0, 0)); // 单点圆 r=10 从头部擦
    h.handlers.onPointerUp!();
    expect(h.removed).toHaveLength(0);
    expect(h.added).toHaveLength(0);
    const m = h.model('p1');
    expect(m.update).toHaveBeenCalledTimes(1);
    const pts = (m._calls[0] as { points: Array<[number, number]> }).points;
    expect(pts[0]![0]).toBeCloseTo(10, 3); // 切割边界 = 精确交点（距圆心 r 处）
    expect(pts.at(-1)).toEqual([100, 0]);
    expect(h.history.stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('多段：中段被擦 → 首段 update 原设、其余新建并继承 color/strokeWidth', () => {
    const h = makeHarness([
      {
        id: 'p1',
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]);
    h.handlers.onPointerDown!(h.at(50, 0)); // 圆心居中 → [40,60] 被切走 → 两段
    h.handlers.onPointerUp!();
    const m = h.model('p1');
    expect(m.update).toHaveBeenCalledTimes(1);
    const first = (m._calls[0] as { points: Array<[number, number]> }).points;
    expect(first[0]).toEqual([0, 0]);
    expect(first.at(-1)![0]).toBeCloseTo(40, 3);
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({ type: 'PEN', color: '#111111', strokeWidth: 3 });
    const newPts = (h.added[0] as { points: Array<[number, number]> }).points;
    expect(newPts[0]![0]).toBeCloseTo(60, 3);
    expect(newPts.at(-1)).toEqual([100, 0]);
    expect(h.removed).toHaveLength(0);
  });

  it('粗筛未覆盖（bbox 相交但笔画不在胶囊内）→ 零写', () => {
    // 扫掠点 (200, 200) 距笔画 ≥150 —— getVmsInRect 桩恒返回候选，精判必须放行 null
    const h = makeHarness([
      {
        id: 'p1',
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]);
    h.handlers.onPointerDown!(h.at(200, 200));
    h.handlers.onPointerUp!();
    expect(h.model('p1').update).not.toHaveBeenCalled();
    expect(h.removed).toHaveLength(0);
    expect(h.engine.transact).not.toHaveBeenCalled();
  });
});

describe('eraserService Escape 中途取消（capture 相拦截）', () => {
  it('拖动中 Escape → undo 本手势 + stopPropagation（阻断冒泡相切模式）+ 手势复位', () => {
    const h = makeHarness([
      {
        id: 'p1',
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]);
    h.handlers.onPointerDown!(h.at(0, 0));
    // 真实链路：键事件从画布子元素起泡，service 的 window capture 监听先行拦截
    // ——须从 body 派发（直接派发 window 是 target 相，验不出传播阻断）
    let bubbleReached = false;
    window.addEventListener('keydown', () => {
      bubbleReached = true;
    });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.history.undo).toHaveBeenCalledTimes(1);
    expect(bubbleReached).toBe(false); // stopPropagation 拦下（不切 cursor 模式）
    // 手势已复位：后续 move 不再切割
    h.handlers.onPointerMove!(h.at(50, 0));
    expect(h.model('p1').update).toHaveBeenCalledTimes(1); // 仅 down 时那一次
    // 非 erasing 时 Escape 不再 undo
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.history.undo).toHaveBeenCalledTimes(1);
  });
});
