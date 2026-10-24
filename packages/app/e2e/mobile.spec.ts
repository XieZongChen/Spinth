import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOBILE,
  boxWithin,
  intersects,
  minTarget,
  noDocHScroll,
  openBoard,
} from './helpers/layoutE2e';

/**
 * 390px 移动端布局矩阵（批次 A · A3，spec §7.3）：九个浮层/铬件在
 * 390×844 全部视口内、不互相重叠、文档不横向滚动；触控目标 ≥24（WCAG
 * 2.2 AA 2.5.8），工具坞按钮另守 40×40（docs/12 设计目标）。
 * 断言只用 data-spinth-* 标记；坐标从 canvas boundingBox / __spinth 探针
 * 推导。只读提示条/存储面板/项目文件已有 390 用例（multiTab/storage/
 * projectFile spec），此处不复制。
 */

test.use({ viewport: MOBILE });

function docIdOf(tag: string): string {
  return `e2e-mob-${tag}-${Date.now()}`;
}

async function cleanupDoc(page: Page, docId: string): Promise<void> {
  await page.evaluate((id) => indexedDB.deleteDatabase(`spinth-doc:${id}`), docId);
}

test('M1 壳层：顶栏 44、长 docId 截断、按钮 ≥24、无文档横滚', async ({ page }) => {
  // 24 字符 docId：390 下胶囊必须截断而不是把顶栏撑高/撑宽
  const docId = `e2e-mob-${Date.now()}`.padEnd(24, 'x');
  await openBoard(page, docId);

  const header = page.locator('header');
  const headerBox = await header.boundingBox();
  expect(headerBox?.height).toBe(44);

  await noDocHScroll(page);

  const pill = page.locator('[data-spinth-doc-id]');
  await expect(pill).toBeVisible();
  // 确实截断（不是变宽）：内容溢出且被裁
  const pillOverflow = await pill.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(pillOverflow).toBeGreaterThan(0);

  // 所有顶栏按钮 ≥24×24（存储状态按钮曾实测约 20px 高）
  const buttons = header.locator('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i += 1) {
    await minTarget(buttons.nth(i));
  }
  await cleanupDoc(page, docId);
});

test('M2 工具坞：四边在视口内、按钮 40×40、坞内横滚、文档不横滚', async ({ page }) => {
  await openBoard(page, docIdOf('m2'));
  const dock = page.locator('[data-spinth-toolbar]');
  await expect(dock).toBeVisible();

  // 坞整体在视口内（max-w 封顶）
  await boxWithin(dock, MOBILE, 0);

  // 每个工具按钮 40×40（flex 默认 shrink 在 390 下会把 ~20 个 40px 按钮压扁）
  const btns = dock.locator('button');
  const n = await btns.count();
  expect(n).toBeGreaterThanOrEqual(11);
  for (let i = 0; i < n; i += 1) {
    const box = await btns.nth(i).boundingBox();
    expect(box, `工具坞按钮 #${i}`).not.toBeNull();
    expect(
      box!.width,
      `工具坞按钮 #${i} 宽 ${box!.width} < 40（被 flex 压缩）`,
    ).toBeGreaterThanOrEqual(39.5);
    expect(box!.height, `工具坞按钮 #${i} 高 ${box!.height} < 40`).toBeGreaterThanOrEqual(39.5);
  }

  // 390 横滚是 docs/12 的口径：坞内部横向滚动，文档不动
  const dockScroll = await dock.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(dockScroll).toBeGreaterThan(0);
  await noDocHScroll(page);
});

