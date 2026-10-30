import { describe, expect, it } from 'vitest';
import { pinKeepMiddle } from '../widgets/line/lineMath';

/** pinned 路由（docs/08 §10 批次 3）：两端锚点重贴、中间拐点保持，U 形不丢 */
describe('pinKeepMiddle pinned 路由（docs/08 §10 批次 3）', () => {
  const pts = [
    { x: 10, y: 20 },
    { x: 10, y: 50 },
    { x: 100, y: 50 },
    { x: 200, y: 50 },
    { x: 200, y: 80 },
  ];

  it('两端锚点重贴、中间拐点保持（U 形不丢）', () => {
    const next = pinKeepMiddle(pts, { x: 15, y: 25 }, { x: 195, y: 75 });
    expect(next[0]).toEqual({ x: 15, y: 25 });
    expect(next[next.length - 1]).toEqual({ x: 195, y: 75 });
    expect(next.slice(1, -1)).toEqual(pts.slice(1, -1));
  });

  it('null 端不重贴', () => {
    const next = pinKeepMiddle(pts, null, { x: 195, y: 75 });
    expect(next[0]).toEqual({ x: 10, y: 20 });
    expect(next[next.length - 1]).toEqual({ x: 195, y: 75 });
  });
});
