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

/** GC 统计（sdk.lastAssetMaintenance 的 GC 侧；E2E/调试探针） */
export interface IAssetGcResult {
  /** 扫描的磁盘文档数（不含当前 doc） */
  docs: number;
  /** 资产库总行数 */
  assets: number;
  /** 无任何文档引用的孤儿数 */
  orphans: number;
  /** 实际删除数（孤儿中持活/宽限期内的不计） */
  removed: number;
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
 * listDocIds/scanDoc 参数化：生产用 indexedDB.databases() 发现 + 盘上重建；
 * 测试注入（fake-indexeddb 的 databases 支持与真实环境解耦）。
 */
export async function runAssetGc(opts: {
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
}): Promise<IAssetGcResult & { skipped: boolean }> {
  if (opts.canUndo) {
    return { docs: 0, assets: 0, orphans: 0, removed: 0, skipped: true };
  }
  const listDocIds = opts.listDocIds ?? listPersistedDocIds;
  const scanDoc = opts.scanDoc ?? scanDocAssetRefs;
  const docIds = await listDocIds();
  if (!docIds) {
    console.info('[spinth:asset-gc] indexedDB.databases() 不可用，本轮跳过');
    return { docs: 0, assets: 0, orphans: 0, removed: 0, skipped: true };
  }

  const refs = new Set(opts.currentDocRefs);
  let docs = 0;
  for (const id of docIds) {
    if (id === opts.currentDocId) continue; // 当前 doc 用内存引用集（含未落盘缓冲）
    for (const r of await scanDoc(id)) refs.add(r);
    docs++;
  }
  // 删行前重采：其他 doc 扫描期间用户可能刚贴图（引用在内存、未落盘）
  if (opts.collectCurrentRefs) {
    for (const r of opts.collectCurrentRefs()) refs.add(r);
  }

  const assetIds = await opts.assetStore.listIds();
  const olderThan = opts.olderThan ?? sessionStartEpoch();
  let orphans = 0;
  let removed = 0;
  for (const id of assetIds) {
    if (refs.has(id)) continue;
    orphans++;
    if (await opts.assetStore.deleteIfOlderThan(id, olderThan)) removed++;
  }
  if (orphans > 0) {
    console.info(
      `[spinth:asset-gc] ${docs} 文档扫描，${assetIds.length} 资产，清理孤儿 ${removed}/${orphans}（本会话新 put 的保留）`,
    );
  }
  return { docs, assets: assetIds.length, orphans, removed, skipped: false };
}

/** 单写者锁（Web Locks）：多标签同时启动维护链时只有一个执行 GC——其他标签的
 *  未落盘引用对本标签不可见，双跑扩大误删窗口。ifAvailable 在锁被占用时仍会调用
 *  callback，但传入 null；必须显式判空，否则锁形同虚设（2026-10-20 修复）。
 *  Web Locks API 不可用（老浏览器/jsdom）降级直跑（单标签场景无竞争）。
 *  返回是否真正执行。 */
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
