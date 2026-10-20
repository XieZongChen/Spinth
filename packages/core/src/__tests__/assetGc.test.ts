// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { AssetStore, assetSrcOf } from '../platform/dataEngine/assetStore';
import { DbProvider, scanDocAssetRefs } from '../platform/dataEngine/dbProvider';
import { collectLiveAssetRefs, runAssetGc } from '../platform/dataEngine/assetGc';

/** 资产 GC（Batch 2 二期）：mark-sweep 真链路——DbProvider 落盘 → 盘上重建扫描 */
describe('资产 GC mark-sweep', () => {
  const pngBlob = (seed: string): Blob =>
    new Blob([new Uint8Array([...seed].map((c) => c.charCodeAt(0)))], { type: 'image/png' });

  /** 造一份已落盘的文档：单 IMAGE widget 引用给定 src（transact 须在 attach
   *  之后——update 监听是 attach 挂的，之前的写不落盘） */
  async function persistDocWithImageRef(docId: string, src: string): Promise<void> {
    const yDoc = new Y.Doc();
    const db = new DbProvider();
    await db.attach(docId, yDoc);
    const arr = yDoc.getArray('widgets');
    yDoc.transact(() => {
      arr.push([
        new Y.Map<unknown>([
          ['id', 'w-gc'],
          ['type', 'IMAGE'],
          ['src', src],
        ]),
      ]);
    });
    await db.flushPendingWrites();
    db.dispose();
    yDoc.destroy();
  }

  it('孤儿清除；跨文档引用与当前文档引用保留（scanDocAssetRefs 真链路）', async () => {
    const docB = `t-gc-docB-${Date.now()}`;
    const store = new AssetStore();
    const refCur = await store.put(pngBlob('gc-cur')); // 当前 doc（内存）引用
    const refB = await store.put(pngBlob('gc-docb')); // docB（磁盘）引用
    const refOrphan = await store.put(pngBlob('gc-orphan')); // 无引用
    await persistDocWithImageRef(docB, refB.src);

    // 盘上扫描真链路：docB 重建后能取到引用
    const diskRefs = await scanDocAssetRefs(docB);
    expect(diskRefs.has(refB.id)).toBe(true);

    const res = await runAssetGc({
      assetStore: store,
      currentDocId: 't-gc-current',
      currentDocRefs: new Set([refCur.id]),
      listDocIds: () => Promise.resolve([docB, 't-gc-current']), // databases() 注入
      olderThan: Infinity, // 测试立即删（默认=会话启动基线，见下方宽限用例）
      // scanDoc 走默认真实现（盘上重建）
    });
    expect(res.skipped).toBe(false);
    expect(res.docs).toBe(1); // current 跳过，只扫 docB
    expect(res.orphans).toBeGreaterThanOrEqual(1); // 库共享有残留——相对断言
    expect(res.removed).toBeGreaterThanOrEqual(1);

    expect(await store.get(refCur.id)).not.toBeNull(); // 当前 doc 引用保留
    expect(await store.get(refB.id)).not.toBeNull(); // 跨文档引用保留
    expect(await store.get(refOrphan.id)).toBeNull(); // 孤儿清除
    store.close();
  });

  it('持活 objectURL 的孤儿跳过（渲染中不删）；databases 不可用整轮跳过', async () => {
    const store = new AssetStore();
    const refLive = await store.put(pngBlob('gc-live'));
    await store.objectURL(refLive.id); // 持活引用不 release

    const res = await runAssetGc({
      assetStore: store,
      currentDocId: 't-gc-current',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve([]),
      olderThan: Infinity,
    });
    expect(res.orphans).toBeGreaterThanOrEqual(1);
    expect(res.removed).toBe(res.orphans - 1); // 唯一持活行跳过，其余孤儿照删
    expect(await store.get(refLive.id)).not.toBeNull();
    store.releaseObjectURL(refLive.id);

    const res2 = await runAssetGc({
      assetStore: store,
      currentDocId: 't-gc-current',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve(null), // databases() 不可用
    });
    expect(res2.skipped).toBe(true);
    expect(res2.removed).toBe(0);
    store.close();
  });

  it('collectLiveAssetRefs：内存 yWidgets 收集（含非 IMAGE / data URL 排除）', () => {
    const yDoc = new Y.Doc();
    const arr = yDoc.getArray('widgets');
    const srcA = assetSrcOf('a'.repeat(64));
    const srcB = assetSrcOf('b'.repeat(64));
    yDoc.transact(() => {
      arr.push([
        new Y.Map<unknown>([
          ['id', 'w1'],
          ['type', 'IMAGE'],
          ['src', srcA],
        ]),
        new Y.Map<unknown>([
          ['id', 'w2'],
          ['type', 'IMAGE'],
          ['src', 'data:image/png;base64,xxx'], // data URL 不入引用集
        ]),
        new Y.Map<unknown>([
          ['id', 'w3'],
          ['type', 'SHAPE'], // 非 IMAGE
        ]),
      ]);
    });
    const refs = collectLiveAssetRefs(arr);
    expect(refs.size).toBe(1);
    expect(refs.has('a'.repeat(64))).toBe(true);
    expect(refs.has(srcB)).toBe(false);
    yDoc.destroy();
  });

  /** 第三轮审查：GC 安全边界三件——undo 栈非空跳过 / 孤儿宽限 / 删前重采 */
  it('安全边界：canUndo 整轮跳过；宽限期内孤儿保留；删前重采防误删', async () => {
    const store = new AssetStore();
    // canUndo：整轮跳过（不扫不删）
    const rUndo = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      canUndo: true,
      listDocIds: () => Promise.resolve([]),
      olderThan: Infinity,
    });
    expect(rUndo.skipped).toBe(true);

    // 宽限：刚 put 的孤儿（本会话/他标签未落盘引用窗口）保留——基线晚于 put
    const fresh = await store.put(pngBlob('gc-fresh'));
    const rGrace = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve([]),
      olderThan: Date.now() - 60_000, // 基线在过去——近期 put（t ≥ 基线）都保护
    });
    expect(rGrace.orphans).toBeGreaterThanOrEqual(1);
    expect(await store.get(fresh.id)).not.toBeNull(); // 宽限保留
    // 同一孤儿基线 Infinity（不限）即删
    await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve([]),
      olderThan: Infinity,
    });
    expect(await store.get(fresh.id)).toBeNull();

    // 删前重采：初始 refs 空，扫描后、删行前用户新贴图（collectCurrentRefs）
    const saved = await store.put(pngBlob('gc-rescued'));
    const rRescue = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      collectCurrentRefs: () => new Set([saved.id]), // 模拟扫描窗口内新贴
      listDocIds: () => Promise.resolve([]),
      olderThan: Infinity,
    });
    expect(await store.get(saved.id)).not.toBeNull(); // 重采救回
    expect(rRescue.removed).toBe(0);
    store.close();
  });
});
