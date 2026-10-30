/** 撤销/图层 E2E：redo 全链路/图层换序 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, worldToScreen } from './helpers/coverageE2e';

test('redo 全链路：undo → redo 恢复位移与元素（栈互转）', async ({ page }) => {
  const docId = `e2e-redo-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const afterCreate = await probe(page);
  const x0 = afterCreate.shapes[0]!.x;

  // 拖动 +140 → undo → redo（位移恢复）
  const c = await worldToScreen(page, x0 + 60, afterCreate.shapes[0]!.y + 40);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 140, c.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).shapes[0]!.x).toBeGreaterThan(x0 + 100);
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.x, { timeout: 5000 })
    .toBeCloseTo(x0, 1);
  await page.keyboard.press('ControlOrMeta+Shift+z'); // redo
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.x, { timeout: 5000 })
    .toBeGreaterThan(x0 + 100);

  // 删除 → undo → redo（元素恢复与消失）
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await probe(page)).count).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await probe(page)).count).toBe(0);
});

test('图层操作：bringToFront/sendToBack 与 forward/backward 换 zOrder', async ({ page }) => {
  const docId = `e2e-layer-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 400, y: 250 } });
  await page.mouse.down();
  await page.mouse.move(560, 370, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 700, y: 250 } });
  await page.mouse.down();
  await page.mouse.move(860, 370, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(2);

  // 拖 b 与 a 重叠（forward/backward 仅对空间重叠元素生效——layerOps 语义）
  const before = await probe(page);
  const a = before.shapes[0]!;
  const b = before.shapes[1]!;
  const bCenter = await worldToScreen(page, b.x + b.width / 2, b.y + b.height / 2);
  const overlapPt = await worldToScreen(page, a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.move(bCenter.x, bCenter.y);
  await page.mouse.down();
  await page.mouse.move(overlapPt.x, overlapPt.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const p = await probe(page);
        const bb = p.shapes.find((sh) => sh.id === b.id)!;
        return Math.abs(bb.x - (a.x + a.width / 2 - b.width / 2)) < 2;
      },
      { timeout: 5000 },
    )
    .toBe(true);

  // b 拖到 a 上方成为顶层——选 b（点重叠中心即顶层）做 forward/backward 往返
  const overlapCenter = await worldToScreen(page, a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.click(overlapCenter.x, overlapCenter.y);
  const zOf = async (id: string): Promise<string> =>
    (await probe(page)).shapes.find((sh) => sh.id === id)?.zOrder ?? '';
  const sel = async (): Promise<string> => String((await probe(page)).selected[0] ?? '');
  await expect.poll(sel, { timeout: 5000 }).toBe(b.id);
  expect(await zOf(b.id)).toBe(b.zOrder);

  // 注：Cmd+]/[ 被 macOS Chrome 拦为历史导航（浏览器级冲突）——键路径无法在
  // E2E 驱动；走 SDK 命令（与快捷键 handler 同一入口 app.sendBackward）
  await page.evaluate(() =>
    (window as unknown as { __spinth: { sendBackward(): void } }).__spinth.sendBackward(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).not.toBe(b.zOrder);
  expect((await zOf(b.id)) < a.zOrder).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { __spinth: { bringForward(): void } }).__spinth.bringForward(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).toBe(b.zOrder);

  // 置顶/置底（front/back 无重叠要求）
  await page.evaluate(() =>
    (window as unknown as { __spinth: { sendToBack(): void } }).__spinth.sendToBack(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).not.toBe(b.zOrder);
  await page.evaluate(() =>
    (window as unknown as { __spinth: { bringToFront(): void } }).__spinth.bringToFront(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).toBe(b.zOrder);
});
