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

test('D 端部链式等距：拖一排两端件也有橙色徽标并吸附（gap(A,P) = g(P,Q)）', async ({ page }) => {
  await page.goto(`/?doc=e2e-refline-endchain-${Date.now()}`);
  await ready(page);

  // 布局：L(100,200) M(320,200) R(540,200) 各 120×80——间隙均 100
  const lId = await dragCreateRect(page, 100, 200);
  await dragCreateRect(page, 320, 200);
  const rId = await dragCreateRect(page, 540, 200);
  await expect.poll(() => geomOf(page, lId)).toEqual({ x: 100, y: 200 });

  const gapsProbe = () =>
    page.evaluate(() => {
      const d = (
        window as unknown as {
          __spinthDebug: { __debug: { spacingGaps: Array<{ axis: string; value: number }> } };
        }
      ).__spinthDebug.__debug.spacingGaps;
      return d.map((g) => `${g.axis}:${Math.round(g.value)}`).sort();
    });

  // 1. 拖左端 L：过牵引阈值后停在 gap 95（期望 dx=+5，链式解偏差 5 < 6）
  await page.mouse.move(160, sy(240));
  await page.mouse.down();
  await page.mouse.move(120, sy(240), { steps: 4 }); // dx=-40（牵引成立，gap 140 无命中）
  await page.mouse.move(165, sy(240), { steps: 4 }); // dx=+5 → 吸附回等距位
  await page.waitForTimeout(150);
  expect(await gapsProbe()).toEqual(['x:100', 'x:100']); // A↔M 与 M↔R 两段徽标
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect.poll(() => geomOf(page, lId)).toEqual({ x: 100, y: 200 }); // 落库在等距位

  // 2. 对称拖右端 R：停在 gap 95（期望 dx=-5）→ 吸附回 540
  await page.mouse.move(600, sy(240));
  await page.mouse.down();
  await page.mouse.move(640, sy(240), { steps: 4 }); // dx=+40（牵引成立）
  await page.mouse.move(595, sy(240), { steps: 4 }); // dx=-5 → 吸附回等距位
  await page.waitForTimeout(150);
  expect(await gapsProbe()).toEqual(['x:100', 'x:100']);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect.poll(() => geomOf(page, rId)).toEqual({ x: 540, y: 200 });
});

test('C 粘滞落库：吸上后过冲 3px 仍被拉回线上（松手位置 = 对齐线）', async ({ page }) => {
  await page.goto(`/?doc=e2e-refline-sticky-${Date.now()}`);
  await ready(page);

  // 布局：A(400,200) 作参照；B(100,320) 异排（y 投影不重叠 → 等距不参与）
  await dragCreateRect(page, 400, 200);
  const bId = await dragCreateRect(page, 100, 320);

  // 拖 B 右移到左缘期望 396（dx=296）：距 A 左缘 400 为 4，接近侧吸上（修正 dx=300）
  await page.mouse.move(160, sy(360));
  await page.mouse.down();
  await page.mouse.move(160 + 296, sy(360), { steps: 6 });
  await page.waitForTimeout(80);
  // 过冲 3px（期望左缘 403）：无粘滞时线在身后被方向过滤 → 脱钩停 403；
  // 粘滞让上一帧命中线双向保持 → 拉回 400
  await page.mouse.move(160 + 303, sy(360), { steps: 2 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const b = await geomOf(page, bId);
  expect(b.x).toBeCloseTo(400, 1);
});
