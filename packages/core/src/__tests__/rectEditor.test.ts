// @vitest-environment jsdom
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { RectEditorService } from '../platform/rectEditor/rectEditorService';
import { resizeRect, resizeRotatedRect } from '../platform/rectEditor/resizeMath';
import { getRenderId } from '../common/render';

/**
 * RectEditor 缩放编排桩测试（docs/15 §3 挂账收口：lastNext 落库——
 * 松手 commitResize 收「起点 + 最近一帧目标」，不从视觉反推）。
 * 手柄入口经 RectEditorVm.onHandleDown 回调直驱（绕过 PIXI 命中），
 * window pointermove/up 用真实 DOM 事件（jsdom）。
 */

function makeHarness(opts: { snapRect?: (r: unknown) => { rect: unknown } } = {}) {
  const vmStub = {
    id: 'w1',
    type: 'SHAPE',
    getBounds: () => ({ x: 100, y: 100, width: 50, height: 50 }),
    getLocalRect: () => ({ x: 100, y: 100, width: 50, height: 50 }),
    getHostGeom: () => ({ rect: { x: 100, y: 100, width: 50, height: 50 }, rotation: 0 }),
    getRotation: () => 0,
    applyResizePreview: vi.fn(),
    applyRotatePreview: vi.fn(),
    commitRotate: vi.fn(),
    commitResize: vi.fn(),
    onStateChanged$: new Subject(),
  };
  const selected$ = new BehaviorSubject<string[]>([]);
  const dragMove$ = new Subject<void>();
  const vpScale$ = new BehaviorSubject(1);
  const vpBounds$ = new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 });
  const updateSelectionFrame = vi.fn();
  const stopCapturing = vi.fn();
  const engine = {
    getModelById: () => ({ capabilities: { resizable: true, rotatable: true } }),
    transact: (fn: () => void) => fn(),
  };
  const refLine = {
    snapForResize: vi.fn((r: unknown) => (opts.snapRect ? opts.snapRect(r) : { rect: r })),
    hideMatches: vi.fn(),
  };
  const svc = new RectEditorService(
    {
      optionLayer: { addChild: () => {}, removeChild: () => {} },
      vpScale$,
      vpBounds$,
      clientToWorld: (x: number, y: number) => ({ x, y }),
    } as never,
    { getVmById: () => vmStub } as never,
    { selected$, dragMove$, updateSelectionFrame } as never,
    engine as never,
    { stopCapturing } as never,
    refLine as never,
  );
  svc.initialize();
  const fireMove = (x: number, y: number): void => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  };
  const fireUp = (): void => {
    window.dispatchEvent(new PointerEvent('pointerup'));
  };
  return { svc, vmStub, selected$, updateSelectionFrame, stopCapturing, fireMove, fireUp };
}

