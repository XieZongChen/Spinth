import { expect, test, type Page } from '@playwright/test';

/**
 * IMAGE 控件链路 E2E（挂账清理 C4——此前零专项覆盖）：拖放/粘贴两条创建
 * 入口 + 长边钳制 + 选中态。入口无 DOM input（imageService 监听 container
 * 的 dragover/drop + clipboard 的 paste 检出 files）——合成事件直驱。
 */

/** 1×1 PNG（长边 1 ≤ 480 钳制上限自然满足；断言用 natural 尺寸） */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

async function imageState(
  page: Page,
): Promise<{ count: number; img: { width?: number; height?: number; srcLen?: number } | null }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: { __debug: { modelCount: number; vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinth.__debug;
    const s = d.vmStates.find((v) => v.type === 'IMAGE');
    return {
      count: d.modelCount,
      img:
        s === undefined
          ? null
          : {
              width: s.width as number,
              height: s.height as number,
              srcLen: String(s.src ?? '').length,
            },
    };
  });
}

test('拖放创建：drop 文件到画布 → IMAGE 落库 + natural 尺寸 + 选中', async ({ page }) => {
  const docId = `e2e-img-drop-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const rect = await page.locator('#stage-container').boundingBox();
  expect(rect).not.toBeNull();
  await page.evaluate(
    ({ x, y, b64 }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
      document.querySelector('#stage-container')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x: rect!.x + 400, y: rect!.y + 260, b64: PNG_B64 },
  );

  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  const st = await imageState(page);
  // 1×1 natural：宽高 1:1 落库（长边钳 480 上限内）
  expect(st.img?.width).toBe(1);
  expect(st.img?.height).toBe(1);
  expect(st.img?.srcLen).toBeGreaterThan(50); // dataURL 已落库
  // 创建即选中（ActionBar 面向选中态）
  const selected = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { selectedIds: string[] } } }).__spinth.__debug
        .selectedIds,
  );
  expect(selected).toHaveLength(1);
});

test('粘贴创建：paste 图片文件 → IMAGE 落库于视口中心', async ({ page }) => {
  const docId = `e2e-img-paste-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, PNG_B64);

  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  const st = await imageState(page);
  expect(st.img?.srcLen).toBeGreaterThan(50);
  // 真渲染断言（P0 修复配套）：贴图即出 sprite（非灰框占位）
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
});

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

/** 等盘上落盘完成（写聚合 100ms 窗口 + pagehide flush 是 best-effort——
 *  reload 前不等 saved，更新可能随页面卸载被杀，文档丢写） */
async function persisted(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __spinth: { engine: { persistState$: { getValue(): string } } };
            }
          ).__spinth.engine.persistState$.getValue(),
        ),
      { timeout: 5_000 },
    )
    .toBe('saved');
}

test('存量迁移（Batch 2 二期）：旧式 dataURL 文档 → 启动迁移改引用 + 不入 undo + 幂等', async ({
  page,
}) => {
  const docId = `e2e-mig-${Date.now()}`;
  // 第一段不开维护链（assetMaint=1 会让 requestIdleCallback 空闲即跑——抢在
  // 「造存量→读前提」之前把 dataURL 迁掉，前提断言翻车）；导航时再开启
  await page.goto(`/?doc=${docId}`);
  await ready(page);

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
  await ready(page);
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
  await ready(page);
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
  await ready(page);

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
  await ready(page);

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
  await ready(page);
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

// ---------- 生命周期专项（P1：纹理共享 / 竞态配平 / 重试） ----------

interface ImageLoadProbe {
  src: string;
  state: string;
  attempts: number;
  textureUid: number;
}

/** 纹理缓存/租约/加载会话探针（docs/19 §3-§4） */
function textureProbes(page: Page): Promise<{
  entries: Array<{ key: string; refs: number; uid: number }>;
  pending: number;
  leases: Record<string, number>;
  loads: ImageLoadProbe[];
}> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            imageTextures: {
              entries: Array<{ key: string; refs: number; uid: number }>;
              pending: number;
            };
            assetLeases: Record<string, number>;
            vmStates: Array<Record<string, unknown>>;
          };
        };
      }
    ).__spinth.__debug;
    return {
      entries: d.imageTextures.entries,
      pending: d.imageTextures.pending,
      leases: d.assetLeases,
      loads: d.vmStates.filter((v) => v.type === 'IMAGE').map((v) => v.imageLoad as ImageLoadProbe),
    };
  });
}

/** 尾部盐唯一 PNG（共用 base64 会内容寻址跨 doc 去重，计数判读须唯一化） */
function saltedPngB64(page: Page): Promise<string> {
  return page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, Date.now() % 0xffffffff);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, PNG_B64);
}

function pasteB64(page: Page, b64: string): Promise<void> {
  return page.evaluate((data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'e2e.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, b64);
}

function removeFirstImage(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          __debug: { vmStates: Array<Record<string, unknown>> };
          engine: { removeByIds(ids: string[]): void };
        };
      }
    ).__spinth;
    const img = w.__debug.vmStates.find((v) => v.type === 'IMAGE');
    if (img) w.engine.removeByIds([String(img.id)]);
  });
}

test('纹理共享（L2）：同图两实例一份纹理一份 URL 计数；删除逐张递减', async ({ page }) => {
  const docId = `e2e-texshare-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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

  // 删一张：refs 2 → 1（纹理存活）；再删：条目销毁、URL 租约归还
  await removeFirstImage(page);
  await expect
    .poll(async () => (await textureProbes(page)).entries[0]?.refs ?? 0, { timeout: 5_000 })
    .toBe(1);
  await removeFirstImage(page);
  await expect
    .poll(async () => (await textureProbes(page)).entries.length, { timeout: 5_000 })
    .toBe(0);
  await expect
    .poll(async () => Object.keys((await textureProbes(page)).leases).length, { timeout: 5_000 })
    .toBe(0);
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});

test('切 src 计数配平（L1）：A 切 B 后旧引用归零、新引用恰 1；删图归零', async ({ page }) => {
  const docId = `e2e-srcsw-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
  // 旧引用归零（条目已销毁），新引用恰 1——竞态由单测确定性覆盖，此处守计数不变式
  expect(probes.leases[hashA] ?? 0).toBe(0);
  expect(probes.leases[hashB]).toBe(1);

  await removeFirstImage(page);
  await expect
    .poll(async () => (await textureProbes(page)).entries.length, { timeout: 5_000 })
    .toBe(0);
  await expect
    .poll(async () => (await textureProbes(page)).leases[hashB] ?? 0, { timeout: 5_000 })
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
  await ready(page);
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
  await ready(page);
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
