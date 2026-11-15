/** 脑图竖向 E2E（specs/tree-diagrams §13 Phase 2）：切换/几何/方向键/撤销/重载 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/mindProbeE2e';

/** 画布左上角屏幕偏移（worldRect 世界坐标 → 屏幕坐标；初始视口 1:1） */
async function canvasOrigin(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const cr = (document.querySelector('canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { left: cr.left, top: cr.top };
  });
}

/** 建根图（脑图工具点空白）并退出编辑 */
async function createMap(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

/** 选中根（建图锚点固定 (500,300)，根中心 ≈ (560,320)）并把排列切到上下 */
async function switchToVertical(page: import('@playwright/test').Page) {
  const o = await canvasOrigin(page);
  await page.mouse.click(o.left + 560, o.top + 320);
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '排列方向' }).click();
  await page.getByRole('menuitemradio', { name: '上下' }).click();
  await page.waitForTimeout(300);
}

test('V-1 切竖向：分支上下分布、同侧子树横向堆叠、父在子组中水平居中', async ({ page }) => {
  const docId = `e2e-mind-v1-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createMap(page);

  // 根上先建三个子（默认右侧=下侧）：Tab 建子（焦点移到新子）→ 点根回焦点 → 再 Tab
  const o0 = await canvasOrigin(page);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    await page.mouse.click(o0.left + 560, o0.top + 320);
    await page.waitForTimeout(150);
  }
  await switchToVertical(page);

  const p = await probe(page);
  expect(p.mindNodes).toHaveLength(4);
  const [root, ...kids] = p.mindNodes;
  // 三个子都在根正下方（y > 根底），x 沿水平堆叠（互不重叠）
  for (const k of kids) {
    expect(k.worldRect.y).toBeGreaterThanOrEqual(root.worldRect.y + root.worldRect.height);
  }
  const xs = kids.map((k) => k.worldRect.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(0);
  // 父在子组中水平居中：根中心 x 落在首末子中心 x 的中点 ±2
  const first = kids.reduce((a, b) => (a.worldRect.x < b.worldRect.x ? a : b));
  const last = kids.reduce((a, b) => (a.worldRect.x > b.worldRect.x ? a : b));
  const mid =
    (first.worldRect.x + first.worldRect.width / 2 + last.worldRect.x + last.worldRect.width / 2) /
    2;
  expect(Math.abs(mid - (root.worldRect.x + root.worldRect.width / 2))).toBeLessThanOrEqual(2);
});

test('V-2 竖向导航：↓=子、↑=父（右侧=下侧树）；撤销一步回横向', async ({ page }) => {
  const docId = `e2e-mind-v2-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createMap(page);
  await switchToVertical(page);

  // 建链：根 → A → A1。barPick 后 DOM 焦点在菜单项上（Tab 会走原生焦点序列），
  // 先点根回画布焦点再 Tab
  const o0 = await canvasOrigin(page);
  await page.mouse.click(o0.left + 560, o0.top + 320);
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  let p = await probe(page);
  expect(p.mindNodes).toHaveLength(3);
  const [, nodeA, nodeA1] = p.mindNodes;

  // 焦点 A → ↓ 进子 A1（下侧树 ↓=子）。先 Escape 清选区——否则点已选中图
  // = 「再点已选中 → 进编辑」，textarea 会吞掉方向键（treeCollapse.spec 同款）
  const o = await canvasOrigin(page);
  // Tab 建子会自动进编辑（textarea 聚焦会吞方向键）：双 Escape 先关编辑器、
  // 再清选区——之后点 A 才是纯选中（不触发「再点已选中 → 进编辑」）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(
    o.left + nodeA.worldRect.x + nodeA.worldRect.width / 2,
    o.top + nodeA.worldRect.y + nodeA.worldRect.height / 2,
  );
  await page.waitForTimeout(200);
  p = await probe(page);
  expect(p.mindFocus?.nodeId).toBe(nodeA1.id);
  // ↑ 回父
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  p = await probe(page);
  expect(p.mindFocus?.nodeId).toBe(nodeA.id);

  // 撤销回横向：栈序 = A1 → A → 切竖向（导航不写文档）。逐步撤到只剩根，
  // 再 Tab 建子——恢复横向几何（子在根右侧、纵向中线对齐）
  await page.keyboard.press('ControlOrMeta+z'); // 撤 A1
  await page.waitForTimeout(150);
  await page.keyboard.press('ControlOrMeta+z'); // 撤 A
  await page.waitForTimeout(150);
  await page.keyboard.press('ControlOrMeta+z'); // 撤切竖向
  await page.waitForTimeout(300);
  p = await probe(page);
  expect(p.mindNodes).toHaveLength(1);
  // 根仍选中（选区未清）——Tab 建子后横向：子 x ≥ 根右缘
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  p = await probe(page);
  expect(p.mindNodes).toHaveLength(2);
  const root = p.mindNodes[0]!;
  const kid = p.mindNodes[1]!;
  expect(kid.worldRect.x).toBeGreaterThanOrEqual(root.worldRect.x + root.worldRect.width);
});

test('V-3 刷新保持竖向；旧语义 direction 不变（折叠徽标随轴转不炸）', async ({ page }) => {
  const docId = `e2e-mind-v3-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createMap(page);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await switchToVertical(page);

  await page.reload();
  await waitForSynced(page);
  await page.waitForTimeout(300);
  // 选中根复活探针（建图锚点 (500,300) 固定）
  const o = await canvasOrigin(page);
  await page.mouse.click(o.left + 560, o.top + 320);
  await page.waitForTimeout(300);
  const p = await probe(page);
  expect(p.mindNodes.length).toBeGreaterThanOrEqual(2);
  const root = p.mindNodes[0]!;
  const kid = p.mindNodes[1]!;
  // 仍竖向：子在根正下方
  expect(kid.worldRect.y).toBeGreaterThanOrEqual(root.worldRect.y + root.worldRect.height);
  expect(kid.worldRect.x).toBeLessThan(root.worldRect.x + root.worldRect.width + 60);
});