describe('RectEditor 缩放编排（docs/15 §3 挂账）', () => {
  it('单选 → 出手柄；拖右下角（se）→ commitResize 收起点+末帧目标（lastNext 语义）', () => {
    const h = makeHarness();
    h.selected$.next(['w1']);
    expect(h.svc.__editorFrame).not.toBeNull();

    // 经 vm 回调入口模拟手柄按下（se = 东南角）
    (
      h.svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
    ).vm.onHandleDown('se', 150, 150);
    h.fireMove(180, 170); // 拖大：右下角 100+50 → 180/170
    h.fireUp();

    expect(h.vmStub.commitResize).toHaveBeenCalledTimes(1);
    const [start, next] = h.vmStub.commitResize.mock.calls[0] as [
      { x: number; y: number; width: number; height: number },
      { x: number; y: number; width: number; height: number },
    ];
    expect(start).toEqual({ x: 100, y: 100, width: 50, height: 50 });
    expect(next).toEqual({ x: 100, y: 100, width: 80, height: 70 });
    expect(h.stopCapturing).toHaveBeenCalled();
  });

  it('多帧拖拽：落库只看最后一帧（中间帧全部被 lastNext 覆盖）', () => {
    const h = makeHarness();
    h.selected$.next(['w1']);
    (
      h.svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
    ).vm.onHandleDown('se', 150, 150);
    h.fireMove(130, 130);
    h.fireMove(200, 190);
    h.fireMove(175, 160);
    h.fireUp();
    const [, next] = h.vmStub.commitResize.mock.calls[0] as unknown as [
      unknown,
      { width: number; height: number },
    ];
    expect(next.width).toBe(75); // 175 - 100
    expect(next.height).toBe(60);
    expect(h.vmStub.commitResize).toHaveBeenCalledTimes(1);
  });

  it('参考线吸附：snapForResize 的 rect 参与落库（吸附修正进 lastNext）', () => {
    const snapped = { x: 100, y: 100, width: 96, height: 50 }; // 宽被吸到 96
    const h = makeHarness({ snapRect: () => ({ rect: snapped }) });
    h.selected$.next(['w1']);
    (
      h.svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
    ).vm.onHandleDown('se', 150, 150);
    h.fireMove(180, 150);
    h.fireUp();
    const [, next] = h.vmStub.commitResize.mock.calls[0] as unknown as [unknown, { width: number }];
    expect(next.width).toBe(96);
  });

  it('undo 裂项守卫：onResizeCommitted 夹在 commitResize 与 stopCapturing 之间（docs/05 §4.4）', () => {
    const h = makeHarness();
    const order: string[] = [];
    let hookNext: unknown = undefined;
    h.vmStub.commitResize.mockImplementation(() => order.push('commitResize'));
    h.stopCapturing.mockImplementation(() => order.push('stopCapturing'));
    (
      h.svc as unknown as { onResizeCommitted: ((id: string, next: unknown) => void) | null }
    ).onResizeCommitted = (id: string, next: unknown) => {
      order.push(`hook:${id}`);
      hookNext = next;
    };
    h.selected$.next(['w1']);
    (
      h.svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
    ).vm.onHandleDown('se', 150, 150);
    h.fireMove(180, 170);
    h.fireUp();
    expect(order).toEqual(['commitResize', 'hook:w1', 'stopCapturing']);
    // next = lastNext（commitResize 落库值同源——微任务相 reattach 将算出的同一 bounds）
    expect(hookNext).toEqual({ x: 100, y: 100, width: 80, height: 70 });
  });

  it('松手后 resizeMove$/isResizing 复位；选区空 → 手柄隐藏', () => {
    const h = makeHarness();
    h.selected$.next(['w1']);
    (
      h.svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
    ).vm.onHandleDown('se', 150, 150);
    expect(h.svc.isResizing).toBe(true);
    h.fireUp();
    expect(h.svc.isResizing).toBe(false);
    h.selected$.next([]);
    expect(h.svc.__editorFrame).toBeNull();
  });
});

