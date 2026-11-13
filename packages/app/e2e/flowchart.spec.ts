/** 标准流程图收口 E2E（specs/flowchart-closeout §18.3）：F-1…F-8。
 *  坐标纪律（docs/15）：断言一律走 __spinthDebug.__debug 探针（世界坐标）；
 *  指针操作坐标 = 世界坐标 + canvas rect 偏移（本布局 canvas 顶边 ≈ 屏幕 y+44）。 */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { barPick, createRect, lineProbe } from './helpers/widgetProbeE2e';
import { probe } from './helpers/alignE2e';

type Pt = [number, number];

/** LINE vm 状态投影（锚定字段 + points；字段名即 schema，docs/08 §3） */
interface ILineSnap {
  points: Pt[];
  startNodeId: string | null;
  endNodeId: string | null;
  startJoin: string | null;
  endJoin: string | null;
  pinned?: boolean;
  startArrow?: string;
  text?: string;
}

async function linesOf(page: Page): Promise<ILineSnap[]> {
  const p = await probe(page);
  return p.vmStates.filter((s) => s.type === 'LINE') as unknown as ILineSnap[];
}

async function firstLine(page: Page): Promise<ILineSnap> {
  return (await linesOf(page))[0]!;
}

async function canvasOffset(page: Page): Promise<{ left: number; top: number }> {
  const r = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  return { left: r.left, top: r.top };
}

/** 画一条锚定线（连线工具已激活；屏幕坐标直给，调用方保证起止在形状上） */
async function drawLine(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** 回 cursor 并点线身选中（路径中段中点——首末中点在肘部内侧不在路径上）；
 *  返回选中前 points（F-8 拖拐点的前值基准） */
async function selectLineBody(page: Page): Promise<Pt[]> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const c = await canvasOffset(page);
  const pts = (await firstLine(page)).points;
  const mid = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[mid - 1]![0] + pts[mid]![0]) / 2 + c.left,
    (pts[mid - 1]![1] + pts[mid]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);
  return pts;
}

/** v 到最近 16 倍数的距离（网格吸附断言：0 = 贴格点） */
function gridRem(v: number): number {
  const r = ((v % 16) + 16) % 16;
  return Math.min(r, 16 - r);
}

/** shoelace 有向面积（自环非零面积断言） */
function polyArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** 线段与矩形严格相交（内缩 0.5 防贴边误报；docs/15 AABB 口径） */
function segCrossRect(a: Pt, b: Pt, r: { x: number; y: number; width: number; height: number }) {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return x0 < r.x + r.width - 0.5 && x1 > r.x + 0.5 && y0 < r.y + r.height - 0.5 && y1 > r.y + 0.5;
}

// ---------------------------------------------------------------------------

test('F-1 白底黑框：填充/边框色/边框宽落库 + 无填充两态 + 导出选中集 PNG', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-style-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 350);
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.click(500, 350); // 选中（世界 500,306 在 A 内）
  await page.waitForTimeout(250);

  // S1 样本：白底 + 黑框 + 2px
  await barPick(page, '填充色', '#ffffff');
  await barPick(page, '边框色', '#000000');
  await barPick(page, '边框宽', '2 px');
  await page.waitForTimeout(250);
  let s = (await probe(page)).vmStates.find((v) => v.type === 'SHAPE')!;
  expect(s.color).toBe('#ffffff');
  expect(s.fill).toBe('solid');
  expect(s.borderColor).toBe('#000000');
  expect(Number(s.borderWidth)).toBe(2);

  // 无填充两态（§4.2）：只剩描边；切回白底恢复 solid
  await barPick(page, '填充色', '无填充');
  await page.waitForTimeout(250);
  s = (await probe(page)).vmStates.find((v) => v.type === 'SHAPE')!;
  expect(s.fill).toBe('none');
  await barPick(page, '填充色', '#ffffff');
  await page.waitForTimeout(250);

  // 导出成功（ActionBar 公共尾部；download 事件即产物）
  const dl = page.waitForEvent('download', { timeout: 10_000 });
  await page.locator('[data-spinth-action-bar] button[aria-label="导出 PNG"]').click();
  expect((await dl).suggestedFilename()).toBe('spinth-selection.png');
});

