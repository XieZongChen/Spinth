import type * as Y from 'yjs';
import type { AssetStore } from './assetStore';
import { assetIdOf, isAssetSrc } from './assetStore';
import { listPersistedDocIds, scanDocAssetRefs } from './dbProvider';

/** 孤儿宽限基线（第三轮审查「只删早于本次 session 的孤儿」）：调用方传
 *  页面加载时刻（performance.timeOrigin）——本会话内 put 的孤儿一律保留
 *  （undo 栈/剪贴板/他标签未落盘引用的统一兜底窗口），上会话的照删 */
export function sessionStartEpoch(): number {
  const t = (performance as { timeOrigin?: number }).timeOrigin;
  return typeof t === 'number' ? t : Date.now();
}

/** GC 统计（sdk.lastAssetMaintenance 的 GC 侧；E2E/调试探针）。
 *  partial：none = 整轮完成；budget = 软预算耗尽（下轮继续）；cancelled =
 *  页面销毁/切页中断（mark 中断零删除，sweep 可部分完成） */
export interface IAssetGcResult {
  /** 扫描的磁盘文档数（不含当前 doc） */
  docs: number;
  /** 资产库总行数 */
  assets: number;
  /** 无任何文档引用的孤儿数 */
  orphans: number;
  /** 实际删除数（孤儿中持活/宽限期内的不计） */
  removed: number;
  skipped: boolean;
  partial: 'none' | 'budget' | 'cancelled';
  /** 本轮耗时（opts.now 度量；软预算口径） */
  ms: number;
}

export interface IAssetGcOptions {
  assetStore: AssetStore;
  currentDocId: string;
  currentDocRefs: Set<string>;
  /** 删行前重采当前 doc 引用（扫描窗口内新建的图防误删——第三轮审查） */
  collectCurrentRefs?: () => Set<string>;
  /** undo 栈非空则整轮跳过（栈内待恢复的 widget 可能引用孤儿 blob——
   *  删了则 undo 恢复灰框。启动 3s 场景通常为空，用户秒删快于维护链时兜住） */
  canUndo?: boolean;
  /** 孤儿宽限基线（epoch ms）：只删 t < olderThan 的孤儿。缺省 = 会话启动
   *  （sessionStartEpoch）——本会话 put 的保留；测试传 0 = 不限立即删 */
  olderThan?: number;
  listDocIds?: () => Promise<string[] | null>;
  scanDoc?: (docId: string) => Promise<Set<string>>;
  /** false = 停止本轮（页面销毁/切页），默认恒真 */
  shouldContinue?: () => boolean;
  /** 单轮软预算（ms）：只影响清理完整度不影响正确性，默认 1500；
   *  Infinity = 不限；0 = 零预算 */
  budgetMs?: number;
  /** 时钟注入（默认 performance.now；测试用） */
  now?: () => number;
  /** 协作让出（每篇扫描/每块删除后），默认 scheduler.yield ?? setTimeout(0) */
  yieldToMain?: () => Promise<void>;
  /** sweep 每批行数（默认 ASSET_SWEEP_BATCH） */
  batchSize?: number;
}

/** 单轮软预算（ms）：软在「超时只少删不误删」，下轮会话继续清 */
export const ASSET_GC_BUDGET_MS = 1500;
/** sweep 单批行数：孤儿删除从 2N 事务降到 2×ceil(N/64) */
export const ASSET_SWEEP_BATCH = 64;

const defaultNow = (): number => performance.now();

/** 协作让出（GC 与迁移共用）：scheduler.yield 不可用时退 setTimeout(0) */
export function defaultYieldToMain(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0));
}

/** 内存态收集（当前 doc 的权威引用集——含未落盘缓冲） */
export function collectLiveAssetRefs(yWidgets: Y.Array<unknown>): Set<string> {
  const refs = new Set<string>();
  for (const item of yWidgets.toArray()) {
    const m = item as Y.Map<unknown>;
    if (m.get('type') !== 'IMAGE') continue;
    const src = m.get('src');
    if (typeof src === 'string' && isAssetSrc(src)) refs.add(assetIdOf(src));
  }
  return refs;
}

/**
 * mark-sweep 资产 GC（Batch 2 二期，单机版）：
 * 引用集 = 当前 doc 内存引用 ∪ 其他磁盘文档引用 → 资产库差集即孤儿 → 删。
 *
 * 时机模型（安全边界）：**仅启动 idle 跑一次，会话内不再跑**——本会话删除的
 * 图必留到下会话（undo 恢复永远有 blob；跨会话 undo 栈已消失，下会话清安全）。
 * 协同在线（wsState !== 'off'）整轮跳过：他端删图未同步到本端的窗口内不删
 * （blob 生命周期归二期 server 端点统筹）。
 *
 * 启动成本（P1）：空资产库零文档扫描短路；mark 每篇后协作让出；sweep 批量
 * 删除（单批一次读 tx + 一次写 tx）；软预算超时或 shouldContinue=false 中断
 * ——**mark 阶段被打断 = 零删除**（部分引用集绝不能用于删除），sweep 阶段
 * 可部分完成（已删块保留，统计带 partial）。
 *
 * listDocIds/scanDoc 参数化：生产用 indexedDB.databases() 发现 + 盘上重建；
 * 测试注入（fake-indexeddb 的 databases 支持与真实环境解耦）。
 */
