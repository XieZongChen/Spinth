import { expect, test, type Page } from '@playwright/test';

/**
 * 补齐 E2E（盘点 P2）：redo 全链路 / 图层操作 / ActionBar 色板族 / SHAPE 缩放 /
 * 快捷键面——均为已落地功能零护栏面。断言数据探针优先（docs/15 §3）。
 */

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

interface VProbe {
  count: number;
  shapes: Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    borderStyle: string;
    zOrder?: string;
  }>;
  scale: number;
  selected: string[];
}

async function probe(page: Page): Promise<VProbe> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            modelCount: number;
            vmStates: Array<Record<string, unknown>>;
            vmPositions: Array<{ id: string; x: number; y: number }>;
            selectedIds: string[];
          };
        };
      }
    ).__spinth.__debug;
    return {
      count: d.modelCount,
      shapes: d.vmStates
        .filter((s) => s.type === 'SHAPE')
        .map((s) => ({
          id: String(s.id),
          x: s.x as number,
          y: s.y as number,
          width: s.width as number,
          height: s.height as number,
          color: String(s.color),
          borderStyle: String(s.borderStyle),
          zOrder: s.zOrder as string | undefined,
        })),
      scale: (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
        .value,
      selected: d.selectedIds,
    };
  });
}

/** 屏幕坐标换算（探针世界 → canvas 局部 + 顶栏 44） */
async function worldToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy]) => {
      const w = (
        window as unknown as {
          __spinth: {
            viewport: {
              viewportInstance: { toScreen(x: number, y: number): { x: number; y: number } };
            };
          };
        }
      ).__spinth;
      const s = w.viewport.viewportInstance.toScreen(wx, wy);
      return { x: Math.round(s.x), y: Math.round(s.y + 44) };
    },
    [x, y],
  );
}

test('redo 全链路：undo → redo 恢复位移与元素（栈互转）', async ({ page }) => {
  const docId = `e2e-redo-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const afterCreate = await probe(page);
  const x0 = afterCreate.shapes[0]!.x;

  // 拖动 +140 → undo → redo（位移恢复）
  const c = await worldToScreen(page, x0 + 60, afterCreate.shapes[0]!.y + 40);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 140, c.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).shapes[0]!.x).toBeGreaterThan(x0 + 100);
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.x, { timeout: 5000 })
    .toBeCloseTo(x0, 1);
  await page.keyboard.press('ControlOrMeta+Shift+z'); // redo
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.x, { timeout: 5000 })
    .toBeGreaterThan(x0 + 100);

  // 删除 → undo → redo（元素恢复与消失）
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await probe(page)).count).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await probe(page)).count).toBe(0);
});

test('图层操作：bringToFront/sendToBack 与 forward/backward 换 zOrder', async ({ page }) => {
  const docId = `e2e-layer-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const canvas = page.locator('canvas').first();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 400, y: 250 } });
  await page.mouse.down();
  await page.mouse.move(560, 370, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('r');
  await canvas.hover({ position: { x: 700, y: 250 } });
  await page.mouse.down();
  await page.mouse.move(860, 370, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).count).toBe(2);

  // 拖 b 与 a 重叠（forward/backward 仅对空间重叠元素生效——layerOps 语义）
  const before = await probe(page);
  const a = before.shapes[0]!;
  const b = before.shapes[1]!;
  const bCenter = await worldToScreen(page, b.x + b.width / 2, b.y + b.height / 2);
  const overlapPt = await worldToScreen(page, a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.move(bCenter.x, bCenter.y);
  await page.mouse.down();
  await page.mouse.move(overlapPt.x, overlapPt.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const p = await probe(page);
        const bb = p.shapes.find((sh) => sh.id === b.id)!;
        return Math.abs(bb.x - (a.x + a.width / 2 - b.width / 2)) < 2;
      },
      { timeout: 5000 },
    )
    .toBe(true);

  // b 拖到 a 上方成为顶层——选 b（点重叠中心即顶层）做 forward/backward 往返
  const overlapCenter = await worldToScreen(page, a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.click(overlapCenter.x, overlapCenter.y);
  const zOf = async (id: string): Promise<string> =>
    (await probe(page)).shapes.find((sh) => sh.id === id)?.zOrder ?? '';
  const sel = async (): Promise<string> => String((await probe(page)).selected[0] ?? '');
  await expect.poll(sel, { timeout: 5000 }).toBe(b.id);
  expect(await zOf(b.id)).toBe(b.zOrder);

  // 注：Cmd+]/[ 被 macOS Chrome 拦为历史导航（浏览器级冲突）——键路径无法在
  // E2E 驱动；走 SDK 命令（与快捷键 handler 同一入口 app.sendBackward）
  await page.evaluate(() =>
    (window as unknown as { __spinth: { sendBackward(): void } }).__spinth.sendBackward(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).not.toBe(b.zOrder);
  expect((await zOf(b.id)) < a.zOrder).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { __spinth: { bringForward(): void } }).__spinth.bringForward(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).toBe(b.zOrder);

  // 置顶/置底（front/back 无重叠要求）
  await page.evaluate(() =>
    (window as unknown as { __spinth: { sendToBack(): void } }).__spinth.sendToBack(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).not.toBe(b.zOrder);
  await page.evaluate(() =>
    (window as unknown as { __spinth: { bringToFront(): void } }).__spinth.bringToFront(),
  );
  await expect.poll(async () => zOf(b.id), { timeout: 5000 }).toBe(b.zOrder);
});

