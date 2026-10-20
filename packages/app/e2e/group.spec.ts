import { expect, test, type Page } from '@playwright/test';

/**
 * 编组 Group E2E（docs/18，2026-10-17 四点拍板：成员挂 groupId 无容器、
 * 参考框选口径整组全入框、Alt+点击进组、仅自由元素）。
 *
 * 覆盖面：建组（ActionBar/快捷键双入口）→ 点击整组选中 → Alt 直选单体 →
 * shift 组原子切换 → 框选半组不选/全组入选 → 拖动整组 → 对齐组整体性 →
 * 解组（快捷键）→ undo 一步（键删除投影）→ 粘贴保组（新 groupId）→
 * 混入锚定线编组键禁用 → 自由线转锚定同事务脱组。
 *
 * 坐标纪律同 align.spec：断言走 __spinth.__debug 探针；操作坐标从探针世界
 * 坐标 + canvas rect 反推；修饰键必须物理键盘 down/up 包夹。
 */

interface IProbe {
  modelCount: number;
  selectedIds: string[];
  vmStates: Array<Record<string, unknown>>;
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
    };
  });
}

interface RectSnap {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
}

function shapesOf(p: IProbe): RectSnap[] {
  return p.vmStates
    .filter((s) => s.type === 'SHAPE')
    .map((s) => ({
      id: String(s.id),
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
      groupId: s.groupId === undefined ? undefined : String(s.groupId),
    }))
    .sort((a, b) => a.x - b.x);
}

function lineOf(p: IProbe): Record<string, unknown> | undefined {
  return p.vmStates.find((s) => s.type === 'LINE');
}

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

async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function clickBar(page: Page, label: string): Promise<void> {
  await page.locator(`[data-spinth-action-bar] button[aria-label="${label}"]`).click();
  await page.waitForTimeout(300);
}

/** 修饰键必须物理键盘包夹（mouse.click 的 modifiers 不达 DOM 事件，align.spec 同款教训） */
async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

async function altClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Alt');
  await page.mouse.click(x, y);
  await page.keyboard.up('Alt');
}

/** 世界 → 屏幕（初载 scale=1 无平移，align.spec 同款假设） */
async function screenOf(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  return { x: wx + cRect.left, y: wy + cRect.top };
}

/** 建两块矩形并框选编组（ActionBar 入口），返回建组后快照 */
async function createGroupedPair(
  page: Page,
): Promise<{ a: RectSnap; b: RectSnap; groupId: string }> {
  await createRect(page, 450, 300); // world ≈ (390,216,120,80)
  await createRect(page, 700, 400); // world ≈ (640,316,120,80)
  await marquee(page, 340, 160, 820, 480);
  await clickBar(page, '编组');
  const p = await probe(page);
  const [a, b] = shapesOf(p);
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(a!.groupId).toBeTruthy();
  expect(b!.groupId).toBe(a!.groupId);
  return { a: a!, b: b!, groupId: a!.groupId! };
}

test('建组：两块同 groupId + zOrder 归拢；点击组员 = 整组选中；undo 一步组消解', async ({
  page,
}) => {
  const docId = `e2e-group-create-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createGroupedPair(page);
  const g = await probe(page);
  const [a] = shapesOf(g);
  const groupId = a!.groupId!;

  // 点击空白清选区 → 点其中一块 = 整组选中（zOrder 序）
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  const pt = await screenOf(page, a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(2);

  // undo 一步（单事务 = 单撤销单元）：groupId 键删除，点击恢复单选
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const undone = shapesOf(await probe(page));
  expect(undone.every((r) => r.groupId === undefined)).toBe(true);
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(1);

  // redo：组恢复（undo/redo 对 optional 键删除/恢复的投影守卫）
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(300);
  expect(shapesOf(await probe(page)).every((r) => r.groupId === groupId)).toBe(true);
});

test('快捷键双入口：ControlOrMeta+G 建组 / +Shift+G 解组；解组保持选区', async ({ page }) => {
  const docId = `e2e-group-shortcut-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);
  await marquee(page, 340, 160, 820, 480);
  expect((await probe(page)).selectedIds).toHaveLength(2);

  await page.keyboard.press('ControlOrMeta+g');
  await page.waitForTimeout(300);
  const grouped = shapesOf(await probe(page));
  expect(grouped.every((r) => r.groupId === undefined)).toBe(false);

  await page.keyboard.press('ControlOrMeta+Shift+g');
  await page.waitForTimeout(300);
  const ungrouped = await probe(page);
  expect(shapesOf(ungrouped).every((r) => r.groupId === undefined)).toBe(true);
  expect(ungrouped.selectedIds).toHaveLength(2); // 选区保持原成员集
});