test('F-2 同边多线：三条线锚 A 右缘/B 左缘 → 端点互异且按 0.35/0.5/0.65 等距', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-spread-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 450, 350); // A 世界 (390,266,120,80)
  await createRect(page, 850, 350); // B 世界 (790,266,120,80)
  await page.getByRole('button', { name: /连线/ }).click();
  // 起止压在 A 右缘/B 左缘中点附近（join 固定 right/left——同边分组的键）
  for (let i = 0; i < 3; i++) {
    await drawLine(page, 505, 350, 795, 350);
  }
  const ls = await linesOf(page);
  expect(ls).toHaveLength(3);
  for (const l of ls) {
    expect(l.startJoin).toBe('right');
    expect(l.endJoin).toBe('left');
    expect(l.startNodeId).not.toBeNull();
    expect(l.endNodeId).not.toBeNull();
  }
  // A 右缘 x=510、y = 266 + 80t（t=0.35/0.5/0.65 → 294/306/318，等距 12）
  const startYs = ls.map((l) => l.points[0]![1]).sort((a, b) => a - b);
  expect(new Set(startYs).size).toBe(3); // 端点互异
  expect(startYs[0]!).toBeCloseTo(294, 0);
  expect(startYs[1]!).toBeCloseTo(306, 0);
  expect(startYs[2]!).toBeCloseTo(318, 0);
  expect(startYs[1]! - startYs[0]!).toBeCloseTo(startYs[2]! - startYs[1]!, 1);
  for (const l of ls) {
    expect(l.points[0]![0]).toBeCloseTo(510, 0);
    expect(l.points[l.points.length - 1]![0]).toBeCloseTo(790, 0); // B 左缘
  }
});

test('F-3 轮廓锚点：三角形快照贴轮廓 + 实际拉线起点贴斜边中点（判别实现）', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-anchor-tri-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.click(500, 400); // 世界 (500,356) = 中心
  await page.waitForTimeout(250);
  await barPick(page, '图形类型', '上三角');
  await page.waitForTimeout(250);

  // 连线工具悬停 → 四锚点快照（世界坐标）。
  // 上三角轮廓（局部 (60,0)/(120,80)/(0,80)）P→中心射线交点：left/right 落
  // 斜边中点 (30,40)/(90,40)——与 bbox 边中点 (0,40)/(120,40) 相差 30px，
  // 判别快照真走轮廓而非 bbox
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(500, 400);
  await page.waitForTimeout(150);
  const anchors = (await lineProbe(page)).lineAnchors!;
  expect(anchors).toHaveLength(4);
  const expected = [
    { x: 500, y: 316 }, // top：顶点（恰与 bbox 重合）
    { x: 530, y: 356 }, // right：右斜边中点
    { x: 500, y: 396 }, // bottom：底边中点（恰与 bbox 重合）
    { x: 470, y: 356 }, // left：左斜边中点
  ];
  for (const e of expected) {
    const hit = anchors.some((a) => Math.abs(a.x - e.x) <= 1 && Math.abs(a.y - e.y) <= 1);
    expect(hit, `锚点应贴轮廓交点 (${e.x},${e.y})，实际 ${JSON.stringify(anchors)}`).toBe(true);
  }
  // 反向判别：bbox 左右边中点 (440/560,356) 不在快照里
  for (const wrong of [
    { x: 440, y: 356 },
    { x: 560, y: 356 },
  ]) {
    const hit = anchors.some((a) => Math.abs(a.x - wrong.x) <= 1 && Math.abs(a.y - wrong.y) <= 1);
    expect(hit, `bbox 边中点 (${wrong.x},${wrong.y}) 不应出现在锚点快照中`).toBe(false);
  }

  // 实际拉线：从右斜边内侧按下（世界 (525,356)，join=right）→ 落库起点 =
  // 轮廓锚点 (530,356)，不是 bbox 边中点 (560,356)（快照与落线同源的端到端锁）
  await drawLine(page, 525, 400, 740, 400); // 屏幕 = 世界 + (0,44)
  const line = await firstLine(page);
  expect(line.startJoin).toBe('right');
  expect(line.startNodeId).not.toBeNull();
  expect(line.points[0]![0]).toBeCloseTo(530, 0);
  expect(line.points[0]![1]).toBeCloseTo(356, 0);
  expect(Math.abs(line.points[0]![0] - 560)).toBeGreaterThan(4); // ≠ bbox 边中点
});

