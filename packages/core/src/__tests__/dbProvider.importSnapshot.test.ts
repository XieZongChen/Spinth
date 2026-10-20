import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DbProvider,
  createDocFromSnapshot,
  DocExistsError,
} from '../platform/dataEngine/dbProvider';
import { listDocDbs } from './helpers/projectFileFixtures';

/** createDocFromSnapshot（docs/20 §5.4）：一次性创建新文档库的最小写入面 */

describe('createDocFromSnapshot', () => {
  it('新库写入一条全量 update + 一条审计；DbProvider.attach 能恢复', async () => {
    const source = new Y.Doc();
    const widgets = source.getArray('widgets');
    source.transact(() => {
      const m = new Y.Map();
      m.set('type', 'SHAPE');
      m.set('id', 's1');
      widgets.push([m]);
    });
    const snapshot = Y.encodeStateAsUpdate(source);

    await createDocFromSnapshot('snap-basic', snapshot, { now: 12345 });

    // 恢复链路与正常启动完全同构：attach → 内容一致
    const reopened = new Y.Doc({ guid: 'snap-basic' });
    const provider = new DbProvider();
    await provider.attach('snap-basic', reopened);
    expect(reopened.getArray('widgets').length).toBe(1);
    expect((reopened.getArray('widgets').get(0) as Y.Map<unknown>).get('id')).toBe('s1');
    const audit = await provider.readAuditLog();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.t).toBe(12345);
    provider.dispose();
  });

  it('已存在的库拒绝写入（DocExistsError），且不改动既有内容', async () => {
    const snapshot = Y.encodeStateAsUpdate(new Y.Doc());
    await createDocFromSnapshot('snap-exists', snapshot);
    await expect(createDocFromSnapshot('snap-exists', snapshot)).rejects.toBeInstanceOf(
      DocExistsError,
    );
    // 原库仍可正常打开（第二次调用未产生写入）
    const provider = new DbProvider();
    const doc = new Y.Doc();
    await provider.attach('snap-exists', doc);
    await expect(provider.readAuditLog()).resolves.toHaveLength(1);
    provider.dispose();
  });

  it('非法 docId 直接抛错且不开库', async () => {
    await expect(createDocFromSnapshot('bad/id!', new Uint8Array([1]))).rejects.toThrow(
      /非法 docId/,
    );
    expect(await listDocDbs()).not.toContain('spinth-doc:bad/id!');
  });

  it('写入事务失败时清理本次新建的库', async () => {
    // 注入点只打 readwrite 事务：fake-indexeddb 的 open 新库内部也走
    // db.transaction（versionchange 升级事务），无差别补丁会让 open 永不 settle
    const proto = IDBDatabase.prototype as unknown as {
      transaction: (stores: string[], mode?: string) => IDBTransaction;
    };
    const original = proto.transaction;
    let injected = false;
    proto.transaction = function injectedReadWrite(
      this: IDBDatabase,
      stores: string[],
      mode?: string,
    ): IDBTransaction {
      if (mode === 'readwrite' && !injected) {
        injected = true;
        proto.transaction = original; // 立即恢复——不污染后续内部调用
        throw new Error('注入：事务创建失败');
      }
      return original.call(this, stores, mode);
    } as unknown as typeof proto.transaction;
    try {
      await expect(
        createDocFromSnapshot('snap-tx-fail', new Uint8Array([1, 2, 3])),
      ).rejects.toThrow('注入：事务创建失败');
    } finally {
      proto.transaction = original;
    }
    // 本次新建失败 → 半成品库被清理（deleteDatabase 异步 best-effort，轮询等待）
    await expect
      .poll(async () => (await listDocDbs()).includes('spinth-doc:snap-tx-fail'), { timeout: 3000 })
      .toBe(false);
  });
});
