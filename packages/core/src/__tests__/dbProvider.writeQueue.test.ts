import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DbProvider } from '../platform/dataEngine/dbProvider';
import { writeWidget, flush } from './helpers/dbProviderFixture';

/**
 * 双 store 持久化（docs/10 §7）：恢复/写入守卫/compaction/审计日志/迁移。
 * fake-indexeddb 提供完整 IndexedDB 语义（含事务原子性）。
 */

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
    // 探针访问路径迁移：写缓冲/退避状态自 DbProvider 私有字段移入 DbWriteQueue
    // （db 字段替换 Proxy 仍有效——getDb() 闭包读 provider 实例属性）
    const s = db as unknown as {
      db: IDBDatabase;
      writeQueue: { retryDelayMs: number; buffered: number };
    };
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
    expect(s.writeQueue.retryDelayMs).toBe(200); // 100 ×2
    expect(s.writeQueue.buffered).toBe(1); // 失败批退回缓冲
    await db.flushPendingWrites();
    expect(s.writeQueue.retryDelayMs).toBe(400);
    for (let i = 0; i < 10; i++) await db.flushPendingWrites(); // 连续失败
    expect(s.writeQueue.retryDelayMs).toBe(5000); // 封顶
    // 恢复句柄：一次成功即复位 + 缓冲清空落盘
    s.db = real;
    await db.flushPendingWrites();
    expect(s.writeQueue.retryDelayMs).toBe(100);
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
