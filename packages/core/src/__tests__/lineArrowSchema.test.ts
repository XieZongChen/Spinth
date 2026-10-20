import { describe, expect, it } from 'vitest';
import { LineSchema } from '../types';

const base = {
  id: 'l1',
  type: 'LINE' as const,
  zOrder: 'a0',
  points: [
    [0, 0],
    [100, 0],
  ] as Array<[number, number]>,
};

/** 批次 3：菱形箭头（docs/05 §5 第四种）——schema 枚举放行 + 默认值不回归 */
describe('LineSchema 箭头枚举', () => {
  it('diamond 两端放行', () => {
    const d = LineSchema.parse({ ...base, startArrow: 'diamond', endArrow: 'diamond' });
    expect(d.startArrow).toBe('diamond');
    expect(d.endArrow).toBe('diamond');
  });

  it('既有枚举与默认值不回归（strip 防越权语义不变）', () => {
    const def = LineSchema.parse(base);
    expect(def.startArrow).toBe('none');
    expect(def.endArrow).toBe('arrow');
    expect(def.lineType).toBe('STRAIGHT');
    expect(def.dashed).toBe(false);
  });

  it('未知枚举值仍被拒', () => {
    expect(() => LineSchema.parse({ ...base, startArrow: 'triangle' })).toThrow();
  });
});
