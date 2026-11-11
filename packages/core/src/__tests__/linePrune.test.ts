import { describe, expect, it } from 'vitest';
import { countDanglingLines, danglingLineIds } from '../widgets/line/linePrune';

/**
 * 悬空连线扫描（specs/flowchart-closeout §7.6，G-09）：
 * 「恰好一端 nodeId === null」= 断头线；纯自由线（两端均 null）与双端锚定
 * 线均不清。扫描口径与 unbindFrom 同源（vm 枚举 + toJSON 投影）。
 */

function makeSrc(
  lines: Array<{ id: string; start: string | null; end: string | null }>,
  others: Array<{ id: string; type: string }> = [],
) {
  const models = new Map(
    lines.map((l) => [l.id, { toJSON: () => ({ startNodeId: l.start, endNodeId: l.end }) }]),
  );
  return {
    getAllVms: () => [...lines.map((l) => ({ id: l.id, type: 'LINE' })), ...others],
    getModelById: (id: string) => models.get(id),
  };
}

describe('danglingLineIds/countDanglingLines 断头线判定', () => {
  it('恰好一端 null → 断头线；双端 null（纯自由线）与双端锚定均不算', () => {
    const src = makeSrc([
      { id: 'L1', start: 'A', end: null }, // 断头（删 A 遗留）
      { id: 'L2', start: null, end: 'B' }, // 断头（另一向）
      { id: 'L3', start: null, end: null }, // 纯自由线——合法图元
      { id: 'L4', start: 'A', end: 'B' }, // 双端锚定
    ]);
    expect(danglingLineIds(src).sort()).toEqual(['L1', 'L2']);
    expect(countDanglingLines(src)).toBe(2);
  });

  it('非 LINE 类型不参与（SHAPE 即便模型缺失也不计）', () => {
    const src = makeSrc(
      [{ id: 'L1', start: 'A', end: null }],
      [
        { id: 'S1', type: 'SHAPE' },
        { id: 'P1', type: 'PEN' },
      ],
    );
    expect(danglingLineIds(src)).toEqual(['L1']);
  });

  it('model 缺失（极端时序）安全跳过；空画布零计数', () => {
    const src = {
      getAllVms: () => [{ id: 'L9', type: 'LINE' }],
      getModelById: () => undefined,
    };
    expect(danglingLineIds(src)).toEqual([]);
    expect(countDanglingLines(makeSrc([]))).toBe(0);
  });
});
