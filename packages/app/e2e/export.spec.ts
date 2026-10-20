import { expect, test, type Page } from '@playwright/test';

/**
 * 导出 PNG E2E（docs/03 §8，2026-10-14 导出批）。
 *
 * 双入口：右键画布菜单「导出画布 PNG」（整画布）+ ActionBar 公共尾部
 * 「导出 PNG」（选中集）。断言走 Playwright download 事件（extract.download
 * 内置浏览器下载）：suggestedFilename + 落盘文件非空；产物内容完整性在
 * 批末目检（sips 尺寸 + 视觉），不在用例内解码像素。
 */

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

async function dragCreateRect(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('r');
  await page.mouse.move(x, y + 44);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80 + 44, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

test('导出画布 PNG：右键菜单入口 → download 事件 + 文件非空（含视窗外被 cull 件）', async ({
  page,
}) => {
  await page.goto(`/?doc=e2e-export-canvas-${Date.now()}`);
  await ready(page);

  // 三件（全视口内建）+ 抓手 pan 把第三件移出视口触发 cull（renderable=false——
  // 导出须含它；不能直接在视口外拖建：CDP 鼠标超屏坐标失灵建不出件，zz-shoot20 坑）
  await dragCreateRect(page, 300, 200);
  await dragCreateRect(page, 500, 300);
  await dragCreateRect(page, 1100, 600);
  await page.keyboard.press('h');
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(300, 400, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150); // culling 生效（vpBounds$ 变化 → diff 翻转）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  const menu = page.locator('[data-spinth-context-menu]');
  await page.mouse.click(100, 500, { button: 'right' });
  await expect(menu).toBeVisible();
  const dlPromise = page.waitForEvent('download', { timeout: 10_000 });
  await menu.getByRole('button', { name: '导出画布 PNG' }).click();
  const download = await dlPromise;
  expect(download.suggestedFilename()).toBe('spinth-board.png');
  const path = await download.path();
  expect(path).toBeTruthy();
  // 产物存档批末目检（pan 后三件 world x 700~2020，@2x 宽应 >2600px——含被 cull 件）
  await download.saveAs('/tmp/e2e-export-canvas.png');
  expect((await import('fs')).statSync('/tmp/e2e-export-canvas.png').size).toBeGreaterThan(1000);
});

test('导出选中集 PNG：ActionBar 公共尾部 → spinth-selection.png', async ({ page }) => {
  await page.goto(`/?doc=e2e-export-sel-${Date.now()}`);
  await ready(page);

  await dragCreateRect(page, 300, 200);
  await dragCreateRect(page, 500, 300);
  await page.mouse.click(360, 280); // 选中第一件（两击进编辑风险：单击即选中——首击选中）
  await page.waitForTimeout(250);

  const dlPromise = page.waitForEvent('download', { timeout: 10_000 });
  await page.locator('[data-spinth-action-bar] button[aria-label="导出 PNG"]').click();
  const download = await dlPromise;
  expect(download.suggestedFilename()).toBe('spinth-selection.png');
  await download.saveAs('/tmp/e2e-export-sel.png');
});
