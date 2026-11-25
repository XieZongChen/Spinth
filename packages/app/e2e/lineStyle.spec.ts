/** 连线样式 E2E（docs/08 批次 3/4）：ActionBar 线型/箭头/曲线/多级 popover */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { createRect, createTwoRects, barPick, lineSelectionState } from './helpers/widgetProbeE2e';

type Pt = [number, number];

/** 线的文档真值（model.toJSON）——undo·redo 路径上 vm.state 可能滞后，断言读文档 */
async function lineDoc(page: Page): Promise<{ lineType: string; points: Pt[]; pinned: boolean }> {
  return page.evaluate(() => {
    const dbg = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmStates: Array<Record<string, unknown>>;
            engine: { getModelById(id: string): { toJSON(): unknown } | undefined };
          };
        };
      }
    ).__spinthDebug.__debug;
    const id = String(dbg.vmStates.find((s) => s.type === 'LINE')!.id);
    const data = dbg.engine.getModelById(id)!.toJSON() as {
      lineType: string;
      points: Pt[];
      pinned?: boolean;
    };
    return { lineType: data.lineType, points: data.points, pinned: data.pinned ?? false };
  });
}

/** shoelace 有向面积（自环非零面积断言；两端锚点重合的退化线为 0） */
function polyArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** 全段轴对齐且无零长段（折线路由口径） */
function isOrthogonal(pts: Pt[]): boolean {
  return pts.every((p, i) => {
    if (i === 0) return true;
    const dx = Math.abs(p[0] - pts[i - 1]![0]);
    const dy = Math.abs(p[1] - pts[i - 1]![1]);
    return Math.hypot(dx, dy) > 0.5 && (dx < 0.5 || dy < 0.5);
  });
}

/** x 极差（自环跨度） */
function spanX(pts: Pt[]): number {
  return Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
}

async function canvasOffset(page: Page): Promise<{ left: number; top: number }> {
  const r = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  return { left: r.left, top: r.top };
}

/** 点线身上一点选中（世界坐标 + canvas rect 偏移） */
async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const c = await canvasOffset(page);
  await page.mouse.click(x + c.left, y + c.top);
  await page.waitForTimeout(250);
}

/** 点线身中段中点选中（首末两点中点不一定在路径上，docs/15） */
async function clickLineMid(page: Page, pts: Pt[]): Promise<void> {
  const midI = Math.floor(pts.length / 2);
  await clickWorld(
    page,
    (pts[midI - 1]![0] + pts[midI]![0]) / 2,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2,
  );
}

/** 建左右两个矩形（世界 (400,256,120,80) / (700,256,120,80)）并从左件右边拉线到
 *  右件左边——两端锚定。拖拽画图完成后工具自动回选择模式，矩形逐个建；
 *  按下/松手取边内侧一点，锚定边由最近边判定 */