test('M3 二级菜单：面板在视口内（pad 8）、顶边 ≥44、切换选项不越界', async ({ page }) => {
  await openBoard(page, docIdOf('m3'));
  await page.keyboard.press('r'); // 激活形状工具 → 常驻二级菜单
  const flyout = page.locator('[data-spinth-tool-flyout]');
  await expect(flyout).toBeVisible();

  const assertFlyout = async (): Promise<void> => {
    const box = await boxWithin(flyout, MOBILE, 8);
    expect(box.y, `二级菜单顶边 ${box.y} 钻进顶栏`).toBeGreaterThanOrEqual(44);
  };
  await assertFlyout();

  // 切换到椭圆：aria-checked 转移，面板仍在视口内
  await flyout.getByRole('menuitemradio', { name: /椭圆/ }).click();
  await expect(flyout.getByRole('menuitemradio', { name: /椭圆/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await assertFlyout();
});

test('M4 缩放胶囊：在视口内、与工具坞不重叠、点击生效', async ({ page }) => {
  await openBoard(page, docIdOf('m4'));
  const zoom = page.locator('[data-spinth-zoom]');
  await expect(zoom).toBeVisible();
  const zoomBox = await boxWithin(zoom, MOBILE);

  // 与 max-md:bottom-20 的工具坞不同行也不重叠
  const dock = page.locator('[data-spinth-toolbar]');
  const dockBox = await dock.boundingBox();
  expect(dockBox, '工具坞 boundingBox').not.toBeNull();
  expect(intersects(zoomBox, dockBox!), '缩放胶囊与工具坞重叠').toBe(false);

  // 点放大：百分比文本变化（真实交互，不是只测盒子）
  const pct = zoom.locator('button[title*="适应"]');
  const before = await pct.textContent();
  await zoom.locator('button[title*="放大"]').click();
  await expect.poll(async () => pct.textContent()).not.toBe(before);
});

test('M5 项目菜单：844 与 480 高度都纵向收口、可滚、焦点归还', async ({ page }) => {
  await openBoard(page, docIdOf('m5'));
  const trigger = page.getByRole('button', { name: '项目' });
  await trigger.click();
  const panel = page.locator('[data-spinth-project-menu-panel]');
  await expect(panel).toBeVisible();

  // 390×844：右 ≤382、下 ≤836（视口内收口）
  let box = await panel.boundingBox();
  expect(box, '项目菜单面板 boundingBox').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(382.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(836.5);

  // maxHeight 有限 + overflowY 可滚（内容增长时兜底）
  const style = await panel.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
  });
  expect(style.maxHeight, `maxHeight=${style.maxHeight}（无纵向兜底）`).not.toBe('none');
  expect(['auto', 'scroll']).toContain(style.overflowY);

  // Escape 关闭且焦点回触发按钮
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  // 390×480 小高度：下边 ≤472；内容超高时可滚到末项可见
  await page.setViewportSize({ width: 390, height: 480 });
  await trigger.click();
  await expect(panel).toBeVisible();
  box = await panel.boundingBox();
  expect(box, '480 高度面板 boundingBox').not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(472.5);

  const items = panel.getByRole('menuitem');
  const last = items.last();
  await last.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const lastBox = await last.boundingBox();
  expect(lastBox, '末项 boundingBox').not.toBeNull();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(480.5);
  await page.keyboard.press('Escape');
  await page.setViewportSize(MOBILE);
});

test('M6 右键菜单：右下/左上边缘翻转都不出视口、可点适应屏幕', async ({ page }) => {
  const docId = docIdOf('m6');
  await openBoard(page, docId);
  const menu = page.locator('[data-spinth-context-menu]');

  // 视口右下角右键：常量尺寸翻转（flipX/flipY）后四边仍在视口内
  await page.mouse.click(390 - 10, 844 - 10, { button: 'right' });
  await expect(menu).toBeVisible();
  await boxWithin(menu, MOBILE);
  await menu.getByRole('button', { name: '适应屏幕' }).click();
  await expect(menu).toBeHidden();

  // 左上画布角右键（10, 顶栏 +10）：不出上边、不钻顶栏
  await page.mouse.click(10, 44 + 10, { button: 'right' });
  await expect(menu).toBeVisible();
  const box = await boxWithin(menu, MOBILE);
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.y).toBeGreaterThanOrEqual(44);
  await menu.getByRole('button', { name: '适应屏幕' }).click();
  await expect(menu).toBeHidden();
  await cleanupDoc(page, docId);
});

test('M7 操作栏 + Popover：画布右下选中后都收在视口内', async ({ page }) => {
  const docId = docIdOf('m7');
  await openBoard(page, docId);
  // 画布右下角拖一个矩形（canvas box 推导，含顶栏 44 偏移）。
  // 形状工具激活会带出常驻二级菜单（fixed portal 面板）——起点从 flyout
  // 实测 box 右侧推导避开它；终点钳在缩放胶囊（右下 ≈322-370, 791-839）
  // 与工具坞（中下）之外，鼠标悬在 DOM 浮层上时 canvas 收不到事件
  const canvasBox = await page.locator('canvas').first().boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.keyboard.press('r');
  const flyoutBox = await page.locator('[data-spinth-tool-flyout]').boundingBox();
  expect(flyoutBox).not.toBeNull();
  const startX = flyoutBox!.x + flyoutBox!.width + 12;
  const startY = Math.min(flyoutBox!.y + 24, 660);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(Math.min(startX + 120, 315), Math.min(startY + 150, 780), {
    steps: 4,
  });
  await page.mouse.up();
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar).toBeVisible();
  await boxWithin(bar, MOBILE);

  // 第一个 Popover 触发钮（颜色等）→ 面板在视口内
  const popTrigger = bar.locator('[data-spinth-popover] > button').first();
  await popTrigger.click();
  const popPanel = page.locator('[data-spinth-popover-panel]');
  await expect(popPanel).toBeVisible();
  await boxWithin(popPanel, MOBILE, 8);
  await page.keyboard.press('Escape');
  await cleanupDoc(page, docId);
});

