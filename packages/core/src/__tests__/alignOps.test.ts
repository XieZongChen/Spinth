import { describe, expect, it } from 'vitest';
import type { IRect } from '../common/geometry';
import { computeAlignDeltas, computeDistributeDeltas } from '../platform/selector/alignOps';

/** 应用位移（验证幂等/几何不变量用） */
function apply(rects: IRect[], deltas: Array<{ dx: number; dy: number }>): IRect[] {
  return rects.map((r, i) => ({ ...r, x: r.x + deltas[i]!.dx, y: r.y + deltas[i]!.dy }));
}

/** 三块错位矩形：x=0/100/260，宽 120/80/60 → 间隙 100-120=-20 / 260-180=80 */
const THREE: IRect[] = [
  { x: 0, y: 40, width: 120, height: 50 },
  { x: 100, y: 10, width: 80, height: 70 },
  { x: 260, y: 90, width: 60, height: 40 },
];

describe('computeAlignDeltas（docs/05 §7）', () => {
  it('左对齐：全部 x 收敛到包围盒左缘（= 最小 x）', () => {
    const d = computeAlignDeltas(THREE, 'left');
    const next = apply(THREE, d);
    expect(next.map((r) => r.x)).toEqual([0, 0, 0]);
    expect(next.map((r) => r.y)).toEqual(THREE.map((r) => r.y)); // y 不动
  });

  it('右对齐：全部右缘收敛到包围盒右缘（= 最大 x+w）', () => {
    const d = computeAlignDeltas(THREE, 'right');
    const next = apply(THREE, d);
    const right = next.map((r) => r.x + r.width);
    expect(right).toEqual([320, 320, 320]);
  });

  it('水平居中：全部中心 x 收敛到包围盒中心', () => {
    const d = computeAlignDeltas(THREE, 'hcenter');
    const next = apply(THREE, d);
    const centers = next.map((r) => r.x + r.width / 2);
    expect(centers[0]).toBeCloseTo(160, 10);
    expect(centers.every((c) => Math.abs(c - centers[0]!) < 1e-9)).toBe(true);
  });

  it('顶对齐 / 垂直居中 / 底对齐：y 向三档对称收敛，x 不动', () => {
    for (const mode of ['top', 'vcenter', 'bottom'] as const) {
      const d = computeAlignDeltas(THREE, mode);
      expect(d.every((v) => v.dx === 0)).toBe(true);
      const next = apply(THREE, d);
      const edges = next.map((r) =>
        mode === 'top' ? r.y : mode === 'vcenter' ? r.y + r.height / 2 : r.y + r.height,
      );
      expect(edges.every((e) => Math.abs(e - edges[0]!) < 1e-9)).toBe(true);
    }
  });

  it('幂等：应用一次后再算全零（基准不变）', () => {
    for (const mode of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const) {
      const once = apply(THREE, computeAlignDeltas(THREE, mode));
      const twice = computeAlignDeltas(once, mode);
      expect(twice.every((v) => v.dx === 0 && v.dy === 0)).toBe(true);
    }
  });

  it('已在基准上的元素零位移（左缘最小者左对齐不动）', () => {
    const d = computeAlignDeltas(THREE, 'left');
    expect(d[0]).toEqual({ dx: 0, dy: 0 });
  });

  it('空/单元素安全返回', () => {
    expect(computeAlignDeltas([], 'left')).toEqual([]);
    expect(computeAlignDeltas([THREE[0]!], 'left')).toEqual([{ dx: 0, dy: 0 }]);
  });
});

describe('computeDistributeDeltas（docs/05 §7）', () => {
  it('横向分布：相邻间隙相等、两端不动、顺序稳定', () => {
    const d = computeDistributeDeltas(THREE, 'h');
    const next = apply(THREE, d);
    // 两端不动（首元素 x=0 本就最小；末元素 x=260 最大）
    expect(next[0]!.x).toBe(0);
    expect(next[2]!.x).toBe(260);
    // 相邻间隙相等：span 320，总宽 260 → gap (320-260)/2 = 30
    const gap1 = next[1]!.x - (next[0]!.x + next[0]!.width);
    const gap2 = next[2]!.x - (next[1]!.x + next[1]!.width);
    expect(gap1).toBeCloseTo(30, 10);
    expect(gap2).toBeCloseTo(30, 10);
    // y 不动
    expect(next.map((r) => r.y)).toEqual(THREE.map((r) => r.y));
  });

  it('纵向分布：同数学换轴', () => {
    const vertical: IRect[] = THREE.map((r) => ({
      x: r.y,
      y: r.x,
      width: r.height,
      height: r.width,
    }));
    const d = computeDistributeDeltas(vertical, 'v');
    const next = apply(vertical, d);
    expect(next.every((r, i) => r.x === vertical[i]!.x)).toBe(true); // x 不动（换轴后同源）
    const gap1 = next[1]!.y - (next[0]!.y + next[0]!.height);
    const gap2 = next[2]!.y - (next[1]!.y + next[1]!.height);
    expect(gap1).toBeCloseTo(gap2, 10);
  });

  it('输入乱序：先按位置排序再分布（结果与有序输入一致）', () => {
    const shuffled = [THREE[2]!, THREE[0]!, THREE[1]!];
    const d = computeDistributeDeltas(shuffled, 'h');
    const next = apply(shuffled, d);
    // 输出数组与输入同序（per 元素位移），但几何结果应与有序输入一致
    const sorted = next.slice().sort((a, b) => a.x - b.x);
    const ref = apply(THREE, computeDistributeDeltas(THREE, 'h'))
      .slice()
      .sort((a, b) => a.x - b.x);
    expect(sorted.map((r) => r.x)).toEqual(ref.map((r) => r.x));
  });

  it('总宽不足（负间隙）：照算，两端仍不动', () => {
    // 三块互相重叠：span 200 < 总宽 300 → gap = -50
    const overlap: IRect[] = [
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 50, y: 0, width: 100, height: 10 },
      { x: 100, y: 0, width: 100, height: 10 },
    ];
    const d = computeDistributeDeltas(overlap, 'h');
    const next = apply(overlap, d);
    expect(next[0]!.x).toBe(0);
    expect(next[2]!.x).toBe(100);
    const gap1 = next[1]!.x - (next[0]!.x + next[0]!.width);
    const gap2 = next[2]!.x - (next[1]!.x + next[1]!.width);
    expect(gap1).toBeCloseTo(-50, 10);
    expect(gap2).toBeCloseTo(-50, 10);
  });

  it('<3 个元素返回全零（两端即全部，无中间可排）', () => {
    expect(computeDistributeDeltas(THREE.slice(0, 2), 'h')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(computeDistributeDeltas([THREE[0]!], 'v')).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('幂等：分布后再算全零', () => {
    const once = apply(THREE, computeDistributeDeltas(THREE, 'h'));
    const twice = computeDistributeDeltas(once, 'h');
    expect(twice.every((v) => v.dx === 0 && v.dy === 0)).toBe(true);
  });
});
