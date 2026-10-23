// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { AssetStore, assetIdOf, isAssetSrc, sha256Hex } from '../platform/dataEngine/assetStore';
import { dataUrlToBlob, migrateDataUrls } from '../platform/dataEngine/assetMigration';
import { createEngineForTest } from './helpers/createEngineForTest';

/** 存量 dataURL 迁移（Batch 2 二期）：data URL → 资产引用 + blob 入库 */
describe('存量 dataURL 迁移', () => {
  // 1x1 红 png（与 E2E image.spec 同款）
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('dataUrlToBlob：mime/字节往返', () => {
    const blob = dataUrlToBlob(PNG_1PX);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(50);
    expect(() => dataUrlToBlob('https://example.com/a.png')).toThrow();
    expect(() => dataUrlToBlob('data:image/png,faulty-no-base64')).toThrow();
  });

  it('迁移：src 改引用 + blob 入库 + 不进 undo 栈 + 幂等', async () => {
    const { engine, history, dispose } = await createEngineForTest(`t-mig-${Date.now()}`);
    engine.add({
      id: 'w-mig',
      type: 'IMAGE',
      zOrder: 'a0',
      src: PNG_1PX,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    const canUndoBefore = history.canUndo$.value; // add（null origin）在栈内

    const store = new AssetStore();
    const r1 = await migrateDataUrls(engine, store);
    expect(r1.migrated).toBe(1);
    expect(r1.failed).toBe(0);

    const src = engine.getModelById('w-mig')!.toJSON() as { src: string };
    expect(isAssetSrc(src.src)).toBe(true);
    expect(src.src).toMatch(/^spinth-asset:[0-9a-f]{64}$/);
    expect(src.src.length).toBeLessThan(100);

    // blob 入库且内容寻址命中
    const blob = await store.get(assetIdOf(src.src));
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/png');

    // 维护写不进 undo 栈（栈深不变——迁移不可被用户 undo 回 data URL）
    expect(history.canUndo$.value).toBe(canUndoBefore);

    // 幂等：二跑零迁移
    const r2 = await migrateDataUrls(engine, store);
    expect(r2.migrated).toBe(0);
    const src2 = engine.getModelById('w-mig')!.toJSON() as { src: string };
    expect(src2.src).toBe(src.src); // 同值未动
    store.close();
    dispose();
  });

  it('损坏 data URL 单张跳过，不阻塞其余迁移', async () => {
    const { engine, dispose } = await createEngineForTest(`t-mig-bad-${Date.now()}`);
    engine.add({
      id: 'w-bad',
      type: 'IMAGE',
      zOrder: 'a0',
      src: 'data:image/png;base64,###not-base64###',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    engine.add({
      id: 'w-good',
      type: 'IMAGE',
      zOrder: 'a1',
      src: PNG_1PX,
      x: 20,
      y: 0,
      width: 10,
      height: 10,
    } as never);

    const store = new AssetStore();
    const r = await migrateDataUrls(engine, store);
    expect(r.failed).toBe(1);
    expect(r.migrated).toBe(1);
    const good = engine.getModelById('w-good')!.toJSON() as { src: string };
    expect(isAssetSrc(good.src)).toBe(true);
    const bad = engine.getModelById('w-bad')!.toJSON() as { src: string };
    expect(bad.src.startsWith('data:')).toBe(true); // 坏的原样保留（下轮重试）
    store.close();
    dispose();
  });

  it('批量让出：每 8 张迁移让出一次（记录节奏）', async () => {
    const { engine, dispose } = await createEngineForTest(`t-mig-yield-${Date.now()}`);
    engine.add({
      id: 'w1',
      type: 'IMAGE',
      zOrder: 'a0',
      src: PNG_1PX,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    engine.add({
      id: 'w2',
      type: 'IMAGE',
      zOrder: 'a1',
      src: 'data:image/png,faulty-no-base64', // 必 throw——不依赖 base64 长度
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    const store = new AssetStore();
    let yields = 0;
    const r = await migrateDataUrls(engine, store, {
      yieldToMain: () => {
        yields++;
        return Promise.resolve();
      },
      batchSize: 2,
    });
    expect(r.migrated).toBe(1); // w2 是损坏 data URL → failed
    expect(r.failed).toBe(1);
    expect(yields).toBe(1); // 迁移量 2（成败都计入节奏）→ 恰一次让出
    store.close();
    dispose();
  });

  it('put 之后 transact 之前中断：blob 已入库、src 未改写、cancelled', async () => {
    const { engine, dispose } = await createEngineForTest(`t-mig-putcancel-${Date.now()}`);
    engine.add({
      id: 'w1',
      type: 'IMAGE',
      zOrder: 'a0',
      src: PNG_1PX,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    const store = new AssetStore();
    const origPut = store.put.bind(store);
    let allow = true;
    // put 完成即翻转开关：命中「put 后、transact 前」的中断窗口
    vi.spyOn(store, 'put').mockImplementation(async (b: Blob) => {
      const r = await origPut(b);
      allow = false;
      return r;
    });
    const r = await migrateDataUrls(engine, store, {
      shouldContinue: () => allow,
      yieldToMain: () => Promise.resolve(),
    });
    expect(r).toEqual({ migrated: 0, failed: 0, cancelled: true });
    const src = engine.getModelById('w1')!.toJSON() as { src: string };
    expect(src.src.startsWith('data:')).toBe(true); // 未改写——下轮续
    const id = await sha256Hex(await dataUrlToBlob(PNG_1PX).arrayBuffer());
    expect(await store.get(id)).not.toBeNull(); // blob 已入库（幂等，下轮命中）
    store.close();
    dispose();
  });

  it('shouldContinue 中断：停止迁移、余量保持 data URL、返回 cancelled', async () => {
    const { engine, dispose } = await createEngineForTest(`t-mig-cancel-${Date.now()}`);
    engine.add({
      id: 'w1',
      type: 'IMAGE',
      zOrder: 'a0',
      src: PNG_1PX,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    engine.add({
      id: 'w2',
      type: 'IMAGE',
      zOrder: 'a1',
      src: PNG_1PX,
      x: 20,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    const store = new AssetStore();
    // 每项前/put 后都会查中断——桩语义改为「w1 完整迁移后停」：
    // w1 transact 落地前放行（项前+put 后两查都过），落地后 w2 项前中断
    const shouldContinue = (): boolean => {
      const w1 = engine.getModelById('w1');
      if (!w1) return true;
      return !isAssetSrc((w1.toJSON() as { src: string }).src);
    };
    const r = await migrateDataUrls(engine, store, {
      shouldContinue,
      yieldToMain: () => Promise.resolve(),
    });
    expect(r.cancelled).toBe(true);
    expect(r.migrated).toBe(1);
    const src2 = engine.getModelById('w2')!.toJSON() as { src: string };
    expect(src2.src.startsWith('data:')).toBe(true); // 余量未动，下轮续
    const src1 = engine.getModelById('w1')!.toJSON() as { src: string };
    expect(isAssetSrc(src1.src)).toBe(true);
    store.close();
    dispose();
  });
});
