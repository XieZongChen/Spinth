// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { LineService } from '../widgets/line/lineService';
import { LineQuickAdd } from '../widgets/line/lineQuickAdd';
import { LineAnchorFollow } from '../widgets/line/lineAnchorFollow';
import { LineEndpointDrag } from '../widgets/line/lineEndpointDrag';
import { LineSegTextSlide } from '../widgets/line/lineSegTextSlide';

/**
 * LineService 的装配护栏（specs/sequence-diagram §7.1 前置重构）：
 * ① `'line'` 模式注册的处理器就是只读属性 `drawHandlers`——多图元工具的转发者
 *    要拿到同一个对象按当前图元种类分发（一个 CursorMode 只能注册一组处理器）；
 * ② 协作者的释放顺序——`Disposable.dispose` 按登记序正向遍历，协作者构造迁工厂
 *    时最容易悄悄改变的就是它。桩与 lineDrawFlush.test 同款（走真 initialize）。
 */

function makeService() {
  let registered: Record<string, ((e: unknown) => void) | undefined> | undefined;
  const viewport = {
    registerGlobalEventListener: (_m: string, h: Record<string, (e: unknown) => void>) => {
      registered = h;
    },
    setCursorMode: () => {},
    optionLayer: { addChild: () => {}, removeChild: () => {} },
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    toWorld: (p: { x: number; y: number }) => p,
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 2000, height: 2000 }),
  };
  const engine = {
    onModelRemoved$: new Subject<string[]>(),
    add: vi.fn((data: { id: string }) => ({ id: data.id })),
    removeByIds: () => {},
    genInitialOrder: () => 'a0',
    getModelById: () => undefined,
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
  return { svc, registered };
}

describe('LineService 装配：drawHandlers 与协作者释放顺序', () => {
  it("initialize() 注册到 'line' 模式的就是 drawHandlers——同一引用，五个成员齐全", () => {
    const { svc, registered } = makeService();
    const drawHandlers = (svc as unknown as { drawHandlers?: unknown }).drawHandlers;
    expect(registered).toBe(drawHandlers);
    for (const key of [
      'onPointerCancel',
      'onPointerDown',
      'onPointerMove',
      'onPointerUp',
      'onPointerUpOutside',
    ]) {
      expect(typeof registered?.[key], key).toBe('function');
    }
  });

  it('dispose 按登记序释放协作者：quickAdd → anchorFollow → endpointDragCtl → segTextSlide', () => {
    const { svc } = makeService();
    const internals = svc as unknown as Record<string, unknown>;
    const spies = [
      vi.spyOn(internals.quickAdd as LineQuickAdd, 'dispose'),
      vi.spyOn(internals.anchorFollow as LineAnchorFollow, 'dispose'),
      vi.spyOn(internals.endpointDragCtl as LineEndpointDrag, 'dispose'),
      vi.spyOn(internals.segTextSlide as LineSegTextSlide, 'dispose'),
    ];
    svc.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    const calls = spies.map((spy) => spy.mock.invocationCallOrder[0]!);
    expect([...calls].sort((a, b) => a - b)).toEqual(calls); // 调用序即列表序
  });
});
