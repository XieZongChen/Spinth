import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { unzipSync, zipSync } from 'fflate';

/**
 * 项目文件（.spinth.zip）E2E（docs/20 §13.3）：
 * 导出/导入 round-trip（含图片）、原文档不受影响、失败注入零影响、
 * 导航前落盘、只读态、390px、零外部网络。
 * fflate 仅供测试构造/检视包（app devDependency，不进运行时 bundle）。
 */

/** 1×1 PNG（image.spec 同款） */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type Debug = {
  modelCount: number;
  vmStates: Array<Record<string, unknown>>;
};

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

/** 页面调试快照；导航间隙（__spinth 未挂/换页中）返回 null——poll 兜底重试 */
async function debug(page: Page): Promise<Debug | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __spinth?: { __debug: Debug } };
    if (!w.__spinth) return null;
    return {
      modelCount: w.__spinth.__debug.modelCount,
      vmStates: w.__spinth.__debug.vmStates,
    };
  });
}

/** modelCount 轮询值（null → -1，让 expect.poll 继续重试直到新页面就绪） */
async function modelCount(page: Page): Promise<number> {
  return (await debug(page))?.modelCount ?? -1;
}

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

/** 尾部加盐的唯一 PNG bytes（防跨 doc 内容寻址共享） */
async function uniquePngBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate((base) => {
    const bin = atob(base);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, Date.now() % 0xffffffff);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, PNG_B64);
  return Buffer.from(b64, 'base64');
}

