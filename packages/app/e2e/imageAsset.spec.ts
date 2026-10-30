/** 资产服务 E2E（docs/19）：引用入库/存量迁移/objectURL 配平/GC */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { imageState, persisted, PNG_B64 } from './helpers/imageProbeE2e';

test('资产服务（Batch 2）：贴图入资产库——src 是 spinth-asset 引用非 data URL，文档体积塌缩', async ({
  page,
}) => {
  const docId = `e2e-asset-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );

  // 驱动 = 合成 paste 事件（与既有粘贴例同款——pasteImage 是组合根回调非 SDK 命令）
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'asset-test.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth
              .__debug.modelCount,
        ),
      { timeout: 15_000 },
    )
    .toBe(1);

  const src = await page.evaluate(() =>
    String(
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.src ?? '',
    ),
  );
  expect(src).toMatch(/^spinth-asset:[0-9a-f]{64}$/); // 引用格式（sha256 hex）
  expect(src.length).toBeLessThan(100); // 文档内体积塌缩（data URL 此前是 KB 级）
  await persisted(page); // reload 前先落盘（写聚合窗口竞态，见 persisted 注释）

  // 刷新恢复：资产库持久（IndexedDB spinth-assets）+ 渲染命中（sprite 出现）
  await page.reload();
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.src ?? '',
        ),
      { timeout: 15_000 },
    )
    .toMatch(/^spinth-asset:/);
  // 真渲染断言（P0 修复配套）：sprite 已建非占位——此前只查 vmStates.length，
  // 图片链整体不可用时测试照样绿（审查实证）
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.hasSprite ?? false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  // e2e 卫生：清本例 doc 库（GC 全库扫描，防库数随回归次数累积）
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('存量迁移（Batch 2 二期）：旧式 dataURL 文档 → 启动迁移改引用 + 不入 undo + 幂等', async ({
  page,
}) => {
  const docId = `e2e-mig-${Date.now()}`;
  // 第一段不开维护链（assetMaint=1 会让 requestIdleCallback 空闲即跑——抢在
  // 「造存量→读前提」之前把 dataURL 迁掉，前提断言翻车）；导航时再开启
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 造旧式文档：engine.add 直写 data URL（Batch 2 资产路径之前的存量形态）
  await page.evaluate((b64) => {
    const w = window as unknown as {
      __spinth: {
        engine: {
          transact(fn: () => void): void;
          add(d: unknown): void;
          genInitialOrder(): string;
        };
      };
    };
    w.__spinth.engine.transact(() => {
      w.__spinth.engine.add({
        id: 'w-mig-e2e',
        type: 'IMAGE',
        zOrder: w.__spinth.engine.genInitialOrder(),
        src: `data:image/png;base64,${b64}`,
        x: 100,
        y: 100,
        width: 10,
        height: 10,
      });
    });
  }, PNG_B64);
  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  const before = await page.evaluate(() =>
    String(
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.src ?? '',
    ),
  );
  expect(before.startsWith('data:')).toBe(true); // 前提：确是存量形态
  await persisted(page); // reload 前必须落盘（否则存量随页面卸载丢）

  // 导航重启（带 assetMaint=1 开维护链）→ 启动 idle 迁移：dataURL → spinth-asset 引用
  await page.goto(`/?doc=${docId}&assetMaint=1`);
  await waitForSynced(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { lastAssetMaintenance: { migrated: number } | null };
              }
            ).__spinth.lastAssetMaintenance?.migrated ?? -1,
        ),
      { timeout: 20_000 },
    )
    .toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          String(
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.src ?? '',
          ),
        ),
      { timeout: 8_000 },
    )
    .toMatch(/^spinth-asset:[0-9a-f]{64}$/);
  // 真渲染断言：迁移改写后经 resolver 解码出 sprite（非灰框占位）
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.hasSprite ?? false,
        ),
      { timeout: 8_000 },
    )
    .toBe(true);

  // 再 reload：幂等（已无存量，migrated=0）且引用持久
  await persisted(page); // 迁移改写的 src 同样先落盘
  await page.reload();
  await waitForSynced(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { lastAssetMaintenance: { migrated: number } | null };
              }
            ).__spinth.lastAssetMaintenance?.migrated ?? -1,
        ),
      { timeout: 20_000 },
    )
    .toBe(0);
  const after = await page.evaluate(() =>
    String(
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.src ?? '',
    ),
  );
  expect(after).toMatch(/^spinth-asset:/);
  // e2e 卫生：清本例 doc 库（GC 每轮全库扫描，库数随回归次数累积会拖慢后续轮）
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('objectURL 配平回归（第三轮审查）：删图计数归零 revoke；undo 恢复计数=1', async ({ page }) => {
  const docId = `e2e-refbal-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 唯一 hash（尾部盐）——防共用 PNG 跨 doc 共享 blob 干扰计数判读
  const uniqueB64 = await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, Date.now() % 0xffffffff);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, PNG_B64);
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'refbal.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, uniqueB64);
  await expect.poll(async () => (await imageState(page)).count, { timeout: 8_000 }).toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.hasSprite ?? false,
        ),
      { timeout: 8_000 },
    )
    .toBe(true);

  const refs = (): Promise<{ refs: number; urls: number }> =>
    page.evaluate(() => {
      const store = (
        window as unknown as {
          __spinth: {
            assetStore: { objectUrlRefs: Map<string, number>; objectUrls: Map<string, string> };
          };
        }
      ).__spinth.assetStore;
      let refs = 0;
      for (const v of store.objectUrlRefs.values()) refs += v;
      return { refs, urls: store.objectUrls.size };
    });

  // 贴图渲染后：恰一组 URL 持有（该 hash 计数 1）
  let r = await refs();
  expect(r.refs).toBe(1);
  expect(r.urls).toBe(1);

  // 删除：dispose 配平——计数归零且 URL revoke（第三轮审查实证 refs 停留 1 = 泄漏）
  await page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          __debug: { selectedIds: string[] };
          engine: { removeByIds(ids: string[]): void };
        };
      }
    ).__spinth;
    w.engine.removeByIds(w.__debug.selectedIds);
  });
  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(0);
  await page.waitForTimeout(200);
  r = await refs();
  expect(r.refs).toBe(0);
  expect(r.urls).toBe(0);

  // undo 恢复：新 vm 重新持有（恰 1，非累加为 2）
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.hasSprite ?? false,
        ),
      { timeout: 8_000 },
    )
    .toBe(true);
  r = await refs();
  expect(r.refs).toBe(1);
  expect(r.urls).toBe(1);
  // e2e 卫生：清本例 doc 库
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('资产 GC（Batch 2 二期）：删图 → 下会话启动清孤儿 blob', async ({ page }) => {
  const docId = `e2e-gc-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=1`); // 维护链专项开启（同上）
  await waitForSynced(page);

  // 尾部盐唯一化：内容寻址下共用 PNG 会跨 doc 共享 blob（正确行为）——
  // GC 断言须避开：PNG 解码器忽略 IEND 后字节，sha256 仍唯一
  const uniqueB64 = await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, Date.now() % 0xffffffff);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, PNG_B64);

  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'gc-test.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, uniqueB64);
  await expect.poll(async () => (await imageState(page)).count, { timeout: 8_000 }).toBe(1);

  const src = await page.evaluate(() =>
    String(
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.src ?? '',
    ),
  );
  expect(src).toMatch(/^spinth-asset:[0-9a-f]{64}$/);
  const hash = src.slice('spinth-asset:'.length);

  // 删除该图（文档引用归零；blob 仍在库——会话内 GC 已过点不跑，undo 也安全）
  await page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          __debug: { selectedIds: string[] };
          engine: { removeByIds(ids: string[]): void };
        };
      }
    ).__spinth;
    w.engine.removeByIds(w.__debug.selectedIds);
  });
  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(0);
  await persisted(page); // 删除更新先落盘（否则 reload 后引用仍在，GC 不删）

  // reload → 启动维护链：无存量迁移，GC 清孤儿（唯一 hash 他 doc 不引用）
  await page.reload();
  await waitForSynced(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { lastAssetMaintenance: { removed: number } | null };
              }
            ).__spinth.lastAssetMaintenance?.removed ?? -1,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(1);

  // 精确断言：该 hash 行已从 spinth-assets 消失
  const exists = await page.evaluate(async (h) => {
    const db = (await new Promise((res, rej) => {
      const r = indexedDB.open('spinth-assets');
      r.onsuccess = (): void => res(r.result);
      r.onerror = (): void => rej(r.error);
    })) as IDBDatabase;
    const got = await new Promise((res) => {
      const q = db.transaction('assets', 'readonly').objectStore('assets').getKey(h);
      q.onsuccess = (): void => res(q.result);
    });
    db.close();
    return got !== undefined;
  }, hash);
  expect(exists).toBe(false);
  // e2e 卫生：清本例 doc 库（GC 全库扫描，防库数随回归次数累积）
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});