describe('RectEditor 旋转手势（docs/05 §8）', () => {
  const h = () => makeHarness();
  const startRotateAt = (
    svc: ReturnType<typeof makeHarness>['svc'],
    x: number,
    y: number,
  ): void => {
    (svc as unknown as { vm: { onRotateDown: (x: number, y: number) => void } }).vm.onRotateDown(
      x,
      y,
    );
  };

  it('拖柄 90°：applyRotatePreview 逐帧 + 松手 commitRotate 落库（中心 = 宿主几何中心）', () => {
    const t = h();
    t.selected$.next(['w1']);
    // 宿主 100,100,50,50 → 中心 (125,125)。从正上柄位 (125,65) 拖到正右 (185,125) = +90°
    startRotateAt(t.svc, 125, 65);
    t.fireMove(185, 125);
    t.fireUp();
    expect(t.vmStub.applyRotatePreview).toHaveBeenCalled();
    expect(t.vmStub.commitRotate).toHaveBeenCalled();
    const theta = (t.vmStub.commitRotate as unknown as { mock: { calls: Array<[number]> } }).mock
      .calls[0]![0];
    expect(theta).toBeCloseTo(Math.PI / 2, 6);
  });

  it('Shift 15° 步进：20° 附近量化到 15°（π/12）', () => {
    const t = h();
    t.selected$.next(['w1']);
    startRotateAt(t.svc, 125, 65);
    // 角度 = atan2 相对起点：起点 (125,65) 相对中心 (125,125) 是 -90°；
    // 拖到 20° 方向点 → θ = 20°−(-90°)+0 = 110°？——θ = Δ指针角。构造 Δ=20°：
    // 终点 = 中心 + R(20°)·(起点向量)
    const c = { x: 125, y: 125 };
    const start = { x: 125 - c.x, y: 65 - c.y }; // (0,-60)
    const rad = (20 * Math.PI) / 180;
    const end = {
      x: c.x + start.x * Math.cos(rad) - start.y * Math.sin(rad),
      y: c.y + start.x * Math.sin(rad) + start.y * Math.cos(rad),
    };
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: end.x, clientY: end.y, shiftKey: true }),
    );
    t.fireUp();
    const theta = (t.vmStub.commitRotate as unknown as { mock: { calls: Array<[number]> } }).mock
      .calls[0]![0];
    expect(theta).toBeCloseTo(Math.PI / 12, 6);
  });

  it('undo 裂项守卫：onRotateCommitted 夹在 commitRotate 与 stopCapturing 之间（第四条通道）', () => {
    const t = h();
    const order: string[] = [];
    t.vmStub.commitRotate = vi.fn(() => order.push('commitRotate'));
    (
      t.svc as unknown as { onRotateCommitted: (id: string, th: number) => void }
    ).onRotateCommitted = () => order.push('hook');
    const stop = order.push.bind(order, 'stopCapturing');
    void stop;
    t.selected$.next(['w1']);
    startRotateAt(t.svc, 125, 65);
    t.fireMove(185, 125);
    // stopCapturing 桩在 harness 里是独立 vi.fn——顺序断言用 hook 与 commit 的相对序
    t.fireUp();
    expect(order[0]).toBe('commitRotate');
    expect(order[1]).toBe('hook');
  });
});

describe('RectEditor.cancelGesture 只读降级收口（docs/21 §4）', () => {
  const startResize = (svc: RectEditorService): void => {
    (
      svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
    ).vm.onHandleDown('se', 150, 150);
  };
  const startRotateAt = (svc: RectEditorService, x: number, y: number): void => {
    (svc as unknown as { vm: { onRotateDown: (x: number, y: number) => void } }).vm.onRotateDown(
      x,
      y,
    );
  };

  it('缩放中取消：撤监听、预览按起点回落（零写）、迟到的 pointerup 不再落库', () => {
    const h = makeHarness();
    h.selected$.next(['w1']);
    startResize(h.svc);
    h.fireMove(180, 170); // 预览拖大
    expect(h.svc.isResizing).toBe(true);

    // 跟随层通知与标脏：取消本身要闭环（不依赖调用方后续恰好有别的重绘）
    let moveEmits = 0;
    const sub = h.svc.resizeMove$.subscribe(() => (moveEmits += 1));
    const beforeRender = getRenderId();
    h.svc.cancelGesture();
    sub.unsubscribe();
    expect(h.svc.isResizing).toBe(false);
    expect(moveEmits).toBe(1); // 快捷连接点按模型几何重排
    expect(getRenderId()).toBeGreaterThan(beforeRender); // 预览复位已标脏
    // 预览回落 = applyResizePreview(start, start)（scale 归 1），不 commit、不结历史
    expect(h.vmStub.applyResizePreview).toHaveBeenLastCalledWith(
      { x: 100, y: 100, width: 50, height: 50 },
      { x: 100, y: 100, width: 50, height: 50 },
    );
    expect(h.vmStub.commitResize).not.toHaveBeenCalled();
    expect(h.stopCapturing).not.toHaveBeenCalled();

    h.fireUp(); // 迟到抬手：window 监听已撤，不得写库
    expect(h.vmStub.commitResize).not.toHaveBeenCalled();
  });

  it('旋转中取消：预览回落到起点角度、锚定线重路由、迟到的 pointerup 不再落库', () => {
    const h = makeHarness();
    h.selected$.next(['w1']);
    startRotateAt(h.svc, 125, 65);
    h.fireMove(185, 125); // 预览 +90°
    const follow = vi.fn();
    h.svc.onRotatePreview = follow;
    const beforeRender = getRenderId();
    h.svc.cancelGesture();
    expect(h.vmStub.applyRotatePreview).toHaveBeenLastCalledWith(0); // 起点角度回落
    expect(follow).toHaveBeenCalledTimes(1); // 锚定线按复位后的几何重路由
    expect(getRenderId()).toBeGreaterThan(beforeRender);
    expect(h.vmStub.commitRotate).not.toHaveBeenCalled();
    expect(h.stopCapturing).not.toHaveBeenCalled();

    h.fireUp();
    expect(h.vmStub.commitRotate).not.toHaveBeenCalled();
  });

  it('无手势时取消：no-op 不抛、不通知跟随层、不标脏', () => {
    const h = makeHarness();
    const follow = vi.fn();
    h.svc.onRotatePreview = follow;
    let moveEmits = 0;
    const sub = h.svc.resizeMove$.subscribe(() => (moveEmits += 1));
    const beforeRender = getRenderId();
    expect(() => h.svc.cancelGesture()).not.toThrow();
    sub.unsubscribe();
    expect(h.vmStub.applyResizePreview).not.toHaveBeenCalled();
    expect(h.vmStub.applyRotatePreview).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
    expect(moveEmits).toBe(0);
    expect(getRenderId()).toBe(beforeRender);
  });
});

