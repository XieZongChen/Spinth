import { expect, test, type Page } from '@playwright/test';

/**
 * 多选对齐/分布 E2E（docs/05 §7，2026-10）。
 *
 * 覆盖面：六向对齐的 x/y 两轴数学、分布等距（两端不动）、可用性（2 选分布禁用/
 * 单选无对齐键）、自由线 points 平移参与、锚定线跟随宿主（对齐后重路由 +
 * undo 一步形状与线同回——单事务含重路由合并的守卫）。
 *
 * 坐标纪律：断言一律走 __spinth.__debug 探针（vmStates/selectedIds/selectionFrame
 * 世界坐标）；点击/框选操作坐标从探针与 canvas rect 反推，禁手写裸屏数字。
 * PEN 不单设用例——commitDrag 平移既有护栏（widgets 4.10），对齐只是新调用方。
 */

interface IProbe {
  modelCount: number;
  selectedIds: string[];
  vmStates: Array<Record<string, unknown>>;
  selectionFrame: { x: number; y: number; width: number; height: number } | null;
  mindNodes: Array<{
    id: string;
    text: string;
    worldRect: { x: number; y: number; width: number; height: number };
  }>;
}

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

async function probe(page: Page): Promise<IProbe> {
  return page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: IProbe } }).__spinth.__debug;
    return {
      modelCount: d.modelCount,
      selectedIds: [...d.selectedIds],
      vmStates: d.vmStates,
      selectionFrame: d.selectionFrame ? { ...d.selectionFrame } : null,
      mindNodes: d.mindNodes,
    };
  });
}

