import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SelectorService } from '../platform/selector/selectorService';
import type { IMindDragDelegate } from '../types';
import type { RefLineService } from '../platform/refLine/refLineService';

/**
 * 回归（2026-09 Phase 4 审查）：4.4 拖拽重排的 startDrag/dragMove/dragEnd 曾是
 * 全仓零调用的死代码——roadmap 标 ✅ 但用户拖不动节点。守卫：cursor 指针序列
 * 按下在脑图非根节点上时，selector 委托 MindService 接管（docs/11 §6 接线）。
 */

function makeHarness(opts: { startDragOk: boolean } = { startDragOk: true }) {
  let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
  const mindVm = {
    id: 'map1',
    type: 'MIND_MAP',
    root: { zOrder: 'a0' },
    // y < 200 命中子节点，否则命中根
    hitNode: (p: { x: number; y: number }) =>
      p.y < 200 ? { model: { id: 'node-child' } } : { model: { id: 'node-root' } },
    getBounds: () => ({ x: 0, y: 0, width: 600, height: 400 }),
    getLocalRect: () => ({ x: 0, y: 0, width: 600, height: 400 }),
    applyDragPreview: vi.fn(),
    commitDrag: vi.fn(),
    hitTestPoint: () => true,
    hitTestRect: () => false,
    onStateChanged$: new Subject(),
    onSelected$: new BehaviorSubject(false),
  };
  let nodeSelectedFlag = false;
  const delegate: IMindDragDelegate = {
    startDrag: vi.fn(
      (_mapId: string, nodeId: string) => opts.startDragOk && nodeId !== 'node-root',
    ),
    dragMove: vi.fn(() => true),
    dragEnd: vi.fn(() => 'moved' as const),
    focusRoot: vi.fn(),
    focusNode: vi.fn(() => {
      nodeSelectedFlag = true;
    }),
    isNodeSelected: () => nodeSelectedFlag,
    isDragging: false,
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
      getVmById: () => mindVm,
      getAllVms: () => [mindVm],
      getVmByPoint: () => [mindVm],
      getVmByRect: () => [mindVm],
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
  );
  selector.mindDragDelegate = delegate;
  selector.initialize();

  const evt = (x: number, y: number): unknown => ({
    world: { x, y, clone: () => ({ x, y }) },
    screen: { x, y },
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    raw: { x, y },
  });
  return { selector, delegate, handlers, evt, mindVm };
}

describe('selector↔mind 拖拽委托接线（docs/11 §6，4.4 防死代码回归）', () => {
  it('按下在非根节点：委托 startDrag 接管 + 就地选中整图', () => {
    const h = makeHarness();
    h.handlers.onPointerDown?.(h.evt(120, 120));
    expect(h.delegate.startDrag).toHaveBeenCalledWith(
      'map1',
      'node-child',
      expect.objectContaining({ x: 120, y: 120 }),
    );
    expect(h.selector.selected$.value).toEqual(['map1']);
  });

  it('接管期间 move/up 走委托，松手后不再接管', () => {
    const h = makeHarness();
    h.handlers.onPointerDown?.(h.evt(120, 120));
    h.handlers.onPointerMove?.(h.evt(200, 150));
    expect(h.delegate.dragMove).toHaveBeenCalledTimes(1);
    h.handlers.onPointerUp?.(h.evt(260, 160));
    expect(h.delegate.dragEnd).toHaveBeenCalledTimes(1);
    // 序列结束：后续 move 不再进委托
    h.handlers.onPointerMove?.(h.evt(300, 150));
    expect(h.delegate.dragMove).toHaveBeenCalledTimes(1);
  });

  it('按下在根节点：startDrag 返回 false，落回整图拖拽（通用路径）', () => {
    const h = makeHarness();
    h.handlers.onPointerDown?.(h.evt(300, 300)); // y ≥ 200 → 根
    expect(h.delegate.startDrag).toHaveBeenCalledWith(
      'map1',
      'node-root',
      expect.objectContaining({ x: 300, y: 300 }),
    );
    // 整图拖拽接管：移动越过阻尼阈值后应走 applyDragPreview
    h.handlers.onPointerMove?.(h.evt(340, 300));
    expect(h.mindVm.applyDragPreview).toHaveBeenCalled();
    expect(h.delegate.dragMove).not.toHaveBeenCalled();
  });
});

