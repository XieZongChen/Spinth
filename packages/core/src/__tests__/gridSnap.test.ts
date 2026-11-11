import { describe, expect, it } from 'vitest';
import { GRID_SPACING, quantizeGrid, quantizeGridRect, quantizeResizeRect } from '../common/grid';
import { GridSnapService } from '../platform/viewport/gridSnapService';

/**
 * 网格吸附量化与开关（specs/flowchart-closeout §9.2，G-08）：
 * - 步长 16 与点阵背景同相位（点中心 ≡ 0 mod 16，量化落点压在点上）；
 * - 关闭时全部量化路径零行为变化（服务缺省关 + 各消费点 early return）。
 */

describe('quantizeGrid/quantizeGridRect', () => {
  it('GRID_SPACING = 16（与点阵背景 BASE_WORLD_SPACING 同相位）', () => {
    expect(GRID_SPACING).toBe(16);
  });

  it('量化到最近格点（含负数与中界）', () => {
    expect(quantizeGrid(0)).toBe(0);
    expect(quantizeGrid(15.9)).toBe(16);
    expect(quantizeGrid(8)).toBe(16); // 中界向上
    expect(quantizeGrid(7.9)).toBe(0);
    expect(quantizeGrid(-0.1)).toBe(0);
    expect(quantizeGrid(-8)).toBe(0); // Math.round(-0.5) = -0（JS 半界向 +∞）
  });

  it('矩形量化：左上角取格点、宽高不变（多元素左对齐才整齐）', () => {
    expect(quantizeGridRect({ x: 10.5, y: -3, width: 100, height: 50 })).toEqual({
      x: 16,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});

describe('quantizeResizeRect（缩放按固定角对齐）', () => {
  const start = { x: 32, y: 48, width: 64, height: 32 };

  it('se 手柄（固定 nw 角）：右/下边量化、左上不动', () => {
    const next = { x: 32, y: 48, width: 60.5, height: 20.2 };
    const q = quantizeResizeRect(start, 'se', next, true, true);
    // 右边 92.5 → 96（width 64）；下边 68.2 → 64（height 16，量化可回缩）
    expect(q).toEqual({ x: 32, y: 48, width: 64, height: 16 });
  });

  it('nw 手柄（固定 se 角）：左/上边量化、右下不动', () => {
    const next = { x: 40.5, y: 52.5, width: 55.5, height: 27.5 };
    const q = quantizeResizeRect(start, 'nw', next, true, true);
    expect(q.x).toBe(48); // 40.5 → 48（不越固定右界 96−1）
    expect(q.y).toBe(48); // 52.5 → 48
    expect(q.x + q.width).toBe(96);
    expect(q.y + q.height).toBe(80);
  });

  it('quantX=false（参考线命中 x 轴）：x 轴不量化', () => {
    const next = { x: 32, y: 48, width: 60.5, height: 20.2 };
    const q = quantizeResizeRect(start, 'se', next, false, true);
    expect(q.width).toBe(60.5); // 原样
    expect(q.height).toBe(16); // y 量化 68.2 → 64
  });

  it('量化不倒退成负尺寸（下限 1）', () => {
    const next = { x: 32, y: 48, width: 0.5, height: 0.5 };
    const q = quantizeResizeRect(start, 'se', next, true, true);
    expect(q.width).toBeGreaterThanOrEqual(1);
    expect(q.height).toBeGreaterThanOrEqual(1);
  });
});

describe('GridSnapService（视图偏好开关）', () => {
  const memoryStorage = (): {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
  } => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it('缺省关；持久化读回；setEnabled 幂等', () => {
    const a = new GridSnapService(memoryStorage());
    expect(a.enabled).toBe(false);
    expect(a.gridSnap$.value).toBe(false);

    a.setEnabled(true);
    expect(a.enabled).toBe(true);
    a.setEnabled(true); // 幂等
    expect(a.gridSnap$.value).toBe(true);

    const store = memoryStorage();
    a.persist(store);
    const b = new GridSnapService(store);
    expect(b.enabled).toBe(true); // 读回

    b.setEnabled(false);
    b.persist(store);
    expect(new GridSnapService(store).enabled).toBe(false);
  });

  it("异常持久化值（'x'）→ 关；storage null → 关", () => {
    const bad = memoryStorage();
    bad.setItem('spinth.gridSnap', 'x');
    expect(new GridSnapService(bad).enabled).toBe(false);
    expect(new GridSnapService(null).enabled).toBe(false);
  });
});
