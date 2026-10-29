import { describe, expect, it } from 'vitest';
import { LineSchema } from '../types';

describe('LineSchema pinned 默认值（批次 3）', () => {
  it('缺省解析为 false', () => {
    const line = LineSchema.parse({
      id: 'l1',
      type: 'LINE',
      zOrder: 'a',
      points: [
        [0, 0],
        [10, 0],
      ],
    });
    expect(line.pinned).toBe(false);
  });
});