test('单钮切换（docs/18 §3.4）：建组后按钮翻「解组」，点击即解组、再翻回「编组」', async ({
  page,
}) => {
  const docId = `e2e-group-toggle-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);
  await marquee(page, 340, 160, 820, 480);
  const bar = page.locator('[data-spinth-action-bar]');

  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
  await clickBar(page, '编组');
  expect(shapesOf(await probe(page)).every((r) => r.groupId)).toBeTruthy();
  // 选区不变（两块仍选）→ schema 随 widgetsChanged$ 重算，按钮翻「解组」
  await expect(bar.locator('button[aria-label="解组"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="编组"]')).toHaveCount(0);

  await clickBar(page, '解组');
  expect(shapesOf(await probe(page)).every((r) => r.groupId === undefined)).toBe(true);
  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
});

test('单钮切换：两个整组选中显示「编组」（合并拍板）→ 合为一组后翻「解组」', async ({ page }) => {
  const docId = `e2e-group-merge-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  // 两对分别编组：AB / CD
  await createRect(page, 450, 300);
  await createRect(page, 700, 400);
  await marquee(page, 340, 160, 820, 480);
  await clickBar(page, '编组');
  await createRect(page, 950, 300);
  await createRect(page, 1150, 420);
  await marquee(page, 850, 160, 1260, 520);
  await clickBar(page, '编组');
  expect(new Set(shapesOf(await probe(page)).map((r) => r.groupId)).size).toBe(2);

  // 全选四块（多整组两可态）→ 显示「编组」（合并，2026-10-17 二轮拍板）
  await marquee(page, 340, 160, 1260, 520);
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar.locator('button[aria-label="解组"]')).toHaveCount(0);
  await expect(bar.locator('button[aria-label="编组"]')).toBeEnabled();
  await clickBar(page, '编组');

  expect(new Set(shapesOf(await probe(page)).map((r) => r.groupId)).size).toBe(1); // 合并为一组
  await expect(bar.locator('button[aria-label="解组"]')).toBeEnabled(); // 恰一整组 → 翻解组
});

test('单钮切换兜底：锚定线+组员混选显示「解组」（编组不可行但涉组，不出死按钮）', async ({
  page,
}) => {
  const docId = `e2e-group-fallback-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350); // A
  await createRect(page, 850, 550); // B
  await marquee(page, 340, 210, 960, 630);
  await clickBar(page, '编组'); // {A,B} 一组

  // 锚定线 A→B，Esc 回 cursor
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 清选区 → 点 A（整组）→ shift 点线身 = 混选（组员×2 + 锚定线）。
  // 点位取**末段中点**（进 B 的竖直段）：ActionBar 悬在选中并集上方居中，
  // 中段水平段的中点恰落在条矩形内（onPointerDown stopPropagation 吞点击，
  // 调试剧本实证 sel 不变）；末段中点 y 在条底之下，稳定避让
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  const created = await probe(page);
  const pts = (lineOf(created) as unknown as { points: Array<[number, number]> }).points;
  const la = pts[pts.length - 2] ?? pts[0]!;
  const lb = pts[pts.length - 1] ?? pts[0]!;
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  await shiftClick(
    page,
    (la[0]! + lb[0]! + cRect.left * 2) / 2,
    (la[1]! + lb[1]! + cRect.top * 2) / 2,
  );
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(3);

  // 兜底规则：canGroup=false（锚定线）且涉组 → 显示「解组」且可用
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar.locator('button[aria-label="解组"]')).toBeEnabled();
  await expect(bar.locator('button[aria-label="编组"]')).toHaveCount(0);
});

test('Alt 直选单体：跳过组扩展（进入组）', async ({ page }) => {
  const docId = `e2e-group-alt-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a } = await createGroupedPair(page);
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);

  const pt = await screenOf(page, a.x + a.width / 2, a.y + a.height / 2);
  await altClick(page, pt.x, pt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(1);

  // Alt 残留不扩散：再 shift 加选组外第三块，组员不被重扩（toggleIds 契约）。
  // createRect 后新块已是当前选中（创建链 setSelected）——先清选区、Alt 重进组选 a
  await createRect(page, 1000, 300);
  const c = shapesOf(await probe(page)).at(-1)!;
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  await altClick(page, pt.x, pt.y); // 重进组：单选 a（残留态）
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(1);
  const cpt = await screenOf(page, c.x + c.width / 2, c.y + c.height / 2);
  await shiftClick(page, cpt.x, cpt.y);
  await page.waitForTimeout(250);
  const sel = (await probe(page)).selectedIds;
  expect(sel).toHaveLength(2); // {a, c}——组员 b 未被重扩进选区
  expect(sel).toContain(a.id);
  expect(sel).toContain(c.id);
});

