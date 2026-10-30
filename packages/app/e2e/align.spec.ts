/** 对齐/分布 E2E（docs/05 §7）：六键收敛/分布/可用性/自由线参与 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import {
  probe,
  shapesOf,
  linePointsOf,
  close,
  createRect,
  marquee,
  clickBar,
  shiftClick,
  createAndSelectThree,
} from './helpers/alignE2e';

test('左对齐：x 全收敛到选中集最小 x + 选区框跟随 + undo 一步全回', async ({ page }) => {
  const docId = `e2e-align-left-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const before = await createAndSelectThree(page);

  await clickBar(page, '左对齐');

  const after = await probe(page);
  const rects = shapesOf(after);
  const targetX = Math.min(...before.map((r) => r.x));
  // 全部 x 收敛（含原本就在最左的第一块零位移）
  expect(rects.every((r) => close(r.x, targetX))).toBe(true);
  // y 不动（左对齐只动 x）
  expect(rects.every((r, i) => close(r.y, before[i]!.y))).toBe(true);
  // 选区框自动跟随到新包络（左缘 = targetX）
  expect(after.selectionFrame).not.toBeNull();
  expect(close(after.selectionFrame!.x, targetX)).toBe(true);
  // 选中集保持（对齐不清选区）
  expect(after.selectedIds).toHaveLength(3);

  // undo 一步（单事务 = 单撤销单元）：三块全回原位
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = shapesOf(await probe(page));
  expect(
    undone.every((r, i) => close(r.x, before[i]!.x, 0.01) && close(r.y, before[i]!.y, 0.01)),
  ).toBe(true);
});

test('顶对齐：y 全收敛到最小 y（y 轴数学）', async ({ page }) => {
  const docId = `e2e-align-top-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const before = await createAndSelectThree(page);

  await clickBar(page, '顶对齐');

  const rects = shapesOf(await probe(page));
  const targetY = Math.min(...before.map((r) => r.y));
  expect(rects.every((r) => close(r.y, targetY))).toBe(true);
  expect(rects.every((r, i) => close(r.x, before[i]!.x))).toBe(true); // x 不动
});

test('横向分布：相邻间隙相等、两端不动；3 选时分布键可用', async ({ page }) => {
  const docId = `e2e-dist-h-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const before = await createAndSelectThree(page);

  // 3 选：分布键可用（恰 2 选才禁用）
  await expect(
    page.locator('[data-spinth-action-bar] button[aria-label="横向分布"]'),
  ).toBeEnabled();

  await clickBar(page, '横向分布');

  const rects = shapesOf(await probe(page));
  // 两端不动（首块 x=390 本就最小、末块 920 最大）
  expect(close(rects[0]!.x, before[0]!.x, 0.01)).toBe(true);
  expect(close(rects[2]!.x, before[2]!.x, 0.01)).toBe(true);
  // 间隙等距：span 650、总宽 360 → gap = 145（含除法浮点，容差断言）
  const gap1 = rects[1]!.x - (rects[0]!.x + rects[0]!.width);
  const gap2 = rects[2]!.x - (rects[1]!.x + rects[1]!.width);
  expect(close(gap1, 145)).toBe(true);
  expect(close(gap2, 145)).toBe(true);
  expect(close(gap1, gap2, 0.05)).toBe(true);
  // 纵向分布键同理可用（结构断言，不再重复几何用例）
  await expect(
    page.locator('[data-spinth-action-bar] button[aria-label="纵向分布"]'),
  ).toBeEnabled();
});

test('可用性：2 选时分布两键禁用、对齐六键可用；单选无对齐键；多选按钮清单', async ({ page }) => {
  const docId = `e2e-align-avail-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);

  // 单选第一块：bar 无任何对齐键（对齐键只在多选分支）
  await page.mouse.click(450, 300);
  await page.waitForTimeout(250);
  expect(await page.locator('[data-spinth-action-bar] button[aria-label="左对齐"]').count()).toBe(
    0,
  );

  // shift 加选第二块 → 多选 bar：八键 + 删除，分布两键 disabled（参考同款显示但禁用）
  await shiftClick(page, 700, 400);
  await page.waitForTimeout(250);
  const bar = page.locator('[data-spinth-action-bar]');
  const labels = await bar
    .locator('button[aria-label]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual([
    '左对齐',
    '水平居中对齐',
    '右对齐',
    '顶对齐',
    '垂直居中对齐',
    '底对齐',
    '横向分布',
    '纵向分布',
    '编组',
    '导出 PNG',
    '删除',
  ]);
  // 组切换单钮（docs/18 §3.4）：两散件态显示「编组」且可用
  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="横向分布"]')).toBeDisabled();
  await expect(bar.locator('button[aria-label="纵向分布"]')).toBeDisabled();
  await expect(bar.locator('button[aria-label="左对齐"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="底对齐"]')).toBeEnabled();
});

test('自由线参与：左对齐后线 points 平移到目标（y 不动）', async ({ page }) => {
  const docId = `e2e-align-freeline-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 300); // world ≈ (390,216,120,80)

  // 自由线：line 工具空白→空白（两端无绑定），工具保持激活 → Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(900, 420, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  await marquee(page, 340, 160, 1000, 560);
  const before = await probe(page);
  expect(before.selectedIds).toHaveLength(2);
  const ptsBefore = linePointsOf(before);
  expect(ptsBefore.length).toBeGreaterThanOrEqual(2);
  const lineMinXBefore = Math.min(...ptsBefore.map((p) => p[0]!));
  const rectX = shapesOf(before)[0]!.x;

  await clickBar(page, '左对齐');

  const after = await probe(page);
  const ptsAfter = linePointsOf(after);
  expect(ptsAfter).toHaveLength(ptsBefore.length);
  // 目标 = 参与集最小 x = 矩形左缘（矩形在自由线左侧）
  const dx = rectX - lineMinXBefore;
  expect(ptsAfter.every((p, i) => close(p[0]!, ptsBefore[i]![0]! + dx, 0.05))).toBe(true);
  expect(ptsAfter.every((p, i) => close(p[1]!, ptsBefore[i]![1]!, 0.01))).toBe(true);
  expect(close(shapesOf(after)[0]!.x, rectX, 0.01)).toBe(true); // 矩形零位移（已在基准）

  // undo 一步：矩形与自由线同回
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = await probe(page);
  const ptsUndone = linePointsOf(undone);
  expect(ptsUndone.every((p, i) => close(p[0]!, ptsBefore[i]![0]!, 0.01))).toBe(true);
});
