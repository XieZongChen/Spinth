/** 图片生命周期 E2E（docs/19 §3-§4）：纹理共享/保活窗口/undo 复用/计数配平/自动手动重试 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import {
  imageState,
  textureProbes,
  saltedPngB64,
  pasteB64,
  removeFirstImage,
  PNG_B64,
} from './helpers/imageProbeE2e';

test('纹理共享（L2）：同图两实例一份纹理一份 URL 计数；删除进保活、到期归零', async ({ page }) => {
  const docId = `e2e-texshare-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const b64 = await saltedPngB64(page);
  await pasteB64(page, b64);
  await pasteB64(page, b64); // 同内容 → 同 assetId（storeAndAdd 内容寻址）
  await expect.poll(async () => (await imageState(page)).count, { timeout: 8_000 }).toBe(2);

  // 同图两实例：一个缓存条目 refs=2，两 VM 的 textureUid 一致且等于条目 uid
  await expect
    .poll(
      async () => {
        const p = await textureProbes(page);
        return p.loads.length === 2 && p.loads.every((l) => l.state === 'loaded')
          ? p.entries.map((e) => ({ key: e.key, refs: e.refs }))
          : [];
      },
      { timeout: 8_000 },
    )
    .toEqual([{ key: expect.stringMatching(/^[0-9a-f]{64}$/), refs: 2 }]);
  const p0 = await textureProbes(page);
  expect(p0.loads[0]!.textureUid).toBe(p0.entries[0]!.uid);
  expect(p0.loads[1]!.textureUid).toBe(p0.entries[0]!.uid);
  const leaseValues = Object.values(p0.leases);
  expect(leaseValues).toEqual([1]); // 同图 N 实例只占 1 份 URL 计数

  // 删一张：refs 2 → 1（纹理存活）；再删：进入保活窗口（refs=0/idle=true，
  // 纹理与 URL 租约保留）→ 窗口到期后条目销毁、URL 租约归还
  await removeFirstImage(page);
  await expect
    .poll(async () => (await textureProbes(page)).entries[0]?.refs ?? 0, { timeout: 5_000 })
    .toBe(1);
  await removeFirstImage(page);
  await expect
    .poll(
      async () => {
        const p = await textureProbes(page);
        const e = p.entries[0];
        return e && e.refs === 0 && e.idle ? p.keepAlive.count : -1;
      },
      { timeout: 5_000 },
    )
    .toBe(1);
  expect(Object.values((await textureProbes(page)).leases)).toEqual([1]); // 租约仍 1
  await expect
    .poll(async () => (await textureProbes(page)).entries.length, { timeout: 9_000 }) // 5s 窗口 + 余量
    .toBe(0);
  await expect
    .poll(async () => Object.keys((await textureProbes(page)).leases).length, { timeout: 9_000 })
    .toBe(0);
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('窗口内 undo 复用（L2）：删图后立即撤销——同一纹理未重新解码', async ({ page }) => {
  const docId = `e2e-texundo-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const b64 = await saltedPngB64(page);
  await pasteB64(page, b64);
  await expect.poll(async () => (await imageState(page)).count, { timeout: 8_000 }).toBe(1);
  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 8_000 })
    .toBe('loaded');
  const before = await textureProbes(page);
  const uidBefore = before.loads[0]!.textureUid;
  expect(before.entries[0]!.refs).toBe(1);

  // 删除后立即 undo（中间不插轮询——CI 停顿可能吃掉 5s 窗口；
  // uid 相同即证未重新 decode，时序无关）
  await removeFirstImage(page);
  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(async () => (await imageState(page)).count, { timeout: 8_000 }).toBe(1);
  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 8_000 })
    .toBe('loaded');
  const after = await textureProbes(page);
  expect(after.loads[0]!.textureUid).toBe(uidBefore); // 同一份 GPU 纹理
  expect(after.entries[0]!.refs).toBe(1);
  expect(after.entries[0]!.idle).toBe(false); // 窗口内被 wake 复用
  expect(after.leases[after.entries[0]!.key]).toBe(1); // URL 租约未归还过（恰 1）
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('切 src 计数配平（L1）：A 切 B 后 A 进入保活、B 恰 1；窗口到期 A 租约归零', async ({
  page,
}) => {
  const docId = `e2e-srcsw-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const b64 = await saltedPngB64(page);

  // 先入 B 资产（不入文档），再贴 A 图 → 文档一张 IMAGE(src=A)
  const srcB = await page.evaluate(async (data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, (Date.now() + 1) % 0xffffffff);
    const w = (
      window as unknown as {
        __spinth: { assetStore: { put(b: Blob): Promise<{ src: string }> } };
      }
    ).__spinth;
    const ref = await w.assetStore.put(new File([bytes], 'b.png', { type: 'image/png' }));
    return ref.src;
  }, b64);
  await pasteB64(page, b64);
  await expect.poll(async () => (await imageState(page)).count, { timeout: 8_000 }).toBe(1);
  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 8_000 })
    .toBe('loaded');
  const hashA = (await textureProbes(page)).entries[0]!.key;

  // 快速切 src → B（Yjs set → render → 加载会话切换）
  await page.evaluate((src) => {
    const w = (
      window as unknown as {
        __spinth: { engine: { yWidgets: { toArray(): Array<{ get(k: string): unknown }> } } };
      }
    ).__spinth;
    const img = w.engine.yWidgets.toArray().find((m) => m.get('type') === 'IMAGE');
    (img as unknown as { set(k: string, v: string): void }).set('src', src);
  }, srcB);
  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 8_000 })
    .toBe('loaded');
  const probes = await textureProbes(page);
  const hashB = srcB.slice('spinth-asset:'.length);
  expect(probes.loads[0]!.src).toBe(srcB);
  // A 条目进入保活窗口（refs=0/idle=true、租约仍 1），B 在租恰 1——竞态由单测
  // 确定性覆盖，此处守计数不变式
  await expect
    .poll(
      async () => {
        const p = await textureProbes(page);
        const a = p.entries.find((e) => e.key === hashA);
        return a && a.refs === 0 && a.idle && p.leases[hashA] === 1 ? p.leases[hashB] : -1;
      },
      { timeout: 8_000 },
    )
    .toBe(1);
  // A 的保活窗口到期后租约归零（B 不受影响）
  await expect
    .poll(async () => (await textureProbes(page)).leases[hashA] ?? 0, { timeout: 9_000 })
    .toBe(0);
  expect((await textureProbes(page)).leases[hashB]).toBe(1);

  await removeFirstImage(page);
  // B 删除 → 同样先进入保活窗口，到期后条目销毁、租约归零
  await expect
    .poll(async () => (await textureProbes(page)).entries.length, { timeout: 9_000 })
    .toBe(0);
  await expect
    .poll(async () => (await textureProbes(page)).leases[hashB] ?? 0, { timeout: 9_000 })
    .toBe(0);
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('自动重试（L3）：http 图前两次失败第三次成功——命中 3 次、attempts 清零', async ({ page }) => {
  const docId = `e2e-autoretry-${Date.now()}`;
  let hits = 0;
  await page.route('https://assets.spinth.test/dot.png', async (route) => {
    hits += 1;
    if (hits <= 2)
      await route.abort(); // 断网/服务抖动
    else
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' }, // crossOrigin=anonymous 需要
        body: Buffer.from(PNG_B64, 'base64'),
      });
  });
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.evaluate((url) => {
    const w = (
      window as unknown as {
        __spinth: {
          engine: {
            transact(fn: () => void): void;
            genInitialOrder(): string;
            add(d: Record<string, unknown>): void;
          };
        };
      }
    ).__spinth;
    w.engine.transact(() => {
      w.engine.add({
        id: 'w-autoretry',
        type: 'IMAGE',
        zOrder: w.engine.genInitialOrder(),
        src: url,
        x: 400,
        y: 300,
        width: 60,
        height: 40,
      });
    });
  }, 'https://assets.spinth.test/dot.png');

  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 15_000 })
    .toBe('loaded');
  expect(hits).toBe(3); // 600ms/1800ms 两次自动重试后第三次成功
  expect((await textureProbes(page)).loads[0]!.attempts).toBe(0); // 成功后清零
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('手动重试（L3）：missing 引用 → put 资产行 → 双击画布恢复显示', async ({ page }) => {
  const docId = `e2e-manual-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 预算 hash（唯一内容）：尾部盐防与既有资产同 id
  const b64 = await saltedPngB64(page);
  const hash = await page.evaluate(async (data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dg = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(dg))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }, b64);

  // 造 IMAGE src=spinth-asset:<hash>（账本无此行）→ missing 占位
  await page.evaluate((h) => {
    const w = (
      window as unknown as {
        __spinth: {
          engine: {
            transact(fn: () => void): void;
            genInitialOrder(): string;
            add(d: Record<string, unknown>): void;
          };
        };
      }
    ).__spinth;
    w.engine.transact(() => {
      w.engine.add({
        id: 'w-manual',
        type: 'IMAGE',
        zOrder: w.engine.genInitialOrder(),
        src: `spinth-asset:${h}`,
        x: 400,
        y: 300,
        width: 60,
        height: 40,
      });
    });
  }, hash);

  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 8_000 })
    .toBe('missing');
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
          }
        ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.hasSprite,
    ),
  ).toBe(false);

  // 补入同内容资产行（同 hash；等 put 落库完成再触发重试）→ 双击图中心
  await page.evaluate(async (data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const w = (
      window as unknown as { __spinth: { assetStore: { put(b: Blob): Promise<unknown> } } }
    ).__spinth;
    await w.assetStore.put(new File([bytes], 'm.png', { type: 'image/png' }));
  }, b64);
  // 双击图中心（精确换算：世界 → client，顶栏/视口平移无关）
  const at = await page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          viewport: { worldToClient(p: { x: number; y: number }): { x: number; y: number } };
        };
      }
    ).__spinth;
    return w.viewport.worldToClient({ x: 430, y: 320 });
  });
  await page.mouse.dblclick(at.x, at.y);

  await expect
    .poll(async () => (await textureProbes(page)).loads[0]?.state ?? '', { timeout: 8_000 })
    .toBe('loaded');
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
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});
