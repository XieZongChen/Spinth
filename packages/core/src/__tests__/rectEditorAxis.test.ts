// @vitest-environment jsdom
/** RectEditor 纵轴缩放编排（specs/sequence-diagram §3.5，批次 3）：声明了
 *  `resizeAxis() === 'v'` 的件（激活条）缩放时吸附 / 量化只取手柄方向的纵向分量——
 *  se → s、e → 空。条的东西沿距生命线中心参考线恰一个线端留隙，横向参与吸附会
 *  常亮一条吸不上的参考线。桩与 rectEditorRatio.test 同款。 */
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IRect } from '../common/geometry';
import { RectEditorService } from '../platform/rectEditor/rectEditorService';
import { constrainActivationResize } from '../widgets/sequence/sequenceOps';

const BAR: IRect = { x: 295, y: 300, width: 10, height: 80 };

function makeHarness(opts: { vertical?: boolean; snapWidth?: number; snapHeight?: number } = {}) {
  const vmStub = {
    id: 'a1',
    type: 'ACTIVATION',
    getLocalRect: () => BAR,
    getHostGeom: () => ({ rect: BAR, rotation: 0 }),
    getRotation: () => 0,
    applyResizePreview: vi.fn(),
    commitResize: vi.fn(),
    onStateChanged$: new Subject(),
    constrainResize: constrainActivationResize,
    ...(opts.vertical ? { resizeAxis: () => 'v' as const } : {}),
  };
  const engine = {
    getModelById: () => ({ capabilities: { resizable: true, rotatable: false, keepRatio: false } }),
  };
  // 参考线桩按方向套用吸附值：方向含 e/w 才可能吸宽，含 n/s 才可能吸高
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
      selected$: new BehaviorSubject<string[]>(['a1']),
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
    move: (x: number, y: number): void => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 1 }));
    },
    up: (): void => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    },
  };
}

type Harness = ReturnType<typeof makeHarness>;

function committed(h: Harness): IRect {
  expect(h.vmStub.commitResize).toHaveBeenCalledTimes(1);
  return h.vmStub.commitResize.mock.calls[0]![1] as IRect;
}

describe('RectEditor 纵轴缩放（resizeAxis 探针，specs/sequence-diagram §3.5）', () => {
  it('se 手柄：吸附只拿纵向分量（方向 s）——横向吸附值不参与，高度照常吸', () => {
    const h = makeHarness({ vertical: true, snapWidth: 60, snapHeight: 150 });
    h.handleDown('se', BAR.x + BAR.width, BAR.y + BAR.height); // 右下角
    h.move(345, 420); // 自由 60×120
    h.up();
    expect(h.refLine.snapForResize).toHaveBeenCalledTimes(1);
    expect(h.refLine.snapForResize.mock.calls[0]![1]).toBe('s');
    expect(committed(h)).toEqual({ x: 295, y: 300, width: 10, height: 150 });
  });

  it('e 手柄：方向投影为空 = 不吸附；落库零变化（宽恒定）', () => {
    const h = makeHarness({ vertical: true, snapWidth: 60 });
    h.handleDown('e', BAR.x + BAR.width, BAR.y + BAR.height / 2);
    h.move(345, 340);
    h.up();
    expect(h.refLine.snapForResize.mock.calls[0]![1]).toBe('');
    expect(committed(h)).toEqual(BAR);
  });

  it('未声明探针的件：角柄方向原样交给参考线（既有行为不变）', () => {
    const h = makeHarness({ snapWidth: 60 });
    h.handleDown('se', BAR.x + BAR.width, BAR.y + BAR.height);
    h.move(345, 420);
    h.up();
    expect(h.refLine.snapForResize.mock.calls[0]![1]).toBe('se');
  });
});
