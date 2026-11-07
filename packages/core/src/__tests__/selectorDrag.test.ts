import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SelectorService } from '../platform/selector/selectorService';
import type { RefLineService } from '../platform/refLine/refLineService';

/**
 * 编排层指针流回归（2026-09 质量护栏补强，docs/15）：
 * 直接驱动 selector 捕获的 pointer handlers，验证拖拽编排——
 * 纯逻辑单测覆盖不到的一层（docs/14 调试方法论：单测全绿 ≠ 编排正确）。
 * 守卫的已知 bug 形态：吸附修正只作用于视觉、落库从指针原始差值重算（松手跳回）。
 */

interface VmStub {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  getBounds: () => { x: number; y: number; width: number; height: number };
  getLocalRect: () => { x: number; y: number; width: number; height: number };
  applyDragPreview: ReturnType<typeof vi.fn>;
  commitDrag: ReturnType<typeof vi.fn>;
  onSelected$: BehaviorSubject<boolean>;
  onStateChanged$: Subject<unknown>;
}

function createHarness(
  opts: {
    snapDx?: number;
    snapDy?: number;
  } = {},
) {
  const vm: VmStub = {
    id: 'w1',
    rect: { x: 100, y: 100, width: 50, height: 50 },
    getBounds: () => ({ ...rect }),
    getLocalRect: () => ({ ...rect }),
    applyDragPreview: vi.fn(),
    commitDrag: vi.fn(),
    onSelected$: new BehaviorSubject(false),
    onStateChanged$: new Subject(),
  };
  const rect = vm.rect;
  const anyVm = vm as unknown;

  let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
  const transact = vi.fn((fn: () => void) => fn());
  const stopCapturing = vi.fn();
  const snapForDrag = vi.fn((_rect: unknown, dx: number, dy: number) => ({
    dx: dx + (opts.snapDx ?? 0),
    dy: dy + (opts.snapDy ?? 0),
    matchedV: [],
    matchedH: [],
  }));
  const hideMatches = vi.fn();

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
      transact,
      removeByIds: vi.fn(),
    } as never,
    { stopCapturing } as never,
    () => ({ snapForDrag, hideMatches }) as unknown as RefLineService,
  );
  selector.initialize();

  const evt = (x: number, y: number): unknown => ({
    world: { x, y, clone: () => ({ x, y }) },
    screen: { x, y },
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    raw: { x, y },
  });
  /** 模拟一次拖拽手势：down → 若 moveDeltas 非空逐个 move → up */
  const gesture = (
    downX: number,
    downY: number,
    moveDeltas: Array<[number, number]>,
    upDelta: [number, number],
  ) => {
    handlers.onPointerDown?.(evt(downX, downY));
    for (const [dx, dy] of moveDeltas) handlers.onPointerMove?.(evt(downX + dx, downY + dy));
    handlers.onPointerUp?.(evt(downX + upDelta[0], downY + upDelta[1]));
  };

  return {
    vm,
    selector,
    gesture,
    transact,
    stopCapturing,
    snapForDrag,
    hideMatches,
    handlers,
    evt,
  };
}

