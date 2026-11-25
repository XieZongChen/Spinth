// @vitest-environment jsdom
/** RectEditor 比例锁编排（图片手柄缩放按住 Shift，docs/05 §4.4）：能力位 keepRatio
 *  的控件按住 Shift 拖手柄时按起点宽高比落库；每帧只看当前修饰键（无跨帧状态）。
 *  桩与 rectEditor.test.ts 同款（手柄入口经 onHandleDown 回调直驱，window
 *  pointermove/up 用真实 DOM 事件） */
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IRect } from '../common/geometry';
import { RectEditorService } from '../platform/rectEditor/rectEditorService';
import { rotatePointAround } from '../platform/rectEditor/rotateMath';

const RECT: IRect = { x: 100, y: 100, width: 200, height: 100 }; // 2:1

function makeHarness(
  opts: {
    keepRatio?: boolean;
    rotation?: number;
    rect?: IRect;
    snapWidth?: number;
    snapHeight?: number;
  } = {},
) {
  const rect = opts.rect ?? RECT;
  const rotation = opts.rotation ?? 0;
  const vmStub = {
    id: 'w1',
    type: 'IMAGE',
    getLocalRect: () => rect,
    getHostGeom: () => ({ rect, rotation }),
    getRotation: () => rotation,
    applyResizePreview: vi.fn(),
    commitResize: vi.fn(),
    onStateChanged$: new Subject(),
  };
  const engine = {
    getModelById: () => ({
      capabilities: { resizable: true, rotatable: true, keepRatio: opts.keepRatio ?? false },
    }),
  };
  // 参考线桩按方向套用吸附值：方向含 e/w 才可能吸宽，含 n/s 才可能吸高
  // （与真实 snapResize「只有被拖动的边参与」同口径）
  const refLine = {
    snapForResize: vi.fn((r: IRect, d: string) => ({
      rect: {
        ...r,
        width: d.includes('e') || d.includes('w') ? (opts.snapWidth ?? r.width) : r.width,
        height: d.includes('n') || d.includes('s') ? (opts.snapHeight ?? r.height) : r.height,
      },
    })),
    hideMatches: vi.fn(),
  };
  const svc = new RectEditorService(
    {
      optionLayer: { addChild: () => {}, removeChild: () => {} },
      vpScale$: new BehaviorSubject(1),
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
      clientToWorld: (x: number, y: number) => ({ x, y }),
    } as never,
    { getVmById: () => vmStub } as never,
    {
      selected$: new BehaviorSubject<string[]>(['w1']),
      dragMove$: new Subject<void>(),
      updateSelectionFrame: vi.fn(),
    } as never,
    engine as never,
    { stopCapturing: vi.fn() } as never,
    refLine as never,
  );
  svc.initialize();
  return {
    vmStub,
    refLine,
    handleDown: (dir: string, x: number, y: number): void => {
      (
        svc as unknown as { vm: { onHandleDown: (d: string, x: number, y: number) => void } }
      ).vm.onHandleDown(dir, x, y);
    },
    move: (x: number, y: number, opts2: { shift?: boolean } = {}): void => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: x,
          clientY: y,
          buttons: 1,
          shiftKey: !!opts2.shift,
        }),
      );
    },
    up: (): void => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    },
  };
}

type Harness = ReturnType<typeof makeHarness>;

function committed(h: Harness): [IRect, IRect] {
  expect(h.vmStub.commitResize).toHaveBeenCalledTimes(1);
  return h.vmStub.commitResize.mock.calls[0] as [IRect, IRect];
}

/** se 手柄按下（右下角），返回手势句柄 */
function grabSe(h: Harness, rect = RECT): void {
  h.handleDown('se', rect.x + rect.width, rect.y + rect.height);
}

