/** 连线样式 E2E（docs/08 批次 3/4）：ActionBar 线型/箭头/曲线/多级 popover */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { createTwoRects, barPick, lineSelectionState } from './helpers/widgetProbeE2e';

async function lineStyle(
  page: Page,
): Promise<{ lineType: string; startArrow: string; endArrow: string }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const l = d.find((s) => s.type === 'LINE') as unknown as {
      lineType: string;
      startArrow: string;
      endArrow: string;
    };
    return { lineType: l.lineType, startArrow: l.startArrow, endArrow: l.endArrow };
  });
}

test('批次3：ActionBar 线型/箭头切换——折线与菱形落库 + undo 回退', async ({ page }) => {
  const docId = `e2e-batch3-style-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  // 画线（工具保持激活）→ Esc 回 cursor 并清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED'); // 新线一律正交折线（docs/08 §4 决策）

  // 点线身选中（路径中段中点——首末中点在肘部内侧不在路径上，docs/15）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(200);

  // ActionBar「折线」→ lineType 落库 ELBOWED（rerouteLine 随 lineType diff 触发重路由）。
  // v2 多级：点「线型」触发钮展开面板 → 点「折线」选项
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED');

  // 终点箭头「菱形箭头」（v2：两组箭头独立触发钮，「终点箭头」面板内选择）
  await barPick(page, '终点箭头', '菱形箭头');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).endArrow).toBe('diamond');

  // 单事务落库 + stopCapturing → undo 一步回退菱形（ControlOrMeta 平台映射键）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).endArrow).toBe('arrow');
});

/** ActionBar v2 多级控件（2026-10-03）：点触发钮展开二级面板 → 点选项应用 */

test('批次4：曲线线型——ActionBar 切换 CURVE 落库 + undo + 选中态端点圆无段条', async ({ page }) => {
  const docId = `e2e-batch4-curve-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  // 画线（ELBOWED，锚定走廊点将成为曲线切向）→ Esc 清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 选中线（段 1/4 处，避开段条抓取区）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // ActionBar「曲线」→ lineType 落库 CURVE（schema 枚举 + updateSelectedStyle 管线；v2 多级）
  await barPick(page, '线型', '曲线');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('CURVE');

  // 曲线选中态：端点圆仍在、无段条（flatten 短弦全被 majorSegments 过滤——
  // 曲线无段语义，段滑移禁用）
  const sel = await lineSelectionState(page);
  expect(sel.segments).toEqual([]);

  // undo 一步回退 ELBOWED（单事务）；段条恢复
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED');
  const sel2 = await lineSelectionState(page);
  expect(sel2.segments!.length).toBeGreaterThan(0);

  // 再切曲线：命中走 flatten 折线（线上文字 ratio 定位复用）——点贝塞尔
  // t=0.5 中点重新选中再切回折线（连线中点不在曲线上——S 弯沿切向偏移）
  await barPick(page, '线型', '曲线');
  await page.waitForTimeout(250);
  const curveMid = await page.evaluate(
    ({ pts }: { pts: Array<[number, number]> }) => {
      const p = pts.map((q) => ({ x: q[0], y: q[1] }));
      const p0 = p[0]!;
      const p3 = p[p.length - 1]!;
      const norm = (ax: number, ay: number, bx: number, by: number) => {
        const l = Math.hypot(bx - ax, by - ay) || 1;
        return { x: (bx - ax) / l, y: (by - ay) / l };
      };
      const d0 = p.length > 2 ? norm(p0.x, p0.y, p[1]!.x, p[1]!.y) : norm(p0.x, p0.y, p3.x, p3.y);
      const d3 =
        p.length > 2
          ? norm(p3.x, p3.y, p[p.length - 2]!.x, p[p.length - 2]!.y)
          : norm(p3.x, p3.y, p0.x, p0.y);
      const arm = Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4;
      const c1 = { x: p0.x + d0.x * arm, y: p0.y + d0.y * arm };
      const c2 = { x: p3.x + d3.x * arm, y: p3.y + d3.y * arm };
      // 三次贝塞尔 t=0.5 = (p0 + 3c1 + 3c2 + p3) / 8
      return {
        x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
        y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
      };
    },
    { pts },
  );
  await page.mouse.click(curveMid.x + c.left, curveMid.y + c.top);
  await page.waitForTimeout(200);
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED');
});

test('ActionBar v2：多级 popover + 中文 tooltip + bar 收窄（参考视频规格）', async ({ page }) => {
  const docId = `e2e-bar-v2-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar).toBeVisible();

  // 1) 一级 9 个按钮位（线型/线宽笔宽批增的线宽/虚线/起箭头/终箭头/颜色 +
  //    排版打磨批 B 增的字号/文字颜色，再/删除）——原 11 个文字平铺位收进二级
  //    面板（v2 定案）；LINE 排版项无对齐（恒 center 与锚点绑定，docs/17 §4）
  const labels = await bar
    .locator('button[aria-label]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual([
    '线型',
    '线宽',
    '虚线',
    '起点箭头',
    '终点箭头',
    '颜色',
    '字号',
    '文字颜色',
    '导出 PNG',
    '删除',
  ]);
  // 2) bar 收窄护栏（原 LINE 全套文字样式 ~400px+；排版批 B +2 位实测 ~337、
  //    线宽批 +1 图标位 ~371、导出批 +1 公共动作位 ~405——阈值 430。35 轮 🟡
  //    「再抬时重审」注：导出为一次性动作钮非样式项（不属「收纳稀释」），且
  //    相对原始 400+ 平铺仍显著收窄；下次样式项再挤入时应转次级 popover）
  expect(await bar.evaluate((el) => el.offsetWidth)).toBeLessThan(430);

  // 3) 点「线型」→ 二级面板现身、触发钮 expanded、当前值描边圈（aria-checked）
  await bar.locator('button[aria-label="线型"]').click();
  const panel = page.locator('[data-spinth-popover-panel]');
  await expect(panel).toBeVisible();
  expect(await bar.locator('button[aria-label="线型"]').getAttribute('aria-expanded')).toBe('true');
  expect(await panel.locator('button[aria-checked="true"]').getAttribute('aria-label')).toBe(
    '折线',
  ); // 新线一律 ELBOWED

  // 4) 面板展开时触发钮 tooltip 抑制（hover 600ms 无气泡）
  await bar.locator('button[aria-label="线型"]').hover();
  await page.waitForTimeout(900); // tooltip 400ms 延迟 + 负载余量（全套件并发时敏，隔离复跑绿）
  expect(await page.locator('[data-spinth-tooltip]').count()).toBe(0);

  // 5) Esc 收起；hover「虚线」600ms → 中文 tooltip 现身、移开即隐
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await bar.locator('button[aria-label="虚线"]').hover();
  await page.waitForTimeout(900); // tooltip 400ms 延迟 + 负载余量（全套件并发时敏，隔离复跑绿）
  await expect(page.locator('[data-spinth-tooltip]')).toHaveText('虚线');
  await page.mouse.move(20, 600);
  await expect(page.locator('[data-spinth-tooltip]')).toHaveCount(0);

  // 6) 色板 popover（swatch 选项）：点选落库 + 点选后面板收起
  await bar.locator('button[aria-label="颜色"]').click();
  await page.locator('[data-spinth-popover-panel] button').nth(2).click(); // LINE_PALETTE[2] #2563eb
  await page.waitForTimeout(250);
  const color = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return String((d.find((s) => s.type === 'LINE') as { color: string }).color);
  });
  expect(color).toBe('#2563eb');
  expect(await page.locator('[data-spinth-popover-panel]').count()).toBe(0);
});