interface RectSnap {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 按世界 x 排序的 SHAPE 快照 */
function shapesOf(p: IProbe): RectSnap[] {
  return p.vmStates
    .filter((s) => s.type === 'SHAPE')
    .map((s) => ({
      id: String(s.id),
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
    }))
    .sort((a, b) => a.x - b.x);
}

/** 线 points 快照（自由线平移/锚定线重路由断言用） */
type Pt = [number, number];
function linePointsOf(p: IProbe): Pt[] {
  const l = p.vmStates.find((s) => s.type === 'LINE') as unknown as { points: Pt[] } | undefined;
  return l ? l.points.map((pt) => [pt[0]!, pt[1]!] as Pt) : [];
}

/** 容差比较（updateRect 两位小数取整 / points 浮点——0.1 内视为相等） */
function close(a: number, b: number, tol = 0.1): boolean {
  return Math.abs(a - b) <= tol;
}

async function createRect(page: Page, cx: number, cy: number): Promise<void> {
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** 空白处框选（起点避开元素） */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function clickBar(page: Page, label: string): Promise<void> {
  await page.locator(`[data-spinth-action-bar] button[aria-label="${label}"]`).click();
  await page.waitForTimeout(300); // 事务 + 观察者（锚定线重路由）沉降
}

/** shift 加选点击：mouse.click 的 modifiers 在本环境（channel:chrome）不达 DOM
 *  事件（dom pointerdown shiftKey=false 实测），必须物理键盘 down/up 包夹。 */
async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

/** 建三块错位矩形（x/y 双轴错开、间隙不等）并框选 */
async function createAndSelectThree(page: Page): Promise<RectSnap[]> {
  await createRect(page, 450, 300); // world ≈ (390,216,120,80)
  await createRect(page, 700, 380); // world ≈ (640,296,120,80)
  await createRect(page, 980, 460); // world ≈ (920,376,120,80)
  await marquee(page, 340, 160, 1120, 560);
  const p = await probe(page);
  expect(p.selectedIds).toHaveLength(3);
  return shapesOf(p);
}

test('左对齐：x 全收敛到选中集最小 x + 选区框跟随 + undo 一步全回', async ({ page }) => {
  const docId = `e2e-align-left-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const before = await createAndSelectThree(page);

  await clickBar(page, '左对齐');

  const after = await probe(page);
  const rects = shapesOf(after);
  const targetX = Math.min(...before.map((r) => r.x));
  // 全部 x 收敛（含原本就在最左的第一块零位移）
  expect(rects.every((r) => close(r.x, targetX))).toBe(true);
  // y 不动（左对齐只动 x）
  expect(rects.every((r, i) => close(r.y, before[i]!.y))).toBe(true);
  // 选区框自动跟随到新包络（左缘 = targetX）
  expect(after.selectionFrame).not.toBeNull();
  expect(close(after.selectionFrame!.x, targetX)).toBe(true);
  // 选中集保持（对齐不清选区）
  expect(after.selectedIds).toHaveLength(3);

  // undo 一步（单事务 = 单撤销单元）：三块全回原位
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = shapesOf(await probe(page));
  expect(
    undone.every((r, i) => close(r.x, before[i]!.x, 0.01) && close(r.y, before[i]!.y, 0.01)),
  ).toBe(true);
});

test('顶对齐：y 全收敛到最小 y（y 轴数学）', async ({ page }) => {
  const docId = `e2e-align-top-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const before = await createAndSelectThree(page);

  await clickBar(page, '顶对齐');

  const rects = shapesOf(await probe(page));
  const targetY = Math.min(...before.map((r) => r.y));
  expect(rects.every((r) => close(r.y, targetY))).toBe(true);
  expect(rects.every((r, i) => close(r.x, before[i]!.x))).toBe(true); // x 不动
});

test('横向分布：相邻间隙相等、两端不动；3 选时分布键可用', async ({ page }) => {
  const docId = `e2e-dist-h-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const before = await createAndSelectThree(page);

  // 3 选：分布键可用（恰 2 选才禁用）
  await expect(
    page.locator('[data-spinth-action-bar] button[aria-label="横向分布"]'),
  ).toBeEnabled();

  await clickBar(page, '横向分布');

  const rects = shapesOf(await probe(page));
  // 两端不动（首块 x=390 本就最小、末块 920 最大）
  expect(close(rects[0]!.x, before[0]!.x, 0.01)).toBe(true);
  expect(close(rects[2]!.x, before[2]!.x, 0.01)).toBe(true);
  // 间隙等距：span 650、总宽 360 → gap = 145（含除法浮点，容差断言）
  const gap1 = rects[1]!.x - (rects[0]!.x + rects[0]!.width);
  const gap2 = rects[2]!.x - (rects[1]!.x + rects[1]!.width);
  expect(close(gap1, 145)).toBe(true);
  expect(close(gap2, 145)).toBe(true);
  expect(close(gap1, gap2, 0.05)).toBe(true);
  // 纵向分布键同理可用（结构断言，不再重复几何用例）
  await expect(
    page.locator('[data-spinth-action-bar] button[aria-label="纵向分布"]'),
  ).toBeEnabled();
});

test('可用性：2 选时分布两键禁用、对齐六键可用；单选无对齐键；多选按钮清单', async ({ page }) => {
  const docId = `e2e-align-avail-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);

  // 单选第一块：bar 无任何对齐键（对齐键只在多选分支）
  await page.mouse.click(450, 300);
  await page.waitForTimeout(250);
  expect(await page.locator('[data-spinth-action-bar] button[aria-label="左对齐"]').count()).toBe(
    0,
  );

  // shift 加选第二块 → 多选 bar：八键 + 删除，分布两键 disabled（参考同款显示但禁用）
  await shiftClick(page, 700, 400);
  await page.waitForTimeout(250);
  const bar = page.locator('[data-spinth-action-bar]');
  const labels = await bar
    .locator('button[aria-label]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual([
    '左对齐',
    '水平居中对齐',
    '右对齐',
    '顶对齐',
    '垂直居中对齐',
    '底对齐',
    '横向分布',
    '纵向分布',
    '编组',
    '导出 PNG',
    '删除',
  ]);
  // 组切换单钮（docs/18 §3.4）：两散件态显示「编组」且可用
  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="横向分布"]')).toBeDisabled();
  await expect(bar.locator('button[aria-label="纵向分布"]')).toBeDisabled();
  await expect(bar.locator('button[aria-label="左对齐"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="底对齐"]')).toBeEnabled();
});

