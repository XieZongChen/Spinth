import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SelectorService } from '../platform/selector/selectorService';
import { createDragState } from '../platform/selector/selectorDragOps';
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

describe('createDragState 纯线选区不建会话（2026-11 三轮审查下沉）', () => {
  type VmLike = { type: string; getLocalRect?: () => unknown; getBounds?: () => unknown };
  const mkCtx = (vms: Record<string, VmLike>) =>
    ({ vmEngine: { getVmById: (id: string) => vms[id] ?? null } }) as never;
  const EVT = {
    world: { x: 0, y: 0, clone: () => ({ x: 0, y: 0 }) },
    screen: { x: 0, y: 0 },
  } as never;

  it('纯线选区（单线/多线）→ null：空操作会话只带来 ActionBar 停隐副作用', () => {
    expect(createDragState(mkCtx({ l1: { type: 'LINE' } }), ['l1'], EVT, true)).toBeNull();
    expect(
      createDragState(
        mkCtx({ l1: { type: 'LINE' }, l2: { type: 'LINE' } }),
        ['l1', 'l2'],
        EVT,
        true,
      ),
    ).toBeNull();
  });

  it('含形状的混合选区照常建会话（形状移动带动线跟随）', () => {
    const rect = () => ({ x: 0, y: 0, width: 10, height: 10 });
    const ctx = mkCtx({
      s1: { type: 'SHAPE', getLocalRect: rect, getBounds: rect },
      l1: { type: 'LINE', getLocalRect: rect, getBounds: rect },
    });
    expect(createDragState(ctx, ['s1', 'l1'], EVT, true)).not.toBeNull();
  });
});