/** 页面内粘贴 PNG（image.spec 同款合成 ClipboardEvent） */
async function pastePng(page: Page, bytes: Buffer): Promise<void> {
  await page.evaluate((u8) => {
    const dt = new DataTransfer();
    dt.items.add(new File([u8], 'x.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, new Uint8Array(bytes));
}

/** 画布中央拖出一个控件（快捷键 + 鼠标拖拽；页坐标 +44 顶栏） */
async function dragWidget(page: Page, key: string, dx = 120): Promise<void> {
  await page.keyboard.press(key);
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(200 + dx, 300 + 90, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** 放置一个带内容的 TEXT（t + 单击进编辑 + 输入 + Esc 落库，textEdit.spec 同款） */
async function placeText(page: Page, content: string): Promise<void> {
  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 400, y: 260 } });
  await page.keyboard.type(content);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

/** 菜单导出：返回下载与保存路径 */
async function exportViaMenu(page: Page): Promise<{ fileName: string; path: string }> {
  await page.getByRole('button', { name: '项目' }).click();
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  const dlPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('menuitem', { name: /导出项目/ }).click();
  const download = await dlPromise;
  const fileName = download.suggestedFilename();
  const path = `/tmp/${fileName}`;
  await download.saveAs(path);
  return { fileName, path };
}

async function importViaInput(page: Page, path: string): Promise<void> {
  await page.setInputFiles('input[data-spinth-project-import]', path);
}

/**
 * 导入成功后的导航等待：必须先等 URL 真正切走（location.assign 提交），
 * 再等新页 synced——只等 synced 会在旧页上立刻通过，随后的 goto/断言与
 * 在途导航相撞（net::ERR_ABORTED，偶红源）。返回新 docId。
 */
async function waitForImportedNav(page: Page, previousDocId: string): Promise<string> {
  await page.waitForURL(
    (url) => {
      const doc = url.searchParams.get('doc');
      return !!doc && doc !== previousDocId;
    },
    { timeout: 20_000 },
  );
  const docId = new URL(page.url()).searchParams.get('doc') ?? '';
  expect(docId).not.toBe('');
  await ready(page);
  return docId;
}

async function cleanupDoc(page: Page, docId: string): Promise<void> {
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
}

test('round-trip（含图片）：导出 → 新文档导入 → 内容/图片恢复 → reload 仍在', async ({ page }) => {
  const docId = `e2e-pf-rt-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 三个快捷键控件 + 粘贴唯一 PNG
  await dragWidget(page, 'r');
  await dragWidget(page, 's', 140);
  await placeText(page, '项目 round-trip');
  const png = await uniquePngBytes(page);
  await pastePng(page, png);
  await expect.poll(async () => await modelCount(page)).toBe(4);
  // 图片真渲染（hasSprite）
  await expect
    .poll(
      async () =>
        (await debug(page))?.vmStates.some((v) => v.type === 'IMAGE' && v.hasSprite === true) ??
        false,
    )
    .toBe(true);
  await persisted(page);

  // 导出：文件名格式（D5）；包结构符合 §4（manifest 第一、document、assets）
  const { fileName, path } = await exportViaMenu(page);
  expect(fileName).toMatch(/^spinth-e2e-pf-rt-\d+-\d{8}-\d{6}\.spinth\.zip$/);
  const zipBytes = new Uint8Array(readFileSync(path));
  const entries = unzipSync(zipBytes);
  const entryNames = Object.keys(entries);
  expect(entryNames).toContain('manifest.json');
  expect(entryNames).toContain('document.yjs');
  expect(entryNames.some((n) => /^assets\/[0-9a-f]{64}$/.test(n))).toBe(true);
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as {
    format: string;
    version: number;
    sourceDocId: string;
  };
  expect(manifest.format).toBe('spinth-project');
  expect(manifest.version).toBe(1);
  expect(manifest.sourceDocId).toBe(docId);

  // 新文档页导入 → URL 变化 → synced → 内容与图片恢复
  const importDocBase = `e2e-pf-host-${Date.now()}`;
  await page.goto(`/?doc=${importDocBase}`);
  await ready(page);
  await importViaInput(page, path);
  const importedDocId = await waitForImportedNav(page, importDocBase);
  await expect.poll(async () => await modelCount(page)).toBe(4);
  await expect
    .poll(
      async () =>
        (await debug(page))?.vmStates.some((v) => v.type === 'IMAGE' && v.hasSprite === true) ??
        false,
    )
    .toBe(true);

  // reload 后仍完整（A12）
  await page.reload();
  await ready(page);
  await expect.poll(async () => await modelCount(page)).toBe(4);

  // 原文档不受影响（A6）：回到原 doc URL，内容仍在
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await expect.poll(async () => await modelCount(page)).toBe(4);

  // e2e 卫生：清理本例产生的文档库
  await cleanupDoc(page, docId);
  await cleanupDoc(page, importDocBase);
  await cleanupDoc(page, importedDocId);
});

test('导入失败：坏 ZIP / 版本过新 / 缺资产 / 坏哈希——错误提示可见、URL 与画布不变', async ({
  page,
}) => {
  const docId = `e2e-pf-bad-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await dragWidget(page, 'r');
  await pastePng(page, await uniquePngBytes(page));
  await expect.poll(async () => await modelCount(page)).toBe(2);
  await persisted(page);

  // 先导出一份合法包作为篡改底
  const { path } = await exportViaMenu(page);
  const good = unzipSync(new Uint8Array(readFileSync(path)));
  const manifest = JSON.parse(new TextDecoder().decode(good['manifest.json']!)) as {
    document: { bytes: number; sha256: string };
    assets: Array<{ id: string; path: string; mime: string; size: number }>;
  };
  const writeZip = (
    mutate: (m: Record<string, unknown>, e: Record<string, Uint8Array>) => void,
  ) => {
    const m = JSON.parse(new TextDecoder().decode(good['manifest.json']!)) as Record<
      string,
      unknown
    >;
    const entries: Record<string, Uint8Array> = {
      'document.yjs': good['document.yjs']!,
    };
    for (const [name, bytes] of Object.entries(good)) {
      if (name.startsWith('assets/')) entries[name] = bytes;
    }
    mutate(m, entries);
    entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(m, null, 2) + '\n');
    const buf = zipSync(entries);
    const p = `/tmp/e2e-pf-tampered-${Date.now()}.spinth.zip`;
    writeFileSync(p, buf);
    return p;
  };

  const badCases: Array<{ path: string; message: RegExp }> = [];

  // 坏 ZIP：随机字节
  const garbage = `/tmp/e2e-pf-garbage-${Date.now()}.zip`;
  writeFileSync(garbage, Buffer.from('this is not a zip file'));
  badCases.push({ path: garbage, message: /已损坏或不是 spinth 项目/ });

  // 版本过新
  badCases.push({
    path: writeZip((m) => {
      m.version = 2;
    }),
    message: /版本过新/,
  });

  // 缺资产（manifest 声明、包内删除）
  badCases.push({
    path: writeZip((m, e) => {
      for (const a of manifest.assets) delete e[a.path];
      void m;
    }),
    message: /缺少图片资产/,
  });

  // 坏哈希（资产字节翻转）
  badCases.push({
    path: writeZip((m, e) => {
      const a = manifest.assets[0]!;
      const bytes = e[a.path]!;
      bytes[0] = bytes[0]! ^ 0xff;
      void m;
    }),
    message: /图片校验失败/,
  });

  const dbsBefore = await page.evaluate(() =>
    indexedDB
      .databases()
      .then((list) => list.map((d) => d.name ?? ''))
      .catch(() => [] as string[]),
  );
  const urlBefore = page.url();

  for (const bad of badCases) {
    // 打开菜单使错误提示可见（导入失败菜单保持打开，§9.2）
    await page.getByRole('button', { name: '项目' }).click();
    await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
    await importViaInput(page, bad.path);
    await expect(page.locator('[data-spinth-project-menu-panel] [role="alert"]')).toHaveText(
      bad.message,
    );
    await expect(page).toHaveURL(urlBefore); // URL 不变
    // 关菜单继续下一例
    await page.keyboard.press('Escape');
  }

  await expect.poll(async () => await modelCount(page)).toBe(2); // 原内容不变（形状 + 图片）
  const dbsAfter = await page.evaluate(() =>
    indexedDB
      .databases()
      .then((list) => list.map((d) => d.name ?? ''))
      .catch(() => [] as string[]),
  );
  expect(dbsAfter.filter((n) => n.startsWith('spinth-doc:') && !dbsBefore.includes(n))).toEqual([]);
  await cleanupDoc(page, docId);
});

test('当前文档落盘：编辑后立即导入 → 回原文档，编辑仍在（A11）', async ({ page }) => {
  const docId = `e2e-pf-flush-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await dragWidget(page, 'r');
  await expect.poll(async () => await modelCount(page)).toBe(1);
  // 不等 persisted——立即导出再导入（导出读取内存态，导入前 flush 当前文档）

  const { path } = await exportViaMenu(page);
  await importViaInput(page, path);
  const importedDocId = await waitForImportedNav(page, docId);

  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await expect.poll(async () => await modelCount(page)).toBe(1);
  await cleanupDoc(page, docId);
  await cleanupDoc(page, importedDocId);
});

test('只读态：导出可用；导入创建新画布（D6）', async ({ page }) => {
  const docId = `e2e-pf-ro-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await dragWidget(page, 'r');
  await expect.poll(async () => await modelCount(page)).toBe(1);
  await persisted(page);
  await page.evaluate(() => {
    (
      window as unknown as { __spinth: { updateEditable(v: boolean): void } }
    ).__spinth.updateEditable(false);
  });

  const { path } = await exportViaMenu(page);
  await importViaInput(page, path);
  const importedDocId = await waitForImportedNav(page, docId);
  await cleanupDoc(page, docId);
  await cleanupDoc(page, importedDocId);
});

test('390px：菜单面板在视口内、顶栏不换行（A9）', async ({ page }) => {
  const docId = `e2e-pf-390-${Date.now()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const header = page.locator('header');
  const headerBox = await header.boundingBox();
  expect(headerBox?.height).toBe(44); // 不换行

  await page.getByRole('button', { name: '项目' }).click();
  const panel = page.locator('[data-spinth-project-menu-panel]');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('menuitem', { name: /导出项目/ })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: /导入项目/ })).toBeEnabled();
  // Escape 关闭并把焦点还给按钮
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: '项目' })).toBeFocused();
  await cleanupDoc(page, docId);
});

test('零外部网络：导出与导入全程无外部请求（A8）', async ({ page }) => {
  const docId = `e2e-pf-net-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await dragWidget(page, 'r');
  await expect.poll(async () => await modelCount(page)).toBe(1);
  await persisted(page);

  const external: string[] = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') external.push(req.url());
  });

  const { path } = await exportViaMenu(page);
  await importViaInput(page, path);
  const importedDocId = await waitForImportedNav(page, docId);
  expect(external).toEqual([]);
  await cleanupDoc(page, docId);
  await cleanupDoc(page, importedDocId);
});
