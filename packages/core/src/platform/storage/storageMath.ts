/**
 * 存储配额纯函数（docs/02 §6.1）：阈值/压力/格式化的唯一实现源，
 * app 壳只消费导出的结果，不重复实现。
 */

import type { StoragePressure } from '../../types/storage';

export const STORAGE_WARN_RATIO = 0.8;
export const STORAGE_CRITICAL_RATIO = 0.95;

export function normalizeBytes(value: number | undefined | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function storageRatio(usage: number | null, quota: number | null): number | null {
  if (usage === null || quota === null || quota <= 0) return null;
  return Math.min(1, Math.max(0, usage / quota));
}

export function storagePressure(usage: number | null, quota: number | null): StoragePressure {
  const ratio = storageRatio(usage, quota);
  if (ratio === null) return 'unknown';
  if (ratio >= STORAGE_CRITICAL_RATIO) return 'critical';
  if (ratio >= STORAGE_WARN_RATIO) return 'warn';
  return 'ok';
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 显示值：>=10 取整，否则 1 位小数（与 formatBytes 的输出规则一致） */
function displayValue(n: number): number {
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}

/** 字节人性化（— / B / KB / MB / GB / TB；>=10 取整，否则 1 位小数）。 */
export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—';
  let v = value;
  let unit = 0;
  // 按显示值进位：1048575B 换算 999.99…KB 取整后是 1024，继续进到 1.0 MB
  // （复审低优 #2：只按原始值 <1024 判断会输出「1024 KB」）
  while (unit < BYTE_UNITS.length - 1 && displayValue(v) >= 1024) {
    v /= 1024;
    unit += 1;
  }
  const text = v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return `${text} ${BYTE_UNITS[unit]}`;
}

/** 用量百分比（— 或整数百分比，封顶 100）。 */
export function formatPercent(usage: number | null, quota: number | null): string {
  const ratio = storageRatio(usage, quota);
  if (ratio === null) return '—';
  return `${Math.min(100, Math.round(ratio * 100))}%`;
}
