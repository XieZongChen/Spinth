/** 树形图工具入口 E2E（specs/tree-diagrams §14.2/Phase 3c）：
 *  单入口默认脑图、类型二级菜单切 org、kind 记忆、O 直达、幽灵、既有 mind E2E 兼容 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/mindProbeE2e';

test('TT-1 默认脑图：树形图入口建 MIND_MAP（既有 /脑图/ 选择器零迁移）', async ({ page }) => {
  const docId = `e2e-tree-tool-1-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 标题动态含当前 kind：初始脑图（spec §10.1 会话记忆初始 mind）
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const p = await probe(page);
  expect(p.mindFocus?.kind).toBe('MIND_MAP');
  expect(p.mindFocus?.orientation).toBe('horizontal');
});

test('TT-2 类型二级菜单：切组织架构保持激活 → 建出 ORG_CHART（top-down）', async ({ page }) => {
  const docId = `e2e-tree-tool-2-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.waitForTimeout(200);
  // 激活即显示类型组；切 org 工具保持激活（spec §10.1）
  await page.getByRole('menuitemradio', { name: '组织架构' }).click();
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /组织架构/ })).toBeVisible();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const p = await probe(page);
  expect(p.mindFocus?.kind).toBe('ORG_CHART');
  expect(p.mindFocus?.orientation).toBe('top-down');
});

test('TT-3 kind 记忆：创建回 cursor 后再点树形图回到上次 kind（O 直达更新记忆）', async ({
  page,
}) => {
  const docId = `e2e-tree-tool-3-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // O 直达（更新记忆为 org）
  await page.keyboard.press('o');
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /组织架构/ })).toBeVisible();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 创建后回 cursor（树工具一次性创建）
  expect((await probe(page)).mindFocus?.kind).toBe('ORG_CHART');
  // 再点树形图按钮 → 回到 org（记忆）
  await page.getByRole('button', { name: /组织架构/ }).click();
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /组织架构 \(O\)/ })).toBeVisible();
});

test('TT-4 M 直达：从 org 记忆切回脑图（M 语义不变）', async ({ page }) => {
  const docId = `e2e-tree-tool-4-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  await page.keyboard.press('m');
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /树形图 · 脑图/ })).toBeVisible();
});

test('TT-5 幽灵：org 模式出组织架构示意；悬停已有树图抑制', async ({ page }) => {
  const docId = `e2e-tree-tool-5-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  await page.mouse.move(600, 300);
  await page.waitForTimeout(150);
  const ghost = page.locator('[data-spinth-tool-ghost="org"]');
  await expect(ghost).toHaveCSS('opacity', /[^0]/);
  // 建图后悬停其上 → 抑制（ToolGhost 对 hidden 是卸载而非 opacity:0——
  // mindTool.spec 的抑制断言同款口径：toBeHidden）
  await page.mouse.click(600, 300);
  await page.waitForTimeout(400);
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  await page.mouse.move(640, 330, { steps: 3 });
  await page.waitForTimeout(200);
  await expect(ghost).toBeHidden();
});
