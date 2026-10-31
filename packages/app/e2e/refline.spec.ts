import { expect, test, type Page } from '@playwright/test';

/**
 * 参考线吸附 E2E 守卫（docs/06，误差修复批 2026-10-11）。
 *
 * 本例守卫行为契约「undo 后重拖，吸附目标是当前几何」。实施时实证：本地流程
 * pointerdown 必 setSelected（selected$ 无 diff 每次 emission）天然触发重建——
 * 该契约当前实现天然满足（区分验证旧代码不红，属预期）；守卫价值在防止未来
 * 给 selected$ 加 diff 优化时静默破坏此行为，及 onModelUpdated$ 通道回归。
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

/** 世界 → 屏幕（canvas 顶栏 44px） */
const sy = (worldY: number): number => worldY + 44;

/** 按 id 取控件几何（vmStates 探针） */
async function geomOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((wid) => {
    const s = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => v.id === wid)!;
    return { x: Number(s.x), y: Number(s.y) };
  }, id);
}

/** 拖拽建 120×80 矩形（世界左上角），返回新件 id（按落点 x 定位） */
async function dragCreateRect(page: Page, x: number, y: number): Promise<string> {
  await page.keyboard.press('r');
  await page.mouse.move(x, sy(y));
  await page.mouse.down();
  await page.mouse.move(x + 120, sy(y + 80), { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const id = await page.evaluate((tx) => {
    const states = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates.filter((v) => String(v.type) === 'SHAPE');
    const s = states.find((v) => Math.abs(Number(v.x) - tx) < 2)!;
    return String(s.id);
  }, x);
  await page.keyboard.press('Escape'); // 单击/拖建后工具保持激活——回 cursor
  await page.waitForTimeout(80);
  return id;
}

test('A1 置脏覆盖几何变化：undo 后重拖，吸附目标是当前几何', async ({ page }) => {
  await page.goto(`/?doc=e2e-refline-${Date.now()}`);
  await ready(page);

  // 布局：A(200,200) C(600,200) —— 后续把 C 拖到 445 再 undo 回 600
  const aId = await dragCreateRect(page, 200, 200);
  const cId = await dragCreateRect(page, 600, 200);
  expect(aId).not.toBe(cId);

  // 1. 拖 C 到 x=445（左移 155）——制造一段可 undo 的几何历史
  await page.mouse.move(660, sy(240));
  await page.mouse.down();
  await page.mouse.move(660 - 155, sy(240), { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect.poll(() => geomOf(page, cId)).toEqual({ x: 445, y: 200 });

  // 2. 清选中 → 点选 A（选中集 === [A]，此后 undo 不换选中集）
  await page.mouse.click(50, sy(500));
  await page.waitForTimeout(120);
  await page.mouse.click(260, sy(240));
  await page.waitForTimeout(120);

  // 3. undo：C 回到 600（几何变化、无选中变化——A1 的置脏通道在此生效）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => geomOf(page, cId)).toEqual({ x: 600, y: 200 });

  // 4. 重拖 A 向 C 当前左缘（600）：停在 gap 2px 处（598 右缘，阈值 6px 内）
  //    修复后吸到 A.x=480（右缘恰 600）；回归时参考线停旧坐标（C.left=445 距 598
  //    153px 不可达）→ 不吸附 → A.x 停在 478
  await page.mouse.move(260, sy(240));
  await page.mouse.down();
  await page.mouse.move(538, sy(240), { steps: 6 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const a = await geomOf(page, aId);
  expect(a.x).toBeCloseTo(480, 1);
});

test('B 等间距参考线：拖中间件两侧间隙相等 → 橙色徽标 + 吸附落库 + undo 单步', async ({ page }) => {
  await page.goto(`/?doc=e2e-refline-sp-${Date.now()}`);
  await ready(page);

  // 布局：L(100,200) A(292,200) R(500,200) 各 120×80——等距解 A.x=300（gap 80/80）
  await dragCreateRect(page, 100, 200);
  const aId = await dragCreateRect(page, 292, 200);
  await dragCreateRect(page, 500, 200);

  // 拖 A：先大幅左移过牵引阈值（10px），再回停等距解附近（期望位 296，偏差 4 < 6）
  await page.mouse.move(352, sy(240));
  await page.mouse.down();
  await page.mouse.move(292, sy(240), { steps: 4 }); // dx=-60（牵引成立）
  await page.mouse.move(356, sy(240), { steps: 4 }); // 末帧 dx=+4（等距解 dx=8 偏差 4）
  await page.waitForTimeout(150);
  const gaps = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { spacingGaps: Array<{ axis: string; value: number }> } };
      }
    ).__spinthDebug.__debug.spacingGaps;
    return d.map((g) => `${g.axis}:${Math.round(g.value)}`).sort();
  });
  expect(gaps).toEqual(['x:80', 'x:80']); // 两段间隙徽标（世界单位 80）
  await page.mouse.up();
  await page.waitForTimeout(150);
  // 吸附落库：A.x 精确 300（等距解）
  const a = await geomOf(page, aId);
  expect(a.x).toBeCloseTo(300, 1);

  // undo 单步回拖前位（292）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => geomOf(page, aId)).toEqual({ x: 292, y: 200 });
});
