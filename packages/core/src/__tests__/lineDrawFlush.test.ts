// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import { LineService } from '../widgets/line/lineService';

/**
 * 线绘制节流的 up-flush 回归（外部审查揪出，2026-09-21）：
 * onPointerUp 曾先置空 drawingId 再调 applyMove 冲刷 pendingMove——
 * applyMove 按 drawingId 查 model 拿到 null → flush 静默失效：
 * ① 快速拉线（down→move→up 全在 34ms 内）points 停在初始同位两点 →
 *   距离 <4 → 整条线被当「未拖出」删除；
 * ② 快速甩尾终点截断（最后一次 move 落在 up 前节流窗口内未应用）。
 */

function makeService() {
  let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
  /** model 桩：记录 update 落库的 points 序列 */
  const updates: Array<Array<[number, number]>> = [];
  const removed: string[] = [];
  const models = new Map<
    string,
    {
      update(p: { points: Array<[number, number]> }): void;
      toJSON(): { points: Array<[number, number]> };
    }
  >();
  const model = {
    update: (patch: { points: Array<[number, number]> }) => {
      updates.push(patch.points);
    },
    toJSON: () => ({
      points:
        updates.length > 0
          ? updates[updates.length - 1]!
          : [
              [0, 0],
              [0, 0],
            ],
    }),
  };
  const viewport = {
    registerGlobalEventListener: (_m: string, h: Record<string, (e: unknown) => void>) => {
      handlers = h;
    },
    setCursorMode: () => {},
    optionLayer: { addChild: () => {}, removeChild: () => {} },
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    toWorld: (p: { x: number; y: number }) => p,
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 2000, height: 2000 }),
  };
  const engine = {
    onModelRemoved$: new Subject(),
    add: vi.fn((data: { id: string }) => {
      // LineService 用自己 genId() 的 id 建 model——按传入 id 登记
      models.set(data.id, model as never);
      return { id: data.id };
    }),
    removeByIds: (ids: string[]) => removed.push(...ids),
    genInitialOrder: () => 'a0',
    getModelById: (id: string | null) => (id ? models.get(id) : undefined),
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = {
    getVmByPoint: () => [],
    getVmsInRect: () => [],
    getVmById: () => undefined,
    getAllVms: () => [],
  };
  const selector = {
    selected$: new BehaviorSubject<string[]>([]),
    setSelected: vi.fn(),
    dragMove$: new Subject(),
  };
  const history = { stopCapturing: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  // 统一编辑会话桩（批 2 起 LineService 注入 EditingService——本测试不驱动编辑）
  const editing = {
    begin: vi.fn(),
    exitActive: vi.fn(),
    editingWidgetId: null,
    activeKernel: null,
    session$: new Subject(),
  };
  const svc = new LineService(
    viewport as never,
    engine as never,
    vmEngine as never,
    selector as never,
    history as never,
    editing as never,
  );
  svc.initialize();
  const evt = (x: number, y: number): unknown => ({
    world: { x, y, clone: () => ({ x, y }) },
    screen: { x, y },
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    raw: { x, y },
  });
  return { handlers, updates, removed, evt };
}

describe('LineService 节流 up-flush（docs/08 §7 边界）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('快速拉线（down→move→up 同一节流窗口内）：终帧 flush 生效，线不被误删', () => {
    const { handlers, updates, removed, evt } = makeService();
    handlers.onPointerDown?.(evt(100, 100));
    handlers.onPointerMove?.(evt(400, 300));
    // 不推进 fake timer——up 发生在 34ms 节流窗口内（pendingMove 未应用）
    handlers.onPointerUp?.(evt(400, 300));
    expect(removed).toEqual([]); // 曾被当未拖出删除
    expect(updates.length).toBe(1); // flush 落库了终帧
  });

  it('快速甩尾：up 前最后一次 move 必达（终点不截断）', () => {
    const { handlers, updates, evt } = makeService();
    handlers.onPointerDown?.(evt(0, 0));
    handlers.onPointerMove?.(evt(100, 0));
    vi.advanceTimersByTime(40); // 第一帧 trailing 已应用
    handlers.onPointerMove?.(evt(300, 0)); // 尾帧落在下一节流窗口内
    handlers.onPointerUp?.(evt(300, 0));
    const last = updates[updates.length - 1]!;
    const end = last[last.length - 1]!;
    expect(Math.abs(end[0] - 300)).toBeLessThanOrEqual(1); // 终点 ≈ 300（曾停在 100）
  });

  it('down→up 无 move：仍按未拖出删除（既有语义不回退）', () => {
    const { handlers, removed, evt } = makeService();
    handlers.onPointerDown?.(evt(50, 50));
    handlers.onPointerUp?.(evt(50, 50));
    expect(removed.length).toBe(1);
  });
});
