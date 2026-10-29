import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DbProvider } from '../platform/dataEngine/dbProvider';
import { writeWidget } from './helpers/dbProviderFixture';

/**
 * 双 store 持久化（docs/10 §7）：恢复/写入守卫/compaction/审计日志/迁移。
 * fake-indexeddb 提供完整 IndexedDB 语义（含事务原子性）。
 */

describe('Batch 2 · compaction 乐观双事务（可注入 compute）', () => {
  it("间隙写入竞态：Tx A 后他标签插一条 → U'≠U 重试 → 快照含全部数据", async () => {
    const docId = `t-opt-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', '1');
    await db.flushPendingWrites();

    // 注入假 worker compute：首次调用前（Tx A 后）向 store 塞一条模拟他标签写入
    let injected = false;
    const s = db as unknown as {
      snapshotCompute: ((u: Array<Uint8Array | ArrayBuffer>) => Promise<Uint8Array>) | null;
      db: IDBDatabase;
    };
    const realCompute = async (u: Array<Uint8Array | ArrayBuffer>): Promise<Uint8Array> => {
      if (!injected) {
        injected = true;
        const other = new Y.Doc();
        writeWidget(other, 'intruder', 'x');
        await new Promise<void>((r) => {
          const tx = s.db.transaction('updates', 'readwrite');
          tx.objectStore('updates').add(Y.encodeStateAsUpdate(other));
          tx.oncomplete = () => r();
        });
      }
      const { computeSnapshot } = await import('../platform/dataEngine/compactWorker');
      return computeSnapshot(u);
    };
    s.snapshotCompute = realCompute;

    await db.compactNow();

    // 竞态重试后落盘快照含 a + intruder
    const restored = new Y.Doc();
    const s2 = db as unknown as { readAllUpdates: () => Promise<Array<Uint8Array | ArrayBuffer>> };
    for (const u of await s2.readAllUpdates()) Y.applyUpdate(restored, new Uint8Array(u));
    const ids = (restored.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) =>
      m.get('id'),
    );
    expect(ids.sort()).toEqual(['a', 'intruder']);
    db.dispose();
    doc.destroy();
  }, 15_000);

  it('compute 抛错 → 退同步路径成功（快照完整、pendingCount=1）', async () => {
    const docId = `t-fb-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'b', '2');
    const s = db as unknown as {
      snapshotCompute: ((u: Array<Uint8Array | ArrayBuffer>) => Promise<Uint8Array>) | null;
    };
    s.snapshotCompute = () => Promise.reject(new Error('worker dead'));
    await db.compactNow(); // 不抛——退 compactSynchronous
    const restored = new Y.Doc();
    const s2 = db as unknown as { readAllUpdates: () => Promise<Array<Uint8Array | ArrayBuffer>> };
    const updates = await s2.readAllUpdates();
    expect(updates).toHaveLength(1); // 收敛为快照单行
    for (const u of updates) Y.applyUpdate(restored, new Uint8Array(u));
    expect(
      (restored.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id')),
    ).toEqual(['b']);
    db.dispose();
    doc.destroy();
  }, 15_000);
});

/** 只读写保护（docs/21 §4）：只读标签不落任何文档增量、不跑迁移写；
 *  切回可写恢复写入路径 */
