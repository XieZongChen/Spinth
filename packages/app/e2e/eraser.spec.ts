/** 橡皮 E2E（docs/03/04）：分段橡皮一分为二/切割保组 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';

test('eraser 分段橡皮：扫过中部一分为二 + undo 一步恢复 + 全擦删除', async ({ page }) => {
  const docId = `e2e-eraser-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 画一条水平长笔画（步间 80ms 保证 60ms 采样节流出 ≥4 点）
  await page.keyboard.press('p');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  for (let x = 360; x <= 660; x += 60) {
    await page.mouse.move(x, 300, { steps: 1 });
    await page.waitForTimeout(80);
  }
  await page.mouse.up();

  const penState = () =>
    page.evaluate(() => {
      const d = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug;
      const pens = d.vmStates.filter((v) => String(v.type) === 'PEN');
      const pts = pens.reduce((n, p) => n + ((p.points as unknown[] | undefined)?.length ?? 0), 0);
      return { count: pens.length, pts };
    });
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(1);
  expect((await penState()).pts).toBeGreaterThanOrEqual(4);

  // 画笔不参与快捷创建（2026-10-08 用户拍板）：选中画笔 → 四向连接点不出现
  await page.keyboard.press('v');
  await page.mouse.click(480, 300);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { lineAnchors: unknown } } }).__spinth
              .__debug.lineAnchors,
        ),
      { timeout: 5_000 },
    )
    .toBeNull();
  await page.keyboard.press('Escape');

  // e 切橡皮，垂直扫过笔画中部（页面 y 300 = 世界 256，扫掠线穿笔画）
  await page.keyboard.press('e');
  await page.mouse.move(480, 250);
  await page.mouse.down();
  for (let y = 270; y <= 340; y += 14) {
    await page.mouse.move(480, y, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();

  // 中部被擦：一条 → 两条（分段保留）
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(2);

  // undo 一步恢复一条（拖动期间的切割事务靠 captureTimeout 窗口合并，pen 同款）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(1);

  // Escape 中途取消（拖动中按 Esc）：undo 回退本手势 + 模式不被 edit.escape 切走
  await page.mouse.move(480, 250);
  await page.mouse.down();
  for (let y = 270; y <= 310; y += 14) {
    await page.mouse.move(480, y, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.keyboard.press('Escape'); // 指针仍按住
  await page.mouse.up();
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(1); // 取消 = 未擦
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinth: { cursorMode$: { value: string } } }).__spinth.cursorMode$
          .value,
    ),
  ).toBe('eraser');

  // 全擦：沿笔画全长反复扫 → 删除（PEN 0 条）
  await page.mouse.move(300, 290);
  await page.mouse.down();
  for (let x = 320; x <= 680; x += 30) {
    await page.mouse.move(x, 290 + (x % 60 === 0 ? 10 : 0), { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.move(680, 310);
  await page.mouse.up();
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(0);

  // 大小可调（方括号）：] ×2 半径 10→18（探针断言；4~40 钳制）
  const radiusOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { __debug: { eraserRadius: number } } }).__spinth.__debug
          .eraserRadius,
    );
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await expect.poll(radiusOf, { timeout: 5_000 }).toBe(18);
  await page.keyboard.press('[');
  await expect.poll(radiusOf, { timeout: 5_000 }).toBe(14);
});

test('1.11③ eraser 切割保组：编组笔擦断后新段继承 groupId', async ({ page }) => {
  const docId = `e2e-eraser-group-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 先建一块矩形（编组需 ≥2 件）
  await page.keyboard.press('r');
  await page.mouse.move(300, 240);
  await page.mouse.down();
  await page.mouse.move(360, 280, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  // 画一笔长折线（中段可擦）
  await page.getByRole('button', { name: /画笔/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.move(700, 450, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  // 编组（框选单笔 → ActionBar 编组）
  await page.keyboard.press('v');
  await page.mouse.move(280, 220);
  await page.mouse.down();
  await page.mouse.move(760, 500, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(
    (
      await page.evaluate(
        () =>
          (window as unknown as { __spinth: { __debug: { selectedIds: string[] } } }).__spinth
            .__debug.selectedIds,
      )
    ).length,
  ).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+g'); // 快捷键入口（ActionBar 定位对笔画不稳）
  await page.waitForTimeout(300);
  const gid = (
    await page.evaluate(() => {
      const d = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug;
      return d.vmStates.filter((s) => s.type === 'PEN').map((s) => String(s.groupId ?? ''));
    })
  )[0];
  expect(gid).toBeTruthy();

  // 橡皮扫断中段（笔中点上下扫过——线宽容差内）
  await page.keyboard.press('e');
  await page.mouse.move(550, 280);
  await page.mouse.down();
  await page.mouse.move(550, 330, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  const gids = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug;
    return d.vmStates.filter((s) => s.type === 'PEN').map((s) => String(s.groupId ?? ''));
  });
  expect(gids.length).toBe(2); // 一分为二
  expect(new Set(gids).size).toBe(1); // 两段同组（修复前新段脱组）
  expect(gids[0]).toBe(gid);
});
