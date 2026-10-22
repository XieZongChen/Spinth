import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatPercent,
  normalizeBytes,
  storagePressure,
  storageRatio,
  STORAGE_CRITICAL_RATIO,
  STORAGE_WARN_RATIO,
} from '../platform/storage/storageMath';

describe('存储配额纯函数（docs/02 §6.1）', () => {
  it('normalizeBytes：非数/NaN/负数 → null，合法值原样返回', () => {
    expect(normalizeBytes(undefined)).toBeNull();
    expect(normalizeBytes(null)).toBeNull();
    expect(normalizeBytes(Number.NaN)).toBeNull();
    expect(normalizeBytes(-1)).toBeNull();
    expect(normalizeBytes(0)).toBe(0);
    expect(normalizeBytes(1024)).toBe(1024);
  });

  it('storageRatio：缺任一边/配额非正 → null；结果钳制在 [0,1]', () => {
    expect(storageRatio(null, 100)).toBeNull();
    expect(storageRatio(50, null)).toBeNull();
    expect(storageRatio(50, 0)).toBeNull();
    expect(storageRatio(50, 100)).toBe(0.5);
    expect(storageRatio(150, 100)).toBe(1);
    expect(storageRatio(-5, 100)).toBe(0);
  });

  it('storagePressure 边界：warn>=0.80、critical>=0.95（A6）', () => {
    expect(storageRatio(79, 100)).toBeLessThan(STORAGE_WARN_RATIO);
    expect(storagePressure(79, 100)).toBe('ok');
    expect(storagePressure(80, 100)).toBe('warn');
    expect(storagePressure(94.9, 100)).toBe('warn');
    expect(storagePressure(95, 100)).toBe('critical');
    expect(storagePressure(100, 100)).toBe('critical');
    expect(storagePressure(null, 100)).toBe('unknown');
    expect(storagePressure(50, null)).toBe('unknown');
  });

  it('formatBytes：null/NaN/负数 → —；单位阶梯与取整规则', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(0)).toBe('0.0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    // 大值不越过最高单位（TB 封顶，继续取整）
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
  });

  it('formatPercent：缺边 → —；整数百分比、四舍五入、超额封顶 100', () => {
    expect(formatPercent(null, 100)).toBe('—');
    expect(formatPercent(50, null)).toBe('—');
    expect(formatPercent(0, 100)).toBe('0%');
    expect(formatPercent(50, 100)).toBe('50%');
    expect(formatPercent(80, 100)).toBe('80%');
    expect(formatPercent(95, 100)).toBe('95%');
    expect(formatPercent(150, 100)).toBe('100%');
    expect(formatPercent(50.4, 100)).toBe('50%');
    expect(formatPercent(50.5, 100)).toBe('51%');
  });
});