async function createLinkedRects(page: Page): Promise<void> {
  await createRect(page, 460, 340);
  await createRect(page, 760, 340);
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(516, 340);
  await page.mouse.down();
  await page.mouse.move(704, 340, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

/** 世界坐标拖拽（起点按下 → 分步移动 → 松手） */
async function dragWorld(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const c = await canvasOffset(page);
  await page.mouse.move(x1 + c.left, y1 + c.top);
  await page.mouse.down();
  await page.mouse.move(x2 + c.left, y2 + c.top, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** 选中线并把线身中段下滑 40（段滑移：唯一段拆五点、pinned），返回滑移后的文档真值 */
async function selectAndPinLine(page: Page) {
  const pts = (await lineDoc(page)).points;
  const midI = Math.floor(pts.length / 2);
  const mx = (pts[midI - 1]![0] + pts[midI]![0]) / 2;
  const my = (pts[midI - 1]![1] + pts[midI]![1]) / 2;
  await clickWorld(page, mx, my);
  await dragWorld(page, mx, my, mx, my + 40);
  const pinned = await lineDoc(page);
  expect(pinned.pinned).toBe(true);
  expect(pinned.points.length).toBeGreaterThan(2);
  return pinned;
}

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

test('ActionBar popover 互斥：连点两个触发钮同屏至多一面板（2026-11 用户实测）', async ({
  page,
}) => {
  const docId = `e2e-bar-mutex-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  // 画线 → Esc 清选区 → 点线身选中（ActionBar 出现，LINE schema）
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
  // 连点第二个触发钮：旧面板收、新面板开（开合单源 openPopoverId 互斥）
  await bar.locator('button[aria-label="线型"]').click();
  await expect(page.locator('[data-spinth-popover-panel]')).toHaveCount(1);
  await bar.locator('button[aria-label="线宽"]').click();
  await expect(page.locator('[data-spinth-popover-panel]')).toHaveCount(1);
  expect(await bar.locator('button[aria-label="线型"]').getAttribute('aria-expanded')).toBe(
    'false',
  );
  expect(await bar.locator('button[aria-label="线宽"]').getAttribute('aria-expanded')).toBe('true');

  // 点 bar 内 toggle（虚线）也收起面板（bar 内 pointerdown 被容器
  // stopPropagation 遮蔽、到不了 window outside-click，由容器统一关闭）
  await bar.locator('button[aria-label="虚线"]').click();
  await expect(page.locator('[data-spinth-popover-panel]')).toHaveCount(0);
});

// ---- 线型切回折线（docs/08 §7 自环 / §10.3）：重路由与锚定跟随同一路由 ----

test('线型切回折线：同边自环 直线 → 折线 仍是 U 形环（跨度 80、非零面积）', async ({ page }) => {
  await page.goto(`/?doc=e2e-linetype-selfloop-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)：顶边 y=316
  await page.getByRole('button', { name: /连线/ }).click();
  // 顶边内侧拖回顶边（同节点同边、单点 0.5）→ U 形自环：跨度 80（460..540）
  await page.mouse.move(500, 362);
  await page.mouse.down();
  await page.mouse.move(510, 362, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const loop = await lineDoc(page);
  expect(loop.lineType).toBe('ELBOWED');
  expect(spanX(loop.points)).toBeCloseTo(80, 0);

  // 回 cursor → 点环顶段中点选中 → 切直线（切型不改 points，只换渲染方式）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await clickWorld(page, 500, 286);
  await barPick(page, '线型', '直线');
  await page.waitForTimeout(250);
  expect((await lineDoc(page)).lineType).toBe('STRAIGHT');

  // 切回折线：按当前两端锚点重路由——同节点同边走自环分支，仍是环。
  // 重路由若直接走常规正交路由，两端锚点重合会被压成两个重合点（环消失）
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  const back = await lineDoc(page);
  expect(back.lineType).toBe('ELBOWED');
  expect(back.points.length).toBeGreaterThanOrEqual(4);
  expect(isOrthogonal(back.points)).toBe(true);
  expect(spanX(back.points)).toBeCloseTo(80, 0);
  expect(Math.abs(polyArea(back.points))).toBeGreaterThan(1000);
});

test('线型切回折线：直线期间拖动宿主致端点漂移 → 重路由与切型同属一步撤销', async ({ page }) => {
  await page.goto(`/?doc=e2e-linetype-reroute-${Date.now()}`);
  await waitForSynced(page);
  await createLinkedRects(page);

  // 选中 → 切直线
  await clickLineMid(page, (await lineDoc(page)).points);
  await barPick(page, '线型', '直线');
  await page.waitForTimeout(250);
  expect((await lineDoc(page)).lineType).toBe('STRAIGHT');

  // 拖右件下移 80：直线期间只替换锚定端点，两点一横一纵都不齐（斜线）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.move(760, 340);
  await page.mouse.down();
  await page.mouse.move(760, 420, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const stale = await lineDoc(page);
  expect(stale.points).toHaveLength(2);
  expect(Math.abs(stale.points[0]![0] - stale.points[1]![0])).toBeGreaterThan(50);
  expect(Math.abs(stale.points[0]![1] - stale.points[1]![1])).toBeGreaterThan(50);

  // 选中斜线中点 → 切回折线：按当前两端锚点重路由成全段轴对齐，两端锚点保持
  await clickLineMid(page, stale.points);
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  const routed = await lineDoc(page);
  expect(routed.lineType).toBe('ELBOWED');
  expect(routed.points.length).toBeGreaterThanOrEqual(3);
  expect(isOrthogonal(routed.points)).toBe(true);
  expect(routed.points[0]).toEqual(stale.points[0]);
  expect(routed.points.at(-1)).toEqual(stale.points[1]);

  // 一步撤销同时回退切型与重路由——重路由落在切型事务内，不裂成第二步
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  const undone = await lineDoc(page);
  expect(undone.lineType).toBe('STRAIGHT');
  expect(undone.points).toEqual(stale.points);
});

test('线型：折线 → 曲线 → undo → redo 回曲线（撤销落回折线不产生幻影写入）', async ({ page }) => {
  await page.goto(`/?doc=e2e-linetype-redo-${Date.now()}`);
  await waitForSynced(page);
  await createLinkedRects(page);

  const elbowed = await lineDoc(page);
  expect(elbowed.lineType).toBe('ELBOWED');
  expect(isOrthogonal(elbowed.points)).toBe(true);
  await clickLineMid(page, elbowed.points);
  await barPick(page, '线型', '曲线');
  await page.waitForTimeout(250);
  expect((await lineDoc(page)).lineType).toBe('CURVE');

  // undo 落回折线：路由本就是正解，重路由不得再写 points——写了就是一步幻影撤销，
  // 且清空重做栈
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  const undone = await lineDoc(page);
  expect(undone.lineType).toBe('ELBOWED');
  expect(undone.points).toEqual(elbowed.points);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(250);
  expect((await lineDoc(page)).lineType).toBe('CURVE');
});

test('线型：pinned 折线 → 曲线 → undo 原样恢复手调路由与 pinned，redo 回曲线', async ({ page }) => {
  await page.goto(`/?doc=e2e-linetype-pinned-undo-${Date.now()}`);
  await waitForSynced(page);
  await createLinkedRects(page);
  const pinned = await selectAndPinLine(page);

  await barPick(page, '线型', '曲线');
  await page.waitForTimeout(250);
  expect((await lineDoc(page)).lineType).toBe('CURVE');

  // undo 恢复的是切型前的历史状态，路由本就自洽——此时重路由会按 pinned:false
  // 覆盖手调路由，且写入本身是一步幻影撤销并清空重做栈
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  const undone = await lineDoc(page);
  expect(undone.lineType).toBe('ELBOWED');
  expect(undone.pinned).toBe(true);
  expect(undone.points).toEqual(pinned.points);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(250);
  expect((await lineDoc(page)).lineType).toBe('CURVE');
});

test('线型：已是折线时再选折线——pinned 路由原样保留', async ({ page }) => {
  await page.goto(`/?doc=e2e-linetype-repick-${Date.now()}`);
  await waitForSynced(page);
  await createLinkedRects(page);
  const pinned = await selectAndPinLine(page);

  // 线型没变就不该触发任何重路由（重复点选当前项是幂等操作）
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  const after = await lineDoc(page);
  expect(after.lineType).toBe('ELBOWED');
  expect(after.pinned).toBe(true);
  expect(after.points).toEqual(pinned.points);
});
