/** updateSelectedStyle 的切回折线编排：重路由并入切型事务（一步撤销），
 *  线型没变不触发。宿主用最小桩——只验证调用次序与事务嵌套深度 */
import { describe, expect, it, vi } from 'vitest';
import type { IBoardCommandHost } from '../boardHost';
import { updateSelectedStyle } from '../styleCommands';

function makeHost(current: string): { host: IBoardCommandHost; calls: string[] } {
  const calls: string[] = [];
  let depth = 0;
  const model = {
    toJSON: () => ({ lineType: current }),
    update: vi.fn(() => {
      calls.push('update');
    }),
  };
  const host = {
    selector: { selected$: { value: ['L1'] } },
    viewport: { editable$: { value: true } },
    engine: {
      transact: (fn: () => void) => {
        depth++;
        try {
          fn();
        } finally {
          depth--;
        }
      },
      getModelById: () => model,
    },
    history: { stopCapturing: vi.fn() },
    lineService: {
      rerouteLine: vi.fn(() => {
        calls.push(`reroute@${depth}`);
      }),
    },
  } as unknown as IBoardCommandHost;
  return { host, calls };
}

describe('updateSelectedStyle：切回折线的重路由编排', () => {
  it('STRAIGHT → ELBOWED：同一切型事务内、写入之后重路由', () => {
    const { host, calls } = makeHost('STRAIGHT');
    updateSelectedStyle(host, { lineType: 'ELBOWED' });
    expect(calls).toEqual(['update', 'reroute@1']);
  });

  it('线型没变（重复点选当前项）：不重路由', () => {
    const { host, calls } = makeHost('ELBOWED');
    updateSelectedStyle(host, { lineType: 'ELBOWED' });
    expect(calls).toEqual(['update']);
  });

  it('切到其他线型 / 不含 lineType：不重路由', () => {
    for (const patch of [{ lineType: 'STRAIGHT' }, { lineType: 'CURVE' }, { color: '#2563eb' }]) {
      const { host, calls } = makeHost('ELBOWED');
      updateSelectedStyle(host, patch);
      expect(calls).toEqual(['update']);
    }
  });
});

describe('updateSelectedStyle：文字位置的「线上」转写（specs/sequence-diagram §4.9）', () => {
  function makePatchHost() {
    const model = { toJSON: () => ({}), update: vi.fn() };
    const host = {
      selector: { selected$: { value: ['L1'] } },
      viewport: { editable$: { value: true } },
      engine: { transact: (fn: () => void) => fn(), getModelById: () => model },
      history: { stopCapturing: vi.fn() },
    } as unknown as IBoardCommandHost;
    return { host, model };
  }

  it('选项 id on 不是合法枚举值 → 写 textSide: undefined（读回即缺省）', () => {
    const { host, model } = makePatchHost();
    updateSelectedStyle(host, { textSide: 'on' });
    expect(model.update).toHaveBeenCalledTimes(1);
    const patch = model.update.mock.calls[0]![0] as Record<string, unknown>;
    expect('textSide' in patch).toBe(true);
    expect(patch.textSide).toBeUndefined();
  });

  it('above / below 原样落库；不含 textSide 的 patch 不被添键', () => {
    const a = makePatchHost();
    updateSelectedStyle(a.host, { textSide: 'above' });
    expect(a.model.update.mock.calls[0]![0]).toEqual({ textSide: 'above' });
    const b = makePatchHost();
    updateSelectedStyle(b.host, { color: '#2563eb' });
    expect(b.model.update.mock.calls[0]![0]).toEqual({ color: '#2563eb', fill: 'solid' });
  });
});
