import { describe, expect, it } from 'vitest';
import { computePortSpread, selfLoopSpanOf } from '../widgets/line/linePortSpread';
import type { ILineAnchorData } from '../widgets/line/lineQuickAdd';

/** 同边错开/自环嵌套分档纯函数（specs/flowchart-closeout §7.3/§7.5，四轮拆分） */

const line = (id: string, extra: Partial<ILineAnchorData>): ILineAnchorData & { id: string } =>
  ({
    id,
    startNodeId: null,
    endNodeId: null,
    startJoin: null,
    endJoin: null,
    points: [],
    lineType: 'ELBOWED',
    pinned: false,
    ...extra,
  }) as ILineAnchorData & { id: string };

describe('computePortSpread', () => {
  it('双自环同边：id 字典序赋档 1/2；单自环不进表', () => {
    const a = line('958d', { startNodeId: 'N', endNodeId: 'N', startJoin: 'top', endJoin: 'top' });
    const b = line('f00a', { startNodeId: 'N', endNodeId: 'N', startJoin: 'top', endJoin: 'top' });
    const spread = computePortSpread([a, b]);
    expect(spread.selfLoopSpan.get('958d')).toBe(1);
    expect(spread.selfLoopSpan.get('f00a')).toBe(2);
    expect(spread.ports.size).toBe(0); // 自环豁免错开槽位
    const single = computePortSpread([a]);
    expect(single.selfLoopSpan.size).toBe(0); // n=1 缺省
  });

  it('两条同边普通线：0.4/0.6 均分（n=2 公式）；混合端同组', () => {
    const a = line('LA', { startNodeId: 'N', startJoin: 'right' });
    const b = line('LB', { endNodeId: 'N', endJoin: 'right' });
    const spread = computePortSpread([a, b]);
    expect(spread.ports.get(`s|N|right|LA`)).toBeCloseTo(0.4, 5);
    expect(spread.ports.get(`e|N|right|LB`)).toBeCloseTo(0.6, 5);
  });
});

describe('selfLoopSpanOf（预览查询 + live 覆写）', () => {
  // f00a 的 model 里 endNodeId 尚未写（拉线首帧：applyMove 的 update 在 route
  // 之后——live 覆写当帧锚定是首帧同源的关键，四轮实测的滞后缺陷锁）
  const models = new Map([
    [
      '958d',
      {
        toJSON: () =>
          line('958d', { startNodeId: 'N', endNodeId: 'N', startJoin: 'top', endJoin: 'top' }),
      },
    ],
    [
      'f00a',
      { toJSON: () => line('f00a', { startNodeId: 'N', endNodeId: null, startJoin: 'top' }) },
    ],
  ]);
  const engine = { getModelById: (id: string) => models.get(id) };
  const vmEngine = {
    getAllVms: () => [
      { id: '958d', type: 'LINE' },
      { id: 'f00a', type: 'LINE' },
    ],
  };
  const live = {
    startNodeId: 'N',
    startJoin: 'top' as const,
    endNodeId: 'N',
    endJoin: 'top' as const,
    startPort: undefined,
    endPort: undefined,
  };

  it('live 覆写当帧锚定：被查线（f00a 首帧未落库）得正确外环档 2', () => {
    expect(selfLoopSpanOf(engine as never, vmEngine as never, 'f00a', live)).toBe(2);
  });

  it('查另一条线（958d）时 f00a 假定已落库（后帧场景）→ 内环档 1', () => {
    const settled = new Map(models);
    settled.set('f00a', {
      toJSON: () =>
        line('f00a', { startNodeId: 'N', endNodeId: 'N', startJoin: 'top', endJoin: 'top' }),
    });
    const eng = { getModelById: (id: string) => settled.get(id) };
    expect(selfLoopSpanOf(eng as never, vmEngine as never, '958d', live)).toBe(1);
  });

  it('live 也是 null 锚定（未命中控件帧）→ 不判自环，undefined 缺省 1', () => {
    const stale = { ...live, endNodeId: null, endJoin: null };
    expect(selfLoopSpanOf(engine as never, vmEngine as never, 'f00a', stale)).toBeUndefined();
  });
});