test('SHAPE ActionBar：填充色 + 边框三态落库', async ({ page }) => {
  const docId = `e2e-shape-bar-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

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
  await ready(page);

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

// 快捷键面拆分（2026-10-17 prompt §2.3.2）：单用例耦合长链路 + 修饰键状态
// 串扰是 CI 时敏红的构成面——每例独立 page；缩放族显式 Control（不赌
// ControlOrMeta 的平台映射），每键后 poll 断言，@timing 归 nightly 层。

test('快捷键面：工具切换 h/l/p/m/v', async ({ page }) => {
  const docId = `e2e-hotkeys-tools-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
  await ready(page);
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
  await ready(page);
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
          __spinth: { viewport: { viewportInstance: { center: { x: number; y: number } } } };
        }
      ).__spinth.viewport.viewportInstance;
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
  await ready(page);
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
  await ready(page);
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
  await ready(page);
  const canvas = page.locator('canvas').first();

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
          __spinth: { viewport: { viewportInstance: { center: { x: number; y: number } } } };
        }
      ).__spinth.viewport.viewportInstance;
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
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(scaleOf, { timeout: 5000 }).toBeGreaterThan(1);
  await page.waitForTimeout(300); // 200ms 动画沉降
  const b = await centerWorld();
  expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(0.5);

  // 平移后（裸滚轮）再缩放——漂移轨道
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const c = await centerWorld();
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(scaleOf, { timeout: 5000 }).toBeGreaterThan(1.4);
  await page.waitForTimeout(300);
  const d = await centerWorld();
  expect(Math.abs(d.x - c.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(d.y - c.y)).toBeLessThanOrEqual(0.5);

  // immediate 路径：cmd+0 精确归位——中心世界点不动（修复前 position.set 把
  // 世界中心值当平移量写入，半屏级跳动）
  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(scaleOf, { timeout: 5000 }).toBeCloseTo(1, 5);
  const e = await centerWorld();
  expect(Math.abs(e.x - d.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(e.y - d.y)).toBeLessThanOrEqual(0.5);
});

test('键盘可达性：聚焦工具栏按钮时 Enter/Space 激活按钮、Tab 走焦点遍历（不被快捷键吞）', async ({
  page,
}) => {
  const docId = `e2e-kbd-ui-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

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
