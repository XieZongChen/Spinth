/** 快捷键面 E2E：工具/缩放/微移/Esc/缩放锚点/键盘可达性 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/coverageE2e';

test('快捷键面：工具切换 h/l/p/m/v', async ({ page }) => {
  const docId = `e2e-hotkeys-tools-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const cursorOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { cursorMode$: { value: string } } }).__spinth.cursorMode$
          .value,
    );
  for (const [key, mode] of [
    ['h', 'hand'],
    ['l', 'line'],
    ['p', 'pen'],
    ['m', 'mind'],
    ['v', 'cursor'],
  ] as const) {
    await page.keyboard.press(key);
    expect(await cursorOf()).toBe(mode);
  }
});

test('快捷键面：Ctrl+= / Ctrl+- 缩放（显式 Control，每键断言） @timing', async ({ page }) => {
  const docId = `e2e-hotkeys-zoom-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const scaleOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
          .value,
    );
  await page.keyboard.down('Control');
  await page.keyboard.press('=');
  await page.keyboard.up('Control');
  await expect.poll(scaleOf, { timeout: 5000 }).toBeGreaterThan(1);
  const up = await scaleOf();
  await page.keyboard.down('Control');
  await page.keyboard.press('-');
  await page.keyboard.up('Control');
  await expect.poll(scaleOf, { timeout: 5000 }).toBeLessThan(up); // 回落一级
});

test('快捷键面：Ctrl+0 精确回 100%（immediate 路径 + 世界中心在屏幕中心） @timing', async ({
  page,
}) => {
  const docId = `e2e-hotkeys-z100-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const scaleOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
          .value,
    );
  const centerWorld = () =>
    page.evaluate(() => {
      const vp = (
        window as unknown as {
          __spinthDebug: {
            __debug: { viewport: { viewportInstance: { center: { x: number; y: number } } } };
          };
        }
      ).__spinthDebug.__debug.viewport.viewportInstance;
      return { x: vp.center.x, y: vp.center.y };
    });
  const c0 = await centerWorld(); // 初始 scale=1 无平移的世界中心（canvas 局部系，y=428）
  // 先放大两级再回零（覆盖「动画在飞时 cmd+0」竞态轨道）
  await page.keyboard.down('Control');
  await page.keyboard.press('=');
  await page.keyboard.up('Control');
  await expect.poll(scaleOf, { timeout: 5000 }).toBeGreaterThan(1);
  await page.keyboard.down('Control');
  await page.keyboard.press('0');
  await page.keyboard.up('Control');
  // zoom100 走 immediate 精确路径（2026-10-09 治本：收敛式插值残差）
  await expect.poll(scaleOf, { timeout: 5000 }).toBeCloseTo(1, 5);
  // 位置断言（prompt §2.3.2 #3）：归位后世界中心回到初始位（±1）
  const c1 = await centerWorld();
  expect(Math.abs(c1.x - c0.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(c1.y - c0.y)).toBeLessThanOrEqual(1);
});

test('快捷键面：方向键微移 1px', async ({ page }) => {
  const docId = `e2e-hotkeys-nudge-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(600, 340, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const x0 = (await probe(page)).shapes[0]!.x;
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.x, { timeout: 5000 })
    .toBeCloseTo(x0 - 1, 0);
});

test('快捷键面：Esc 清选区', async ({ page }) => {
  const docId = `e2e-hotkeys-esc-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(600, 340, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  expect((await probe(page)).selected.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await probe(page)).selected.length).toBe(0);
});

test('P0-7 缩放锚点：屏幕中心的世界点在缩放前后不动（animate/immediate 双路径 + 平移后轨道） @timing', async ({
  page,
}) => {
  const docId = `e2e-zoom-anchor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 完整套件并行跑时保持页面前台：后台页 rAF 节流会让 200ms 缩放动画迟迟不收敛，
  // 本用例是 @timing 语义，不能把「页面被节流」误判成锚点回归。
  await page.bringToFront();
  const canvas = page.locator('canvas').first();

  // 显式 Control（与上方 Ctrl+= 用例同款）：ControlOrMeta 在 macOS 会走 Meta，
  // 并行 worker 下偶发按键未生效；两个缩放入口统一成同一物理键。
  const zoomIn = async (): Promise<void> => {
    await page.keyboard.down('Control');
    await page.keyboard.press('=');
    await page.keyboard.up('Control');
  };
  const zoomReset = async (): Promise<void> => {
    await page.keyboard.down('Control');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');
  };

  // 拉开世界范围（有内容才可平移）
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);

  // viewportInstance.center 即世界坐标（P0-7 修复的语义单源）
  const centerWorld = () =>
    page.evaluate(() => {
      const vp = (
        window as unknown as {
          __spinthDebug: {
            __debug: { viewport: { viewportInstance: { center: { x: number; y: number } } } };
          };
        }
      ).__spinthDebug.__debug.viewport.viewportInstance;
      return { x: vp.center.x, y: vp.center.y };
    });
  const scaleOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
          .value,
    );

  // animate 路径：cmd+= 绕中心——中心世界点不动（修复前 focus 二次换算 + 比例
  // 写反，平移后轨道漂移；纯缩放轨道恰好幂等掩盖）
  const a = await centerWorld();
  await zoomIn();
  await expect.poll(scaleOf, { timeout: 10_000 }).toBeGreaterThan(1);
  await page.waitForTimeout(400); // 200ms 动画沉降（并行负载下留余量）
  const b = await centerWorld();
  expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(0.5);

  // 平移后（裸滚轮）再缩放——漂移轨道
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const c = await centerWorld();
  await zoomIn();
  await expect.poll(scaleOf, { timeout: 10_000 }).toBeGreaterThan(1.4);
  await page.waitForTimeout(400);
  const d = await centerWorld();
  expect(Math.abs(d.x - c.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(d.y - c.y)).toBeLessThanOrEqual(0.5);

  // immediate 路径：cmd+0 精确归位——中心世界点不动（修复前 position.set 把
  // 世界中心值当平移量写入，半屏级跳动）
  await zoomReset();
  await expect.poll(scaleOf, { timeout: 10_000 }).toBeCloseTo(1, 5);
  const e = await centerWorld();
  expect(Math.abs(e.x - d.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(e.y - d.y)).toBeLessThanOrEqual(0.5);
});

test('键盘可达性：聚焦工具栏按钮时 Enter/Space 激活按钮、Tab 走焦点遍历（不被快捷键吞）', async ({
  page,
}) => {
  const docId = `e2e-kbd-ui-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const cursorOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { cursorMode$: { value: string } } }).__spinth.cursorMode$
          .value,
    );
  expect(await cursorOf()).toBe('cursor');

  // 聚焦矩形工具按钮 → Enter 应激活（修复前：enter 绑定脑图同级被 preventDefault 吞）
  const shapeBtn = page.getByRole('button', { name: /矩形/ });
  await shapeBtn.focus();
  await expect(shapeBtn).toBeFocused(); // 图标钮 textContent 空、名来自 tooltip——原生断言，不读 DOM 属性
  await page.keyboard.press('Enter');
  await expect.poll(cursorOf, { timeout: 3000 }).toBe('shape');

  // 回 cursor（v）后聚焦按钮 → Space 应激活（修复前：Space 被抓手劫持吞掉）
  await page.keyboard.press('v');
  await expect.poll(cursorOf, { timeout: 3000 }).toBe('cursor');
  await shapeBtn.focus();
  await page.keyboard.press(' ');
  await expect.poll(cursorOf, { timeout: 3000 }).toBe('shape');

  // Tab：焦点应移到下一个控件（修复前：tab 绑定脑图建子被吞，焦点钉死）
  await page.keyboard.press('v');
  await shapeBtn.focus();
  const before = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 60) ?? '');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 60) ?? '');
  expect(after).not.toBe(before); // 焦点已移动
});