describe('selectorService 拖拽编排（指针流桩）', () => {
  it('吸附修正随落库：commitDrag 收到修正后的位移，而非指针原始差值', () => {
    // 吸附服务把期望位移 (+80, +30) 修正为 (+83, +28)——落库必须是后者
    const h = createHarness({ snapDx: 3, snapDy: -2 });
    h.gesture(
      125,
      125,
      [
        [10, 0],
        [40, 10],
        [80, 30],
      ],
      [80, 30],
    );
    expect(h.vm.commitDrag).toHaveBeenCalledTimes(1);
    const [init, dx, dy] = h.vm.commitDrag.mock.calls[0] as [
      { x: number; y: number },
      number,
      number,
    ];
    expect(init).toEqual({ x: 100, y: 100, width: 50, height: 50 });
    expect(dx).toBe(83);
    expect(dy).toBe(28);
  });

  it('视觉预览与落库使用同一吸附修正（视觉 = 数据）', () => {
    const h = createHarness({ snapDx: 3, snapDy: 0 });
    h.gesture(125, 125, [[60, 0]], [60, 0]);
    // 预览（move 阶段）与落库（up 阶段）的 dx 一致
    const preview = h.vm.applyDragPreview.mock.calls.at(-1) as unknown[];
    expect(preview![1]).toBe(63);
    expect(h.vm.commitDrag.mock.calls[0]![1]).toBe(63);
  });

  it('落库包在一个事务里 = 一次撤销', () => {
    const h = createHarness();
    h.gesture(125, 125, [[50, 20]], [50, 20]);
    expect(h.transact).toHaveBeenCalledTimes(1);
    expect(h.stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('低于阻尼阈值（10px）的位移不构成拖拽、不落库', () => {
    const h = createHarness();
    h.gesture(
      125,
      125,
      [
        [3, 2],
        [6, 4],
      ],
      [7, 5],
    );
    expect(h.vm.applyDragPreview).not.toHaveBeenCalled();
    expect(h.vm.commitDrag).not.toHaveBeenCalled();
    expect(h.transact).not.toHaveBeenCalled();
  });

  it('拖拽结束后隐藏参考线（无论是否移动）', () => {
    const h = createHarness();
    h.gesture(125, 125, [], [0, 0]);
    expect(h.hideMatches).toHaveBeenCalled();
  });

  it('手柄手势抑制单击激活：生命周期 = 手势（window up 单源清除，不随下一次 up 消费）', () => {
    const h = createHarness();
    const activate = vi.fn();
    h.selector.onActivate = activate;
    h.selector.setSelected(['w1']);

    // RectEditor 手柄 down 被 stopPropagation；手势期置位后，冒泡上来的 up
    // 不得按「单击已选中」激活编辑。
    h.selector.suppressClickActivation = true;
    h.handlers.onPointerUp?.(h.evt(125, 125));
    expect(activate).not.toHaveBeenCalled();

    // 手势未终止（rectEditor 的 window up 未到）：后续正常点击序列同样不激活
    h.handlers.onPointerDown?.(h.evt(125, 125));
    h.handlers.onPointerUp?.(h.evt(125, 125));
    expect(activate).not.toHaveBeenCalled();

    // 手势终止（onWindowUp 清标志）后：正常点击激活恢复
    h.selector.suppressClickActivation = false;
    h.handlers.onPointerDown?.(h.evt(125, 125));
    h.handlers.onPointerUp?.(h.evt(125, 125));
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('blur 中途不清抑制：手柄手势跨失焦存活，复窗松手不误进编辑', () => {
    const h = createHarness();
    const activate = vi.fn();
    h.selector.onActivate = activate;
    h.selector.setSelected(['w1']);

    // 手柄手势进行中切窗失焦 → viewport blur watchdog 对 mode handlers 发
    // cancel；rectEditor 的 window 级手势不受影响（复焦后 up 仍收尾）——
    // cancel 不得清抑制，否则复窗松手 up 被 final 分支当单击激活
    h.selector.suppressClickActivation = true;
    h.handlers.onPointerCancel?.(h.evt(-1e5, -1e5)); // cancel 不依赖坐标（dispatchCancel 同款哨兵位）
    h.handlers.onPointerUp?.(h.evt(125, 125));
    expect(activate).not.toHaveBeenCalled();
  });

  it('多指：手势期第二指在已选中件上 down+up（dragState 分支）不激活', () => {
    const h = createHarness();
    const activate = vi.fn();
    h.selector.onActivate = activate;
    h.selector.setSelected(['w1']);

    // 第一指拖着手柄缩放中（抑制置位）；第二指点已选中件建 dragState——
    // 未拖动即松手不得激活编辑（!moved && wasSelected 分支同受手势抑制）。
    // 本例锁 selector 侧门控；rectEditor 侧 pointerId 生命周期（异指 up 不
    // 终止手势/不偷监听）在 rectEditor.test.ts「手势指针生命周期」锁
    h.selector.suppressClickActivation = true;
    h.handlers.onPointerDown?.(h.evt(125, 125));
    h.handlers.onPointerUp?.(h.evt(125, 125));
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('undo 裂项守卫：onDragCommitted 夹在 transact 与 stopCapturing 之间（docs/05 §4.3）', () => {
  it('拖拽落库：钩子收到 (ids, 末帧吸附位移)，时序 = transact 后、stopCapturing 前', () => {
    const h = createHarness({ snapDx: 3 });
    const order: string[] = [];
    h.transact.mockImplementation((fn: () => void) => {
      order.push('transact');
      fn();
    });
    h.stopCapturing.mockImplementation(() => order.push('stopCapturing'));
    h.selector.onDragCommitted = vi.fn((ids: string[], dx: number, dy: number) => {
      order.push(`hook:${ids.join(',')}:${dx},${dy}`);
    });
    h.gesture(125, 125, [[60, 0]], [60, 0]);
    expect(h.selector.onDragCommitted).toHaveBeenCalledWith(['w1'], 63, 0);
    expect(order).toEqual(['transact', 'hook:w1:63,0', 'stopCapturing']);
  });

  it('未构成拖拽（低于阻尼阈值）：钩子与 stopCapturing 均不触发', () => {
    const h = createHarness();
    const hook = vi.fn();
    h.selector.onDragCommitted = hook;
    h.gesture(125, 125, [[3, 2]], [7, 5]);
    expect(hook).not.toHaveBeenCalled();
    expect(h.stopCapturing).not.toHaveBeenCalled();
  });
});

describe('选中元素被 undo 删除 → 选区清理（2026-09-22 用户实测：框残留原地）', () => {
  it('onModelRemoved$ 剔除已删 id 并隐藏选区框', async () => {
    const { SelectorService } = await import('../platform/selector/selectorService');
    const { BehaviorSubject, Subject } = await import('rxjs');
    const layerChildren: unknown[] = [];
    const shapeVm = {
      id: 's1',
      type: 'SHAPE',
      root: { zOrder: 'a0' },
      getBounds: () => ({ x: 0, y: 0, width: 50, height: 50 }),
      getLocalRect: () => ({ x: 0, y: 0, width: 50, height: 50 }),
      hitTestPoint: () => true,
      hitTestRect: () => true,
      onStateChanged$: new Subject(),
      onSelected$: new BehaviorSubject(false),
    };
    const onModelRemoved$ = new Subject<string[]>();
    const selector = new SelectorService(
      {
        optionLayer: { addChild: (c: unknown) => layerChildren.push(c) },
        vpScale$: { value: 1 },
        registerGlobalEventListener: () => {},
      } as never,
      {
        getAllVms: () => [shapeVm],
        getVmById: () => shapeVm,
        getVmByPoint: () => [shapeVm],
        getVmByRect: () => [shapeVm],
      } as never,
      {
        onModelCreated$: new Subject(),
        onModelRemoved$,
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
    selector.initialize();
    const frame = layerChildren[1] as { visible: boolean };
    selector.setSelected(['s1']);
    expect(frame.visible).toBe(true);
    // undo 删除（不经 removeSelected 的路径）——选区被剔除、框隐藏
    onModelRemoved$.next(['s1']);
    expect(selector.selected$.value).toEqual([]);
    expect(frame.visible).toBe(false); // 曾残留在原位置
  });
});
