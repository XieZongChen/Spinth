/** 样式与缩放 E2E：SHAPE 填充边框/角手柄缩放 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, worldToScreen } from './helpers/coverageE2e';

test('SHAPE ActionBar：填充色 + 边框三态落库', async ({ page }) => {
  const docId = `e2e-shape-bar-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  expect((await probe(page)).shapes[0]!.color).toBe('#e8f0fb'); // 默认填充

  const pick = async (trigger: string, option: string): Promise<void> => {
    await page.locator(`[data-spinth-action-bar] button[aria-label="${trigger}"]`).click();
    await page
      .locator(`[data-spinth-popover-panel] button[aria-label="${option}"]`)
      .first()
      .click();
  };
  await pick('填充色', '#d1fae5');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.color, { timeout: 5000 })
    .toBe('#d1fae5');
  await pick('边框', '虚线');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.borderStyle, { timeout: 5000 })
    .toBe('dashed');
  await pick('边框', '无边框');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.borderStyle, { timeout: 5000 })
    .toBe('none');
});

test('SHAPE 缩放：角手柄拖拽改宽高（rectEditor 全链路）', async ({ page }) => {
  const docId = `e2e-resize-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;
  expect(s0.width).toBeGreaterThan(100);

  // 选中 → 东南角手柄（bounds 右下角）外拖 40×30
  const c = await worldToScreen(page, s0.x + s0.width / 2, s0.y + s0.height / 2);
  await page.mouse.click(c.x, c.y);
  const corner = await worldToScreen(page, s0.x + s0.width, s0.y + s0.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeGreaterThan(s0.width + 30);
  expect((await probe(page)).shapes[0]!.height).toBeGreaterThan(s0.height + 20);
});

// 快捷键面拆分（2026-10-17 prompt §2.3.2）：单用例耦合长链路 + 修饰键状态
// 串扰是 CI 时敏红的构成面——每例独立 page；缩放族显式 Control（不赌
// ControlOrMeta 的平台映射），每键后 poll 断言，@timing 归 nightly 层。
