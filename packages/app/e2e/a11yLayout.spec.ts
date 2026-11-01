import { expect, test, type Page } from '@playwright/test';
import {
  COMPACT,
  HEADER_H,
  MOBILE,
  ZOOM_200,
  applySafeArea,
  assertNoTextClip,
  boxWithin,
  minTarget,
  noDocHScroll,
  openBoard,
} from './helpers/layoutE2e';

/**
 * WCAG 1.4.4 / 1.4.10 / 安全区布局矩阵（specs/a11y-closeout §7）。
 * 断言纪律：data-spinth-* 定位、boundingBox 实测、独立 test.use 视口
 * （不污染 mobile.spec 的 390 基线）。工具坞内部横向滚动属于工具栏自身的
 * 可滚动区域——页面级仍断言无二维滚动（§3.3 豁免边界）。
 * #stage-container 豁免（白板内容必须二维布局才有意义，§3.3）。
 */

async function drawShape(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.keyboard.press('r');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('v'); // 回选择工具：保持选中 + 右键菜单 modeGuard 放行
  await page.waitForTimeout(200);
}

test.describe('Z1 720×450（页面缩放 200% 代理，WCAG 1.4.4）', () => {
  test.use({ viewport: ZOOM_200 });

  test('Z1-a 壳层与面板：顶栏/工具坞/缩放胶囊/项目菜单/存储面板四边在视口', async ({ page }) => {
    await openBoard(page, `e2e-z1a-${Date.now()}`);
    const header = page.locator('header');
    expect(Math.round((await header.boundingBox())!.height)).toBe(HEADER_H);
    // 顶栏按钮 ≥24×24 且在视口内（钳制后不越界）
    const btns = header.locator('button');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      await boxWithin(btns.nth(i), ZOOM_200, 0);
      await minTarget(btns.nth(i));
    }
    await boxWithin(page.locator('[data-spinth-toolbar]'), ZOOM_200, 0);
    await boxWithin(page.locator('[data-spinth-zoom]'), ZOOM_200, 0);
    await noDocHScroll(page);
    // 项目菜单：打开后四边在视口（pad 8）、面板可滚
    await page.click('[data-spinth-project-menu]');
    const pm = page.locator('[data-spinth-project-menu-panel]');
    await expect(pm).toBeVisible();
    await boxWithin(pm, ZOOM_200, 8);
    await page.click('[data-spinth-project-menu]');
    // 存储面板同口径
    await page.click('[data-spinth-storage-button]');
    const sp = page.locator('#spinth-storage-panel');
    await expect(sp).toBeVisible();
    await boxWithin(sp, ZOOM_200, 8);
  });

  test('Z1-b 二级菜单/右键菜单/操作栏/空画布提示不越界', async ({ page }) => {
    await openBoard(page, `e2e-z1b-${Date.now()}`);
    // 空画布提示（450 高下的回归面）
    await boxWithin(page.locator('[data-spinth-empty-hint]'), ZOOM_200, 0);
    // 二级菜单（r 激活形状）：面板四边在视口（pad 8）、顶边不低于顶栏下缘
    await page.keyboard.press('r');
    const flyout = page.locator('[data-spinth-tool-flyout]');
    await expect(flyout).toBeVisible();
    const fBox = await boxWithin(flyout, ZOOM_200, 8);
    expect(fBox.y).toBeGreaterThanOrEqual(HEADER_H - 0.5);
    // 右键菜单只在 cursor 模式开（core modeGuard）——先切回选择工具；
    // 右下角开（翻转 + clamp 生效面）
    await page.keyboard.press('v');
    await page.mouse.click(ZOOM_200.width - 12, ZOOM_200.height - 12, { button: 'right' });
    await boxWithin(page.locator('[data-spinth-context-menu]'), ZOOM_200, 8);
    await page.keyboard.press('Escape');
    // 操作栏：画一个形状（选中保持；drawShape 自带 r/v 切换）
    await drawShape(page, { x: 200, y: 150 }, { x: 360, y: 260 });
    await boxWithin(page.locator('[data-spinth-action-bar]'), ZOOM_200, 0);
  });
});

test.describe('Z2 1440×900 + html font-size 200%（纯文本缩放补充护栏）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Z2 rem 文本放大：可访问名非空、提示不裁字、坞不出视口', async ({ page }) => {
    await openBoard(page, `e2e-z2-${Date.now()}`);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.waitForTimeout(100);
    // 顶栏按钮可访问名非空（px/rem 混用下名称不依赖字号）
    const btns = page.locator('header button');
    const n = await btns.count();
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < n; i++) {
      await expect(btns.nth(i)).toHaveAccessibleName(/\S/);
    }
    // 空画布提示（text-sm/text-xs 均 rem）：放大后不裁字
    const hint = page.locator('[data-spinth-empty-hint]');
    await assertNoTextClip(hint.locator('p').first());
    await assertNoTextClip(hint.locator('p').nth(1));
    // 工具坞仍不压出视口、页面无横滚
    await boxWithin(page.locator('[data-spinth-toolbar]'), { width: 1440, height: 900 }, 0);
    await noDocHScroll(page);
  });
});