export async function runAssetGc(opts: IAssetGcOptions): Promise<IAssetGcResult> {
  const now = opts.now ?? defaultNow;
  const start = now();
  const elapsed = (): number => now() - start;
  const budget = opts.budgetMs ?? ASSET_GC_BUDGET_MS;
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const yieldToMain = opts.yieldToMain ?? defaultYieldToMain;
  const batchSize = opts.batchSize ?? ASSET_SWEEP_BATCH;
  const done = (over: Omit<IAssetGcResult, 'ms'>): IAssetGcResult => ({
    ...over,
    ms: elapsed(),
  });

  if (opts.canUndo) {
    return done({ docs: 0, assets: 0, orphans: 0, removed: 0, skipped: true, partial: 'none' });
  }

  // 空库短路：无孤儿可言——不 listDocIds、不扫任何文档。必须在迁移之后
  //  调用（迁移会新建资产），由调用方（runAssetMaintenance）保证次序
  const allIds = await opts.assetStore.listIds();
  if (allIds.length === 0) {
    return done({ docs: 0, assets: 0, orphans: 0, removed: 0, skipped: false, partial: 'none' });
  }

  const listDocIds = opts.listDocIds ?? listPersistedDocIds;
  const scanDoc = opts.scanDoc ?? scanDocAssetRefs;
  const docIds = await listDocIds();
  if (!docIds) {
    console.info('[spinth:asset-gc] indexedDB.databases() 不可用，本轮跳过');
    return done({
      docs: 0,
      assets: allIds.length,
      orphans: 0,
      removed: 0,
      skipped: true,
      partial: 'none',
    });
  }

  // mark：逐文档扫描（每篇前查中断/预算，每篇后让出）
  const refs = new Set(opts.currentDocRefs);
  let docs = 0;
  for (const id of docIds) {
    if (id === opts.currentDocId) continue; // 当前 doc 用内存引用集（含未落盘缓冲）
    if (!shouldContinue()) {
      console.info('[spinth:asset-gc] mark 阶段被打断，本轮零删除');
      return done({
        docs,
        assets: allIds.length,
        orphans: 0,
        removed: 0,
        skipped: false,
        partial: 'cancelled',
      });
    }
    if (elapsed() >= budget) {
      return done({
        docs,
        assets: allIds.length,
        orphans: 0,
        removed: 0,
        skipped: false,
        partial: 'budget',
      });
    }
    for (const r of await scanDoc(id)) refs.add(r);
    docs++;
    await yieldToMain();
  }
  // 删行前重采：其他 doc 扫描期间用户可能刚贴图（引用在内存、未落盘）
  if (opts.collectCurrentRefs) {
    for (const r of opts.collectCurrentRefs()) refs.add(r);
  }

  // sweep：批量删除，块前查中断/预算（sweep 可部分完成，已删块保留）
  const olderThan = opts.olderThan ?? sessionStartEpoch();
  const orphanIds = allIds.filter((id) => !refs.has(id));
  let removed = 0;
  let partial: 'none' | 'budget' | 'cancelled' = 'none';
  for (let i = 0; i < orphanIds.length; i += batchSize) {
    if (!shouldContinue()) {
      partial = 'cancelled';
      break;
    }
    if (elapsed() >= budget) {
      partial = 'budget';
      break;
    }
    const r = await opts.assetStore.sweepOrphans(orphanIds.slice(i, i + batchSize), olderThan);
    removed += r.removed;
    await yieldToMain();
  }
  if (orphanIds.length > 0) {
    console.info(
      `[spinth:asset-gc] ${docs} 文档扫描，${allIds.length} 资产，清理孤儿 ${removed}/${orphanIds.length}` +
        (partial === 'none' ? '（本会话新 put 的保留）' : `（${partial} 中断，下轮继续）`),
    );
  }
  return done({
    docs,
    assets: allIds.length,
    orphans: orphanIds.length,
    removed,
    skipped: false,
    partial,
  });
}

/** 单写者锁（Web Locks）：多标签同时启动维护链时只有一个执行 GC——其他标签的
 *  未落盘引用对本标签不可见，双跑扩大误删窗口。锁覆盖整轮（含协作让出）。
 *  ifAvailable 在锁被占用时仍会调用 callback，但传入 null；必须显式判空，
 *  否则锁形同虚设（2026-10-20 修复）。Web Locks API 不可用（老浏览器/jsdom）
 *  降级直跑（单标签场景无竞争）。返回是否真正执行。 */
export async function withAssetGcLock(fn: () => Promise<void>): Promise<boolean> {
  const locks = (
    navigator as unknown as {
      locks?: {
        request(
          name: string,
          opts: unknown,
          cb: (lock: unknown | null) => Promise<void>,
        ): Promise<unknown>;
      };
    }
  ).locks;
  if (!locks || typeof locks.request !== 'function') {
    await fn();
    return true;
  }
  let ran = false;
  try {
    await locks.request('spinth-asset-gc', { ifAvailable: true }, async (lock) => {
      if (!lock) return; // 其他标签持有锁——本轮跳过（ifAvailable 的 null 语义）
      ran = true;
      await fn();
    });
  } catch (err) {
    console.warn('[spinth:asset-gc] 锁请求失败（跳过本轮）', err);
  }
  return ran;
}