test('F-3b 轮廓锚点：菱形四锚点 = 轮廓四顶点（贴边 ≤1px）', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-diamond-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.click(500, 400); // 世界 (500,356) = 中心
  await page.waitForTimeout(250);
  await barPick(page, '图形类型', '菱形');
  await page.waitForTimeout(250);

  // 连线工具悬停 → 四锚点（世界坐标）
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(500, 400);
  await page.waitForTimeout(150);
  const anchors = (await lineProbe(page)).lineAnchors!;
  expect(anchors).toHaveLength(4);
  // 菱形轮廓顶点：上/右/下/左（锚点在轮廓上——不是 bbox 角点）
  const expected = [
    { x: 500, y: 316 },
    { x: 560, y: 356 },
    { x: 500, y: 396 },
    { x: 440, y: 356 },
  ];
  for (const e of expected) {
    const hit = anchors.some((a) => Math.abs(a.x - e.x) <= 1 && Math.abs(a.y - e.y) <= 1);
    expect(hit, `锚点应贴轮廓顶点 (${e.x},${e.y})，实际 ${JSON.stringify(anchors)}`).toBe(true);
  }
});

test('F-3c 轮廓锚点：平行四边形左右锚点贴斜边（≠ bbox 边中点）', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-anchor-par-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.click(500, 400);
  await page.waitForTimeout(250);
  await barPick(page, '图形类型', '右平行四边形');
  await page.waitForTimeout(250);

  // 轮廓 = [(21.6,0),(120,0),(98.4,80),(0,80)]（skew = 120×0.18）：
  // right 锚点 = 右斜边中点 (109.2,40)、left 锚点 = 左斜边中点 (10.8,40)
  // ——分别与 bbox 边中点 (0,40)/(120,40) 相差 10.8px
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(500, 400);
  await page.waitForTimeout(150);
  const anchors = (await lineProbe(page)).lineAnchors!;
  expect(anchors).toHaveLength(4);
  const expected = [
    { x: 500, y: 316 }, // top：上边中点（x=60 ∈ (21.6,120)，恰与 bbox 重合）
    { x: 549.2, y: 356 }, // right：右斜边中点
    { x: 500, y: 396 }, // bottom：下边中点（x=60 ∈ (0,98.4)）
    { x: 450.8, y: 356 }, // left：左斜边中点
  ];
  for (const e of expected) {
    const hit = anchors.some((a) => Math.abs(a.x - e.x) <= 1 && Math.abs(a.y - e.y) <= 1);
    expect(hit, `锚点应贴轮廓交点 (${e.x},${e.y})，实际 ${JSON.stringify(anchors)}`).toBe(true);
  }
  for (const wrong of [
    { x: 440, y: 356 },
    { x: 560, y: 356 },
  ]) {
    const hit = anchors.some((a) => Math.abs(a.x - wrong.x) <= 1 && Math.abs(a.y - wrong.y) <= 1);
    expect(hit, `bbox 边中点 (${wrong.x},${wrong.y}) 不应出现在锚点快照中`).toBe(false);
  }
});