test('M8 脑图 +/-：靠右根节点的按钮钳制在视口内、28×28', async ({ page }) => {
  const docId = docIdOf('m8');
  await openBoard(page, docId);
  // 画布右缘左侧约 90px 建根：右槽按钮天然冲出右缘（钳制的主缺陷面）
  const canvasBox = await page.locator('canvas').first().boundingBox();
  expect(canvasBox).not.toBeNull();
  const rootX = canvasBox!.x + canvasBox!.width - 90;
  const rootY = canvasBox!.y + canvasBox!.height / 2;
  await page.keyboard.press('m');
  await page.mouse.move(rootX, rootY);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);

  // 点根聚焦 → mindAddButtons 出现（根节点：左右两槽）
  const rootC = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            mindNodes: Array<{
              worldRect: { x: number; y: number; width: number; height: number };
            }>;
          };
        };
      }
    ).__spinth.__debug;
    const r = d.mindNodes[0]!;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return {
      x: r.worldRect.x + r.worldRect.width / 2 + c.left,
      y: r.worldRect.y + r.worldRect.height / 2 + c.top,
    };
  });
  await page.mouse.click(rootC.x, rootC.y);
  await page.waitForTimeout(200);

  const addBtns = page.locator('[data-spinth-mind-add]');
  const n = await addBtns.count();
  expect(n, `脑图 +/- 按钮数 ${n} < 2`).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i += 1) {
    const btn = addBtns.nth(i);
    const box = await btn.boundingBox();
    expect(box, `脑图按钮 #${i}`).not.toBeNull();
    expect(Math.abs(box!.width - 28), `脑图按钮 #${i} 宽 ${box!.width} ≠ 28`).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(box!.height - 28), `脑图按钮 #${i} 高 ${box!.height} ≠ 28`).toBeLessThanOrEqual(
      0.5,
    );
    await boxWithin(btn, MOBILE);
  }
  await cleanupDoc(page, docId);
});

test('M9 空画布提示：居中卡片在视口内、宽度 ≤ 100vw-32px', async ({ page }) => {
  const docId = docIdOf('m9');
  await openBoard(page, docId);
  const hint = page.locator('[data-spinth-empty-hint]');
  await expect(hint).toBeVisible();
  const box = await boxWithin(hint, MOBILE);
  expect(box.width, `提示卡宽 ${box.width} > 358（窄屏该换行不该溢出）`).toBeLessThanOrEqual(358.5);
  await cleanupDoc(page, docId);
});
