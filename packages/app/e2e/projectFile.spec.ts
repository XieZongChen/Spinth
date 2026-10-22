import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { unzipSync, zipSync } from 'fflate';
import {
  anyImageSprite,
  cleanupDoc,
  dragWidget,
  exportViaMenu,
  importViaInput,
  modelCount,
  pastePng,
  persisted,
  placeText,
  ready,
  setFirstImageExternal,
  textContent,
  uniquePngBytes,
  waitForImportedNav,
  widgetTypes,
} from './helpers/projectFileE2e';

/**
 * 项目文件（.spinth.zip）E2E：
 * 导出/导入 round-trip（含图片）、原文档不受影响、失败注入零影响、
 * 导航前落盘、只读态、390px、零外部网络。
 * fflate 仅供测试构造/检视包（app devDependency，不进运行时 bundle）。
 */

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
  await expect.poll(async () => anyImageSprite(page)).toBe(true);
  await persisted(page);

  // 导出：文件名格式（D5）；包结构符合 §4（manifest 第一、document、assets）
  const { fileName, path } = await exportViaMenu(page);
  expect(fileName).toMatch(/^spinth-e2e-pf-rt-\d+-\d{8}-\d{6}\.spinth\.zip$/);
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
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
  await expect.poll(async () => anyImageSprite(page)).toBe(true);
  // A3 断言补强（评审 P2-9）：类型逐件对齐 + TEXT 内容一致
  await expect
    .poll(async () => (await widgetTypes(page)).join(','))
    .toBe('IMAGE,SHAPE,STICKY,TEXT');
  await expect.poll(async () => await textContent(page)).toContain('项目 round-trip');

  // reload 后仍完整（A12）
  await page.reload();
  await ready(page);
  await expect.poll(async () => await modelCount(page)).toBe(4);
  await expect
    .poll(async () => (await widgetTypes(page)).join(','))
    .toBe('IMAGE,SHAPE,STICKY,TEXT');
  await expect.poll(async () => await textContent(page)).toContain('项目 round-trip');

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
  const badZipPaths = buildTamperedZips(path);

  const dbsBefore = await page.evaluate(() =>
    indexedDB
      .databases()
      .then((list) => list.map((d) => d.name ?? ''))
      .catch(() => [] as string[]),
  );
  const urlBefore = page.url();

  for (const bad of badZipPaths) {
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

  // 存储写入失败（评审 P2-9/A7：页面内注入 put 失败 → 用户提示可见）
  await page.getByRole('button', { name: '项目' }).click();
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as {
      __spinth: { assetStore: { put: (b: Blob) => Promise<unknown> } };
    };
    w.__spinth.assetStore.put = async () => {
      throw new Error('注入：配额不足');
    };
  });
  await importViaInput(page, path);
  await expect(page.locator('[data-spinth-project-menu-panel] [role="alert"]')).toHaveText(
    /本地存储空间不足/,
  );
  await expect(page).toHaveURL(urlBefore);
  await page.keyboard.press('Escape');
  await cleanupDoc(page, docId);
});

/** 以合法导出包为底构造四类篡改件（坏 ZIP / 版本过新 / 缺资产 / 坏哈希） */
function buildTamperedZips(goodPath: string): Array<{ path: string; message: RegExp }> {
  const good = unzipSync(new Uint8Array(readFileSync(goodPath)));
  const manifest = JSON.parse(new TextDecoder().decode(good['manifest.json']!)) as {
    assets: Array<{ path: string }>;
  };
  const writeZip = (
    mutate: (m: Record<string, unknown>, e: Record<string, Uint8Array>) => void,
  ): string => {
    const m = JSON.parse(new TextDecoder().decode(good['manifest.json']!)) as Record<
      string,
      unknown
    >;
    const entries: Record<string, Uint8Array> = { 'document.yjs': good['document.yjs']! };
    for (const [name, bytes] of Object.entries(good)) {
      if (name.startsWith('assets/')) entries[name] = bytes;
    }
    mutate(m, entries);
    entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(m, null, 2) + '\n');
    const p = `/tmp/e2e-pf-tampered-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.spinth.zip`;
    writeFileSync(p, zipSync(entries));
    return p;
  };

  const cases: Array<{ path: string; message: RegExp }> = [];
  const garbage = `/tmp/e2e-pf-garbage-${Date.now()}.zip`;
  writeFileSync(garbage, Buffer.from('this is not a zip file'));
  cases.push({ path: garbage, message: /已损坏或不是 spinth 项目/ });
  cases.push({
    path: writeZip((m) => {
      m.version = 2;
    }),
    message: /版本过新/,
  });
  cases.push({
    path: writeZip((_m, e) => {
      for (const a of manifest.assets) delete e[a.path];
    }),
    message: /缺少图片资产/,
  });
  cases.push({
    path: writeZip((_m, e) => {
      const a = manifest.assets[0]!;
      const bytes = e[a.path]!;
      bytes[0] = bytes[0]! ^ 0xff;
    }),
    message: /图片校验失败/,
  });
  // 资产条目数超限（评审 P2-9/A7：manifest 声明 257 项 → ASSET_LIMIT 提示）
  cases.push({
    path: writeZip((m) => {
      const assets = m.assets as Array<Record<string, unknown>>;
      for (let i = 0; assets.length <= 256; i++) {
        const fake = String(i).padStart(64, '0');
        assets.push({ id: fake, path: `assets/${fake}`, mime: 'image/png', size: 1 });
      }
    }),
    message: /图片超过大小限制/,
  });
  return cases;
}

