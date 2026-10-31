import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SelectorService } from '../platform/selector/selectorService';
import type { RefLineService } from '../platform/refLine/refLineService';
import type { IEdgeAutoScrollService } from '../types';

/**
 * selector ↔ 边缘自动滚屏集成（specs/edge-auto-scroll §7.4 T27-T31）：编排层
 * 桩测试——沿用 selectorDrag.test.ts 的指针流桩，验证 5 行集成的上报语义
 * （update 收到正确的 dragging、up/cancel 停止、重放幂等）。
 */

interface VmStub {
  id: string;
  type: string;
  rect: { x: number; y: number; width: number; height: number };
  getBounds: () => { x: number; y: number; width: number; height: number };
  getLocalRect: () => { x: number; y: number; width: number; height: number };
  applyDragPreview: ReturnType<typeof vi.fn>;
  commitDrag: ReturnType<typeof vi.fn>;
  onSelected$: BehaviorSubject<boolean>;
  onStateChanged$: Subject<unknown>;
  hitNode?: (p: { x: number; y: number }) => { model: { id: string } } | null;
}

function createHarness(opts: { mind?: boolean } = {}) {
  const vm: VmStub = {
    id: 'w1',
    type: opts.mind ? 'MIND_MAP' : 'SHAPE',
    rect: { x: 100, y: 100, width: 50, height: 50 },
    getBounds: () => ({ ...rect }),
    getLocalRect: () => ({ ...rect }),
    applyDragPreview: vi.fn(),
    commitDrag: vi.fn(),
    onSelected$: new BehaviorSubject(false),
    onStateChanged$: new Subject(),
    hitNode: () => ({ model: { id: 'node-child' } }),
  };
  const rect = vm.rect;
  const anyVm = vm as unknown;

  let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
  const update = vi.fn();
  const stop = vi.fn();
  const edgeScroll = { update, stop, scrolling: false, dispose: vi.fn() } as IEdgeAutoScrollService;
  /** 脑图 delegate（T30）：isDragMoved 可切换 */
  const delegate = {
    startDrag: vi.fn(() => true),
    dragMove: vi.fn(() => true),
    dragEnd: vi.fn(() => 'moved' as const),
    dragCancel: vi.fn(),
    isNodeSelected: () => false,
    getFocusFrame: () => null,
    isDragging: false,
    isDragMoved: false,
  };

  const selector = new SelectorService(
    {
      optionLayer: { addChild: () => {} },
      vpScale$: { value: 1 },
      registerGlobalEventListener: (_mode: string, h: Record<string, (e: unknown) => void>) => {
        handlers = h;
      },
    } as never,
    {
      getAllVms: () => [anyVm],
      getVmById: () => anyVm,
      getVmByPoint: () => [anyVm],
      getVmByRect: () => [anyVm],
    } as never,
    {
      onModelCreated$: new Subject(),
      onModelRemoved$: new Subject(),
      transact: (fn: () => void) => fn(),
      removeByIds: vi.fn(),
    } as never,
    { stopCapturing: vi.fn() } as never,
    () =>
      ({
        snapForDrag: vi.fn((_r: unknown, dx: number, dy: number) => ({
          dx,
          dy,
          matchedV: [],
          matchedH: [],
        })),
        hideMatches: vi.fn(),
      }) as unknown as RefLineService,
    () => null,
    edgeScroll,
  );
  selector.mindDragDelegate = opts.mind ? delegate : null;
  selector.initialize();

  const evt = (x: number, y: number): unknown => ({
    world: { x, y, clone: () => ({ x, y }) },
    screen: { x, y },
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    raw: { x, y },
  });

  return { vm, selector, delegate, update, stop, handlers, evt };
}

describe('selector 边缘滚屏集成（specs/edge-auto-scroll T27-T31）', () => {
  it('T27 down → move 过阻尼 → update 收到 dragging=true 与指针 screen', () => {
    const h = createHarness();
    h.handlers.onPointerDown?.(h.evt(125, 125));
    h.handlers.onPointerMove?.(h.evt(145, 125)); // hypot(20,0) ≥ 10 → moved
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith({ x: 145, y: 125 }, true);
  });

  it('T28 down → move 未过阻尼 → update 收到 dragging=false', () => {
    const h = createHarness();
    h.handlers.onPointerDown?.(h.evt(125, 125));
    h.handlers.onPointerMove?.(h.evt(128, 127)); // hypot(3,2) < 10
    expect(h.update).toHaveBeenCalledWith({ x: 128, y: 127 }, false);
  });

  it('T29 up 与 cancel 各触发一次 stop（两分支各一次）', () => {
    // 元素拖拽分支的 up
    const a = createHarness();
    a.handlers.onPointerDown?.(a.evt(125, 125));
    a.handlers.onPointerMove?.(a.evt(160, 125));
    a.handlers.onPointerUp?.(a.evt(160, 125));
    expect(a.stop).toHaveBeenCalledTimes(1);
    // cancel 分支
    const b = createHarness();
    b.handlers.onPointerDown?.(b.evt(125, 125));
    b.handlers.onPointerMove?.(b.evt(160, 125));
    b.handlers.onPointerCancel?.(b.evt(160, 125));
    expect(b.stop).toHaveBeenCalledTimes(1);
  });

  it('T30 脑图分支：update 的 dragging 跟随 delegate.isDragMoved（缺省 false）', () => {
    const h = createHarness({ mind: true });
    h.handlers.onPointerDown?.(h.evt(125, 125)); // startDrag true → mindDragging
    h.handlers.onPointerMove?.(h.evt(130, 125));
    expect(h.update).toHaveBeenCalledWith({ x: 130, y: 125 }, false); // 缺省视为未拖起
    h.delegate.isDragMoved = true;
    h.handlers.onPointerMove?.(h.evt(140, 125));
    expect(h.update).toHaveBeenLastCalledWith({ x: 140, y: 125 }, true);
  });

  it('T31 重放同屏幕坐标两次 → applyDragPreview 收到相同 (init, dx, dy)（幂等）', () => {
    const h = createHarness();
    h.handlers.onPointerDown?.(h.evt(125, 125));
    // 同一坐标重复投递（模拟 rAF 每帧 replayLastPointerMove）
    h.handlers.onPointerMove?.(h.evt(180, 125));
    h.handlers.onPointerMove?.(h.evt(180, 125));
    h.handlers.onPointerMove?.(h.evt(180, 125));
    expect(h.vm.applyDragPreview).toHaveBeenCalledTimes(3);
    const [init1, dx1, dy1] = h.vm.applyDragPreview.mock.calls[0] as [
      { x: number },
      number,
      number,
    ];
    for (const call of h.vm.applyDragPreview.mock.calls.slice(1)) {
      expect(call[0]).toEqual(init1);
      expect(call[1]).toBe(dx1);
      expect(call[2]).toBe(dy1);
    }
    expect(dx1).toBe(55); // 180 − 125，绝对量不随重放次数漂移
  });
});