test('F-4 避障：中间节点挡路 → 绕行不穿 AABB + 探针记录障碍集合', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-obstacle-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 450, 350); // A 世界 (390,266)
  await createRect(page, 850, 350); // B 世界 (790,266)
  await createRect(page, 650, 350); // C 世界 (590,266,120,80)——直连必穿
  await page.getByRole('button', { name: /连线/ }).click();
  await drawLine(page, 505, 350, 795, 350); // A 右缘 → B 左缘（水平走廊正穿 C）
  const p = await probe(page);
  const line = (await linesOf(page))[0]!;
  expect(line.startJoin).toBe('right');
  expect(line.endJoin).toBe('left');

  // 探针：C 进了最近一次重路由的避障集合
  const obstacles = await page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { lastRouteObstacles: Array<Record<string, number>> | null } };
        }
      ).__spinthDebug.__debug.lastRouteObstacles,
  );
  expect(obstacles).not.toBeNull();
  const c = p.vmStates
    .filter((s) => s.type === 'SHAPE')
    .find((s) => Number(s.x) === 590) as unknown as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(
    obstacles!.some(
      (o) =>
        Math.abs(o.x! - c.x) <= 1 &&
        Math.abs(o.y! - c.y) <= 1 &&
        Math.abs(o.width! - c.width) <= 1 &&
        Math.abs(o.height! - c.height) <= 1,
    ),
  ).toBe(true);

  // 绕行：折线任一段不与 C 的 AABB 相交
  const pts = line.points;
  expect(pts.length).toBeGreaterThanOrEqual(3); // 有绕行拐点
  for (let i = 0; i + 1 < pts.length; i++) {
    expect(segCrossRect(pts[i]!, pts[i + 1]!, c)).toBe(false);
  }
});

