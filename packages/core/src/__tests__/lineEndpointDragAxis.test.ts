// @vitest-environment jsdom
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { LineEndpointDrag } from '../widgets/line/lineEndpointDrag';
import { axisAnchorWithInset } from '../widgets/line/lineAxisAnchor';
import type { IHostGeom, IRect } from '../common/geometry';
import type { JoinDir } from '../widgets/line/lineMathTypes';

/**
 * 端点重锚定到轴宿主（specs/sequence-diagram §4.2，批次 2）：落点走 resolveAnchorPick
 * ——按指针在轴的哪一侧选边、端口 = 轴上比例（4 位小数）。普通形状仍是 nearestJoin +
 * 指针在最近边上的投影（两位小数），逐字节不变。
 * 夹具：生命线 (200,100,120,520)，轴 x = 260、轴段 y 136…620；普通形状 (440,316,120,80)。
 */

const LIFE: IRect = { x: 200, y: 100, width: 120, height: 520 };
const AXIS = { x: 260, top: 136, bottom: 620 };
const SHAPE: IRect = { x: 440, y: 316, width: 120, height: 80 };

function makeDrag(target: 'axis' | 'shape') {
  const geom: IHostGeom = { rect: target === 'axis' ? LIFE : SHAPE, rotation: 0 };
  const updates: Array<Record<string, unknown>> = [];
  const state = {
    id: 'L1',
    type: 'LINE',
    lineType: 'STRAIGHT',
    startNodeId: 'S',
    startJoin: 'right',
    endNodeId: null,
    endJoin: null,
    pinned: false,
    points: [
      [300, 360],
      [500, 360],
    ] as Array<[number, number]>,
  };
  const line = {
    id: 'L1',
    type: 'LINE',
    state,
    previewRoute: () => {},
    getHostGeom: () => ({ rect: { x: 300, y: 360, width: 200, height: 0 }, rotation: 0 }),
  };
  const hostVm =
    target === 'axis'
      ? {
          getHostGeom: () => geom,
          getAxisAnchor: () => AXIS,
          getAnchorPoint: (join: JoinDir, t: number) => axisAnchorWithInset(AXIS, join, t, 0),
        }
      : { getHostGeom: () => geom };
  const drag = new LineEndpointDrag(
    {
      clientToWorld: (x: number, y: number) => ({ x, y }),
      vpScale$: new BehaviorSubject(1),
    } as never,
    {
      getModelById: () => ({
        toJSON: () => state,
        update: (p: Record<string, unknown>) => updates.push(p),
      }),
    } as never,
    {
      getAllVms: () => [line],
      getVmsInRect: () => [],
      getVmById: (id: string) => (id === 'L1' ? line : hostVm),
    } as never,
    { stopCapturing: () => {} } as never,
    {
      showDrawFeedback: () => {},
      hideDrawFeedback: () => {},
      refreshHandles: () => {},
      showEndpointHandles: () => {},
      hideEndpointHandles: () => {},
      hideHandles: () => {},
      hideAll: () => {},
    } as never,
    { hitTest: () => ({ id: 'A', geom }), gridSnapOn: () => false, onSettled: () => {} },
  );
  return { drag, updates };
}

const fire = (type: string, x: number, y: number): void => {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
};

describe('端点重锚定的落点策略（§4.2）', () => {
  it('轴宿主：按指针在轴的哪一侧选边、端口 = 轴上比例（4 位小数）', () => {
    const { drag, updates } = makeDrag('axis');
    drag.begin('L1', 'end');
    fire('pointermove', 262, 300); // 轴右侧 2px
    fire('pointerup', 262, 300);
    expect(updates[0]).toMatchObject({ endNodeId: 'A', endJoin: 'right', endPort: 0.3388 });
  });

  it('轴宿主：左侧选 left；拖到轴段端点之外钳到端点', () => {
    const { drag, updates } = makeDrag('axis');
    drag.begin('L1', 'end');
    fire('pointermove', 258, 640);
    fire('pointerup', 258, 640);
    expect(updates[0]).toMatchObject({ endJoin: 'left', endPort: 1 });
  });

  it('普通形状不变：nearestJoin + 最近边上的投影（两位小数）', () => {
    const { drag, updates } = makeDrag('shape');
    drag.begin('L1', 'end');
    fire('pointermove', 510, 320);
    fire('pointerup', 510, 320);
    expect(updates[0]).toMatchObject({ endNodeId: 'A', endJoin: 'top', endPort: 0.58 });
  });
});
