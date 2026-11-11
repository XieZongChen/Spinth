import { describe, expect, it } from 'vitest';
import { moveCorner } from '../widgets/line/lineHandles';

/**
 * 拐点拖拽纯函数（specs/flowchart-closeout §6.4/§10，G-11）：
 * 相邻段保持轴对齐（同 X/Y 连续邻居同步）、首末锚点段不动。
 */

function isOrthogonal(pts: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (pts[i]!.x !== pts[i + 1]!.x && pts[i]!.y !== pts[i + 1]!.y) return false;
  }
  return true;
}

describe('moveCorner 正交保持', () => {
  // U 形五点线：锚点 A(0,0) → 竖(0,200) → 横(400,200) → 竖(400,0) → 锚点 B(?,0)
  const U = [
    { x: 0, y: 0 },
    { x: 0, y: 200 },
    { x: 400, y: 200 },
    { x: 400, y: 0 },
    { x: 500, y: 0 },
  ];

  it('中拐点双轴移动：同 X/Y 邻居各跟随一轴，全段保持正交', () => {
    const out = moveCorner(U, 2, { x: 300, y: 120 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 120 }, // 与 P2 同 Y → y 跟随
      { x: 300, y: 120 },
      { x: 300, y: 0 }, // 与 P2 同 X → x 跟随
      { x: 500, y: 0 },
    ]);
    expect(isOrthogonal(out)).toBe(true);
  });

  it('邻锚点钳制：i=1（邻 A 锚点）——A 不动，竖段只沿 Y 动（x 不变）', () => {
    const out = moveCorner(U, 1, { x: 999, y: 100 });
    // A(0,0) 与 P1 同 X——X run 触达锚点即停 → x 链不动（保正交不斜接）
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[1]).toEqual({ x: 0, y: 100 }); // y 动（P2 同 Y 跟随）
    expect(out[2]).toEqual({ x: 400, y: 100 });
    expect(isOrthogonal(out)).toBe(true);
  });

  it('对称端钳制：i=3（邻 B 锚点）——B 不动，P2 的 y 跟随', () => {
    const out = moveCorner(U, 3, { x: 300, y: 999 });
    expect(out[4]).toEqual({ x: 500, y: 0 }); // 锚点 B 不动
    expect(out[3]).toEqual({ x: 300, y: 0 }); // y 触锚即停（与 B 同 Y）
    expect(out[2]).toEqual({ x: 300, y: 200 }); // x 跟随（与 P3 同 X）
    expect(isOrthogonal(out)).toBe(true);
  });

  it('三点线（单拐点）：双轴自由，两端锚点不动', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ];
    const out = moveCorner(pts, 1, { x: 120, y: 30 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 30 },
      { x: 200, y: 0 },
    ]);
  });

  it('首末点（锚点）与越界 index 原样返回', () => {
    expect(moveCorner(U, 0, { x: 9, y: 9 })).toEqual(U);
    expect(moveCorner(U, 4, { x: 9, y: 9 })).toEqual(U);
    expect(moveCorner(U, 99, { x: 9, y: 9 })).toEqual(U);
  });

  it('拖回原位幂等（配合 mergeCollinear 零残留）', () => {
    const out = moveCorner(U, 2, { x: 400, y: 200 });
    expect(out).toEqual(U);
  });
});
