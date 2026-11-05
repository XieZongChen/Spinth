import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertNoTextClip,
  assertRowsDisjoint,
  boxWithin,
  noDocHScroll,
  openBoard,
  setRootFontSize,
  twoFrames,
} from './helpers/layoutE2e';

/**
 * WCAG 1.4.4 纯文本缩放矩阵（specs/rem-typography §6.2）：根字号 16 → 32px。
 * 断言纪律：getComputedStyle 读真实字号/行高（不读类名）；几何用 boundingBox；
 * data-spinth-* 标记定位。视觉基线只截画布、证不了铬件——铬件精确性靠本文件。
 * 横幅（更新/离线条）在主配置不可达，其字号断言收口在 pwa.spec P5；
 * 主工具坞按钮用原生 title，悬停提示取二级菜单（flyout）选项的 Tooltip。
 */

const VP = { width: 1440, height: 900 } as const;
test.use({ viewport: VP });

interface ITypo {
  fontSize: string;
  lineHeight: string;
}

async function typo(l: Locator): Promise<ITypo> {
  return l.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
  });
}

async function pageScroll(page: Page): Promise<number[]> {
  return page.evaluate(() => [window.scrollX, window.scrollY]);
}

/** 右下角右键（同 a11yLayout Z1-b 点位）：翻转 + 夹取同时生效的面 */
async function openCornerMenu(page: Page): Promise<Locator> {
  await page.mouse.click(VP.width - 12, VP.height - 12, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  return menu;
}

/** 按 r 开形状二级菜单、悬停首个选项，等中文提示出现（400ms 延迟） */
async function openFlyoutTooltip(page: Page): Promise<Locator> {
  await page.locator('#stage-container').focus();
  await page.keyboard.press('r');
  const flyout = page.locator('[data-spinth-tool-flyout]');
  await expect(flyout).toBeVisible();
  await flyout.locator('button').first().hover();
  const tip = page.locator('[data-spinth-tooltip]');
  await expect(tip).toBeVisible({ timeout: 5000 });
  return tip;
}

/** 同 a11yKeyboard.drawShape：拖拽建件后保持选中（元素菜单最长，6 项） */
async function drawShape(page: Page): Promise<void> {
  await page.keyboard.press('r');
  await page.mouse.move(400, 250);
  await page.mouse.down();
  await page.mouse.move(520, 330, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** 一次采集迁移文本的计算样式（T1/T2 共用） */
async function readChromeTypography(page: Page): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  out.root = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  out.brand = await typo(page.locator('[data-spinth-brand]'));
  // 存储面板：标题（text-md）、脚注（text-2xs + leading-4）
  await page.click('[data-spinth-storage-button]');
  const panel = page.locator('#spinth-storage-panel');
  await expect(panel).toBeVisible();
  out.storageTitle = await typo(page.locator('#spinth-storage-panel-title'));
  out.storageNote = await typo(page.locator('#spinth-storage-panel > p'));
  await page.click('[data-spinth-storage-button]');
  await expect(panel).toBeHidden();
  // 右键菜单：菜单项（text-md）、快捷键（text-3xs）、面板宽（13.5rem）
  const menu = await openCornerMenu(page);
  out.menuItem = await typo(menu.locator('[role="menuitem"]').first());
  out.kbd = await typo(menu.locator('kbd').first());
  out.menuWidth = (await menu.boundingBox())!.width;
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // 悬停提示（text-2xs）
  out.tooltip = await typo(await openFlyoutTooltip(page));
  await page.mouse.move(20, VP.height / 2);
  await page.keyboard.press('v');
  return out;
}

/** 期望值随根字号线性：字号 = 1x 值 × k；行高继承根的 1.5，脚注 leading-4 = 1rem */
function expected(rootPx: number): Record<string, unknown> {
  const k = rootPx / 16;
  const t = (fs: number, lh = fs * 1.5): ITypo => ({
    fontSize: `${fs * k}px`,
    lineHeight: `${lh * k}px`,
  });
  return {
    root: `${rootPx}px`,
    brand: t(15),
    storageTitle: t(13),
    storageNote: t(11, 16),
    menuItem: t(13),
    kbd: t(10),
    tooltip: t(11),
    menuWidth: 216 * k,
  };
}

test('T1 1x 精确性：迁移文本的计算字号/行高与迁移前逐像素一致', async ({ page }) => {
  await openBoard(page, `e2e-ts1-${Date.now()}`);
  expect(await readChromeTypography(page)).toEqual(expected(16));
});

test('T2 200% 精确性：根字号 32px 时字号/行高/菜单宽全部 ×2', async ({ page }) => {
  await openBoard(page, `e2e-ts2-${Date.now()}`);
  await setRootFontSize(page, 32);
  expect(await readChromeTypography(page)).toEqual(expected(32));
});

test('T3 200% 右键菜单：实测尺寸翻转夹取、行不重叠、行高 68、过高时内滚', async ({ page }) => {
  await openBoard(page, `e2e-ts3-${Date.now()}`);
  await setRootFontSize(page, 32);
  // 右下角：宽 432 / 行高 68 的实测尺寸参与翻转——只按 216 常量夹取会右缘越界
  const menu = await openCornerMenu(page);
  await boxWithin(menu, VP, 8);
  const items = menu.locator('[role="menuitem"]');
  await assertRowsDisjoint(items);
  const heights = await items.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  for (const h of heights) {
    expect(h, `菜单行高应为 2.125rem = 68px（实际 ${h}）`).toBeCloseTo(68, 0);
  }
  const maxH = await menu.evaluate((el) => parseFloat(getComputedStyle(el).maxHeight));
  expect(maxH, 'max-height 应封顶在视口内').toBeLessThanOrEqual(VP.height - 16 + 0.5);
  await noDocHScroll(page);
  expect(await pageScroll(page)).toEqual([0, 0]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // 菜单高于可视区：矮视口确定性覆盖内滚分支（画布菜单约 315px > 300 − 16）
  const SHORT = { width: VP.width, height: 300 };
  await page.setViewportSize(SHORT);
  await twoFrames(page);
  await page.mouse.click(1300, 120, { button: 'right' }); // 顶栏 88px 之下、坞与缩放胶囊之外
  await expect(menu).toBeVisible();
  await boxWithin(menu, SHORT, 8);
  const m = await menu.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh, `菜单应内滚（scrollHeight ${m.sh} > clientHeight ${m.ch}）`).toBeGreaterThan(m.ch);
  await noDocHScroll(page);
});

test('T4 200% 面板与提示：项目菜单行不重叠、存储面板不裁字、提示在视口', async ({ page }) => {
  await openBoard(page, `e2e-ts4-${Date.now()}`);
  await setRootFontSize(page, 32);
  // 项目菜单：长标签在 320px 面板里折行，min-h 行随内容增高、互不重叠
  await page.click('[data-spinth-project-menu]');
  const pm = page.locator('[data-spinth-project-menu-panel]');
  await expect(pm).toBeVisible();
  await boxWithin(pm, VP, 8);
  await assertRowsDisjoint(pm.locator('[role="menuitem"]'));
  await page.click('[data-spinth-project-menu]');
  await expect(pm).toBeHidden();
  // 存储面板：面板 maxHeight 兜底在视口内，标题与脚注不裁字
  await page.click('[data-spinth-storage-button]');
  const sp = page.locator('#spinth-storage-panel');
  await expect(sp).toBeVisible();
  await boxWithin(sp, VP, 8);
  await assertNoTextClip(page.locator('#spinth-storage-panel-title'));
  await assertNoTextClip(page.locator('#spinth-storage-panel > p'));
  await page.click('[data-spinth-storage-button]');
  await expect(sp).toBeHidden();
  // 悬停提示：w-max + 视口上限，放大后仍在视口、不撑出横滚
  await boxWithin(await openFlyoutTooltip(page), VP, 0);
  await noDocHScroll(page);
});

test('T5 200% 键盘打开：Shift+F10 不滚屏、焦点在菜单、Esc 归还 stage', async ({ page }) => {
  await openBoard(page, `e2e-ts5-${Date.now()}`);
  await setRootFontSize(page, 32);
  await drawShape(page);
  const stage = page.locator('#stage-container');
  await stage.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-label', '元素操作');
  // 首项聚焦发生在估算尺寸那一帧（被动 effect 先于实测重定位）——不得触发任何滚动
  await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
  expect(await pageScroll(page)).toEqual([0, 0]);
  expect(await menu.evaluate((el) => el.scrollTop)).toBe(0);
  await boxWithin(menu, VP, 8);
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[role="menuitem"]').nth(1)).toBeFocused();
  expect(await pageScroll(page)).toEqual([0, 0]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(stage).toBeFocused();
});