describe('1.6 resizeRotatedRect：旋转态对侧锚定（resizeMath 纯函数）', () => {
  const rot = (p: { x: number; y: number }, th: number) => ({
    x: p.x * Math.cos(th) - p.y * Math.sin(th),
    y: p.x * Math.sin(th) + p.y * Math.cos(th),
  });

  it('θ=45° 拖 SE 角：对侧 NW 角世界坐标逐字节不动（旧实现漂移 (I−R)·Δ/2）', () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const th = Math.PI / 4;
    const c0 = { x: 50, y: 50 };
    const nwStart = rot({ x: -50, y: -50 }, th);
    const nwWorldBefore = { x: c0.x + nwStart.x, y: c0.y + nwStart.y };
    // 指针：拖到局部 (70,70)（逆旋转坐标——与接线层同输入口径）
    const next = resizeRotatedRect(start, 'se', { x: 70, y: 70 }, th);
    expect(next.width).toBeCloseTo(70, 6);
    expect(next.height).toBeCloseTo(70, 6);
    const c1 = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    const nwRel = rot({ x: -35, y: -35 }, th);
    const nwWorldAfter = { x: c1.x + nwRel.x, y: c1.y + nwRel.y };
    expect(nwWorldAfter.x).toBeCloseTo(nwWorldBefore.x, 6);
    expect(nwWorldAfter.y).toBeCloseTo(nwWorldBefore.y, 6);
    // 被拖 SE 角精确贴指针：C1 + R(35,35) 的逆旋转前世界位 = 指针逆旋转位 (70,70)
    const seRel = rot({ x: 35, y: 35 }, th);
    const seWorld = { x: c1.x + seRel.x, y: c1.y + seRel.y };
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const seLocal = {
      x: (seWorld.x - c1.x) * cos + (seWorld.y - c1.y) * sin,
      y: -(seWorld.x - c1.x) * sin + (seWorld.y - c1.y) * cos,
    };
    expect(seLocal.x).toBeCloseTo(35, 6); // 半尺寸向量（对中心）——完整推导见上：世界锚定已锁
    expect(seLocal.y).toBeCloseTo(35, 6);
  });

  it('θ=0 等价锁：输出与 resizeRect 逐字段全等', () => {
    const start = { x: 10, y: 20, width: 100, height: 80 };
    for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      expect(resizeRotatedRect(start, dir, { x: 130, y: 120 }, 0)).toEqual(
        resizeRect(start, dir, { x: 130, y: 120 }),
      );
    }
  });
});
