/** 树折叠 E2E（specs/tree-diagrams §8.4/§13 Phase 1）：ActionBar/快捷键/徽标/撤销/重载/自动展开 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, type Probe } from './helpers/mindProbeE2e';

/** 建一棵 4 节点链（根→A→A1→A2）并返回探针快照 */
async function buildChain(page: import('@playwright/test').Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250); // 根编辑器自动打开
  // 编辑态连 Tab：根 → A → A1 → A2（4 节点链）
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

/** 画布左上角屏幕偏移（worldRect 是世界坐标——初始视口 1:1 无平移，
 *  屏幕 = canvas 偏移 + 世界；mindSelect.spec 同款口径） */
async function canvasOrigin(
  page: import('@playwright/test').Page,
): Promise<{ left: number; top: number }> {
  return page.evaluate(() => {
    const cr = (document.querySelector('canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { left: cr.left, top: cr.top };
  });
}

/** 点击节点中心设置焦点（选中 + 节点级焦点，不进编辑）。
 *  先 Escape 清选区——否则点已选中图 = 「再点已选中 → 激活编辑」，
 *  textarea 聚焦会吞掉后续快捷键（mindSelect.spec 同款口径） */
async function clickNodeCenter(page: import('@playwright/test').Page, p: Probe, id: string) {
  const n = p.mindNodes.find((x) => x.id === id);
  expect(n, `节点 ${id} 应存在`).toBeDefined();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const o = await canvasOrigin(page);
  await page.mouse.click(
    o.left + n!.worldRect.x + n!.worldRect.width / 2,
    o.top + n!.worldRect.y + n!.worldRect.height / 2,
  );
  await page.waitForTimeout(200);
}

test('T-1 ActionBar 折叠/展开：隐藏后代 + 徽标计数 + toggle 文案随态', async ({ page }) => {
  const docId = `e2e-tree-collapse-1-${Date.now()}`;
  await buildChain(page, docId);
  let p = await probe(page);
  expect(p.mindNodes).toHaveLength(4);
  const [, nodeA] = p.mindNodes; // 链序：根, A, A1, A2（布局后顺序与探针 DFS 一致）

  await clickNodeCenter(page, p, nodeA.id);
  await page.getByRole('button', { name: '折叠子树' }).click();
  await page.waitForTimeout(250);

  p = await probe(page);
  const a = p.mindNodes.find((n) => n.id === nodeA.id)!;
  expect(a.collapsed).toBe(true);
  expect(a.hiddenCount).toBe(2); // A1 + A2
  expect(p.mindNodes.filter((n) => n.visible)).toHaveLength(2); // 根 + A 可见

  // toggle 文案翻转
  await expect(page.getByRole('button', { name: '展开子树' })).toBeVisible();
  await page.getByRole('button', { name: '展开子树' }).click();
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.every((n) => n.visible)).toBe(true);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(false);
});

test('T-2 快捷键 Cmd/Ctrl+. 折叠/展开焦点子树；无子节点 no-op', async ({ page }) => {
  const docId = `e2e-tree-collapse-2-${Date.now()}`;
  await buildChain(page, docId);
  let p = await probe(page);
  const [, nodeA, nodeA1] = p.mindNodes;

  await clickNodeCenter(page, p, nodeA.id);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(true);

  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(false);

  // 叶子节点（A1 无子……链上 A1 有子 A2）——用末梢 A2：no-op 不写不崩
  await clickNodeCenter(page, p, nodeA1.id);
  const leaf = p.mindNodes[p.mindNodes.length - 1]!;
  await clickNodeCenter(page, p, leaf.id);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(200);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === leaf.id)!.collapsed).toBe(false); // 无子不可折叠
});

test('T-3 点击折叠徽标 = 展开（不建拖拽会话）', async ({ page }) => {
  const docId = `e2e-tree-collapse-3-${Date.now()}`;
  await buildChain(page, docId);
  let p = await probe(page);
  const [, nodeA] = p.mindNodes;

  await clickNodeCenter(page, p, nodeA.id);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(250);
  p = await probe(page);
  const a = p.mindNodes.find((n) => n.id === nodeA.id)!;
  expect(a.collapsed).toBe(true);

  // 徽标在朝子侧（右）边中点：worldRect 右边中点（canvas 偏移口径同上）
  const o = await canvasOrigin(page);
  await page.mouse.click(
    o.left + a.worldRect.x + a.worldRect.width,
    o.top + a.worldRect.y + a.worldRect.height / 2,
  );
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(false);
  expect(p.mindNodes.every((n) => n.visible)).toBe(true);
});

test('T-4 撤销：折叠一步一撤销（undo 恢复展开）', async ({ page }) => {
  const docId = `e2e-tree-collapse-4-${Date.now()}`;
  await buildChain(page, docId);
  let p = await probe(page);
  const [, nodeA] = p.mindNodes;

  await clickNodeCenter(page, p, nodeA.id);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(true);

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(false);
  expect(p.mindNodes.every((n) => n.visible)).toBe(true);
});

test('T-5 刷新恢复：折叠状态随文档持久化', async ({ page }) => {
  const docId = `e2e-tree-collapse-5-${Date.now()}`;
  await buildChain(page, docId);
  let p = await probe(page);
  const [, nodeA] = p.mindNodes;
  await clickNodeCenter(page, p, nodeA.id);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(300);

  await page.reload();
  await waitForSynced(page);
  await page.waitForTimeout(300);
  // reload 后选区空——探针（nodesDebug）依赖焦点图；建图锚点 = 根左上角
  // （buildChain 固定 (500,300)），点击根中心复活探针
  const o0 = await canvasOrigin(page);
  await page.mouse.click(o0.left + 560, o0.top + 320);
  await page.waitForTimeout(300);
  p = await probe(page);
  const a = p.mindNodes.find((n) => n.id === nodeA.id);
  expect(a, '重载后节点 id 稳定（折叠写在文档）').toBeDefined();
  expect(a!.collapsed).toBe(true);
  expect(p.mindNodes.filter((n) => n.visible)).toHaveLength(2);
});

test('T-6 折叠节点上 Tab 建子：自动展开且新子可见（一步撤销）', async ({ page }) => {
  const docId = `e2e-tree-collapse-6-${Date.now()}`;
  await buildChain(page, docId);
  let p = await probe(page);
  const [, nodeA] = p.mindNodes;

  await clickNodeCenter(page, p, nodeA.id);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(true);

  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  p = await probe(page);
  const a = p.mindNodes.find((n) => n.id === nodeA.id)!;
  expect(a.collapsed).toBe(false); // 自动展开
  expect(p.mindNodes).toHaveLength(5); // 新子可见
  expect(p.mindNodes.every((n) => n.visible)).toBe(true);
});