describe('RectEditor 比例锁（能力位 keepRatio + Shift，docs/05 §4.4）', () => {
  it('keepRatio 控件按住 Shift 拖 se：落库保持起点宽高比，对侧角不动', () => {
    const h = makeHarness({ keepRatio: true });
    grabSe(h);
    h.move(360, 260, { shift: true });
    h.up();
    const [start, next] = committed(h);
    expect(start).toEqual(RECT);
    // 自由缩放 260×160（宽 +30%、高 +60%）→ 高为主轴 → 宽 320
    expect(next).toEqual({ x: 100, y: 100, width: 320, height: 160 });
  });

  it('比例取自手势起点矩形（已拉歪的图按当前比例锁，不纠正）', () => {
    const square: IRect = { x: 100, y: 100, width: 120, height: 120 };
    const h = makeHarness({ keepRatio: true, rect: square });
    grabSe(h, square);
    h.move(300, 260, { shift: true });
    h.up();
    // 自由缩放 200×160 → 宽为主轴 → 高 200
    expect(committed(h)[1]).toEqual({ x: 100, y: 100, width: 200, height: 200 });
  });

  it('参考线吸附只作用于主轴：吸附后的宽度仍按比例派生高度', () => {
    // 自由 300×140（宽 +50%、高 +40%）→ 宽为主轴；宽被参考线吸到 296 → 高 148。
    // 交给吸附的是单轴方向 'e'（不是角柄 'se'）
    const h = makeHarness({ keepRatio: true, snapWidth: 296 });
    grabSe(h);
    h.move(400, 240, { shift: true });
    h.up();
    expect(committed(h)[1]).toEqual({ x: 100, y: 100, width: 296, height: 148 });
    expect(h.refLine.snapForResize).toHaveBeenCalledTimes(1);
    expect(h.refLine.snapForResize.mock.calls[0]![1]).toBe('e');
    expect(h.refLine.snapForResize.mock.calls[0]![0]).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 100, // 非主轴保持起点尺寸
    });
  });

  it('非主轴不吸附：高为主轴时宽度方向的吸附值不参与，宽按比例派生', () => {
    // 自由 260×160（宽 +30%、高 +60%）→ 高为主轴；高被吸到 150 → 宽 300
    const h = makeHarness({ keepRatio: true, snapWidth: 296, snapHeight: 150 });
    grabSe(h);
    h.move(360, 260, { shift: true });
    h.up();
    expect(committed(h)[1]).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(h.refLine.snapForResize.mock.calls[0]![1]).toBe('s');
  });

  it('不按 Shift：自由缩放（现状不变）', () => {
    const h = makeHarness({ keepRatio: true, snapWidth: 296, snapHeight: 150 });
    grabSe(h);
    h.move(400, 240);
    h.up();
    // 两轴各自照常吸附（角柄方向 'se' 整体交给参考线）
    expect(committed(h)[1]).toEqual({ x: 100, y: 100, width: 296, height: 150 });
    expect(h.refLine.snapForResize.mock.calls[0]![1]).toBe('se');
  });

  it('非 keepRatio 控件按住 Shift：同样自由缩放（能力位门控，无类型分支）', () => {
    const h = makeHarness({ keepRatio: false });
    grabSe(h);
    h.move(360, 260, { shift: true });
    h.up();
    expect(committed(h)[1]).toEqual({ x: 100, y: 100, width: 260, height: 160 });
  });

  it('每帧只看当前修饰键：中途按下 / 松开 Shift 即时切换，落库取最后一帧', () => {
    const h = makeHarness({ keepRatio: true });
    grabSe(h);
    h.move(360, 260); // 自由
    h.move(360, 260, { shift: true }); // 锁
    h.move(360, 260); // 松开 Shift → 回到自由
    h.up();
    const previews = h.vmStub.applyResizePreview.mock.calls.map((c) => c[1] as IRect);
    expect(previews).toEqual([
      { x: 100, y: 100, width: 260, height: 160 },
      { x: 100, y: 100, width: 320, height: 160 },
      { x: 100, y: 100, width: 260, height: 160 },
    ]);
    expect(committed(h)[1]).toEqual({ x: 100, y: 100, width: 260, height: 160 });
  });

  it('旋转态同样生效：比例保持', () => {
    const theta = Math.PI / 4;
    const h = makeHarness({ keepRatio: true, rotation: theta });
    grabSe(h);
    // 指针落在「局部系 (360,260)」对应的世界位（服务会绕起点中心逆旋转回去）
    const center = { x: RECT.x + RECT.width / 2, y: RECT.y + RECT.height / 2 };
    const raw = rotatePointAround({ x: 360, y: 260 }, center, theta);
    h.move(raw.x, raw.y, { shift: true });
    h.up();
    const next = committed(h)[1];
    expect(next.width).toBeCloseTo(320, 6);
    expect(next.height).toBeCloseTo(160, 6);
  });
});