test('自由线参与：左对齐后线 points 平移到目标（y 不动）', async ({ page }) => {
  const docId = `e2e-align-freeline-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 300); // world ≈ (390,216,120,80)

  // 自由线：line 工具空白→空白（两端无绑定），工具保持激活 → Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(900, 420, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  await marquee(page, 340, 160, 1000, 560);
  const before = await probe(page);
  expect(before.selectedIds).toHaveLength(2);
  const ptsBefore = linePointsOf(before);
  expect(ptsBefore.length).toBeGreaterThanOrEqual(2);
  const lineMinXBefore = Math.min(...ptsBefore.map((p) => p[0]!));
  const rectX = shapesOf(before)[0]!.x;

  await clickBar(page, '左对齐');

  const after = await probe(page);
  const ptsAfter = linePointsOf(after);
  expect(ptsAfter).toHaveLength(ptsBefore.length);
  // 目标 = 参与集最小 x = 矩形左缘（矩形在自由线左侧）
  const dx = rectX - lineMinXBefore;
  expect(ptsAfter.every((p, i) => close(p[0]!, ptsBefore[i]![0]! + dx, 0.05))).toBe(true);
  expect(ptsAfter.every((p, i) => close(p[1]!, ptsBefore[i]![1]!, 0.01))).toBe(true);
  expect(close(shapesOf(after)[0]!.x, rectX, 0.01)).toBe(true); // 矩形零位移（已在基准）

  // undo 一步：矩形与自由线同回
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = await probe(page);
  const ptsUndone = linePointsOf(undone);
  expect(ptsUndone.every((p, i) => close(p[0]!, ptsBefore[i]![0]!, 0.01))).toBe(true);
});

test('锚定线跟随宿主：对齐后自动重路由，undo 一步形状与线同回', async ({ page }) => {
  const docId = `e2e-align-anchored-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350); // A world ≈ (390,266,120,80)
  await createRect(page, 850, 550); // B world ≈ (790,466,120,80)

  // 锚定线：line 工具从 A 拖到 B（两端落形状 = 锚定），Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  const created = await probe(page);
  expect(created.modelCount).toBe(3);
  const anchored = created.vmStates.find((s) => s.type === 'LINE') as unknown as {
    startNodeId: string | null;
    endNodeId: string | null;
  };
  expect(anchored.startNodeId).not.toBeNull();
  expect(anchored.endNodeId).not.toBeNull();

  // 可用性按可移动参与数（2026-10-10 审查处置）：形状 + 锚定线 2 选（参与数 1）
  // → 八键全禁用（按选中数会让对齐键可点但命令 no-op 死点击）
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  const lineMid = (() => {
    const pts = linePointsOf(created);
    const mid = Math.floor(pts.length / 2);
    const a = pts[mid - 1] ?? pts[0]!;
    const b = pts[mid] ?? pts[pts.length - 1]!;
    return { x: (a[0]! + b[0]!) / 2 + cRect.left, y: (a[1]! + b[1]!) / 2 + cRect.top };
  })();
  await shiftClick(page, lineMid.x, lineMid.y); // 点线身（路径中段中点）
  await page.waitForTimeout(250);
  const selLine = await probe(page);
  expect(selLine.selectedIds).toHaveLength(2); // {A, 锚定线}
  const bar1 = page.locator('[data-spinth-action-bar]');
  await expect(bar1.locator('button[aria-label="左对齐"]')).toBeDisabled();
  await expect(bar1.locator('button[aria-label="底对齐"]')).toBeDisabled();
  await expect(bar1.locator('button[aria-label="横向分布"]')).toBeDisabled();

  // shift 点选 A、B（避开线——线不在选中集，锚定线不参与对齐、由宿主移动带动）。
  // 先点空白清选区：A 在 {A,线} 选中集内，直接普通点 A 会走「单击已选中 → 进编辑」
  await page.mouse.click(200, 200);
  await page.waitForTimeout(200);
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  await shiftClick(page, 850, 550);
  await page.waitForTimeout(250);
  const before = await probe(page);
  expect(before.selectedIds).toHaveLength(2);
  const ptsBefore = linePointsOf(before);
  const rectXBefore = shapesOf(before).map((r) => r.x); // [A.x=390, B.x=790]

  await clickBar(page, '左对齐');

  const after = await probe(page);
  const rects = shapesOf(after);
  // 两块形状对齐到最小 x；锚定线被带动重路由（points 变化）
  expect(rects.every((r) => close(r.x, rectXBefore[0]!))).toBe(true);
  const ptsAfter = linePointsOf(after);
  expect(ptsAfter.length).toBeGreaterThanOrEqual(2);
  const moved = ptsAfter.some(
    (p, i) => !close(p[0]!, ptsBefore[i]![0]!, 0.5) || !close(p[1]!, ptsBefore[i]![1]!, 0.5),
  );
  expect(moved).toBe(true); // 重路由跟随（B 左移 400，线必然变化）

  // undo 一步：形状与锚定线同回（重路由写入并入同一撤销项的守卫）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = await probe(page);
  const rectsUndone = shapesOf(undone);
  expect(rectsUndone[0]!.x).toBeCloseTo(rectXBefore[0]!, 1);
  expect(rectsUndone[1]!.x).toBeCloseTo(rectXBefore[1]!, 1);
  const ptsUndone = linePointsOf(undone);
  expect(ptsUndone.every((p, i) => close(p[0]!, ptsBefore[i]![0]!, 0.05))).toBe(true);
  expect(ptsUndone.every((p, i) => close(p[1]!, ptsBefore[i]![1]!, 0.05))).toBe(true);
});

