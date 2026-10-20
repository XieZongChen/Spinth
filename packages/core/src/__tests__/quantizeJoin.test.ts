import { describe, expect, it } from 'vitest';
import { quantizeJoin } from '../widgets/line/lineMath';

/** 出线方向旋转量化（docs/05 §8 旋转穿体修复，2026-10-16 用户实测揪出） */
const PI = Math.PI;

describe('quantizeJoin（边法向旋转后量化到最近轴对齐方向）', () => {
  it('θ=0 恒等（零旋转零变化）', () => {
    for (const j of ['top', 'right', 'bottom', 'left'] as const) {
      expect(quantizeJoin(j, 0)).toBe(j);
    }
  });

  it('90°：四边各转一个方位（right→bottom、bottom→left、left→top、top→right）', () => {
    expect(quantizeJoin('right', PI / 2)).toBe('bottom');
    expect(quantizeJoin('bottom', PI / 2)).toBe('left');
    expect(quantizeJoin('left', PI / 2)).toBe('top');
    expect(quantizeJoin('top', PI / 2)).toBe('right');
  });

  it('180°：对边互换', () => {
    expect(quantizeJoin('right', PI)).toBe('left');
    expect(quantizeJoin('top', PI)).toBe('bottom');
  });

  it('斜角量化最近轴：60°/120° right→bottom（法向 y 占优）、150°→left、315°（对角平局）→top', () => {
    expect(quantizeJoin('right', (60 * PI) / 180)).toBe('bottom');
    expect(quantizeJoin('right', (120 * PI) / 180)).toBe('bottom');
    expect(quantizeJoin('right', (150 * PI) / 180)).toBe('left');
    // 315° = −45°：right 法向 (0.707,−0.707) 平局 → 顺时针侧（y 优先）→ top
    expect(quantizeJoin('right', (315 * PI) / 180)).toBe('top');
  });

  it('幂等：同输入两次相等', () => {
    expect(quantizeJoin('right', 2.3)).toEqual(quantizeJoin('right', 2.3));
  });
});