test('F-5 自环：同节点拖回生成非零面积正交环 + 选中/拖段/加箭头/加标签/逐步撤销', async ({
  page,
}) => {
  await page.goto(`/?doc=e2e-fc-selfloop-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)：顶边 y=316 / 底边 y=396
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(500, 362); // 世界 (500,318)：顶边内侧 2px → join top
  await page.mouse.down();
  await page.mouse.move(500, 438, { steps: 4 }); // 世界 (500,394)：底边内侧 2px → join bottom
  await page.mouse.up();
  await page.waitForTimeout(300);

  const p = await probe(page);
  expect(p.modelCount).toBe(2); // 形状 + 自环线
  const line = p.vmStates.find((s) => s.type === 'LINE') as unknown as ILineSnap;
  expect(line.startNodeId).not.toBeNull();
  expect(line.startNodeId).toBe(line.endNodeId); // 同节点
  const pts = line.points;
  expect(pts.length).toBeGreaterThanOrEqual(4); // 对边矩形环 6 点
  expect(Math.abs(polyArea(pts))).toBeGreaterThan(1000); // 非零面积（≈16000）
  for (let i = 0; i + 1 < pts.length; i++) {
    const axisAligned =
      Math.abs(pts[i]![0] - pts[i + 1]![0]) < 0.5 || Math.abs(pts[i]![1] - pts[i + 1]![1]) < 0.5;
    expect(axisAligned).toBe(true); // 全段正交、不自交
  }

  // ---- 可选中（spec §18.1：选中/拖段/加箭头/加标签/撤销）----
  await selectLineBody(page);
  expect((await lineProbe(page)).selectedIds).toHaveLength(1);

  // ---- 拖段（段滑移）：中段向左 40px → 单事务 points + pinned ----
  const pts1 = (await firstLine(page)).points;
  const c1 = await canvasOffset(page);
  const mid = Math.floor(pts1.length / 2);
  const segX = (pts1[mid - 1]![0] + pts1[mid]![0]) / 2 + c1.left;
  const segY = (pts1[mid - 1]![1] + pts1[mid]![1]) / 2 + c1.top;
  await page.mouse.move(segX, segY);
  await page.mouse.down();
  await page.mouse.move(segX - 40, segY, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const slid = await firstLine(page);
  expect(slid.pinned).toBe(true);
  expect(JSON.stringify(slid.points)).not.toBe(JSON.stringify(pts1));

  // ---- 加箭头（LINE ActionBar 起点箭头 → 实心）----
  await barPick(page, '起点箭头', '实心箭头');
  await page.waitForTimeout(250);
  expect((await firstLine(page)).startArrow).toBe('solid');

  // ---- 加标签（双击线身主段 → 输入 → Esc）----
  const pts2 = (await firstLine(page)).points;
  const mid2 = Math.floor(pts2.length / 2);
  await page.mouse.dblclick(
    (pts2[mid2 - 1]![0] + pts2[mid2]![0]) / 2 + c1.left,
    (pts2[mid2 - 1]![1] + pts2[mid2]![1]) / 2 + c1.top,
  );
  await page.keyboard.type('回退');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect((await firstLine(page)).text).toContain('回退'); // 富文本（htmlDoc）包裹

  // ---- 逐步撤销：标签 → 箭头 → 段滑移 → 自环创建（每操作单事务）----
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  expect((await firstLine(page)).text ?? '').not.toContain('回退');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  expect((await firstLine(page)).startArrow).toBe('none');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  const restored = await firstLine(page);
  expect(restored.pinned ?? false).toBe(false);
  expect(JSON.stringify(restored.points)).toBe(JSON.stringify(pts1)); // 段滑移回拖前
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(1); // 自环创建一步撤销 → 只剩形状
});

test('F-5b 同边自环：A 顶边拖回 A 顶边 → U 形跨度 = 目标跨度 80（错开豁免）+ 撤销一步', async ({
  page,
}) => {
  await page.goto(`/?doc=e2e-fc-selfloop-same-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)：顶边 y=316
  await page.getByRole('button', { name: /连线/ }).click();
  // 顶边内侧按下 → 顶边内侧偏移 10px 松手（同 join top、同节点）。
  // 两端恒 0.5（spreadPorts 豁免自环）→ 锚点重合 → routeSelfLoop 按跨度
  // min(max(80, 120×0.5), 120) = 80 展开；若参与错开会分到 0.4/0.6、
  // 锚点差 24px 绕过展开分支压成 24px 窄 U（二轮审查实测）
  await page.mouse.move(500, 362); // 世界 (500,318)：顶边内侧 2px
  await page.mouse.down();
  await page.mouse.move(510, 362, { steps: 3 }); // 世界 (510,318)：仍顶边内侧
  await page.mouse.up();
  await page.waitForTimeout(300);

  const line = await firstLine(page);
  expect(line.startNodeId).not.toBeNull();
  expect(line.startNodeId).toBe(line.endNodeId); // 同节点
  expect(line.startJoin).toBe('top');
  expect(line.endJoin).toBe('top'); // 同边
  const pts = line.points;
  expect(pts.length).toBeGreaterThanOrEqual(4); // U 形 4 点
  for (let i = 0; i + 1 < pts.length; i++) {
    const axisAligned =
      Math.abs(pts[i]![0] - pts[i + 1]![0]) < 0.5 || Math.abs(pts[i]![1] - pts[i + 1]![1]) < 0.5;
    expect(axisAligned).toBe(true); // 全段正交
  }
  // U 形跨度：x 极差 = 80（以边中点 500 为中心 → 460..540）
  const xs = pts.map((p) => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 0);
  expect(Math.min(...xs)).toBeCloseTo(460, 0);

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(1);
});

test('F-6 网格吸附：开后落库坐标 mod 16 = 0，关后自由落点', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-grid-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 450, 350); // 世界 (390,266)——两轴均不贴格
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  const snap = (on: boolean) =>
    page.evaluate(
      (v) =>
        (window as unknown as { __spinth: { setGridSnap(b: boolean): void } }).__spinth.setGridSnap(
          v,
        ),
      on,
    );
  const shapeXY = async () => {
    const s = (await probe(page)).vmStates.find((v) => v.type === 'SHAPE') as unknown as {
      x: number;
      y: number;
    };
    return { x: Number(s.x), y: Number(s.y) };
  };

  // 开 → 拖 (+23,+25)（原始落点两轴余 3/3）→ 量化到 16 倍数
  await snap(true);
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(473, 375, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const a = await shapeXY();
  expect(gridRem(a.x)).toBeLessThanOrEqual(0.5);
  expect(gridRem(a.y)).toBeLessThanOrEqual(0.5);
  expect(a.x).toBeGreaterThan(400); // 确实拖动了

  // 关 → 再拖 (+25,+21)（余 9/3）→ 不对齐（中心 = 世界坐标 + canvas 偏移）
  await snap(false);
  const c = await canvasOffset(page);
  const cx = a.x + 60 + c.left;
  const cy = a.y + 40 + c.top;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 25, cy + 21, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const b = await shapeXY();
  expect(gridRem(b.x)).toBeGreaterThan(1);
  expect(gridRem(b.y)).toBeGreaterThan(1);
});

