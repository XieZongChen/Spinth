// @vitest-environment jsdom
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { LineEndpointDrag } from '../widgets/line/lineEndpointDrag';
import type { LineVm } from '../widgets/line/lineVm';

/**
 * 端点重锚定落定重排（specs/flowchart-closeout §7.3/§7.5 五轮）：把普通线
 * 拖成同边自环会改变既有自环的嵌套档——onUp 必须经 host.onSettled 触发
 * reattachAll（与拉线 settle 同款），否则其他自环停在旧几何与被拖线重叠。
 * 这里直接验证 LineEndpointDrag 的 onUp 调用 host.onSettled + 写库顺序。
 */

function makeDrag() {
  const settledCalls: number[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const state = {
    id: 'L1',
    type: 'LINE',
    lineType: 'ELBOWED',
    startNodeId: 'A',
    startJoin: 'top' as const,
    endNodeId: null,
    endJoin: null,
    points: [
      [500, 316],
      [700, 400],
    ] as Array<[number, number]>,
  };
  const vm = {
    id: 'L1',
    type: 'LINE',
    state,
    previewRoute: () => {},
  } as unknown as LineVm;
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
      getAllVms: () => [vm],
      getVmsInRect: () => [],
      getVmById: (id: string) =>
        id === 'L1'
          ? vm
          : id === 'A'
            ? {
                getHostGeom: () => ({
                  rect: { x: 440, y: 316, width: 120, height: 80 },
                  rotation: 0,
                }),
              }
            : null,
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
    {
      hitTest: () => ({
        id: 'A',
        geom: { rect: { x: 440, y: 316, width: 120, height: 80 }, rotation: 0 },
      }),
      gridSnapOn: () => false,
      onSettled: () => settledCalls.push(updates.length), // 记录调用时已写入次数
    },
  );
  return { drag, state, updates, settledCalls };
}

const fire = (type: string, x: number, y: number): void => {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
};

describe('端点重锚定 onUp 触发 host.onSettled（五轮返工）', () => {
  it('拖拽命中重锚定 → update 落库后、onSettled 恰好调用一次（重排并入同事务）', () => {
    const { drag, updates, settledCalls } = makeDrag();
    expect(drag.begin('L1', 'end')).toBe(true);
    // 命中 A（世界 500,318 顶边内侧）拖动 >4px 再松手
    fire('pointermove', 510, 320);
    fire('pointerup', 510, 320);
    expect(updates).toHaveLength(1); // 被拖线落库（重锚定为自环端）
    expect(settledCalls).toEqual([1]); // onSettled 在 update 之后调用一次
  });
});
