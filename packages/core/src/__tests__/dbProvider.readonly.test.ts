import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DbProvider } from '../platform/dataEngine/dbProvider';
import { writeWidget } from './helpers/dbProviderFixture';

/**
 * 双 store 持久化（docs/10 §7）：恢复/写入守卫/compaction/审计日志/迁移。
 * fake-indexeddb 提供完整 IndexedDB 语义（含事务原子性）。
 */

describe('DbProvider 只读写保护（docs/21 §4）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('只读丢弃增量且 persistState 保持 saved（首次 warn）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const docId = `t-ro-drop-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc, { readOnly: true });
    writeWidget(doc, 'a', 'x'); // 模拟闸门漏过的写
    await db.flushPendingWrites();
    expect(await db.readAuditLog()).toHaveLength(0); // 未落盘
    expect(db.persistState$.value).toBe('saved'); // 没有真实未落盘发生
    expect(warn).toHaveBeenCalledTimes(1); // 首次提示一次，后续不再刷
    writeWidget(doc, 'b', 'y');
    await db.flushPendingWrites();
    expect(warn).toHaveBeenCalledTimes(1);
    db.dispose();
    doc.destroy();
  });

  it('切回可写后写入恢复', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const docId = `t-ro-resume-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc, { readOnly: true });
    writeWidget(doc, 'dropped', 'x'); // 只读期间被丢弃
    expect(db.persistState$.value).toBe('saved');
    db.setReadOnly(false);
    writeWidget(doc, 'kept', 'y');
    expect(db.persistState$.value).toBe('saving'); // 写路径已恢复
    await db.flushPendingWrites();
    expect(db.persistState$.value).toBe('saved');
    const log = await db.readAuditLog();
    expect(log).toHaveLength(1); // 只保留切回后的增量（被丢弃的不补落；
    // 不做「单条增量恢复出 kept」断言——Yjs 增量以被丢弃的 dropped 为 left
    // 基座，悬空属预期；真实只读场景 UI 闸门在前，不会有这种悬空增量）
    db.dispose();
    doc.destroy();
  });

  it('只读 attach 不影响恢复（数据完整读出）', async () => {
    const docId = `t-ro-restore-${Date.now()}`;
    {
      const doc = new Y.Doc();
      const db = new DbProvider();
      await db.attach(docId, doc);
      writeWidget(doc, 'a', 'hello');
      writeWidget(doc, 'b', 'world');
      await db.flushPendingWrites();
      db.dispose();
      doc.destroy();
    }
    const doc2 = new Y.Doc();
    const db2 = new DbProvider();
    await db2.attach(docId, doc2, { readOnly: true });
    expect(
      (doc2.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id')),
    ).toEqual(['a', 'b']);
    db2.dispose();
    doc2.destroy();
  });

  it('只读跳过 legacy 迁移写与删旧库（主写者完成迁移）', async () => {
    const docId = `t-ro-migrate-${Date.now()}`;
    // 手工造旧库（同迁移用例的造法）
    const oldDoc = new Y.Doc();
    writeWidget(oldDoc, 'legacy', 'old-data');
    const update = Y.encodeStateAsUpdate(oldDoc);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(docId, 1);
      req.onupgradeneeded = (): void => {
        req.result.createObjectStore('updates', { autoIncrement: true });
      };
      req.onsuccess = (): void => {
        const tx = req.result.transaction('updates', 'readwrite');
        tx.objectStore('updates').add(update);
        tx.oncomplete = (): void => {
          req.result.close();
          resolve();
        };
        tx.onerror = (): void => reject(tx.error);
      };
      req.onerror = (): void => reject(req.error);
    });

    // 只读 attach：旧库 update 应用到内存，但不写新库、不删旧库
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc, { readOnly: true });
    expect((doc.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id'))).toEqual(
      ['legacy'],
    );
    expect(await db.readAuditLog()).toHaveLength(0); // 新库未写入
    db.dispose();
    doc.destroy();
    oldDoc.destroy();
    // 旧库仍在（后续可写标签可完成迁移）
    const exists = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open(docId);
      req.onsuccess = (): void => {
        req.result.close();
        resolve(true);
      };
      req.onupgradeneeded = (): void => resolve(false);
    });
    expect(exists).toBe(true);
  });

  it('切只读冲刷已缓冲写：audit=1 且 persistState 回 saved（不滞留 saving）', async () => {
    const docId = `t-ro-flush-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', 'x'); // 100ms 写聚合窗口内——仍在缓冲
    expect(db.persistState$.value).toBe('saving');
    db.setReadOnly(true); // 切只读：setReadOnly 内部主动冲缓冲
    await expect.poll(() => db.readAuditLog(), { timeout: 3_000 }).toHaveLength(1);
    expect(db.persistState$.value).toBe('saved'); // 不滞留 saving
    db.dispose();
    doc.destroy();
  });

  it('切只读后再写仍丢弃（只拒绝新 update）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const docId = `t-ro-flush2-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', 'x');
    db.setReadOnly(true);
    await expect.poll(() => db.readAuditLog(), { timeout: 3_000 }).toHaveLength(1);
    writeWidget(doc, 'b', 'y'); // 只读期间的新写——丢弃
    await db.flushPendingWrites();
    expect(await db.readAuditLog()).toHaveLength(1); // 不涨
    expect(db.persistState$.value).toBe('saved');
    db.dispose();
    doc.destroy();
  });

  it('只读（直设私有）后 dispose 冲刷不丢——dispose 是唯一落盘入口', async () => {
    const docId = `t-ro-flush3-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', 'x');
    // 直设私有 readOnly（绕过 setReadOnly 的主动冲刷），让 dispose 的冲刷
    // 成为该增量的唯一落盘路径——真正隔离 dispose 入口
    (db as unknown as { readOnly: boolean }).readOnly = true;
    db.dispose(); // dispose 走 flushPendingWrites——不得被只读拦截
    doc.destroy();
    // 不写死等待：dispose 的冲刷与延迟关库都是异步——轮询重连读，读到即证明
    // 该增量确实经 dispose 落了盘（固定 sleep 在慢环境会假红）
    const readIds = async (): Promise<string[]> => {
      const probe = new Y.Doc();
      const probeDb = new DbProvider();
      try {
        await probeDb.attach(docId, probe);
        return (probe.getArray('widgets').toArray() as Y.Map<unknown>[]).map(
          (m) => m.get('id') as string,
        );
      } finally {
        probeDb.dispose();
        probe.destroy();
      }
    };
    await expect.poll(readIds, { timeout: 3_000 }).toEqual(['a']);
  });
});