test.describe('R1 320×640（WCAG 1.4.10 Reflow）', () => {
  test.use({ viewport: COMPACT });

  test('R1-a 紧凑顶栏：6 控件可见、无裁切、胶囊截断、高度 44、页面无横滚', async ({ page }) => {
    await openBoard(page, `e2e-r1a-compact-long-document-id-${Date.now()}`);
    const header = page.locator('header');
    const hBox = await header.boundingBox();
    expect(Math.round(hBox!.height)).toBe(HEADER_H);
    // 顶栏自身不横向溢出（紧凑变体后内容收进 320）
    const overflow = await header.evaluate((n) => n.scrollWidth - n.clientWidth);
    expect(overflow, `顶栏内容横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    const btns = header.locator('button');
    const n = await btns.count();
    expect(n).toBeGreaterThanOrEqual(5); // 复制/新建/项目/主题 + 存储按钮
    for (let i = 0; i < n; i++) {
      await boxWithin(btns.nth(i), COMPACT, 0);
      await minTarget(btns.nth(i));
    }
    // 长 docId 胶囊截断（min-w-0 + truncate 生效，不撑破顶栏）
    const pill = page.locator('[data-spinth-doc-id]');
    const pillOverflow = await pill.evaluate((n2) => n2.scrollWidth - n2.clientWidth);
    expect(pillOverflow).toBeGreaterThan(0);
    // 胶囊仍有可读宽度（§7.3 预算 ≈100px；修前 min-w-0 把胶囊压到近 0——
    // 头像能塞下但 docId 不可读，1.4.10 的「不丢信息」同样红）
    const pillW = await pill.evaluate((n2) => n2.clientWidth);
    expect(pillW, `320 下 docId 胶囊宽仅 ${pillW}px（不可读）`).toBeGreaterThanOrEqual(60);
    await noDocHScroll(page);
  });

  test('R1-b 工具坞与面板：坞四边在视口、内部横滚、面板 ≤304 且可滚', async ({ page }) => {
    await openBoard(page, `e2e-r1b-${Date.now()}`);
    const dock = page.locator('[data-spinth-toolbar]');
    await boxWithin(dock, COMPACT, 0);
    // 坞内部横向滚动允许（工具栏自身滚动区域，§3.3）；页面级无横滚
    await noDocHScroll(page);
    await boxWithin(page.locator('[data-spinth-zoom]'), COMPACT, 0);
    // 项目菜单：宽 ≤304（320-16）、四边在视口、纵向可滚能力
    await page.click('[data-spinth-project-menu]');
    const pm = page.locator('[data-spinth-project-menu-panel]');
    await expect(pm).toBeVisible();
    const pmBox = await boxWithin(pm, COMPACT, 8);
    expect(pmBox.width).toBeLessThanOrEqual(304.5);
    await page.click('[data-spinth-project-menu]');
    // 存储面板同口径
    await page.click('[data-spinth-storage-button]');
    const sp = page.locator('#spinth-storage-panel');
    await expect(sp).toBeVisible();
    await boxWithin(sp, COMPACT, 8);
    await noDocHScroll(page);
  });

  test('R1-c 右键菜单与操作栏：贴边打开仍在视口内', async ({ page }) => {
    await openBoard(page, `e2e-r1c-${Date.now()}`);
    // 贴右下角右键：翻转 + 四面夹取
    await page.mouse.click(COMPACT.width - 6, COMPACT.height - 6, { button: 'right' });
    await boxWithin(page.locator('[data-spinth-context-menu]'), COMPACT, 8);
    await page.keyboard.press('Escape');
    // 操作栏：小画布上画形状后不越界
    await drawShape(page, { x: 60, y: 120 }, { x: 180, y: 220 });
    await boxWithin(page.locator('[data-spinth-action-bar]'), COMPACT, 0);
  });
});

test.describe('S1-a 竖屏 notch（applySafeArea 覆盖 --spinth-safe-*）', () => {
  test.use({ viewport: MOBILE });
  test('顶栏增高 safe-top、坞/缩放抬离 safe-bottom', async ({ page }) => {
    await openBoard(page, `e2e-s1a-${Date.now()}`);
    await applySafeArea(page, { top: 47, bottom: 34 });
    await page.waitForTimeout(100);
    // 顶栏 = 44 + safe-top（pt 垫高，内容区仍 44）
    const header = page.locator('header');
    expect(Math.round((await header.boundingBox())!.height)).toBe(HEADER_H + 47);
    // 工具坞/缩放胶囊抬离底部安全区（底缘不侵入 34px 区）
    const dock = await boxWithin(page.locator('[data-spinth-toolbar]'), MOBILE, 0);
    expect(dock.y + dock.height).toBeLessThanOrEqual(MOBILE.height - 34 + 0.5);
    const zoom = await boxWithin(page.locator('[data-spinth-zoom]'), MOBILE, 0);
    expect(zoom.y + zoom.height).toBeLessThanOrEqual(MOBILE.height - 34 + 0.5);
  });
});

test.describe('S1-b 横屏左右 inset', () => {
  test.use({ viewport: { width: 844, height: 390 } });
  test('顶栏内容不进左右安全区', async ({ page }) => {
    await openBoard(page, `e2e-s1b-${Date.now()}`);
    await applySafeArea(page, { left: 44, right: 44 });
    await page.waitForTimeout(100);
    const header = page.locator('header');
    const brand = header.locator('img').first();
    const brandX = (await brand.boundingBox())!.x;
    expect(brandX, `品牌图标进入左安全区（x=${brandX} < 44）`).toBeGreaterThanOrEqual(43.5);
    // 最右按钮（主题切换）不进右安全区
    const lastBtn = header.locator('button').last();
    const b = (await lastBtn.boundingBox())!;
    expect(b.x + b.width, `右侧按钮进入右安全区（${b.x + b.width} > 800）`).toBeLessThanOrEqual(
      844 - 44 + 0.5,
    );
    await noDocHScroll(page);
  });

  // 复审 P2：面板/右键菜单/操作栏都改了安全区 clamp——注入后逐一断言不进
  // 安全区（「改了没测」收口）
  test('S1-c 浮层不进左右安全区：项目菜单/存储面板/右键菜单/操作栏', async ({ page }) => {
    await openBoard(page, `e2e-s1c-${Date.now()}`);
    await applySafeArea(page, { left: 44, right: 44 });
    await page.waitForTimeout(100);
    const SAFE_L = 44;
    const SAFE_R = 844 - 44;
    // 项目菜单：打开后左缘不进左安全区
    await page.click('[data-spinth-project-menu]');
    const pm = page.locator('[data-spinth-project-menu-panel]');
    await expect(pm).toBeVisible();
    const pmBox = await pm.boundingBox();
    expect(pmBox!.x, `项目菜单进左安全区（x=${pmBox!.x}）`).toBeGreaterThanOrEqual(SAFE_L - 0.5);
    await page.keyboard.press('Escape');
    // 存储面板同口径
    await page.click('[data-spinth-storage-button]');
    const sp = page.locator('#spinth-storage-panel');
    await expect(sp).toBeVisible();
    const spBox = await sp.boundingBox();
    expect(spBox!.x, `存储面板进左安全区（x=${spBox!.x}）`).toBeGreaterThanOrEqual(SAFE_L - 0.5);
    expect(spBox!.x + spBox!.width).toBeLessThanOrEqual(SAFE_R + 0.5);
    await page.keyboard.press('Escape');
    // 右键菜单：贴右缘开（clamp 含 safe-right）
    await page.mouse.click(844 - 6, 200, { button: 'right' });
    const cm = page.locator('[data-spinth-context-menu]');
    await expect(cm).toBeVisible();
    const cmBox = await cm.boundingBox();
    expect(cmBox!.x + cmBox!.width).toBeLessThanOrEqual(SAFE_R + 0.5);
    await page.keyboard.press('Escape');
    // 操作栏：选中形状后左右夹取计入 inset（贴左缘画件）
    await page.keyboard.press('r');
    await page.mouse.move(SAFE_L + 30, 120);
    await page.mouse.down();
    await page.mouse.move(SAFE_L + 120, 180, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const ab = page.locator('[data-spinth-action-bar]');
    await expect(ab).toBeVisible();
    const abBox = await ab.boundingBox();
    expect(abBox!.x, `操作栏进左安全区（x=${abBox!.x}）`).toBeGreaterThanOrEqual(SAFE_L + 8 - 0.5);
    expect(abBox!.x + abBox!.width).toBeLessThanOrEqual(SAFE_R + 8 + 0.5);
  });

  // §13.5-8：安全区在 layout effect 内测量——操作栏已挂载后 inset 变化必须
  // 经 resize 失效重算（无失效路径的实现此条必红：首次测量后不再读 inset）
  test('S1-d 操作栏：安全区注入后 resize 重算（挂载晚于注入的反序）', async ({ page }) => {
    await openBoard(page, `e2e-s1d-${Date.now()}`);
    // 先挂载：此时 inset=0，操作栏按无安全区定位
    await drawShape(page, { x: 30, y: 120 }, { x: 120, y: 180 });
    const ab = page.locator('[data-spinth-action-bar]');
    await expect(ab).toBeVisible();
    const before = await ab.boundingBox();
    // 注入左 inset=44 → 派发 resize → 失效重算
    await applySafeArea(page, { left: 44 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect
      .poll(async () => (await ab.boundingBox())?.x ?? -1, { timeout: 3000 })
      .toBeGreaterThanOrEqual(44 + 8 - 0.5);
    const after = await ab.boundingBox();
    expect(
      after!.x,
      `resize 重算后 x 应 ≥52（重算前 ${before!.x}，重算后 ${after!.x}）`,
    ).toBeGreaterThanOrEqual(44 + 8 - 0.5);
  });
});