describe('点根委托（4.9：整图选中 + 焦点重置根）', () => {
  it('按下根节点：startDrag 拒绝后触发 focusRoot（不进入节点拖拽）', () => {
    const h = makeHarness();
    h.handlers.onPointerDown?.(h.evt(120, 300)); // y ≥ 200 命中根（hitNode 桩）
    expect(h.delegate.startDrag).toHaveBeenCalledWith('map1', 'node-root', expect.anything());
    expect(h.delegate.focusRoot).toHaveBeenCalledWith('map1');
    // mindDragging 未置位（根不接管拖拽，落回通用整图路径）
    h.handlers.onPointerUp?.(h.evt(120, 300));
    expect(h.delegate.dragEnd).not.toHaveBeenCalled();
  });
});

describe('节点级选中的整树框隐藏（4.9 视觉对齐既有设计）', () => {
  it('按下子节点：选区框画在节点本体（既有设计点 MIND_NODE 框本体，不是整树 bbox）', async () => {
    const { SelectorService } = await import('../platform/selector/selectorService');
    const { BehaviorSubject } = await import('rxjs');
    let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
    const layerChildren: unknown[] = [];
    let nodeSelected = false;
    const mindVm = {
      id: 'map1',
      type: 'MIND_MAP',
      root: { zOrder: 'a0' },
      hitNode: () => ({ model: { id: 'node-child' } }),
      getBounds: () => ({ x: 0, y: 0, width: 600, height: 400 }),
      getLocalRect: () => ({ x: 0, y: 0, width: 600, height: 400 }),
      hitTestPoint: () => true,
      hitTestRect: () => true,
      onStateChanged$: new (await import('rxjs')).Subject(),
      onSelected$: new BehaviorSubject(false),
    };
    const delegate: IMindDragDelegate = {
      startDrag: vi.fn(() => true),
      dragMove: vi.fn(() => true),
      dragEnd: vi.fn(() => 'click' as const),
      focusNode: vi.fn(() => {
        nodeSelected = true;
      }),
      isNodeSelected: () => nodeSelected,
      getFocusFrame: () => ({ x: 10, y: 20, width: 80, height: 30 }),
      isDragging: false,
    };
    const selector = new SelectorService(
      {
        optionLayer: { addChild: (c: unknown) => layerChildren.push(c) },
        vpScale$: { value: 1 },
        registerGlobalEventListener: (_m: string, h: Record<string, (e: unknown) => void>) => {
          handlers = h;
        },
      } as never,
      {
        getAllVms: () => [mindVm],
        getVmById: () => mindVm,
        getVmByPoint: () => [mindVm],
        getVmByRect: () => [mindVm],
      } as never,
      {
        onModelCreated$: new (await import('rxjs')).Subject(),
        onModelRemoved$: new (await import('rxjs')).Subject(),
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
        }) as never,
    );
    selector.mindDragDelegate = delegate;
    selector.initialize();
    // layerChildren：[0] = SelectorVm（框选）的 graphics，[1] = SelectionVm（选区框）的 graphics
    const frame = layerChildren[1] as { visible: boolean };
    const evt = (x = 120, y = 120): unknown => ({
      world: { x, y, clone: () => ({ x, y }) },
      screen: { x, y },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x, y },
    });
    // 按下子节点 → 焦点落节点 → 选区框 = 节点本体（曾经的 4.9 形态是「隐藏整树框、
    // 只靠节点本体描边」，用户实测反馈子节点看不出选中态）
    handlers.onPointerDown?.(evt());
    expect(delegate.focusNode).toHaveBeenCalledWith('map1', 'node-child');
    expect(frame.visible).toBe(true);
    expect(selector.__selectionFrame).toEqual({ x: 10, y: 20, width: 80, height: 30 });
    // 无焦点帧（delegate 不给框）→ 回退整树 bbox
    nodeSelected = false;
    selector.setSelected(['map1']);
    expect(frame.visible).toBe(true);
  });
});
