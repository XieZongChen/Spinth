import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DbProvider } from '../platform/dataEngine/dbProvider';

/**
 * 双 store 持久化（docs/10 §7）：恢复/写入守卫/compaction/审计日志/迁移。
 * fake-indexeddb 提供完整 IndexedDB 语义（含事务原子性）。
 */

function writeWidget(doc: Y.Doc, id: string, val: string): void {
  doc.transact(() => {
    const m = new Y.Map();
    m.set('id', id);
    m.set('text', val);
    doc.getArray('widgets').push([m]);
  });
}

const flush = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

describe('写入守卫 ignoreOrigin（docs/10 §2 纪律：replay 不回写）', () => {
  it('登记的 origin apply 不落盘（审计/增量均不增长）', async () => {
    const docId = `t-ignore-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    const replayOrigin = Symbol('replay-test');
    db.ignoreOrigin(replayOrigin);

    const before = (await db.readAuditLog()).length;
    const other = new Y.Doc();
    writeWidget(other, 'rp', 'x');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), replayOrigin);
    await db.flushPendingWrites();
    expect((await db.readAuditLog()).length).toBe(before); // 回放不进审计

    // 对照：用户写（origin=null）正常落盘
    writeWidget(doc, 'usr', 'y');
    await db.flushPendingWrites();
    expect((await db.readAuditLog()).length).toBe(before + 1);
    db.dispose();
    doc.destroy();
    other.destroy();
  });
});

describe('写聚合（docs/16 P2#1，2026-09-28）', () => {
  it('窗口内多次写缓冲合并：flush 前不落盘，冲刷后顺序保持', async () => {
    const docId = `t-batch-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', '1');
    writeWidget(doc, 'b', '2');
    // 窗口内（100ms 未到）：缓冲未落盘——聚合的直接证据
    expect((await db.readAuditLog()).length).toBe(0);
    await db.flushPendingWrites();
    const log = await db.readAuditLog();
    expect(log.length).toBe(2);
    expect(log[0]!.t).toBeLessThanOrEqual(log[1]!.t);
    const replayed = new Y.Doc();
    for (const e of log) Y.applyUpdate(replayed, e.u);
    expect(
      (replayed.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id')),
    ).toEqual(['a', 'b']);
    db.dispose();
    doc.destroy();
  });

  it('pagehide 冲刷：写缓冲在页面隐藏事件时落盘', async () => {
    // node 无全局 EventTarget——装微型垫片（注册/派发走同一目标，测毕拆除）
    const target = new EventTarget();
    const g = globalThis as unknown as {
      addEventListener?: (type: string, fn: (e: Event) => void) => void;
      removeEventListener?: (type: string, fn: (e: Event) => void) => void;
      dispatchEvent?: (e: Event) => boolean;
    };
    g.addEventListener = target.addEventListener.bind(target);
    g.removeEventListener = target.removeEventListener.bind(target);
    g.dispatchEvent = target.dispatchEvent.bind(target);
    const docId = `t-pagehide-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'ph', 'v');
    expect((await db.readAuditLog()).length).toBe(0); // 仍在缓冲
    g.dispatchEvent!(new Event('pagehide'));
    await flush(30);
    expect((await db.readAuditLog()).length).toBe(1); // 已冲刷
    db.dispose();
    doc.destroy();
    delete g.addEventListener;
    delete g.removeEventListener;
    delete g.dispatchEvent;
  });

  it('visibilitychange(hidden) 冲刷：切后台时写缓冲落盘（nit#1——注册曾缺失）', async () => {
    const target = new EventTarget();
    const g = globalThis as unknown as {
      addEventListener?: (type: string, fn: (e: Event) => void) => void;
      removeEventListener?: (type: string, fn: (e: Event) => void) => void;
      dispatchEvent?: (e: Event) => boolean;
      document?: { visibilityState: string };
    };
    g.addEventListener = target.addEventListener.bind(target);
    g.removeEventListener = target.removeEventListener.bind(target);
    g.dispatchEvent = target.dispatchEvent.bind(target);
    g.document = { visibilityState: 'hidden' }; // node 无 document——垫片
    const docId = `t-vis-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'vis', 'v');
    expect((await db.readAuditLog()).length).toBe(0); // 仍在缓冲
    g.dispatchEvent!(new Event('visibilitychange'));
    await flush(30);
    expect((await db.readAuditLog()).length).toBe(1); // 已冲刷（hidden 判定通过）
    db.dispose();
    doc.destroy();
    delete g.addEventListener;
    delete g.removeEventListener;
    delete g.dispatchEvent;
    delete g.document;
  });

  it('写失败指数退避：重试延迟翻倍封顶 5s，成功复位；缓冲退回队首保序（nit#2）', async () => {
    const docId = `t-backoff-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'bk', 'v');
    const s = db as unknown as { db: IDBDatabase; retryDelayMs: number; writeBuffer: Uint8Array[] };
    const real = s.db;
    // 事务创建持续抛错（模拟配额满）：flushPendingWrites 内部 catch 不外抛
    s.db = new Proxy(real, {
      get: (t, k) =>
        k === 'transaction'
          ? () => {
              throw new Error('quota exceeded');
            }
          : Reflect.get(t, k),
    });
    await db.flushPendingWrites();
    expect(s.retryDelayMs).toBe(200); // 100 ×2
    expect(s.writeBuffer.length).toBe(1); // 失败批退回缓冲
    await db.flushPendingWrites();
    expect(s.retryDelayMs).toBe(400);
    for (let i = 0; i < 10; i++) await db.flushPendingWrites(); // 连续失败
    expect(s.retryDelayMs).toBe(5000); // 封顶
    // 恢复句柄：一次成功即复位 + 缓冲清空落盘
    s.db = real;
    await db.flushPendingWrites();
    expect(s.retryDelayMs).toBe(100);
    expect((await db.readAuditLog()).length).toBe(1);
    db.dispose();
    doc.destroy();
  });

  it('1.15 persistState$ 状态机：saved →（写入）saving →（失败）failed →（恢复成功）saved', async () => {
    const docId = `t-pstate-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    expect(db.persistState$.value).toBe('saved');
    await db.attach(docId, doc);
    writeWidget(doc, 'ps', 'v');
    expect(db.persistState$.value).toBe('saving'); // 入缓冲即 saving（100ms 聚合窗内）
    const s = db as unknown as { db: IDBDatabase };
    const real = s.db;
    s.db = new Proxy(real, {
      get: (t, k) =>
        k === 'transaction'
          ? () => {
              throw new Error('quota exceeded');
            }
          : Reflect.get(t, k),
    });
    await db.flushPendingWrites();
    expect(db.persistState$.value).toBe('failed'); // 写失败可见（此前静默）
    s.db = real;
    await db.flushPendingWrites();
    expect(db.persistState$.value).toBe('saved'); // oncomplete 后回 saved
    db.dispose();
    doc.destroy();
  });

  it('审计治理：compaction 后 allupdates 收敛为快照锚点，replay 含快照行完整恢复', async () => {
    const docId = `t-govern-${Date.now()}`;
    const doc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, doc);
    writeWidget(doc, 'a', '1');
    writeWidget(doc, 'b', '2');
    await db.compactNow(); // 冲刷 + 快照 + 审计重写
    expect((await db.readAuditLog()).length).toBe(1); // 收敛为 [快照锚点行]
    writeWidget(doc, 'c', '3');
    await db.flushPendingWrites();
    expect((await db.readAuditLog()).length).toBe(2); // 快照 + 后续增量
    db.dispose();

    // replay 语义不变：顺序 apply（快照行 + 增量行）→ 完整恢复
    const doc2 = new Y.Doc();
    const db2 = new DbProvider();
    await db2.attach(docId, doc2, { replay: true });
    expect((doc2.getArray('widgets').toArray() as Y.Map<unknown>[]).length).toBe(0);
    for (const e of await db2.readAuditLog()) Y.applyUpdate(doc2, e.u);
    const ids = (doc2.getArray('widgets').toArray() as Y.Map<unknown>[]).map((m) => m.get('id'));
    expect(ids).toEqual(['a', 'b', 'c']);
    db2.dispose();
    doc2.destroy();
  }, 15000);
});

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
});
