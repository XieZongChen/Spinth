import * as Y from 'yjs';
import { assetIdOf, isAssetSrc } from './assetStore';
import {
  DOC_DB_PREFIX,
  type IAuditEntry,
  openDb,
  reqToPromise,
  STORE_ALL,
  STORE_UPDATES,
} from './dbSchema';

/** 本源维护函数（资产 GC 扫描 / 项目导入写入面）：不建 DbProvider 实例、
 *  不挂监听、不触发 compaction——独立于打开中的文档。 */

/**
 * 枚举本源全部持久化文档 id（资产 GC 用，Batch 2 二期）。
 * `indexedDB.databases()` 能力检测：不可用（老 Firefox 等）返回 null——调用方
 * 跳过本轮 GC（资产只是占盘，不损正确性，挂账观察）。
 */
export async function listPersistedDocIds(): Promise<string[] | null> {
  const factory = (
    indexedDB as unknown as {
      databases?: () => Promise<Array<{ name?: string }>>;
    }
  ).databases;
  if (typeof factory !== 'function') return null;
  try {
    const list = await factory.call(indexedDB);
    return list
      .map((d) => d.name ?? '')
      .filter((n) => n.startsWith(DOC_DB_PREFIX))
      .map((n) => n.slice(DOC_DB_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * 只读扫描一份**未打开**文档的盘上资产引用集（资产 GC 的 mark 侧）：
 * 读 updates 全集 → 临时 Y.Doc 重建（apply 幂等，compact 后的单快照同样成立）
 * → 收集 IMAGE 的 `spinth-asset:` hash。当前打开的文档不走此路径（内存 yDoc
 * 是权威，含未落盘缓冲）——由调用方传 live 引用集。
 */
export async function scanDocAssetRefs(docId: string): Promise<Set<string>> {
  const db = await openDb(DOC_DB_PREFIX + docId, [STORE_UPDATES, STORE_ALL]);
  try {
    const tx = db.transaction(STORE_UPDATES, 'readonly');
    const updates = (await reqToPromise(tx.objectStore(STORE_UPDATES).getAll())) as Array<
      Uint8Array | ArrayBuffer
    >;
    const refs = new Set<string>();
    if (updates.length === 0) return refs;
    const yDoc = new Y.Doc();
    try {
      for (const u of updates) Y.applyUpdate(yDoc, new Uint8Array(u));
      for (const item of yDoc.getArray('widgets').toArray()) {
        const m = item as Y.Map<unknown>;
        if (m.get('type') !== 'IMAGE') continue;
        const src = m.get('src');
        if (typeof src === 'string' && isAssetSrc(src)) refs.add(assetIdOf(src));
      }
    } finally {
      yDoc.destroy();
    }
    return refs;
  } finally {
    db.close();
  }
}

/** `createDocFromSnapshot` 的「库已存在」专用错误（导入层据此换 id 重试，docs/20 §5.4） */
export class DocExistsError extends Error {
  constructor(docId: string) {
    super(`文档库已存在：${DOC_DB_PREFIX}${docId}`);
    this.name = 'DocExistsError';
  }
}

/**
 * 一次性从全量快照创建新文档库（项目文件导入的写入面，docs/20 §5.4）。
 * 与 `DbProvider.attach` 的区别：不建实例、不挂监听、不触发 compaction——导入
 * 是「原子创建新文档」，需要最小、可回滚的写入面：
 * 1. docId 校验 `[A-Za-z0-9_-]{1,128}`；
 * 2. open version 1，onupgradeneeded 标记新建；已存在（未触发 upgrade）→ 关库
 *    抛 `DocExistsError`；
 * 3. 单事务写 updates（一条全量）+ allupdates（一条审计 `{u, t}`）；
 * 4. 事务完成才 resolve 并关库；失败且本次新建 → best-effort deleteDatabase。
 */
export async function createDocFromSnapshot(
  docId: string,
  update: Uint8Array,
  opts?: { now?: number },
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(docId)) {
    throw new Error(`非法 docId：${docId}`);
  }
  let db: IDBDatabase | null = null;
  let created = false;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DOC_DB_PREFIX + docId, 1);
      req.onupgradeneeded = (): void => {
        created = true;
        for (const s of [STORE_UPDATES, STORE_ALL]) {
          if (!req.result.objectStoreNames.contains(s))
            req.result.createObjectStore(s, { autoIncrement: true });
        }
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => reject(req.error);
    });
    if (!created) {
      throw new DocExistsError(docId);
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([STORE_UPDATES, STORE_ALL], 'readwrite');
      tx.objectStore(STORE_UPDATES).add(update);
      tx.objectStore(STORE_ALL).add({
        u: update,
        t: opts?.now ?? Date.now(),
      } satisfies IAuditEntry);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
      tx.onabort = (): void => reject(tx.error ?? new Error('事务中止'));
    });
  } catch (err) {
    if (created && !(err instanceof DocExistsError)) {
      // 本次新建的库写入失败——清理半成品，不留空库（下次导入误判 DOC_EXISTS）。
      //  finally 随后关库，阻塞中的 deleteDatabase 解除并完成（异步 best-effort）
      try {
        indexedDB.deleteDatabase(DOC_DB_PREFIX + docId);
      } catch {
        // best-effort：删除失败留空库，只影响该 id 复用，不损其他数据
      }
    }
    throw err;
  } finally {
    // 任何路径（含事务拒绝跳过 await 后续语句）都关库——否则 deleteDatabase 永久阻塞
    db?.close();
  }
}

/**
 * 旧版（Phase 1/2，y-indexeddb）迁移读取：库名 = docId（无前缀），store
 * 'updates'，值为增量序列。读入内存（origin=self），**不删旧库**——删除
 * 由 attach 在合并态快照落新库确认后执行（P0-5）。幂等（无旧库返回 false）。
 */
export async function readLegacyUpdates(
  docId: string,
  yDoc: Y.Doc,
  self: symbol,
): Promise<boolean> {
  let legacy: IDBDatabase | null = null;
  try {
    legacy = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(docId);
      req.onsuccess = (): void => {
        resolve(req.result.objectStoreNames.contains(STORE_UPDATES) ? req.result : null);
      };
      req.onerror = (): void => resolve(null);
      // 只读打开已存在库不应触发升级；触发说明库不存在（新建会被中止，不产生空库）
      req.onupgradeneeded = (): void => req.transaction?.abort();
    });
    if (!legacy) return false;
    const tx = legacy.transaction(STORE_UPDATES, 'readonly');
    const updates = (await reqToPromise(tx.objectStore(STORE_UPDATES).getAll())) as Array<
      Uint8Array | ArrayBuffer
    >;
    for (const u of updates) {
      Y.applyUpdate(yDoc, new Uint8Array(u), self);
    }
    return true;
  } catch {
    return false; // 迁移失败不阻塞启动（旧库保留，下次重试）
  } finally {
    legacy?.close();
  }
}