test('当前文档落盘：未落盘文本编辑后立即导入 → 回原文档，编辑仍在（A11）', async ({ page }) => {
  const docId = `e2e-pf-flush-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await dragWidget(page, 'r');
  await expect.poll(async () => await modelCount(page)).toBe(1);
  await persisted(page);

  // 先备好导出文件（导入源与本例编辑无关）
  const { path } = await exportViaMenu(page);

  // 制造「未落盘」编辑：放置文本后不等 persisted（写聚合 100ms 窗口内）立即导入
  // ——导入成功前 ProjectFileService 会 flushLocalWrites 收口当前文档（§5.5）
  await placeText(page, 'flush 收口验证文本');
  await expect.poll(async () => await modelCount(page)).toBe(2);
  await importViaInput(page, path);
  const importedDocId = await waitForImportedNav(page, docId);

  // 回原文档：文本编辑不丢（flush 生效；pagehide 仅是兜底）
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await expect.poll(async () => await modelCount(page)).toBe(2);
  await expect.poll(async () => await textContent(page)).toContain('flush 收口验证文本');
  await cleanupDoc(page, docId);
  await cleanupDoc(page, importedDocId);
});

test('外链图片 warning 到达用户（D3/评审 P1-2）：导出提示未打包；导入先确认再打开', async ({
  page,
}) => {
  // 保持用例离线：外链请求止步于 Playwright 拦截层，不真发网络
  await page.route('**/x.png', (route) => route.abort());
  const docId = `e2e-pf-ext-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await dragWidget(page, 'r');
  await pastePng(page, await uniquePngBytes(page));
  await expect.poll(async () => await modelCount(page)).toBe(2);
  // 现场把 IMAGE 的 src 改为外链 URL（导出/导入两侧都应给出 warning）
  await setFirstImageExternal(page, 'https://assets.example-cdn.test/x.png');
  await persisted(page);

  // 导出：菜单保持打开并展示「外链图片未打包」（有 warning 不自动关闭）
  await page.getByRole('button', { name: '项目' }).click();
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  const dlPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('menuitem', { name: /导出项目/ }).click();
  const download = await dlPromise;
  const path = `/tmp/${download.suggestedFilename()}`;
  await download.saveAs(path);
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  await expect(page.locator('[data-spinth-project-menu-panel] [role="status"]').first()).toHaveText(
    /外链图片.*未打包/,
  );

  // 导入：显示 warning + 「打开新画布」确认（不自动导航），确认后才打开
  const hostDoc = `e2e-pf-ext-host-${Date.now()}`;
  await page.goto(`/?doc=${hostDoc}`);
  await ready(page);
  await importViaInput(page, path);
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  await expect(page.locator('[data-spinth-project-menu-panel] [role="status"]').first()).toHaveText(
    /外链图片.*未打包/,
  );

  // 「稍后」只收起菜单、不丢入口：重开菜单仍能看到 warning + 打开新画布
  await page.getByRole('button', { name: '稍后' }).click();
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeHidden();
  await page.getByRole('button', { name: '项目' }).click();
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  await expect(page.locator('[data-spinth-project-menu-panel] [role="status"]').first()).toHaveText(
    /外链图片.*未打包/,
  );

  await page.getByRole('button', { name: '打开新画布' }).click();
  const importedDocId = await waitForImportedNav(page, hostDoc);
  await expect.poll(async () => await modelCount(page)).toBe(2);

  await cleanupDoc(page, docId);
  await cleanupDoc(page, hostDoc);
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

  const headerBox = await page.locator('header').boundingBox();
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