test('拖拽松手：锚定线跟随并入同一撤销项（docs/05 §4.3 挂账销账）', async ({ page }) => {
  const docId = `e2e-align-dragcommit-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350); // A world ≈ (390,266,120,80)
  await createRect(page, 850, 550); // B world ≈ (790,466,120,80)

  // 锚定线：line 工具 A → B（两端落形状 = 锚定），Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 点选 A（未在选中集——普通点选不进编辑）后拖动 +120/+80
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  const before = await probe(page);
  const ptsBefore = linePointsOf(before);
  const aXBefore = shapesOf(before)[0]!.x; // A = 390（最左，拖后仍最左）
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(570, 430, { steps: 8 });
  await page.waitForTimeout(80); // 松手前沉降（renderer 饱和吞 move 的画笔教训族）
  await page.mouse.up();
  await page.waitForTimeout(350);

  // A 落位 = 视觉位置（+120，留出吸附余量的宽松断言）；锚定线已跟随重路由
  const after = await probe(page);
  const aAfter = shapesOf(after)[0]!;
  expect(aAfter.x).toBeGreaterThan(aXBefore + 100);
  const ptsAfter = linePointsOf(after);
  expect(
    ptsAfter.some(
      (p, i) => !close(p[0]!, ptsBefore[i]![0]!, 0.5) || !close(p[1]!, ptsBefore[i]![1]!, 0.5),
    ),
  ).toBe(true);

  // undo 一步：形状与锚定线同回（急切重路由并入同一撤销项的守卫——旧实现
  // 此项红：微任务相 reattach 裂成第二个 undo 项，先回线不回形状）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = await probe(page);
  expect(shapesOf(undone)[0]!.x).toBeCloseTo(aXBefore, 1);
  const ptsUndone = linePointsOf(undone);
  expect(ptsUndone.every((p, i) => close(p[0]!, ptsBefore[i]![0]!, 0.05))).toBe(true);
  expect(ptsUndone.every((p, i) => close(p[1]!, ptsBefore[i]![1]!, 0.05))).toBe(true);
});

test('MIND_MAP 宿主根增高：锚定线跟随（微任务相）与文字编辑并入同一撤销项（二十四轮观察项定案）', async ({
  page,
}) => {
  const docId = `e2e-align-mindhost-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 脑图：工具激活后按下点建图（根「中心主题」），Esc 回 cursor（退出编辑器+工具）
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.move(500, 320);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // 根几何在此时取（焦点脑图探针——MIND_MAP 的 vmStates 宽高是布局派生占位 0，
  // 不可用于断言；点击建图后焦点必然在本图）
  const root0 = (await probe(page)).mindNodes.find((n) => n.text === '中心主题');
  expect(root0).toBeDefined();

  // 矩形 B（连线锚定的另一端）
  await createRect(page, 900, 560);

  // 锚定线：脑图 → B（两端落元素 = 锚定；脑图整图可锚定），Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(500, 320);
  await page.mouse.down();
  await page.mouse.move(900, 560, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  const created = await probe(page);
  expect(created.modelCount).toBe(3);
  const anchored = created.vmStates.find((s) => s.type === 'LINE') as unknown as {
    startNodeId: string | null;
    endNodeId: string | null;
  };
  expect(anchored.startNodeId).not.toBeNull();
  expect(anchored.endNodeId).not.toBeNull();
  const ptsBefore = linePointsOf(created);
  // 基线用建图时探针的根几何（建矩形/画线会改选区 → 清脑图焦点，此时
  // mindNodes 已空；树未被触碰，几何即建图时值）
  const rootOf = (p: IProbe) => p.mindNodes.find((n) => n.id === root0!.id)!.worldRect;
  const rootBefore = root0!.worldRect;

  // 点根一次选中（顺带关可能开着的编辑器）、再点进编辑——mind.spec 长文本用例
  // 同款；坐标从根 worldRect 反推屏幕
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  const rootC = {
    x: rootBefore.x + rootBefore.width / 2 + cRect.left,
    y: rootBefore.y + rootBefore.height / 2 + cRect.top,
  };
  await page.mouse.click(rootC.x, rootC.y);
  await page.waitForTimeout(250);
  await page.mouse.click(rootC.x, rootC.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelectorAll('body > textarea').length)).toBe(1);
  // CJK 必须走 insertText（真实输入管线；keyboard.type 对中文静默无效）
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('长文本换行验收联动重排'.repeat(10)); // 120 字 → 360px 上限换行
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // 落库退出（编辑态 Escape = 提交）
  await page.waitForTimeout(500); // flush + 微任务相 reattach 沉降

  const after = await probe(page);
  expect(rootOf(after).height).toBeGreaterThan(rootBefore.height + 20); // 根换行增高
  const ptsAfter = linePointsOf(after);
  expect(
    ptsAfter.some(
      (p, i) => !close(p[0]!, ptsBefore[i]![0]!, 0.5) || !close(p[1]!, ptsBefore[i]![1]!, 0.5),
    ),
  ).toBe(true); // 锚定线经微任务相 reattach 跟随（本用例前提）

  // undo 一步：文字编辑事务与 reattach 写入须在 captureTimeout 窗口内并入同一
  // 撤销项——根高与线 points 同回。若裂项（编辑回、线不回）此断言红
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(400);
  const undone = await probe(page);
  expect(rootOf(undone).height).toBeCloseTo(rootBefore.height, 1);
  const ptsUndone = linePointsOf(undone);
  expect(
    ptsUndone.every(
      (p, i) => close(p[0]!, ptsBefore[i]![0]!, 0.5) && close(p[1]!, ptsBefore[i]![1]!, 0.5),
    ),
  ).toBe(true);
});

