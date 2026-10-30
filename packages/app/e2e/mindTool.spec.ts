/** 脑图工具与幽灵 E2E：选中不建图/幽灵跟随/失效通道/程序化切工具 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, ghostPos } from './helpers/mindProbeE2e';

test('脑图工具：选中不创建、幽灵示意跟随、悬停已有图隐藏、按下点建图', async ({ page }) => {
  const docId = `e2e-mind-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const ghostBox = () => page.locator('[data-spinth-tool-ghost="mind"]');
  // 1) 点工具本身：不建图，幽灵 DOM 出现
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.move(500, 260);
  await page.waitForTimeout(150);
  let p = await probe(page);
  expect(p.modelCount).toBe(0);
  await expect(ghostBox()).toBeVisible();

  // 2) 跟随鼠标（ref 直写 transform，两次移动位置都要变）
  const tx = async () => {
    const m = await ghostBox().evaluate((el) => getComputedStyle(el).transform);
    const nums = m.match(/[-\d.]+/g)?.map(Number) ?? [];
    return { x: nums[12] ?? nums[4] ?? 0, y: nums[13] ?? nums[5] ?? 0 };
  };
  await page.mouse.move(620, 320);
  await page.waitForTimeout(120);
  const a = await tx();
  await page.mouse.move(760, 380);
  await page.waitForTimeout(120);
  const b = await tx();
  expect(b.x - a.x).toBeGreaterThan(100);
  expect(b.y - a.y).toBeGreaterThan(30);

  // 3) 画布按下 → 在按下点建图（数量 +1）
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  p = await probe(page);
  expect(p.modelCount).toBe(1);
  await page.keyboard.press('Escape');

  // 4) 重新激活 mind 工具：悬停根节点本体 → 幽灵隐藏；移开恢复
  await page.getByRole('button', { name: /脑图/ }).click();
  const rootC = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            vmPositions: Array<{ x: number; y: number }>;
            vmStates: Array<Record<string, unknown>>;
          };
        };
      }
    ).__spinth.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const pos = d.vmPositions[0]!;
    const w = Number(d.vmStates[0]?.width ?? 100);
    const h = Number(d.vmStates[0]?.height ?? 40);
    return { x: pos.x + w / 2 + c.left, y: pos.y + h / 2 + c.top };
  });
  await page.mouse.move(rootC.x, rootC.y);
  await page.waitForTimeout(200);
  await expect(ghostBox()).toBeHidden();
  await page.mouse.move(rootC.x + 600, rootC.y + 300);
  await page.waitForTimeout(200);
  await expect(ghostBox()).toBeVisible();
});

test('可创建工具统一幽灵：矩形工具激活即跟随（脑图同款 DOM）', async ({ page }) => {
  const docId = `e2e-ghost-shape-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(150);
  await expect(page.locator('[data-spinth-tool-ghost="shape"]')).toBeVisible();
  // cursor/hand 工具无幽灵
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(120);
  await expect(page.locator('[data-spinth-tool-ghost]')).toHaveCount(0);
});

test('程序化切工具（指针静止）：幽灵立即按指针位置就位（不必等 move）', async ({ page }) => {
  const docId = `e2e-ghost-programmatic-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 指针先进入画布（组件常驻记录位置），随后只程序化切工具、不再动鼠标
  await page.mouse.move(500, 300);
  await page.evaluate(() => {
    (
      window as unknown as { __spinth: { setCursorMode: (m: string) => void } }
    ).__spinth.setCursorMode('shape');
  });
  const pos = await ghostPos(page, 'shape');
  expect(pos.opacity).toBe('0.6');
  expect(Math.abs(pos.x - (500 + 14))).toBeLessThanOrEqual(2);
  expect(Math.abs(pos.y - (300 + 14))).toBeLessThanOrEqual(2);
});

test('画布元素被替换后幽灵自恢复（rect 缓存失检兜底）', async ({ page }) => {
  const docId = `e2e-ghost-requery-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
  // 模拟 Board 重挂：旧 canvas 摘除、几何**不同**的新 canvas 补位
  // （若仍用旧 rect 判界内，(150,100) 会被误判在界内）
  await page.evaluate(() => {
    const stage = document.querySelector('#stage-container')!;
    stage.querySelector('canvas')?.remove();
    const c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;top:200px;left:100px;width:50%;height:50%;';
    stage.appendChild(c);
  });
  await page.mouse.move(150, 100);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0'); // 旧 rect 会误判 0.6
  await page.mouse.move(640, 360);
  await page.waitForTimeout(120);
  const pos = await ghostPos(page, 'shape');
  expect(pos.opacity).toBe('0.6');
  expect(Math.abs(pos.x - (640 + 14))).toBeLessThanOrEqual(2);
  expect(Math.abs(pos.y - (360 + 14))).toBeLessThanOrEqual(2);
});

test('幽灵 rect 失效通道①：scroll 捕获重读（transform 缩画布——不触发 RO/resize）', async ({
  page,
}) => {
  const docId = `e2e-ghost-scroll-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
  // scaleY(0.5) 只改 getBoundingClientRect 的可视几何、不改布局盒——RO/resize
  // 都不触发，rect 失效只能来自合成 scroll 事件（通道隔离）
  await page.evaluate(() => {
    const c = document.querySelector('#stage-container canvas') as HTMLElement;
    c.style.transformOrigin = 'top';
    c.style.transform = 'scaleY(0.5)';
    window.dispatchEvent(new Event('scroll'));
  });
  await page.mouse.move(500, 700);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0'); // 旧 rect（bottom≈900）会误判界内
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6'); // 新 rect（bottom≈472）内恢复
});

test('幽灵 rect 失效通道②：ResizeObserver（CSS 改尺寸——无 scroll/resize 事件）', async ({
  page,
}) => {
  const docId = `e2e-ghost-ro-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
  // 改 CSS 高度改变布局盒 → RO 触发（不派发 scroll/resize，元素也未替换）
  await page.evaluate(() => {
    (document.querySelector('#stage-container canvas') as HTMLElement).style.height = '50%';
  });
  await page.waitForTimeout(200); // RO 回调在下一渲染帧前
  await page.mouse.move(500, 700);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0'); // 旧 rect（bottom≈900）会误判界内
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
});

test('幽灵 coalesced 空列表回退 + 指针从未移动时不现身', async ({ page }) => {
  const docId = `e2e-ghost-coalesced-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 指针从未移动（常驻记录为 null）：程序化切工具保持隐藏、不报错
  await page.evaluate(() => {
    (
      window as unknown as { __spinth: { setCursorMode: (m: string) => void } }
    ).__spinth.setCursorMode('shape');
  });
  expect((await ghostPos(page, 'shape')).opacity).toBe('0');
  // 合成 pointermove 无合并采样（Chrome 中 getCoalescedEvents() 返回 []）
  // → 走 last = e 回退分支（Safari 旧版兼容路径），位置取事件坐标本身
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 400 }));
  });
  const pos = await ghostPos(page, 'shape');
  expect(pos.opacity).toBe('0.6');
  expect(Math.abs(pos.x - (700 + 14))).toBeLessThanOrEqual(2);
  expect(Math.abs(pos.y - (400 + 14))).toBeLessThanOrEqual(2);
});
