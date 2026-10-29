import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DbProvider } from '../platform/dataEngine/dbProvider';
import { writeWidget, flush } from './helpers/dbProviderFixture';

/**
 * 双 store 持久化（docs/10 §7）：恢复/写入守卫/compaction/审计日志/迁移。
 * fake-indexeddb 提供完整 IndexedDB 语义（含事务原子性）。
 */

describe('DbProvider 双 store（docs/10 §7）', () => {
  it('attach → 写入 → 重新 attach 数据完整恢复', async () => {
    const docId = `t-restore-${Date.now()}`;
    {
      const doc = new Y.Doc();
      const db = new DbProvider();
      await db.attach(docId, doc);
      writeWidget(doc, 'a', 'hello');
      writeWidget(doc, 'b', 'world');
      await db.flushPendingWrites(); // 写聚合：显式冲刷（写缓冲 → IDB）
      db.dispose();
      doc.destroy();
    }
    {
      const doc2 = new Y.Doc();
      const db2 = new DbProvider();
      await db2.attach(docId, doc2);
      const items = doc2.getArray('widgets').toArray() as Y.Map<unknown>[];
      expect(items.map((m) => m.get('id'))).toEqual(['a', 'b']);
      expect((items[0] as Y.Map<unknown>).get('text')).toBe('hello');
      db2.dispose();
      doc2.destroy();
    }
  });

  it('写入守卫：恢复回流的 update 不重复落盘', async () => {
    const docId = `t-guard-${Date.now()}`;
    // 第一会话：1 次用户写 → audit 记 1 条
    {
      const doc = new Y.Doc();
      const db = new DbProvider();
      await db.attach(docId, doc);
      writeWidget(doc, 'a', 'x');
      await db.flushPendingWrites();
      db.dispose();
      doc.destroy();
    }
    // 第二会话：恢复（origin=self）不得追加 audit——长度保持 1
    {
      const doc2 = new Y.Doc();
      const db2 = new DbProvider();
      await db2.attach(docId, doc2);
      const audit = await db2.readAuditLog();
      expect(audit.length).toBe(1);
      await flush();
      expect((await db2.readAuditLog()).length).toBe(1);
      db2.dispose();
      doc2.destroy();
    }
  });

  it('审计日志：每条本地 update 记录 {u, t}，顺序保持', async () => {
    const docId = `t-audit-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', '1');
    writeWidget(doc, 'b', '2');
    await db.flushPendingWrites();
    const log = await db.readAuditLog();
    expect(log.length).toBe(2);
    expect(log[0]!.t).toBeLessThanOrEqual(log[1]!.t);
    // 审计条目可独立 apply 到新 doc 恢复同样数据（replay 语义）
    const replayed = new Y.Doc();
    for (const e of log) Y.applyUpdate(replayed, e.u);
    expect(
      (replayed.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id')),
    ).toEqual(['a', 'b']);
    db.dispose();
    doc.destroy();
  });

  it('compaction：增量超阈值后收敛为单条快照，恢复无损', async () => {
    const docId = `t-compact-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    // 501 次写（>500 阈值）→ compactNow 确定性触发（冲刷 + 快照 + 审计收敛），
    // 不与 1s debounce 赛跑（负载下 timer 延迟会让 dispose 抢在 compact 前清掉它）
    for (let i = 0; i < 501; i++) writeWidget(doc, `w${i}`, `v${i}`);
    await db.compactNow();
    db.dispose();

    const doc2 = new Y.Doc();
    const db2 = new DbProvider();
    await db2.attach(docId, doc2);
    const items = doc2.getArray('widgets').toArray() as Y.Map<unknown>[];
    expect(items.length).toBe(501);
    // updates store 应只剩 1 条快照（经恢复读到的 update 数验证）
    // 审计治理（docs/16 P2#2）：compaction 后 allupdates 收敛为 [快照锚点行]
    const audit = await db2.readAuditLog();
    expect(audit.length).toBe(1);
    db2.dispose();
    doc.destroy();
    doc2.destroy();
  }, 15000);

  it('迁移：旧版 y-indexeddb 库（库名=docId）导入后删除', async () => {
    const docId = `t-migrate-${Date.now()}`;
    // 手工造旧库：库名 docId，store 'updates'，一条 update 数据
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

    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    const items = doc.getArray('widgets').toArray() as Y.Map<unknown>[];
    expect(items.map((m) => m.get('id'))).toEqual(['legacy']);
    await flush();
    db.dispose();
    doc.destroy();
    oldDoc.destroy();
    // 旧库已删（open 触发 upgradeneeded = 不存在）
    const exists = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open(docId);
      req.onupgradeneeded = (): void => {
        req.transaction?.abort();
        resolve(false);
      };
      req.onsuccess = (): void => {
        req.result.close();
        resolve(true);
      };
    });
    expect(exists).toBe(false);
  });

  it('P0-5 迁移后二次 attach 数据在位：合并态快照落新库后才删旧库', async () => {
    const docId = `t-migrate2-${Date.now()}`;
    // 造旧库（同上用例）
    const oldDoc = new Y.Doc();
    writeWidget(oldDoc, 'legacy-1', 'old-data');
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

    // 首次 attach：迁移 + 在迁移态之上写一条新编辑
    {
      const doc = new Y.Doc();
      const db = new DbProvider();
      await db.attach(docId, doc);
      writeWidget(doc, 'post-migrate', 'new');
      await db.flushPendingWrites();
      db.dispose();
      doc.destroy();
    }
    // 二次 attach（修复前：新库空 + 旧库已删 → 连迁移后的新编辑一并读不出）
    const doc2 = new Y.Doc();
    const db2 = new DbProvider();
    await db2.attach(docId, doc2);
    const ids = (doc2.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id'));
    expect(ids.sort()).toEqual(['legacy-1', 'post-migrate']);
    db2.dispose();
    doc2.destroy();
    oldDoc.destroy();
  }, 15000);

  it('P0-4 双活标签 compaction 不互删：A compact 前在同一事务内重读合并 B 已落盘增量', async () => {
    const docId = `t-dual-live-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new DbProvider();
    const b = new DbProvider();
    await a.attach(docId, docA);
    await b.attach(docId, docB); // 双活：各自持有独立 Y.Doc、共享同一 IndexedDB

    writeWidget(docA, 'A1', 'a');
    await a.flushPendingWrites(); // A1 落盘
    writeWidget(docB, 'B1', 'b');
    await b.flushPendingWrites(); // B1 落盘（A 的内存 doc 不可见）

    await a.compactNow(); // 修复前：快照只含 A 内存态 → clear 抹掉 B1

    const docC = new Y.Doc();
    const c = new DbProvider();
    await c.attach(docId, docC);
    const ids = (docC.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id'));
    expect(ids.sort()).toEqual(['A1', 'B1']); // 修复前 B1 永久丢失
    c.dispose();
    docC.destroy();
    a.dispose();
    b.dispose();
    docA.destroy();
    docB.destroy();
  }, 15000);
});

describe('replay 模式（docs/10 §6）', () => {
  it('replay=true 跳过普通恢复；审计日志 apply 恢复同等数据', async () => {
    const docId = `t-replay-${Date.now()}`;
    // 先正常写入两条 update
    const log: Array<{ u: Uint8Array; t: number }> = [];
    {
      const doc = new Y.Doc();
      const db = new DbProvider();
      await db.attach(docId, doc);
      writeWidget(doc, 'r1', 'a');
      writeWidget(doc, 'r2', 'b');
      await db.flushPendingWrites();
      log.push(...(await db.readAuditLog()));
      db.dispose();
      doc.destroy();
    }
    expect(log.length).toBe(2);
    // replay 模式 attach：不 apply 普通恢复
    {
      const doc2 = new Y.Doc();
      const db2 = new DbProvider();
      await db2.attach(docId, doc2, { replay: true });
      expect((doc2.getArray('widgets').toArray() as Y.Map<unknown>[]).length).toBe(0); // 未恢复
      // 手动回放审计（engine.replayFromAudit 等价路径）
      for (const e of log) Y.applyUpdate(doc2, e.u);
      const items = doc2.getArray('widgets').toArray() as Y.Map<unknown>[];
      expect(items.map((m) => m.get('id'))).toEqual(['r1', 'r2']);
      db2.dispose();
      doc2.destroy();
    }
  });
});
