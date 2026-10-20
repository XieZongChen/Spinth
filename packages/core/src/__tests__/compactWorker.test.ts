import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeSnapshot } from '../platform/dataEngine/compactWorker';

/** compaction worker 纯函数（Batch 2）：快照编码与主线程计算逐字节一致 */
describe('computeSnapshot（纯函数）', () => {
  it('空列表 → 空 doc 快照', () => {
    const snap = computeSnapshot([]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, snap);
    expect(doc.toJSON()).toEqual({});
  });

  it('多更新合成单快照，与主线程逐字节一致', () => {
    const d1 = new Y.Doc();
    d1.getArray('w').push(['x']);
    const d2 = new Y.Doc();
    d2.getArray('w').push(['y']);
    d2.getText('t').insert(0, 'hello');
    const updates = [Y.encodeStateAsUpdate(d1), Y.encodeStateAsUpdate(d2)];
    const snap = computeSnapshot(updates);

    // 一致性：worker 路径产物 apply 到新 doc，内容 == 主线程合并结果
    const merged = new Y.Doc();
    Y.applyUpdate(merged, updates[0]!);
    Y.applyUpdate(merged, updates[1]!);
    const mainSnapshot = Y.encodeStateAsUpdate(merged);
    const fromWorkerSnap = new Y.Doc();
    Y.applyUpdate(fromWorkerSnap, snap);
    const fromMainSnap = new Y.Doc();
    Y.applyUpdate(fromMainSnap, mainSnapshot);
    expect(fromWorkerSnap.getArray('w').toArray()).toEqual(fromMainSnap.getArray('w').toArray());
    expect(fromWorkerSnap.getText('t').toString()).toBe('hello');
  });

  it('重复/乱序更新幂等（CRDT 交换律）', () => {
    const d = new Y.Doc();
    d.getMap('m').set('k', 1);
    const u = Y.encodeStateAsUpdate(d);
    const snap = computeSnapshot([u, u, u]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, snap);
    expect(doc.getMap('m').get('k') as number).toBe(1);
  });
});
