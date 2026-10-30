/** 编组建组 E2E（docs/18 §2-§3）：建组/快捷键/单钮切换 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import {
  probe,
  shapesOf,
  lineOf,
  createRect,
  marquee,
  clickBar,
  shiftClick,
  screenOf,
  createGroupedPair,
} from './helpers/groupE2e';

test('建组：两块同 groupId + zOrder 归拢；点击组员 = 整组选中；undo 一步组消解', async ({
  page,
}) => {
  const docId = `e2e-group-create-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createGroupedPair(page);
  const g = await probe(page);
  const [a] = shapesOf(g);
  const groupId = a!.groupId!;

  // 点击空白清选区 → 点其中一块 = 整组选中（zOrder 序）
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  const pt = await screenOf(page, a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(2);

  // undo 一步（单事务 = 单撤销单元）：groupId 键删除，点击恢复单选
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = shapesOf(await probe(page));
  expect(undone.every((r) => r.groupId === undefined)).toBe(true);
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(1);

  // redo：组恢复（undo/redo 对 optional 键删除/恢复的投影守卫）
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(300);
  expect(shapesOf(await probe(page)).every((r) => r.groupId === groupId)).toBe(true);
});

test('快捷键双入口：ControlOrMeta+G 建组 / +Shift+G 解组；解组保持选区', async ({ page }) => {
  const docId = `e2e-group-shortcut-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);
  await marquee(page, 340, 160, 820, 480);
  expect((await probe(page)).selectedIds).toHaveLength(2);

  await page.keyboard.press('ControlOrMeta+g');
  await page.waitForTimeout(300);
  const grouped = shapesOf(await probe(page));
  expect(grouped.every((r) => r.groupId === undefined)).toBe(false);

  await page.keyboard.press('ControlOrMeta+Shift+g');
  await page.waitForTimeout(300);
  const ungrouped = await probe(page);
  expect(shapesOf(ungrouped).every((r) => r.groupId === undefined)).toBe(true);
  expect(ungrouped.selectedIds).toHaveLength(2); // 选区保持原成员集
});

test('单钮切换（docs/18 §3.4）：建组后按钮翻「解组」，点击即解组、再翻回「编组」', async ({
  page,
}) => {
  const docId = `e2e-group-toggle-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);
  await marquee(page, 340, 160, 820, 480);
  const bar = page.locator('[data-spinth-action-bar]');

  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
  await clickBar(page, '编组');
  expect(shapesOf(await probe(page)).every((r) => r.groupId)).toBeTruthy();
  // 选区不变（两块仍选）→ schema 随 widgetsChanged$ 重算，按钮翻「解组」
  await expect(bar.locator('button[aria-label="解组"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="编组"]')).toHaveCount(0);

  await clickBar(page, '解组');
  expect(shapesOf(await probe(page)).every((r) => r.groupId === undefined)).toBe(true);
  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
});

test('单钮切换：两个整组选中显示「编组」（合并拍板）→ 合为一组后翻「解组」', async ({ page }) => {
  const docId = `e2e-group-merge-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 两对分别编组：AB / CD
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);
  await marquee(page, 340, 160, 820, 480);
  await clickBar(page, '编组');
  await createRect(page, 950, 300);
  await createRect(page, 1150, 420);
  await marquee(page, 850, 160, 1260, 520);
  await clickBar(page, '编组');
  expect(new Set(shapesOf(await probe(page)).map((r) => r.groupId)).size).toBe(2);

  // 全选四块（多整组两可态）→ 显示「编组」（合并，2026-10-17 二轮拍板）
  await marquee(page, 340, 160, 1260, 520);
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar.locator('button[aria-label="解组"]')).toHaveCount(0);
  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
  await clickBar(page, '编组');

  expect(new Set(shapesOf(await probe(page)).map((r) => r.groupId)).size).toBe(1); // 合并为一组
  await expect(bar.locator('button[aria-label="解组"]')).toBeEnabled(); // 恰一整组 → 翻解组
});

test('单钮切换兜底：锚定线+组员混选显示「解组」（编组不可行但涉组，不出死按钮）', async ({
  page,
}) => {
  const docId = `e2e-group-fallback-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350); // A
  await createRect(page, 850, 550); // B
  await marquee(page, 340, 210, 960, 630);
  await clickBar(page, '编组'); // {A,B} 一组

  // 锚定线 A→B，Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 清选区 → 点 A（整组）→ shift 点线身 = 混选（组员×2 + 锚定线）。
  // 点位取**末段中点**（进 B 的竖直段）：ActionBar 悬在选中并集上方居中，
  // 中段水平段的中点恰落在条矩形内（onPointerDown stopPropagation 吞点击，
  // 调试剧本实证 sel 不变）；末段中点 y 在条底之下，稳定避让
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  const created = await probe(page);
  const pts = (lineOf(created) as unknown as { points: Array<[number, number]> }).points;
  const la = pts[pts.length - 2] ?? pts[0]!;
  const lb = pts[pts.length - 1] ?? pts[0]!;
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  await shiftClick(
    page,
    (la[0]! + lb[0]! + cRect.left * 2) / 2,
    (la[1]! + lb[1]! + cRect.top * 2) / 2,
  );
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(3);

  // 兜底规则：canGroup=false（锚定线）且涉组 → 显示「解组」且可用
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar.locator('button[aria-label="解组"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="编组"]')).toHaveCount(0);
});
