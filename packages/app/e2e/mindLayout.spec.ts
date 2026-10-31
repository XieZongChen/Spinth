/** 脑图布局 E2E（docs/11 §9）：Tab 深层收敛/长文本换行/拖出成图 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/mindProbeE2e';

test('docs/11 §9：Tab 连建 10 层布局收敛稳定；undo 10 次逐步回退', async ({ page }) => {
  const docId = `e2e-mind-chain-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250); // 根编辑器自动打开

  // 编辑态 Tab = 建子并继续编辑新节点（既有设计连建方式）——连按 10 层
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  const snap = (): Promise<Array<{ cx: number; x: number; y: number }>> =>
    page.evaluate(() => {
      const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
      return d.mindNodes
        .map((n) => ({
          cx: n.worldRect.y + n.worldRect.height / 2,
          x: n.worldRect.x,
          y: n.worldRect.y,
        }))
        .sort((a, b) => a.x - b.x);
    });

  // 收敛：单链全在右侧——各节点垂直居中于同一水平线（单子节点居中）、x 严格递增
  const nodes = await snap();
  expect(nodes).toHaveLength(11);
  for (const n of nodes) expect(Math.abs(n.cx - nodes[0]!.cx)).toBeLessThanOrEqual(1);
  for (let i = 1; i < nodes.length; i++) expect(nodes[i]!.x).toBeGreaterThan(nodes[i - 1]!.x);
  // 无跳动：静止后两次采样逐节点一致
  await page.waitForTimeout(300);
  expect(await snap()).toEqual(nodes);

  // undo 10 次：addChild 每步 stopCapturing → 每次恰好回退一层，11 → 1
  const count = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug.mindNodes
          .length,
    );
  for (let i = 10; i >= 1; i--) {
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(120);
    expect(await count()).toBe(i);
  }
});

test('docs/11 §9：长文本 360px 上限自动换行；根增高子树联动重排', async ({ page }) => {
  const docId = `e2e-mind-wrap-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 建右子（短根下的初始位置；可能带开编辑器）
  await page.waitForTimeout(250);

  const rects = (): Promise<{
    root: { x: number; y: number; width: number; height: number };
    child: { x: number; y: number };
  }> =>
    page.evaluate(() => {
      const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
      // 根的文案会被长文本替换——以「子节点 1」（首个子节点恒名）锚定子节点
      const child = d.mindNodes.find((n) => n.text === '子节点 1')!;
      const root = d.mindNodes.find((n) => n !== child)!;
      return { root: root.worldRect, child: { x: child.worldRect.x, y: child.worldRect.y } };
    });
  const before = await rects();

  // 点根一次：关掉可能开着的子编辑器（textarea blur）+ 选中根；再点一次进编辑。
  // 注意不能 Escape 代替——选中态（非编辑态）按 Escape 会清焦点
  const c = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const child = d.mindNodes.find((n) => n.text === '子节点 1')!;
    const root = d.mindNodes.find((n) => n !== child)!;
    return { x: root.worldRect.x + 20 + canvas.left, y: root.worldRect.y + 15 + canvas.top };
  });
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(250);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelectorAll('body > textarea').length)).toBe(1);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('长文本换行验收联动重排'.repeat(10)); // 120 字
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // 落库退出
  await page.waitForTimeout(250);

  const after = await rects();
  // 换行上限：120 字 × 18px ≈ 2160px 不换行会远超——总宽恒 ≤ 360（含 padding）
  expect(after.root.width).toBeLessThanOrEqual(362);
  expect(after.root.width).toBeGreaterThan(200); // 确实铺到换行宽度（不是被压窄）
  expect(after.root.height).toBeGreaterThan(before.root.height + 20); // 多行
  // 联动重排：根变高 → 右子被推下移，且仍在根本体右侧（无重叠）
  expect(after.child.y).toBeGreaterThan(before.child.y);
  expect(after.child.x).toBeGreaterThanOrEqual(after.root.x + after.root.width - 2);
});

test('docs/11 §9：拖节点到空白处成新图——原树正确移除、新图落在松手点', async ({ page }) => {
  const docId = `e2e-mind-dragout-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 建右子（可能带开编辑器）
  await page.waitForTimeout(250);

  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes.find((n) => n.text === '中心主题')!;
    const child = d.mindNodes.find((n) => n !== root)!;
    const center = (r: { x: number; y: number; width: number; height: number }) => ({
      x: r.x + r.width / 2 + c.left,
      y: r.y + r.height / 2 + c.top,
    });
    return { rootC: center(root.worldRect), childC: center(child.worldRect) };
  });
  // 若子编辑器开着，先点根关掉（textarea 挡指针，直接拖会被它吃掉 pointerdown）；
  // 不能用 Escape——选中态（非编辑态）按 Escape 会清焦点
  await page.mouse.click(geo.rootC.x, geo.rootC.y);
  await page.waitForTimeout(250);

  // 拖子节点到右下空白（沿途无节点，DropArea 不命中 → 成新图）
  await page.mouse.move(geo.childC.x, geo.childC.y);
  await page.mouse.down();
  await page.mouse.move(980, 720, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 新图生成：焦点自动落新图根（= 被拖节点），位置 = 松手点（所见即所得）
  const p1 = await probe(page);
  expect(p1.modelCount).toBe(2);
  expect(p1.mindNodes).toHaveLength(1);
  expect(p1.mindNodes[0]!.text).toBe('子节点 1');
  expect(Math.abs(p1.mindNodes[0]!.worldRect.x - 980)).toBeLessThanOrEqual(3);
  expect(Math.abs(p1.mindNodes[0]!.worldRect.y - (720 - 44))).toBeLessThanOrEqual(3);

  // 原树正确移除：只剩根
  await page.mouse.click(geo.rootC.x, geo.rootC.y);
  await page.waitForTimeout(250);
  const p2 = await probe(page);
  expect(p2.modelCount).toBe(2);
  expect(p2.mindNodes).toHaveLength(1);
  expect(p2.mindNodes[0]!.text).toBe('中心主题');
});
