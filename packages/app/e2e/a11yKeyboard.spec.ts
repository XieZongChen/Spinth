import { expect, test, type Page } from '@playwright/test';
import { probe } from './helpers/widgetProbeE2e';

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
      __spinth?: { selected$: { getValue(): string[] } };
    };
    return w.__spinth?.selected$.getValue() ?? [];
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

// 宿主浮层闸门（specs/a11y-closeout §13.5-1）：与右键菜单同源并入 filter，
// 面板根节点 data-spinth-ui-modal 标记 ⟺ 打开。点顶栏按钮本身会让建件残留的
// 内联编辑器失焦落库——之后 Delete 静默的唯一来源就是浮层闸门（防假绿）。
test('宿主浮层闸门：项目菜单开着 Delete/方向键全静默（§13.5-1）', async ({ page }) => {
  await openBoard(page, `e2e-kb7-${Date.now()}`);
  await drawShape(page);
  expect(await selectedIds(page), '前置：建件后应有 1 个选中').toHaveLength(1);
  await page.click('[data-spinth-project-menu]');
  const pm = page.locator('[data-spinth-project-menu-panel]');
  await expect(pm).toBeVisible();
  const before = await probe(page);
  expect(before.modelCount, '前置 modelCount 应为 1').toBe(1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const afterDelete = await probe(page);
  expect(
    afterDelete.modelCount,
    `菜单开着 Delete 后 modelCount 应仍 1（实际 ${afterDelete.modelCount}）`,
  ).toBe(1);
  expect((await selectedIds(page)).length, 'Delete 后选中应仍为 1').toBe(1);
  // 方向键同样静默：选中几何逐字段全等（闸门失效时会微移 1px）
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const afterArrow = await probe(page);
  const f1 = afterDelete.selectionFrame!;
  const f2 = afterArrow.selectionFrame!;
  expect(f2.x, `ArrowRight 后 selectionFrame.x 应不变（${f1.x} → ${f2.x}）`).toBe(f1.x);
  expect(f2.y, `ArrowRight 后 selectionFrame.y 应不变（${f1.y} → ${f2.y}）`).toBe(f1.y);
  expect(f2.width, `ArrowRight 后 selectionFrame.width 应不变（${f1.width} → ${f2.width}）`).toBe(
    f1.width,
  );
  expect(
    f2.height,
    `ArrowRight 后 selectionFrame.height 应不变（${f1.height} → ${f2.height}）`,
  ).toBe(f1.height);
  await page.keyboard.press('Escape');
  await expect(pm).toBeHidden();
});

test('宿主浮层闸门：存储面板开着按 Delete 不删（§13.5-1）', async ({ page }) => {
  await openBoard(page, `e2e-kb8-${Date.now()}`);
  await drawShape(page);
  await page.click('[data-spinth-storage-button]');
  const sp = page.locator('#spinth-storage-panel');
  await expect(sp).toBeVisible();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const p = await probe(page);
  expect(p.modelCount, `存储面板开着 Delete 后 modelCount 应仍 1（实际 ${p.modelCount}）`).toBe(1);
  expect((await selectedIds(page)).length, 'Delete 后选中应仍为 1').toBe(1);
  await page.keyboard.press('Escape');
  await expect(sp).toBeHidden();
});

test('宿主浮层闸门不残留：面板关闭后 Delete 恢复删除（§13.5-1）', async ({ page }) => {
  await openBoard(page, `e2e-kb9-${Date.now()}`);
  await drawShape(page);
  await page.click('[data-spinth-project-menu]');
  const pm = page.locator('[data-spinth-project-menu-panel]');
  await expect(pm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pm).toBeHidden();
  await page.keyboard.press('Delete');
  // 关面板后标记随条件渲染消失 → 闸门放行（防「恒 true」实现蒙混过关）
  await expect.poll(async () => (await probe(page)).modelCount, { timeout: 3000 }).toBe(0);
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

test.describe('W4 屏读语义（specs/a11y-closeout §8）', () => {
  test('画布宿主语义：application + 白板描述 + 帮助文本；canvas 隐藏；菜单关后无残留 menuitem', async ({
    page,
  }) => {
    await openBoard(page, `e2e-w4a-${Date.now()}`);
    const stage = page.locator('#stage-container');
    await expect(stage).toHaveAttribute('role', 'application');
    await expect(stage).toHaveAttribute('aria-roledescription', '白板');
    await expect(stage).toHaveAttribute('aria-label', '白板画布');
    await expect(stage).toHaveAccessibleName('白板画布');
    // 帮助文本存在且被引用（aria-describedby 指向的节点非空）
    const helpId = await stage.getAttribute('aria-describedby');
    expect(helpId).toBeTruthy();
    expect(
      await page.evaluate((id) => (document.getElementById(id)?.textContent ?? '').length, helpId!),
    ).toBeGreaterThan(10);
    // 纯渲染面：canvas 对 AT 隐藏
    expect(await page.locator('canvas[aria-hidden="true"]').count()).toBeGreaterThan(0);
    // 菜单关闭后 [role=menuitem] 不留在 Tab 序（§8.5）
    await page.mouse.click(500, 300, { button: 'right' });
    await page.keyboard.press('Escape');
    expect(await page.locator('[role="menuitem"]').count()).toBe(0);
    // 页面 h1 + main 语义
    await expect(page.locator('h1.sr-only')).toHaveText('spinth 白板');
    await expect(page.locator('main')).toHaveAttribute('aria-label', '画布区域');
  });

  test('可访问名扫描：五组控件逐个非空 + 显式 aria-label（§8.4）', async ({ page }) => {
    await openBoard(page, `e2e-w4b-${Date.now()}`);
    await drawShape(page); // 选中出 ActionBar（结束后回 cursor，flyout 已卸载）
    const groups = [
      'header button',
      '[data-spinth-toolbar] button',
      '[data-spinth-zoom] button',
      '[data-spinth-action-bar] button',
    ];
    // 显式 aria-label 断言限定规格 §8.4 点名的三组（顶栏/工具坞/缩放）——
    // 复审 P1：title 回退会让裸 title 按钮在名称断言里假绿；ActionBar 的
    // 控件名走 schema label（PopoverControl/ActionControl 自带），不在点名表
    const needsLabel = new Set([
      'header button',
      '[data-spinth-toolbar] button',
      '[data-spinth-zoom] button',
    ]);
    for (const sel of groups) {
      const loc = page.locator(sel);
      const n = await loc.count();
      expect(n, `${sel} 无按钮`).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        await expect(loc.nth(i), `${sel}[${i}]`).toHaveAccessibleName(/\S/);
        if (needsLabel.has(sel)) {
          await expect(loc.nth(i), `${sel}[${i}] 缺 aria-label`).toHaveAttribute(
            'aria-label',
            /\S/,
          );
        }
      }
    }
    // flyout 常驻面板最后扫：按 r 激活形状即出现
    await page.keyboard.press('r');
    const flyout = page.locator('[data-spinth-tool-flyout] button');
    const fn = await flyout.count();
    expect(fn, 'flyout 无按钮').toBeGreaterThan(0);
    for (let i = 0; i < fn; i++) {
      await expect(flyout.nth(i)).toHaveAccessibleName(/\S/);
    }
  });

  test('播报器：选中变化播「已选中 N 个元素」；工具切换播「当前工具」', async ({ page }) => {
    await openBoard(page, `e2e-w4c-${Date.now()}`);
    const announcer = page.locator('[data-spinth-announcer]');
    await expect(announcer).toHaveAttribute('role', 'status');
    // 首载播报（live region 常驻先于内容）
    await expect(announcer).toContainText('画布已加载');
    await drawShape(page);
    await expect(announcer).toContainText('已选中 1 个元素');
    await page.keyboard.press('p');
    await expect(announcer).toContainText('当前工具：画笔');
  });
});

test('右键已选中件不开内联编辑器（指针主键过滤显式断言，复审 P2）', async ({ page }) => {
  await openBoard(page, `e2e-kb6-${Date.now()}`);
  await drawShape(page); // 建件并保持选中——建件路径自动开的内联编辑器正开着，
  // 右键路径必须先收口它（ContextMenuService.exitEdit）且不再经「单击激活」重开
  await page.mouse.click(460, 315, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  // 右键不再走「单击激活」路径：无 contenteditable 获得焦点（此前右键会异步
  // 开出 TipTap 编辑器并抢走菜单首项聚焦，probe 实锤）
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({
    editableFocused: !!document.activeElement?.closest?.('[contenteditable]'),
    menuitemFocused: !!document.activeElement?.closest?.('[data-spinth-context-menu]'),
  }));
  expect(state.editableFocused, '右键不应打开内联编辑器').toBe(false);
  expect(state.menuitemFocused, '焦点应在菜单首项上').toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
