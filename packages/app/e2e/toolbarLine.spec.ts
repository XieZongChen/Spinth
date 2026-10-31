/** 工具坞连线菜单 E2E：默认线型/线宽双创建链（线宽笔宽批） */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import {} from './helpers/toolbarE2e';

test('line 常驻二级菜单：默认线型切换 + 双创建链（工具拉线与 quick-add 同源）', async ({
  page,
}) => {
  const docId = `e2e-toolbar-line-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const lineOf = () =>
    page.evaluate(() => {
      const l = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'LINE') as
        { lineType?: string; strokeWidth?: number } | undefined;
      return l ? `${l.lineType}:${l.strokeWidth}` : '';
    });

  // 1. 'l' 激活 → 面板现身（两组：线型 3 + 线宽 4 = 7 项，折线/2 像素线宽默认选中）
  await page.keyboard.press('l');
  await expect(flyout).toBeVisible();
  const checkedLabels = flyout.locator('button[aria-checked="true"]');
  await expect(checkedLabels).toHaveCount(2);
  await expect(checkedLabels.nth(0)).toHaveAttribute('aria-label', '折线');
  await expect(checkedLabels.nth(1)).toHaveAttribute('aria-label', '2 像素线宽');
  await expect(flyout.locator('button[role="menuitemradio"]')).toHaveCount(7);

  // 2. 切「直线」→ 聚合探针 + 选中圈移动，面板保持（line 工具建线不回 cursor）
  await flyout.locator('button[aria-label="直线"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinthDebug: {
                __debug: { defaultToolOptions: Record<string, Record<string, string>> };
              };
            }
          ).__spinthDebug.__debug.defaultToolOptions['line']?.['type'],
      ),
    )
    .toBe('STRAIGHT');
  await expect(flyout.locator('button[aria-checked="true"][aria-label="直线"]')).toHaveCount(1);
  await expect(flyout).toBeVisible();

  // 3. 工具拉线链：空白处拖一条线 → lineType = STRAIGHT
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await page.mouse.up();
  await expect.poll(lineOf).toBe('STRAIGHT:2');
  await expect(flyout).toBeVisible(); // line 建线后工具保持激活（参考同款）

  // 4. quick-add 链同源：删线 → 'r' 单击建形状 A（单击创建不回 cursor 不选中——基类
  //    仅拖拽分支选中新件回 cursor）→ Escape 回 cursor → 点选 A → hover 底边中点
  //    外移 24 连接点 → 点击 = quick-add（建线+新形状）→ 线也是 STRAIGHT
  await page.keyboard.press('ControlOrMeta+z'); // 删线
  await page.waitForTimeout(200);
  await page.keyboard.press('r');
  await page.mouse.click(450, 350); // screen → world (450,306)：A 默认 120×80 = world (390,266)-(510,346)
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // 形状工具保持激活（单击创建）——回 cursor
  await page.waitForTimeout(200);
  await page.mouse.click(450, 350); // 选中 A（连接点随之常显）
  await page.waitForTimeout(300);
  // 底边中点 world (450,346) 外移 24 → screen (450, 346+24+44) = (450,414)
  await page.mouse.move(450, 414);
  await page.waitForTimeout(250);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  // quick-add 产物：新 LINE + 新 SHAPE，线型/线宽走会话默认 STRAIGHT:2
  await expect.poll(lineOf).toBe('STRAIGHT:2');
});

test('line 线宽：flyout 第二组切档建件随宽 + ActionBar 改宽 undo 单步（线宽笔宽批）', async ({
  page,
}) => {
  const docId = `e2e-toolbar-linewidth-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const lineWidthOf = () =>
    page.evaluate(() => {
      const l = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'LINE') as
        { strokeWidth?: number } | undefined;
      return l?.strokeWidth ?? 0;
    });

  // 1. 'l' → 切宽 8 → 聚合探针 width=8 → 拉一条线 strokeWidth=8 落库（双创建链之一）
  await page.keyboard.press('l');
  await flyout.locator('button[aria-label="8 像素线宽"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinthDebug: {
                __debug: { defaultToolOptions: Record<string, Record<string, string>> };
              };
            }
          ).__spinthDebug.__debug.defaultToolOptions['line']?.['width'],
      ),
    )
    .toBe('8');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await page.mouse.up();
  await expect.poll(lineWidthOf).toBe(8);

  // 2. 选中该线 → ActionBar 线宽 popover 改 4 → 落库 4 → undo 单步回 8
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(500, 394); // 线中段 world (500,350) → screen +44
  await page.waitForTimeout(250);
  const bar = page.locator('[data-spinth-action-bar]');
  await bar.locator('button[aria-label="线宽"]').click();
  await page.locator('[data-spinth-popover-panel] button[aria-label="4 像素线宽"]').click();
  await expect.poll(lineWidthOf).toBe(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(lineWidthOf).toBe(8);
});