describe('容器拖拽带子（specs/container-frame §4.4）', () => {
  function createFrameHarness() {
    const mk = (id: string, type: string, x: number, y: number, w = 50, h = 50) => ({
      id,
      type,
      rect: { x, y, width: w, height: h },
      getBounds() {
        return { ...this.rect };
      },
      getLocalRect() {
        return { ...this.rect };
      },
      applyDragPreview: vi.fn(),
      commitDrag: vi.fn(),
      onSelected$: new BehaviorSubject(false),
      onStateChanged$: new Subject(),
    });
    const frameVm = mk('f1', 'FRAME', 0, 0, 300, 200);
    const childVm = mk('c1', 'SHAPE', 10, 40);
    const otherVm = mk('z1', 'SHAPE', 500, 500);
    const vms = [frameVm, childVm, otherVm];

    const framesLookup = {
      isFrame: (id: string) => id === 'f1',
      childIds: (fid: string) => (fid === 'f1' ? ['c1'] : []),
      expandForCascade: (ids: string[]) => {
        const out: string[] = [];
        for (const id of ids) {
          out.push(id);
          if (id === 'f1') out.push('c1');
        }
        return out;
      },
      reconcileParents: vi.fn(),
      adoptByLanding: () => {},
      createMarqueeFrameFilter: () => null,
      computeLayerClamps: () => [],
    };

    let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
    const transact = vi.fn((fn: () => void) => fn());
    const removeByIds = vi.fn();
    const reconcileCalls: Array<{ ids: string[]; rectOf: (id: string) => unknown; when: string }> =
      [];

    const selector = new SelectorService(
      {
        optionLayer: { addChild: () => {} },
        vpScale$: { value: 1 },
        registerGlobalEventListener: (_mode: string, h: Record<string, (e: unknown) => void>) => {
          handlers = h;
        },
      } as never,
      {
        getAllVms: () => vms,
        getVmById: (id: string) => vms.find((v) => v.id === id),
        getVmByPoint: (world: { x: number; y: number }) =>
          // 标题带命中容器（y < 28 内）；否则命中 child；再否则 other
          world.y < 28 && world.x < 300 ? [frameVm] : world.x < 300 ? [childVm] : [otherVm],
        getVmByRect: () => vms,
      } as never,
      {
        onModelCreated$: new Subject(),
        onModelRemoved$: new Subject(),
        transact,
        removeByIds,
        getModelById: (id: string) => ({
          toJSON: () =>
            id === 'f1'
              ? { id, type: 'FRAME', x: 0, y: 0, width: 300, height: 200 }
              : id === 'c1'
                ? { id, type: 'SHAPE', x: 10, y: 40, width: 50, height: 50, parentId: 'f1' }
                : { id, type: 'SHAPE', x: 500, y: 500, width: 50, height: 50 },
        }),
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
      () => null,
      null,
      () => framesLookup,
    );
    selector.initialize();
    // dragCtx 的 reconcileParents 闭包转发到 framesLookup（构造后注入探针顺序）
    (framesLookup.reconcileParents as ReturnType<typeof vi.fn>).mockImplementation(
      (ids: string[], rectOf: (id: string) => unknown) => {
        reconcileCalls.push({ ids, rectOf, when: transact.mock.calls.length > 0 ? 'in' : 'out' });
      },
    );

    const evt = (x: number, y: number): unknown => ({
      world: { x, y, clone: () => ({ x, y }) },
      screen: { x, y },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x, y },
    });
    return {
      vms,
      frameVm,
      childVm,
      otherVm,
      framesLookup,
      selector,
      transact,
      removeByIds,
      reconcileCalls,
      evt,
      handlers: () => handlers,
    };
  }

  it('拖容器：会话展开带子（预览/落库都作用于子）、selectedIds 保持展开前', () => {
    const h = createFrameHarness();
    h.selector.setSelected(['f1']);
    // 点标题带 (150, 10) → down/move(+80,+40)/up
    h.handlers().onPointerDown?.(h.evt(150, 10));
    h.handlers().onPointerMove?.(h.evt(230, 50));
    h.handlers().onPointerUp?.(h.evt(230, 50));
    // 预览与落库都作用于展开集（容器+子）
    expect(h.frameVm.applyDragPreview).toHaveBeenCalled();
    expect(h.childVm.applyDragPreview).toHaveBeenCalled();
    expect(h.frameVm.commitDrag).toHaveBeenCalledTimes(1);
    expect(h.childVm.commitDrag).toHaveBeenCalledTimes(1);
    expect(h.otherVm.commitDrag).not.toHaveBeenCalled();
    // 归属判定只对展开前选区
    expect(h.reconcileCalls).toHaveLength(1);
    expect(h.reconcileCalls[0]!.ids).toEqual(['f1']);
  });

  it('归属回写在事务内（I6）且 rectOf 是算术（init + 末帧位移）', () => {
    const h = createFrameHarness();
    h.selector.setSelected(['c1']);
    h.handlers().onPointerDown?.(h.evt(30, 60));
    h.handlers().onPointerMove?.(h.evt(110, 100)); // (+80, +40)
    h.handlers().onPointerUp?.(h.evt(110, 100));
    const call = h.reconcileCalls[0]!;
    expect(call.when).toBe('in'); // transact 内（transact 已被调用且未返回——桩内同步判定）
    // c1 被拖动：rectOf = 初值 + 位移（10+80, 40+40）
    expect(call.rectOf('c1')).toEqual({ x: 90, y: 80, width: 50, height: 50 });
    // 父容器未被拖动：rectOf 走 model 权威值
    expect(call.rectOf('f1')).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });

  it('removeSelected 级联：删除集 = 展开后全集（容器连子删）', () => {
    const h = createFrameHarness();
    h.selector.setSelected(['f1']);
    h.selector.removeSelected();
    expect(h.removeByIds).toHaveBeenCalledWith(['f1', 'c1']);
    expect(h.selector.selected$.value).toEqual([]);
  });

  it('取消（pointercancel）：展开集全部预览复位', () => {
    const h = createFrameHarness();
    h.selector.setSelected(['f1']);
    h.handlers().onPointerDown?.(h.evt(150, 10));
    h.handlers().onPointerMove?.(h.evt(230, 50));
    h.handlers().onPointerCancel?.(h.evt(230, 50));
    // 复位调用：末次 applyDragPreview 是 (init, 0, 0)
    const frameReset = h.frameVm.applyDragPreview.mock.calls.at(-1) as unknown[];
    const childReset = h.childVm.applyDragPreview.mock.calls.at(-1) as unknown[];
    expect(frameReset![1]).toBe(0);
    expect(frameReset![2]).toBe(0);
    expect(childReset![1]).toBe(0);
    expect(childReset![2]).toBe(0);
    expect(h.frameVm.commitDrag).not.toHaveBeenCalled();
  });

  it('无容器语义（getFrames null）：老行为零漂移——不展开、不判父', () => {
    const frameVm = {
      id: 'f1',
      type: 'FRAME',
      rect: { x: 0, y: 0, width: 300, height: 200 },
      getBounds() {
        return { ...this.rect };
      },
      getLocalRect() {
        return { ...this.rect };
      },
      applyDragPreview: vi.fn(),
      commitDrag: vi.fn(),
      onSelected$: new BehaviorSubject(false),
      onStateChanged$: new Subject(),
    };
    let handlers: Record<string, ((e: unknown) => void) | undefined> = {};
    const selector = new SelectorService(
      {
        optionLayer: { addChild: () => {} },
        vpScale$: { value: 1 },
        registerGlobalEventListener: (_m: string, h: Record<string, (e: unknown) => void>) => {
          handlers = h;
        },
      } as never,
      {
        getAllVms: () => [frameVm],
        getVmById: () => frameVm,
        getVmByPoint: () => [frameVm],
        getVmByRect: () => [frameVm],
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
        }) as never,
    );
    selector.initialize();
    selector.setSelected(['f1']);
    handlers.onPointerDown?.({
      world: { x: 150, y: 10, clone: () => ({ x: 150, y: 10 }) },
      screen: { x: 150, y: 10 },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x: 0, y: 0 },
    });
    handlers.onPointerMove?.({
      world: { x: 230, y: 50, clone: () => ({ x: 230, y: 50 }) },
      screen: { x: 230, y: 50 },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x: 0, y: 0 },
    });
    handlers.onPointerUp?.({
      world: { x: 230, y: 50, clone: () => ({ x: 230, y: 50 }) },
      screen: { x: 230, y: 50 },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x: 0, y: 0 },
    });
    expect(frameVm.commitDrag).toHaveBeenCalledTimes(1); // 只有容器自身
  });
});