test('缩放松手：锚定线跟随并入同一撤销项（docs/05 §4.4 挂账销账）', async ({ page }) => {
  const docId = `e2e-align-resizecommit-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350); // A world ≈ (390,266,120,80)
  await createRect(page, 850, 550); // B world ≈ (790,466,120,80)

  // 锚定线：line 工具 A → B（两端落形状 = 锚定），Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 点选 A → 抓东南角手柄外拖 40×30（角 = bounds 右下角，coverage 缩放用例同款）
  await page.mouse.click(450, 350);
  await page.waitForTimeout(250);
  const before = await probe(page);
  const ptsBefore = linePointsOf(before);
  const aBefore = shapesOf(before)[0]!;
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  const corner = {
    x: aBefore.x + aBefore.width + cRect.left,
    y: aBefore.y + aBefore.height + cRect.top,
  };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 8 });
  await page.waitForTimeout(80); // 松手前沉降
  await page.mouse.up();
  await page.waitForTimeout(350);

  // A 宽高变大；锚定线已跟随重路由（右缘外移 → 出线锚点变化）
  const after = await probe(page);
  const aAfter = shapesOf(after)[0]!;
  expect(aAfter.width).toBeGreaterThan(aBefore.width + 30);
  const ptsAfter = linePointsOf(after);
  expect(
    ptsAfter.some(
      (p, i) => !close(p[0]!, ptsBefore[i]![0]!, 0.5) || !close(p[1]!, ptsBefore[i]![1]!, 0.5),
    ),
  ).toBe(true);

  // undo 一步：形状尺寸与锚定线同回（旧实现红：微任务相 reattach 裂成第二项）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = await probe(page);
  const aUndone = shapesOf(undone)[0]!;
  expect(aUndone.width).toBeCloseTo(aBefore.width, 1);
  expect(aUndone.x).toBeCloseTo(aBefore.x, 1);
  const ptsUndone = linePointsOf(undone);
  expect(ptsUndone.every((p, i) => close(p[0]!, ptsBefore[i]![0]!, 0.05))).toBe(true);
  expect(ptsUndone.every((p, i) => close(p[1]!, ptsBefore[i]![1]!, 0.05))).toBe(true);
});
