/**
 * 存储状态公共契约（docs/02 §6.1）：浏览器持久化授权与站点配额的可见化。
 * 区分两种状态：persistState$ 是文档写 IndexedDB 的落盘状态（DbProvider）；
 * IStorageStatus 是浏览器持久化授权 + 站点配额估算（navigator.storage）。
 * zod schema 是状态边界的唯一运行时校验源；IStorageManager 为注入端口，
 * 测试替身与浏览器实现同源。
 */

import { z } from 'zod';

/** 浏览器持久化授权（不是文档落盘；后者看 persistState$）。 */
export const StoragePersistenceSchema = z.enum([
  'unsupported', // 无 navigator.storage
  'unknown', // 未查询/查询失败
  'persisted',
  'not-persisted',
]);
export type StoragePersistence = z.infer<typeof StoragePersistenceSchema>;

export const StoragePressureSchema = z.enum(['unknown', 'ok', 'warn', 'critical']);
export type StoragePressure = z.infer<typeof StoragePressureSchema>;

export const StoragePersistOutcomeSchema = z.enum(['granted', 'denied', 'failed']);
export type StoragePersistOutcome = z.infer<typeof StoragePersistOutcomeSchema>;

export const StorageStatusSchema = z.object({
  supported: z.boolean(),
  canPersist: z.boolean(),
  persistence: StoragePersistenceSchema,
  persistOutcome: StoragePersistOutcomeSchema.nullable(),
  usage: z.number().nonnegative().nullable(),
  quota: z.number().nonnegative().nullable(),
  pressure: StoragePressureSchema,
  requestingPersist: z.boolean(),
  estimateFailed: z.boolean(),
  persistedQueryFailed: z.boolean(),
});
export type IStorageStatus = z.infer<typeof StorageStatusSchema>;

/** 注入端口：测试替身与浏览器实现同源；方法可缺失（老浏览器）。 */
export interface IStorageManager {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

export const INITIAL_STORAGE_STATUS: IStorageStatus = {
  supported: true,
  canPersist: false,
  persistence: 'unknown',
  persistOutcome: null,
  usage: null,
  quota: null,
  pressure: 'unknown',
  requestingPersist: false,
  estimateFailed: false,
  persistedQueryFailed: false,
};
