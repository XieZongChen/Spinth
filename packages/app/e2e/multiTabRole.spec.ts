/** 多标签角色 E2E（docs/21 §1-§3）：leader/follower/接管/并行/降级 */
import { expect, test } from '@playwright/test';
import { modelCount, persisted, ready } from './helpers/projectFileE2e';
import { tabRole, waitRole, createShapeByDrag } from './helpers/multiTabE2e';

test('双标签同文档：先到 leader、后到 follower（徽标/提示条/写面禁用/拖拽 no-op）', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-dual-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // 只读徽标 + 提示条（follower 专属）
  await expect(pageB.locator('[data-spinth-readonly-pill]')).toBeVisible();
  await expect(pageB.locator('[data-spinth-readonly-pill]')).toHaveAttribute(
    'title',
    '此画布为只读——另一标签正在编辑',
  );
  await expect(pageB.locator('[data-spinth-readonly-notice]')).toBeVisible();

  // 写工具 disabled；视图工具（cursor/hand）可用
  const toolbar = pageB.getByRole('toolbar', { name: '画板工具' });
  await expect(toolbar.getByRole('button', { name: /\(R\)$/ })).toBeDisabled();
  await expect(toolbar.getByTitle('抓手 (H / 空格)')).toBeEnabled();
  await expect(toolbar.getByTitle('抓手 (H / 空格)')).not.toBeDisabled();

  // follower 按 R（非白名单快捷键被闸门拦）+ 拖拽 + undo：modelCount 纹丝不动
  const before = await modelCount(pageB);
  await pageB.keyboard.press('r');
  const canvas = pageB.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await pageB.mouse.down();
  await pageB.mouse.move(660, 420, { steps: 8 });
  await pageB.mouse.up();
  await pageB.keyboard.press('ControlOrMeta+z');
  expect(await modelCount(pageB)).toBe(before);

  // A 仍是 leader（B 的排队申请不影响持锁者）
  expect(await tabRole(page)).toBe('leader');
});

test('接管：关闭 leader → follower 自动刷新接管，内容为最后落盘状态', async ({ page, context }) => {
  const docId = `e2e-mt-takeover-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // A 建控件并等落盘（B 接管后读到的就是这个状态）
  await createShapeByDrag(page);
  await persisted(page);
  const created = await modelCount(page);

  // 关 A（pagehide 让锁）→ B 排队授予 → 300ms → 整页刷新。
  // waitForEvent('load') 先注册再关页，避免 reload 已发生再等的竞态
  const nextLoad = pageB.waitForEvent('load', { timeout: 20_000 });
  await page.close();
  await nextLoad;
  await waitRole(pageB, 'leader');
  await ready(pageB);

  // 提示条消失；A 最后创建的控件可见
  await expect(pageB.locator('[data-spinth-readonly-notice]')).toHaveCount(0);
  await expect.poll(() => modelCount(pageB), { timeout: 5_000 }).toBe(created);
});

test('只读不写盘：A 建控件后 B 保持打开时的快照', async ({ page, context }) => {
  const docId = `e2e-mt-nosync-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  // B 先打开（快照 = 空文档）
  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');
  expect(await modelCount(pageB)).toBe(0);
  // 只读空文档不出「R 拖出矩形…」引导——引导全是写指令，只读不可执行
  await expect(pageB.getByText('空画布')).toHaveCount(0);
  await expect(page.getByText('空画布')).toBeVisible(); // 写者侧正常显示（区分验证）

  // A 建件落盘后，B 无实时同步也不落盘——modelCount 不涨
  await createShapeByDrag(page);
  await persisted(page);
  expect(await modelCount(page)).toBeGreaterThan(0);
  expect(await modelCount(pageB)).toBe(0);
});

test('不同文档并行：两个标签都 leader', async ({ page, context }) => {
  await page.goto(`/?doc=e2e-mt-x-${Date.now()}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=e2e-mt-y-${Date.now()}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'leader');
});

test('无 Web Locks 降级 solo：可写、无提示条', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', {
      value: undefined,
      configurable: true,
    });
  });
  const p = await ctx.newPage();
  await p.goto(`/?doc=e2e-mt-solo-${Date.now()}&assetMaint=0`);
  await waitRole(p, 'solo');
  await ready(p);
  await expect(p.locator('[data-spinth-readonly-notice]')).toHaveCount(0);
  await expect(p.locator('[data-spinth-readonly-pill]')).toHaveCount(0);
  // solo 可写：创建控件成功
  await createShapeByDrag(p);
  await persisted(p);
  await ctx.close();
});