test('F-6b 网格吸附：便签拖拽创建落点量化（spec §9.2 拖拽创建含便签）', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-grid-sticky-${Date.now()}`);
  await waitForSynced(page);
  await page.evaluate(() =>
    (window as unknown as { __spinth: { setGridSnap(b: boolean): void } }).__spinth.setGridSnap(
      true,
    ),
  );
  // 便签拖拽创建：屏幕 (450,350)→(510,410) = 世界 (450,306)→(510,366)，
  // 两轴均非格点（余 2/2）→ 左上角量化到 448/360 附近
  await page.getByRole('button', { name: /便签/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(510, 410, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s = (await probe(page)).vmStates.find((v) => v.type === 'STICKY') as unknown as {
    x: number;
    y: number;
    width: number;
  };
  expect(s, '便签已创建').toBeDefined();
  expect(gridRem(Number(s.x))).toBeLessThanOrEqual(0.5);
  expect(gridRem(Number(s.y))).toBeLessThanOrEqual(0.5);
  expect(Number(s.width)).toBeGreaterThan(24); // 门控两轴 ≥24（未被量化压瘪）
});

test('F-6c 网格吸附：拉线自由起点/终点量化（未命中控件时）', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-grid-line-${Date.now()}`);
  await waitForSynced(page);
  await page.evaluate(() =>
    (window as unknown as { __spinth: { setGridSnap(b: boolean): void } }).__spinth.setGridSnap(
      true,
    ),
  );
  // 自由起点/终点：屏幕 (450,300)→(505,349) = 世界 (450,256)→(505,305)，
  // x 两端余 2/1——量化后 448/500（y 已贴格）
  await page.getByRole('button', { name: /连线/ }).click();
  await drawLine(page, 450, 300, 505, 349);
  const l = await firstLine(page);
  expect(l.startNodeId).toBeNull();
  expect(l.endNodeId).toBeNull();
  const last = l.points[l.points.length - 1]!;
  for (const [x, y] of [l.points[0]!, last] as Pt[]) {
    expect(gridRem(x)).toBeLessThanOrEqual(0.5);
    expect(gridRem(y)).toBeLessThanOrEqual(0.5);
  }
  expect(l.points[0]![0]).toBeCloseTo(448, 0); // 450 → 448（最近格点）
  expect(last[0]).toBeCloseTo(512, 0); // 505 → 512（31.56 → 32×16）
});

test('F-6d 网格吸附：缩放手柄落库量化（se 角固定 nw）', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-grid-resize-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // 世界 (440,316,120,80)：右缘 560 贴格、下缘 396 余 12
  await page.evaluate(() =>
    (window as unknown as { __spinth: { setGridSnap(b: boolean): void } }).__spinth.setGridSnap(
      true,
    ),
  );
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.click(500, 400); // 中心选中
  await page.waitForTimeout(250);
  const s0 = (await probe(page)).vmStates.find((v) => v.type === 'SHAPE') as unknown as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // 拖东南角手柄 (+37,+29)：右缘 597/下缘 425（均非格点）→ 量化到最近格点
  const c = await canvasOffset(page);
  const corner = { x: s0.x + s0.width + c.left, y: s0.y + s0.height + c.top };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 37, corner.y + 29, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s1 = (await probe(page)).vmStates.find((v) => v.type === 'SHAPE') as unknown as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(gridRem(s1.x + s1.width)).toBeLessThanOrEqual(0.5); // 右缘贴格
  expect(gridRem(s1.y + s1.height)).toBeLessThanOrEqual(0.5); // 下缘贴格
  expect(s1.width).toBeGreaterThan(s0.width); // 确实放大
  expect(s1.x).toBeCloseTo(s0.x, 0); // 固定 nw 角不动
});