interface LineStub {
  id: string;
  type: 'LINE';
  getBounds: () => { x: number; y: number; width: number; height: number };
  getLocalRect: () => { x: number; y: number; width: number; height: number };
  applyDragPreview: ReturnType<typeof vi.fn>;
  commitDrag: ReturnType<typeof vi.fn>;
  onSelected$: BehaviorSubject<boolean>;
  onStateChanged$: Subject<unknown>;
}

/** 线桩：bbox = (x0, y0)–(x1, y1)；axisMessage = 实现轴消息探针 */
function lineStub(id: string, x0: number, x1: number, axisMessage: boolean): LineStub {
  const rect = { x: x0, y: 374, width: x1 - x0, height: 8 };
  return {
    id,
    type: 'LINE',
    getBounds: () => ({ ...rect }),
    getLocalRect: () => ({ ...rect }),
    applyDragPreview: vi.fn(),
    commitDrag: vi.fn(),
    onSelected$: new BehaviorSubject(false),
    onStateChanged$: new Subject(),
    ...(axisMessage ? { isAxisMessage: () => true } : {}),
  };
}

describe('线选区拖拽（轴消息平移，specs/sequence-diagram §4.5）', () => {
  function createLineHarness(vms: LineStub[]) {
    let pressed = vms[0]!;
    const handlers: Record<string, ((e: unknown) => void) | undefined> = {};
    const transact = vi.fn((fn: () => void) => fn());
    const stopCapturing = vi.fn();
    const onDragCommitted = vi.fn();
    const snapForDrag = vi.fn((_rect: unknown, dx: number, dy: number) => ({
      dx,
      dy,
      matchedV: [],
      matchedH: [],
    }));
    const selector = new SelectorService(
      {
        optionLayer: { addChild: () => {} },
        vpScale$: { value: 1 },
        registerGlobalEventListener: (_mode: string, h: Record<string, (e: unknown) => void>) => {
          Object.assign(handlers, h);
        },
      } as never,
      {
        getAllVms: () => vms,
        getVmById: (id: string) => vms.find((v) => v.id === id),
        getVmByPoint: () => [pressed],
        getVmByRect: () => vms,
      } as never,
      {
        onModelCreated$: new Subject(),
        onModelRemoved$: new Subject(),
        transact,
        removeByIds: vi.fn(),
      } as never,
      { stopCapturing } as never,
      () => ({ snapForDrag, hideMatches: vi.fn() }) as unknown as RefLineService,
    );
    selector.onDragCommitted = onDragCommitted as never;
    selector.initialize();
    const evt = (x: number, y: number): unknown => ({
      world: { x, y, clone: () => ({ x, y }) },
      screen: { x, y },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x, y },
    });
    /** 选中 ids 后在 topId 上按下并拖动（down → move → up） */
    const drag = (ids: string[], topId: string, dx: number, dy: number): void => {
      pressed = vms.find((v) => v.id === topId)!;
      selector.setSelected(ids);
      handlers.onPointerDown?.(evt(300, 378));
      handlers.onPointerMove?.(evt(300 + dx, 378 + dy));
      handlers.onPointerUp?.(evt(300 + dx, 378 + dy));
    };
    return { selector, drag, transact, stopCapturing, snapForDrag, onDragCommitted };
  }

  it('线选区只有轴消息：建会话且恒为纵向——预览与落库只动 y（dx = 0），吸附带轴向实参', () => {
    const m1 = lineStub('m1', 255, 645, true);
    const h = createLineHarness([m1]);
    h.drag(['m1'], 'm1', 40, 60);
    const init = { x: 255, y: 374, width: 390, height: 8 };
    expect(m1.applyDragPreview).toHaveBeenLastCalledWith(init, 0, 60);
    expect(m1.commitDrag).toHaveBeenCalledTimes(1);
    expect(m1.commitDrag).toHaveBeenCalledWith(init, 0, 60);
    expect(h.snapForDrag).toHaveBeenCalledWith(init, 0, 60, 'v');
    expect(h.onDragCommitted).toHaveBeenCalledWith(['m1'], 0, 60);
    expect(h.transact).toHaveBeenCalledTimes(1);
    expect(h.stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('混有普通线：建会话，位移只走纵向；普通线不获得任何横向位移', () => {
    const m1 = lineStub('m1', 255, 645, true);
    const n1 = lineStub('n1', 100, 500, false);
    const h = createLineHarness([m1, n1]);
    h.drag(['m1', 'n1'], 'm1', 40, 60);
    // 只有轴消息响应平移（LineVm 的普通线覆写仍是空操作——交互几何单测锁定）
    expect(m1.applyDragPreview).toHaveBeenLastCalledWith(expect.anything(), 0, 60);
    // 会话对普通线给出的位移同样没有横向分量
    const [initN, dxN] = n1.applyDragPreview.mock.calls.at(-1) as [unknown, number, number];
    expect(dxN).toBe(0);
    expect(initN).toEqual({ x: 100, y: 374, width: 400, height: 8 });
    expect(m1.commitDrag).toHaveBeenCalledWith(expect.anything(), 0, 60);
  });

  it('纯普通线选区：不建会话（现状不变）', () => {
    const n1 = lineStub('n1', 100, 500, false);
    const h = createLineHarness([n1]);
    h.drag(['n1'], 'n1', 40, 60);
    expect(n1.applyDragPreview).not.toHaveBeenCalled();
    expect(n1.commitDrag).not.toHaveBeenCalled();
    expect(h.transact).not.toHaveBeenCalled();
    expect(h.snapForDrag).not.toHaveBeenCalled();
  });

  it('纵向会话的网格量化只作用 y（x 不被拉到格点）', () => {
    const m1 = lineStub('m1', 255, 645, true);
    const h = createLineHarness([m1]);
    h.selector.gridSnapOn = () => true;
    h.drag(['m1'], 'm1', 0, 61);
    // x = 255 距格点 256 只差 1：横向若量化会得到 dx = 1；纵向 374 + 61 = 435 → 432
    const [, dx, dy] = m1.applyDragPreview.mock.calls.at(-1) as [unknown, number, number];
    expect(dx).toBe(0);
    expect(dy).toBe(58);
  });
});