test('shift 组原子切换：整组加入 / 整组移除', async ({ page }) => {
  const docId = `e2e-group-shift-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a } = await createGroupedPair(page);
  await createRect(page, 1000, 300);
  const c = shapesOf(await probe(page)).at(-1)!;

  // 选中组外第三块 → shift 点组员 = 整组加入
  const cpt = await screenOf(page, c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.click(cpt.x, cpt.y);
  await page.waitForTimeout(200);
  const apt = await screenOf(page, a.x + a.width / 2, a.y + a.height / 2);
  await shiftClick(page, apt.x, apt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(3);

  // 再 shift 点组员 = 整组移除（只剩第三块）
  await shiftClick(page, apt.x, apt.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(1);
});

test('框选口径（参考）：半组命中 = 整组不选；全组入框 = 整组入选', async ({ page }) => {
  const docId = `e2e-group-marquee-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a } = await createGroupedPair(page); // a world ≈ (390,216) b world ≈ (640,316)
  const b = shapesOf(await probe(page))[1]!;

  // 半框：只全含 a（b 出框）→ 组整体不选
  const p1 = await screenOf(page, a.x - 10, a.y - 10);
  const p2 = await screenOf(page, a.x + a.width + 10, a.y + a.height + 10);
  await marquee(page, p1.x, p1.y, p2.x, p2.y);
  expect((await probe(page)).selectedIds).toHaveLength(0);

  // 全框：两块都入 → 整组（2 块）
  const q1 = await screenOf(page, a.x - 10, a.y - 10);
  const q2 = await screenOf(page, b.x + b.width + 10, b.y + b.height + 10);
  await marquee(page, q1.x, q1.y, q2.x, q2.y);
  expect((await probe(page)).selectedIds).toHaveLength(2);
});

test('拖动整组：组员同位移（相对位置不变）', async ({ page }) => {
  const docId = `e2e-group-drag-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a } = await createGroupedPair(page);
  const before = shapesOf(await probe(page));
  const rel = before[1]!.x - before[0]!.x;

  const pt = await screenOf(page, a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 120, pt.y + 80, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(350);

  const after = shapesOf(await probe(page));
  expect(close(after[0]!.x - before[0]!.x, 120, 5)).toBe(true); // 拖动落位（吸附余量宽松）
  expect(close(after[1]!.x - before[1]!.x, after[0]!.x - before[0]!.x, 0.5)).toBe(true); // 同位移
  expect(close(after[1]!.x - after[0]!.x, rel, 0.5)).toBe(true); // 相对位置不变
});

test('对齐组整体性：组折叠为单参与体，delta 同值摊回成员', async ({ page }) => {
  const docId = `e2e-group-align-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  // 三块：A(390) B(640) C(920)；B、C 编组
  await createRect(page, 450, 300);
  await createRect(page, 700, 380);
  await createRect(page, 980, 460);
  await marquee(page, 590, 250, 1120, 560); // 只框 B、C
  expect((await probe(page)).selectedIds).toHaveLength(2);
  await clickBar(page, '编组');

  await marquee(page, 340, 160, 1120, 560); // 全框三块
  const before = shapesOf(await probe(page));
  expect(before).toHaveLength(3);
  await clickBar(page, '左对齐');

  const after = shapesOf(await probe(page));
  const targetX = before[0]!.x; // A 最左 = 基准（零位移）
  expect(close(after[0]!.x, targetX, 0.01)).toBe(true);
  // B、C 同 dx（组整体到 390）：相对位置（C.x - B.x）不变
  const dB = after[1]!.x - before[1]!.x;
  const dC = after[2]!.x - before[2]!.x;
  expect(close(dB, targetX - before[1]!.x, 0.05)).toBe(true);
  expect(close(dC, dB, 0.05)).toBe(true);
  expect(close(after[2]!.x - after[1]!.x, before[2]!.x - before[1]!.x, 0.05)).toBe(true);
});