test('F-7 清理悬空连线：删中间节点 → API/菜单两路清理计数正确 + 撤销恢复', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-prune-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 450, 350); // A
  await createRect(page, 650, 450); // B（中间节点）
  await createRect(page, 850, 350); // C
  await page.getByRole('button', { name: /连线/ }).click();
  await drawLine(page, 450, 350, 650, 450); // A→B
  await drawLine(page, 650, 450, 850, 350); // B→C
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 删 B：两条线各断一端、保留
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.click(650, 450);
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const p = await probe(page);
  expect(p.modelCount).toBe(4); // 2 形状 + 2 悬空线
  const dangling = await linesOf(page);
  expect(dangling).toHaveLength(2);
  for (const l of dangling) {
    expect(l.startNodeId === null || l.endNodeId === null).toBe(true); // 恰好一端断
    expect(l.startNodeId === null && l.endNodeId === null).toBe(false);
  }

  // 公共 API：计数 2、单事务可撤销
  const n = await page.evaluate(() =>
    (
      window as unknown as { __spinth: { pruneDanglingLines(): number } }
    ).__spinth.pruneDanglingLines(),
  );
  expect(n).toBe(2);
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(4); // 一步恢复两线

  // 右键菜单路径（宿主 ContextMenu 注入 canPrune）
  await page.mouse.click(200, 600, { button: 'right' });
  const item = page.getByRole('menuitem', { name: '清理悬空连线' });
  await expect(item).toBeEnabled();
  await item.click();
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(4);
});

test('F-8 拐点手柄：拖单拐点全段保持正交 + 撤销一步还原', async ({ page }) => {
  await page.goto(`/?doc=e2e-fc-corner-${Date.now()}`);
  await waitForSynced(page);
  await createRect(page, 450, 350); // A 世界 (390,266)
  await createRect(page, 850, 550); // B 世界 (790,466)
  await page.getByRole('button', { name: /连线/ }).click();
  await drawLine(page, 450, 350, 850, 550);
  const pts0 = await selectLineBody(page);
  expect(pts0.length).toBeGreaterThanOrEqual(3); // ELBOWED 有内部拐点

  // 拖最靠下的内部拐点（避开 ActionBar——栏浮于选区上方）
  const c = await canvasOffset(page);
  let idx = 1;
  for (let i = 1; i < pts0.length - 1; i++) {
    if (pts0[i]![1] > pts0[idx]![1]) idx = i;
  }
  const corner = pts0[idx]!;
  await page.mouse.move(corner[0] + c.left, corner[1] + c.top);
  await page.mouse.down();
  await page.mouse.move(corner[0] + 40 + c.left, corner[1] + 30 + c.top, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await firstLine(page);
  expect(after.pinned).toBe(true); // 手滑拐点 → pinned（不再自动重路由）
  const pts1 = after.points;
  expect(JSON.stringify(pts1)).not.toBe(JSON.stringify(pts0)); // 拐点动了
  for (let i = 0; i + 1 < pts1.length; i++) {
    const axisAligned =
      Math.abs(pts1[i]![0] - pts1[i + 1]![0]) < 0.5 ||
      Math.abs(pts1[i]![1] - pts1[i + 1]![1]) < 0.5;
    expect(axisAligned, `段 ${i} 应保持正交: ${JSON.stringify(pts1)}`).toBe(true);
  }
  // 首末锚点不随拐点拖动漂移
  expect(pts1[0]![0]).toBeCloseTo(pts0[0]![0], 0);
  expect(pts1[pts1.length - 1]![1]).toBeCloseTo(pts0[pts0.length - 1]![1], 0);

  // 撤销一步（单事务 {points, pinned}）→ 还原
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  const pts2 = (await firstLine(page)).points;
  expect(pts2.length).toBe(pts0.length);
  for (let i = 0; i < pts2.length; i++) {
    expect(pts2[i]![0]).toBeCloseTo(pts0[i]![0], 0);
    expect(pts2[i]![1]).toBeCloseTo(pts0[i]![1], 0);
  }
});
