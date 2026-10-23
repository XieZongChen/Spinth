// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AssetStore, assetIdOf, assetSrcOf, isAssetSrc } from '../platform/dataEngine/assetStore';

/** 图片资产层（Batch 2）：内容寻址去重 / 往返 / miss / objectURL 计数 */
describe('AssetStore', () => {
  const pngBlob = (seed: string): Blob =>
    new Blob([new Uint8Array([...seed].map((c) => c.charCodeAt(0)))], { type: 'image/png' });

  it('put → get 往返；同内容去重（同 id）；miss = null', async () => {
    const store = new AssetStore();
    const ref1 = await store.put(pngBlob('hello-img'));
    const ref2 = await store.put(pngBlob('hello-img')); // 同内容
    const ref3 = await store.put(pngBlob('other-img'));
    expect(ref2.id).toBe(ref1.id); // 内容寻址
    expect(ref3.id).not.toBe(ref1.id);
    expect(isAssetSrc(ref1.src)).toBe(true);
    expect(assetIdOf(ref1.src)).toBe(ref1.id);
    expect(assetSrcOf(ref1.id)).toBe(ref1.src);

    const blob = await store.get(ref1.id);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/png');
    expect(await store.get('nonexistent')).toBeNull();
    store.close();
  });

  it('objectURL 引用计数：两次取同 URL，release×2 后真释放', async () => {
    const store = new AssetStore();
    const ref = await store.put(pngBlob('url-count'));
    const u1 = await store.objectURL(ref.id);
    const u2 = await store.objectURL(ref.id);
    expect(u1).toBe(u2);
    expect(u1).toMatch(/^blob:/);
    store.releaseObjectURL(ref.id); // 还剩 1 引用——不 revoke
    const u3 = await store.objectURL(ref.id);
    expect(u3).toBe(u1);
    store.releaseObjectURL(ref.id); // 归零 revoke
    store.releaseObjectURL(ref.id); // 幂等
    store.close();
  });

  it('listIds/count/delete：删孤儿行；持活引用（objectURL 未 release）跳过', async () => {
    const store = new AssetStore();
    const before = await store.count(); // 库在同进程用例间共享——相对计数
    const refA = await store.put(pngBlob('gc-a'));
    const refB = await store.put(pngBlob('gc-b'));
    const refC = await store.put(pngBlob('gc-c'));
    const ids = await store.listIds();
    expect(ids).toContain(refA.id);
    expect(ids).toContain(refB.id);
    expect(ids).toContain(refC.id);
    expect(await store.count()).toBe(before + 3);

    // refA 持活引用（渲染中）——delete 跳过
    await store.objectURL(refA.id);
    expect(await store.delete(refA.id)).toBe(false);
    expect(await store.get(refA.id)).not.toBeNull();

    // refB 孤儿——删；refC 保留
    expect(await store.delete(refB.id)).toBe(true);
    expect(await store.get(refB.id)).toBeNull();
    expect(await store.count()).toBe(before + 2);

    // 释放后再删成功（GC 下轮语义）
    store.releaseObjectURL(refA.id);
    expect(await store.delete(refA.id)).toBe(true);
    expect(await store.count()).toBe(before + 1);
    store.close();
  });

  it('sweepOrphans：混合四类（可删/宽限内/持活/不存在）只删可删；计数正确', async () => {
    const store = new AssetStore();
    const del = await store.put(pngBlob('sw-del')); // 可删（t < 基线）
    await new Promise((r) => setTimeout(r, 3)); // 跨毫秒——del.t 严格早于基线
    const baseline = Date.now();
    const grace = await store.put(pngBlob('sw-grace')); // 宽限内（t ≥ 基线）
    const live = await store.put(pngBlob('sw-live')); // 持活（objectURL 未 release）
    await store.objectURL(live.id);
    const ghost = 'f'.repeat(64); // 行不存在（并发删除）

    const res = await store.sweepOrphans([del.id, grace.id, live.id, ghost], baseline);
    expect(res).toEqual({ removed: 1, kept: 2, gone: 1 });
    expect(await store.get(del.id)).toBeNull();
    expect(await store.get(grace.id)).not.toBeNull();
    expect(await store.get(live.id)).not.toBeNull();

    // 全部可删口径（基线在未来）：宽限/持活解除后照删
    store.releaseObjectURL(live.id);
    const res2 = await store.sweepOrphans([grace.id, live.id, ghost], Date.now() + 60_000);
    expect(res2).toEqual({ removed: 2, kept: 0, gone: 1 });
    store.close();
  });

  it('sweepOrphans：空数组 no-op；deleteIfOlderThan 委托语义保持', async () => {
    const store = new AssetStore();
    expect(await store.sweepOrphans([], 0)).toEqual({ removed: 0, kept: 0, gone: 0 });
    const ref = await store.put(pngBlob('sw-single'));
    expect(await store.deleteIfOlderThan(ref.id, Date.now() + 60_000)).toBe(true); // 可删
    expect(await store.deleteIfOlderThan(ref.id, Date.now() + 60_000)).toBe(true); // gone → true（幂等）
    store.close();
  });
});