test('粘贴保组：拷贝组粘贴 = 新 groupId 一组，源组不变', async ({ page }) => {
  const docId = `e2e-group-paste-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { groupId } = await createGroupedPair(page);

  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(250);
  await page.mouse.click(150, 150); // 清选区（防单击已选中进编辑）
  await page.waitForTimeout(200);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(400);

  const p = await probe(page);
  expect(p.modelCount).toBe(4);
  const gids = shapesOf(p).map((r) => r.groupId);
  expect(gids.filter((g) => g === groupId)).toHaveLength(2); // 源组仍在
  const newGid = gids.find((g) => g !== undefined && g !== groupId);
  expect(newGid).toBeTruthy(); // 拷贝是一组（新 groupId）
  expect(gids.filter((g) => g === newGid)).toHaveLength(2);
  expect(p.selectedIds).toHaveLength(2); // 粘贴后选中拷贝组
});

test('混入锚定线：编组键禁用（仅自由元素拍板）', async ({ page }) => {
  const docId = `e2e-group-reject-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350); // A
  await createRect(page, 850, 550); // B
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
  const anchored = lineOf(created) as unknown as { startNodeId: string | null };
  expect(anchored.startNodeId).not.toBeNull();

  // 形状 + 锚定线 2 选 → 编组禁用（运行时锚定态判定）
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  const pts = (lineOf(created) as unknown as { points: Array<[number, number]> }).points;
  const mid = Math.floor(pts.length / 2);
  const a = pts[mid - 1] ?? pts[0]!;
  const b = pts[mid] ?? pts[pts.length - 1]!;
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  await shiftClick(page, (a[0]! + b[0]! + cRect.left * 2) / 2, (a[1]! + b[1]! + cRect.top * 2) / 2);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(2);
  await expect(page.locator('[data-spinth-action-bar] button[aria-label="编组"]')).toBeDisabled();
});

test('自由线转锚定：同事务脱组（锚定不变式）', async ({ page }) => {
  const docId = `e2e-group-anchor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 300); // A world ≈ (390,216,120,80)

  // 自由线（两端空白）
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(900, 420, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 矩形 + 自由线编组（自由线可组）
  await marquee(page, 340, 160, 1000, 560);
  expect((await probe(page)).selectedIds).toHaveLength(2);
  await clickBar(page, '编组');
  const grouped = await probe(page);
  const line = lineOf(grouped) as unknown as {
    id: string;
    groupId?: string;
    points: Array<[number, number]>;
  };
  expect(line.groupId).toBeTruthy();

  // 点线身 = 选中整组（组语义）→ Alt 直选线（进组：端点手势要求单选线，
  // handleGestureDown 的 ids.length===1 闸门）→ 端点手柄出现
  await page.mouse.click(150, 150);
  await page.waitForTimeout(200);
  const lp = await screenOf(page, line.points[0]![0], line.points[0]![1]);
  await page.mouse.click(lp.x, lp.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(2); // 整组
  await altClick(page, lp.x, lp.y);
  await page.waitForTimeout(300);
  expect((await probe(page)).selectedIds).toHaveLength(1); // 单选线
  const ac = await screenOf(page, 390 + 60, 216 + 40);
  await page.mouse.move(lp.x, lp.y);
  await page.mouse.down();
  await page.mouse.move(ac.x, ac.y, { steps: 6 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(350);

  const after = lineOf(await probe(page)) as unknown as {
    startNodeId: string | null;
    groupId?: string;
  };
  expect(after.startNodeId).not.toBeNull(); // 已锚定
  expect(after.groupId).toBeUndefined(); // 同事务脱组
});

test('1.5 多选/组选态单击不进编辑：整组选中再点成员保持组选语义', async ({ page }) => {
  const docId = `e2e-group-noedit-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createGroupedPair(page); // 整组选中（2 员）

  // 再点已选成员（STICKY 型才可二次单击进编辑——用 TEXT 对照面：
  // 这里用第二块已选成员再点一次，断言编辑器不现身、选区保持 2）
  const p = await probe(page);
  await page.mouse.click(150, 150); // 清选区
  await page.waitForTimeout(200);
  const [a] = shapesOf(p);
  const pt = await screenOf(page, a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.click(pt.x, pt.y); // 点组员 → 整组选中
  await page.waitForTimeout(250);
  expect((await probe(page)).selectedIds).toHaveLength(2);
  await page.mouse.click(pt.x, pt.y); // 修复前：多选态再点已选成员 → onActivate 进编辑
  await page.waitForTimeout(300);
  expect((await probe(page)).selectedIds).toHaveLength(2); // 选区保持整组
  // 编辑器从未创建（contenteditable DOM 不存在）——比 opacity 断言更强的「不进编辑」
  expect(await page.locator('#spinth-text-layer [contenteditable="true"]').count()).toBe(0);
});
