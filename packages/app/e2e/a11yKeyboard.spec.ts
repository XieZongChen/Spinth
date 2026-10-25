import { expect, test, type Page } from '@playwright/test';

/**
 * 键盘协议 E2E（specs/a11y-closeout §5.8，批次 B W1）：菜单遍历/触发、
 * Esc 不触发全局清选区、Shift+F10 键盘打开、菜单期快捷键闸门、Tab 序
 * （工具坞单停靠）。定位只用 data-spinth-* / role。
 */

async function openBoard(page: Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts.ready);
}

async function drawShape(page: Page): Promise<void> {
  // 与 a11y.spec 同款：建件后 cursor 模式自动回归（不按 v——建件自动开的
  // 内联编辑器会吞掉它），右键点选形状下部（避开编辑器覆盖区）
  await page.keyboard.press('r');
  await page.mouse.move(400, 250);
  await page.mouse.down();
  await page.mouse.move(520, 330, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __spinth?: { selector: { selected$: { getValue(): () => string[] } } };
    };
    return w.__spinth?.selector.selected$.getValue() ?? [];
  });
}

test('菜单遍历与触发：右键 → End → Enter 删除 → 菜单关、元素删', async ({ page }) => {
  await openBoard(page, `e2e-kb1-${Date.now()}`);
  await drawShape(page);
  expect(await selectedIds(page)).toHaveLength(1);
  await page.mouse.click(460, 315, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('role', 'menu');
  // 打开即聚焦首项（menuitem）
  const focused = page.locator('[data-spinth-context-menu] [role="menuitem"]').first();
  await expect(focused).toBeFocused();
  await page.keyboard.press('End'); // 尾项 = 删除
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await selectedIds(page)).length, { timeout: 3000 }).toBe(0);
});

test('Esc 关菜单：不清选区、焦点回 stage', async ({ page }) => {
  await openBoard(page, `e2e-kb2-${Date.now()}`);
  await drawShape(page);
  expect(await selectedIds(page)).toHaveLength(1);
  await page.mouse.click(460, 315, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // 全局 Esc 清选区未触发（菜单 stopPropagation）；元素仍在选区
  expect(await selectedIds(page)).toHaveLength(1);
  await expect(page.locator('#stage-container')).toBeFocused();
});

test('Shift+F10 键盘打开：焦点在 stage 时出菜单、首项聚焦', async ({ page }) => {
  await openBoard(page, `e2e-kb3-${Date.now()}`);
  await drawShape(page);
  const stage = page.locator('#stage-container');
  await stage.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  // 有选中 → 元素菜单
  await expect(menu).toHaveAttribute('aria-label', '元素操作');
  await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('菜单期快捷键闸门：菜单开着按 Delete 不删选中（D3）', async ({ page }) => {
  await openBoard(page, `e2e-kb4-${Date.now()}`);
  await drawShape(page);
  await page.mouse.click(460, 315, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  // 闸门静默：选中与元素原样（不是「菜单背后的选中被删掉」）
  expect(await selectedIds(page)).toHaveLength(1);
  await expect(menu).toBeVisible();
});

test('Tab 序：8 次内达 stage；工具坞单停靠；ProjectMenu 方向键可达', async ({ page }) => {
  await openBoard(page, `e2e-kb5-${Date.now()}`);
  // 顶栏 5 钮 → stage（DOM 序即 Tab 序）
  let reached = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const inStage = await page.evaluate(() => document.activeElement?.id === 'stage-container');
    if (inStage) {
      reached = true;
      break;
    }
  }
  expect(reached, '8 次 Tab 内未到达画布 stage').toBe(true);
  // stage → 下一站进工具坞（单停靠）
  await page.keyboard.press('Tab');
  const inDock = await page.evaluate(() => {
    const el = document.activeElement;
    return !!el && !!el.closest('[data-spinth-toolbar]');
  });
  expect(inDock, 'stage 后应进入工具坞').toBe(true);
  // 再 Tab 离开：下一焦点不在坞内（12+3 钮只占 1 停靠）
  await page.keyboard.press('Tab');
  const stillDock = await page.evaluate(() => {
    const el = document.activeElement;
    return !!el && !!el.closest('[data-spinth-toolbar]');
  });
  expect(stillDock, '工具坞应只占一个 Tab 停靠').toBe(false);
  // ProjectMenu（同 hook 协议，app 包消费者）：打开 → 首项聚焦 → 方向键到次项
  await page.click('[data-spinth-project-menu]');
  const pm = page.locator('[data-spinth-project-menu-panel]');
  await expect(pm).toBeVisible();
  await expect(pm.locator('[role="menuitem"]').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(pm.locator('[role="menuitem"]').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pm).toBeHidden();
});
