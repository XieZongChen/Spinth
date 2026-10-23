// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
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

  /** P1 分片/预算/取消：注入 now/yield/shouldContinue 断言中断语义 */
  it('空资产库短路：listDocIds/scanDoc 零调用，直接返回', async () => {
    const store = new AssetStore();
    const listDocIds = vi.fn(() => Promise.resolve(['t-doc-a' as string]));
    const scanDoc = vi.fn(() => Promise.resolve(new Set<string>()));
    // 注入空 listIds（同进程共享库的其他用例可能已写行——stub 隔离顺序耦合）
    (store as unknown as { listIds: () => Promise<string[]> }).listIds = async () => [];
    const res = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds,
      scanDoc,
      olderThan: Infinity,
    });
    expect(res).toMatchObject({
      docs: 0,
      assets: 0,
      orphans: 0,
      removed: 0,
      skipped: false,
      partial: 'none',
    });
    expect(listDocIds).not.toHaveBeenCalled();
    expect(scanDoc).not.toHaveBeenCalled();
    store.close();
  });

  it('mark 阶段 shouldContinue 中断：零删除、partial=cancelled', async () => {
    const store = new AssetStore();
    const ref = await store.put(pngBlob('gc-cancel')); // 孤儿（不应被删）
    let scans = 0;
    const res = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve(['d1', 'd2', 'd3']),
      scanDoc: () => {
        scans++;
        return Promise.resolve(new Set<string>());
      },
      olderThan: Infinity,
      shouldContinue: () => scans < 2, // 第 2 篇扫描后中断 → 第 3 篇前停下
    });
    expect(res.partial).toBe('cancelled');
    expect(res.docs).toBe(2);
    expect(res.removed).toBe(0); // mark 中断 = 零删除（部分引用集不可用于删除）
    expect(await store.get(ref.id)).not.toBeNull();
    store.close();
  });

  it('mark 阶段预算耗尽：零删除、partial=budget；sweep 阶段预算耗尽：已删块保留', async () => {
    const store = new AssetStore();
    // mark 预算：now 每读 +1000，首篇前即超预算
    let clock = 0;
    const ref1 = await store.put(pngBlob('gc-b1'));
    const rMark = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve(['d1', 'd2']),
      scanDoc: () => Promise.resolve(new Set<string>()),
      olderThan: Infinity,
      now: () => (clock += 1000), // 每次读表 +1000：首篇前已 1000 ≥ 1000 预算
      budgetMs: 1000,
      yieldToMain: () => Promise.resolve(),
    });
    expect(rMark.partial).toBe('budget');
    expect(rMark.removed).toBe(0);
    expect(await store.get(ref1.id)).not.toBeNull();

    // sweep 预算：不扫文档（listDocIds=[]），单批 1 行，批间超预算
    await store.put(pngBlob('gc-b2'));
    let clock2 = 0;
    const rSweep = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve([]),
      olderThan: Infinity,
      batchSize: 1,
      now: () => (clock2 += 600), // 首批 600 < 1000 过；第二批 1200 ≥ 1000 停
      budgetMs: 1000,
      yieldToMain: () => Promise.resolve(),
    });
    expect(rSweep.partial).toBe('budget');
    expect(rSweep.removed).toBe(1); // 首块保留
    expect(rSweep.removed).toBeLessThan(rSweep.orphans); // 余量下轮
    const stillThere = (await store.listIds()).length;
    expect(stillThere).toBeGreaterThanOrEqual(1); // 非全删
    store.close();
  });

  it('协作让出：每篇扫描后一次、每块删除后一次（顺序记账）', async () => {
    const store = new AssetStore();
    const a = await store.put(pngBlob('gc-y1'));
    const b = await store.put(pngBlob('gc-y2'));
    const events: string[] = [];
    const res = await runAssetGc({
      assetStore: store,
      currentDocId: 't',
      currentDocRefs: new Set<string>(),
      listDocIds: () => Promise.resolve(['d1', 'd2']),
      scanDoc: (id) => {
        events.push(`scan:${id}`);
        return Promise.resolve(new Set<string>());
      },
      olderThan: Infinity,
      batchSize: 1,
      shouldContinue: () => true,
      yieldToMain: () => {
        events.push('yield');
        return Promise.resolve();
      },
    });
    expect(res.partial).toBe('none');
    // 前 4 事件固定（2 篇扫描各 yield 一次）；其后每删除块（batchSize=1）一次 yield
    expect(events.slice(0, 4)).toEqual(['scan:d1', 'yield', 'scan:d2', 'yield']);
    expect(events.slice(4)).toEqual(Array.from({ length: res.orphans }, () => 'yield'));
    expect(res.removed).toBe(res.orphans); // 共享库残留全清（相对断言）
    expect(await store.get(a.id)).toBeNull();
    expect(await store.get(b.id)).toBeNull();
    store.close();
  });
});
