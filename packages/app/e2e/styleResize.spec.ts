/** 样式与缩放 E2E：SHAPE 填充边框/角手柄缩放 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, worldToScreen } from './helpers/coverageE2e';

test('SHAPE ActionBar：填充色 + 边框三态落库', async ({ page }) => {
  const docId = `e2e-shape-bar-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  expect((await probe(page)).shapes[0]!.color).toBe('#e8f0fb'); // 默认填充

  const pick = async (trigger: string, option: string): Promise<void> => {
    await page.locator(`[data-spinth-action-bar] button[aria-label="${trigger}"]`).click();
    await page
      .locator(`[data-spinth-popover-panel] button[aria-label="${option}"]`)
      .first()
      .click();
  };
  await pick('填充色', '#d1fae5');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.color, { timeout: 5000 })
    .toBe('#d1fae5');
  await pick('边框', '虚线');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.borderStyle, { timeout: 5000 })
    .toBe('dashed');
  await pick('边框', '无边框');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.borderStyle, { timeout: 5000 })
    .toBe('none');
});

test('SHAPE 缩放：角手柄拖拽改宽高（rectEditor 全链路）', async ({ page }) => {
  const docId = `e2e-resize-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;
  expect(s0.width).toBeGreaterThan(100);

  // 选中 → 东南角手柄（bounds 右下角）外拖 40×30
  const c = await worldToScreen(page, s0.x + s0.width / 2, s0.y + s0.height / 2);
  await page.mouse.click(c.x, c.y);
  const corner = await worldToScreen(page, s0.x + s0.width, s0.y + s0.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeGreaterThan(s0.width + 30);
  expect((await probe(page)).shapes[0]!.height).toBeGreaterThan(s0.height + 20);
});

test('SHAPE 缩放内向松手：不误进编辑、选区/编辑框与图形同几何（手柄 pointerup 回归）', async ({
  page,
}) => {
  const docId = 'e2e-resize-inward-' + Date.now();
  await page.goto('/?doc=' + docId);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;

  // 创建后已选中；东南角手柄向内拖到图形内部松手——rectEditor 手柄只吞
  // pointerdown，pointerup 会冒泡到 stage；无 down 的 up 不得按「单击已选中」
  // 进编辑，否则 edit 早退保留 resize preview scale，框会脱离图形。
  const corner = await worldToScreen(page, s0.x + s0.width, s0.y + s0.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 55, corner.y - 15, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeLessThan(s0.width - 40);

  const after = await probe(page);
  const s1 = after.shapes[0]!;
  expect(after.selected).toContain(s0.id!);
  expect(s1.width).toBeLessThan(s0.width - 40);
  expect(s1.height).toBeLessThan(s0.height - 10);

  const frames = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            editorFrame: { x: number; y: number; width: number; height: number } | null;
            selectionFrame: { x: number; y: number; width: number; height: number } | null;
          };
        };
      }
    ).__spinthDebug.__debug;
    return {
      editorFrame: d.editorFrame,
      selectionFrame: d.selectionFrame,
      editing: !!document.querySelector('#spinth-text-layer [contenteditable="true"]'),
    };
  });
  expect(frames.editing).toBe(false); // 未误进编辑
  expect(frames.editorFrame).not.toBeNull();
  expect(frames.selectionFrame).not.toBeNull();
  for (const frame of [frames.editorFrame!, frames.selectionFrame!]) {
    expect(Math.abs(frame.x - s1.x)).toBeLessThan(1);
    expect(Math.abs(frame.y - s1.y)).toBeLessThan(1);
    expect(Math.abs(frame.width - s1.width)).toBeLessThan(1);
    expect(Math.abs(frame.height - s1.height)).toBeLessThan(1);
  }
});

test('SHAPE 缩放中途失焦：复窗在图形上松手不误进编辑（抑制随手势生命周期回归）', async ({
  page,
}) => {
  const docId = 'e2e-resize-blur-' + Date.now();
  await page.goto('/?doc=' + docId);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;

  // 抓 SE 角外拖；中途 window blur（切窗）→ 继续拖 → 在图形上松手。手柄手势是
  // window 级监听，blur 只对 mode handlers 发 cancel、不终止手势；抑制若在
  // cancel 里被清掉，复窗松手 up 会被 final 分支当「单击已选中」误进编辑，
  // 且 commit 的 render 编辑期早退保留预览 scale → 框与图形脱节。
  const corner = await worldToScreen(page, s0.x + s0.width, s0.y + s0.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 20, corner.y + 15, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeGreaterThan(s0.width + 30);

  const s1 = (await probe(page)).shapes[0]!;
  const frames = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            editorFrame: { x: number; y: number; width: number; height: number } | null;
            selectionFrame: { x: number; y: number; width: number; height: number } | null;
          };
        };
      }
    ).__spinthDebug.__debug;
    return {
      editorFrame: d.editorFrame,
      selectionFrame: d.selectionFrame,
      editing: !!document.querySelector('#spinth-text-layer [contenteditable="true"]'),
    };
  });
  expect(frames.editing).toBe(false); // 失焦复窗松手 = 手势收尾，不是单击激活
  expect(frames.editorFrame).not.toBeNull();
  expect(frames.selectionFrame).not.toBeNull();
  for (const frame of [frames.editorFrame!, frames.selectionFrame!]) {
    expect(Math.abs(frame.x - s1.x)).toBeLessThan(1);
    expect(Math.abs(frame.y - s1.y)).toBeLessThan(1);
    expect(Math.abs(frame.width - s1.width)).toBeLessThan(1);
    expect(Math.abs(frame.height - s1.height)).toBeLessThan(1);
  }
});

test('SHAPE 缩放手势期异指针 up：不提前提交、不偷监听，真松手恰好一次落库', async ({ page }) => {
  const docId = 'e2e-resize-interloper-' + Date.now();
  await page.goto('/?doc=' + docId);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;

  // 真实鼠标拖 SE 角中途，第二设备/第二指在 window 冒泡一个异 pointerId 的
  // up：不得终止手势（once 监听被它偷走会提前提交中间几何并清抑制，真松手
  // 再被当「单击已选中」误进编辑——审查 P2 实锤形态）。
  const corner = await worldToScreen(page, s0.x + s0.width, s0.y + s0.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 20, corner.y + 15, { steps: 4 });
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 999, button: 0 })),
  );
  const mid = await probe(page);
  expect(mid.shapes[0]!.width).toBe(s0.width); // 未被异指针 up 提前提交

  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeGreaterThan(s0.width + 30);

  const s1 = (await probe(page)).shapes[0]!;
  const frames = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            editorFrame: { x: number; y: number; width: number; height: number } | null;
            selectionFrame: { x: number; y: number; width: number; height: number } | null;
          };
        };
      }
    ).__spinthDebug.__debug;
    return {
      editorFrame: d.editorFrame,
      selectionFrame: d.selectionFrame,
      editing: !!document.querySelector('#spinth-text-layer [contenteditable="true"]'),
    };
  });
  expect(frames.editing).toBe(false); // 真松手 = 手势收尾，不是单击激活
  for (const frame of [frames.editorFrame!, frames.selectionFrame!]) {
    expect(Math.abs(frame.x - s1.x)).toBeLessThan(1);
    expect(Math.abs(frame.y - s1.y)).toBeLessThan(1);
    expect(Math.abs(frame.width - s1.width)).toBeLessThan(1);
    expect(Math.abs(frame.height - s1.height)).toBeLessThan(1);
  }
});

test('SHAPE 缩放：异指针 pointercancel 忽略；指针移出视口松手仍落库（capture 送达）', async ({
  page,
}) => {
  const docId = 'e2e-resize-cancel-' + Date.now();
  await page.goto('/?doc=' + docId);
  await waitForSynced(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 500, y: 280 } });
  await page.mouse.down();
  await page.mouse.move(620, 360, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;

  // 异 pointerId 的 pointercancel（他指被系统接管）不得误杀本手势；
  // 随后指针拖出视口右缘松手——手柄 down 已 setPointerCapture，up 仍送达
  // window（无 capture 时窗口外释放收不到 up，手势与抑制悬挂）。此例为
  // 送达性回归锁（Playwright 无法真正模拟「浏览器不投递」），指针匹配的
  // cancel 回滚路径由 rectEditor 单测锁。
  const corner = await worldToScreen(page, s0.x + s0.width, s0.y + s0.height);
  await page.evaluate(() => {
    (window as unknown as { __gesturePointerId?: number }).__gesturePointerId = undefined;
    window.addEventListener(
      'pointerdown',
      (e) => {
        (window as unknown as { __gesturePointerId?: number }).__gesturePointerId = (
          e as PointerEvent
        ).pointerId;
      },
      { capture: true, once: true },
    );
  });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  const captured = await page.evaluate(() => {
    const id = (window as unknown as { __gesturePointerId?: number }).__gesturePointerId;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    return id !== undefined && canvas?.hasPointerCapture(id) === true;
  });
  expect(captured).toBe(true); // 手柄 down 必须真正捕获指针，否则窗口外 up 仍会丢
  await page.mouse.move(corner.x + 20, corner.y + 15, { steps: 4 });
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 999 })),
  );
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width + 200, corner.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeGreaterThan(s0.width + 30);

  const frames = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            editorFrame: { x: number; y: number; width: number; height: number } | null;
            selectionFrame: { x: number; y: number; width: number; height: number } | null;
          };
        };
      }
    ).__spinthDebug.__debug;
    return {
      editorFrame: d.editorFrame,
      selectionFrame: d.selectionFrame,
      editing: !!document.querySelector('#spinth-text-layer [contenteditable="true"]'),
    };
  });
  expect(frames.editing).toBe(false);
  expect(frames.editorFrame).not.toBeNull();
  expect(frames.selectionFrame).not.toBeNull();
});

// 快捷键面拆分（2026-10-17 prompt §2.3.2）：单用例耦合长链路 + 修饰键状态
// 串扰是 CI 时敏红的构成面——每例独立 page；缩放族显式 Control（不赌
// ControlOrMeta 的平台映射），每键后 poll 断言，@timing 归 nightly 层。
