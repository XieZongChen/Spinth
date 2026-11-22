/** 容器 / Frame E2E（specs/container-frame §8.2）：创建即归属/拖动带子/拖出
 *  脱离/拖入归属/删除级联/容器在子之下。断言走 __spinthDebug.__debug 探针
 *  （世界坐标）；指针坐标 = 世界 + 顶栏 44。容器经 dev 注入 engine.add 搭建
 *  （network.spec 先例）——容器工具快捷键 C 与拖拽创建在 P3 批接入后另补
 *  C-1；子元素形状用真实矩形工具路径（创建即归属必须走真实手势）。 */
import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';
import { modelCount, ready } from './helpers/projectFileE2e';
import { waitRole } from './helpers/multiTabE2e';

const TOP_BAR = 44;

interface Snap {
  id: string;
  type: string;
  title?: string;
  headerSide?: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function vmStates(page: Page): Promise<Snap[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __spinthDebug: { __debug: { vmStates: unknown[] } } }
      ).__spinthDebug.__debug.vmStates.slice() as Snap[],
  );
}

async function framesOf(page: Page): Promise<Snap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'FRAME');
}

async function shapesOf(page: Page): Promise<Snap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'SHAPE');
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } }).__spinthDebug
        .__debug.selectedIds,
  );
}

/** 批量建件（engine.add，bench/network 先例）。两个坑：
 *  ① engine.add 不生成 id（data.id 直用）——缺 id 落成空串坏数据，页内生成；
 *  ② 不包外层 transact——外层事务内「创建后紧接的归属写」对 mid-transaction
 *    才挂上的 vm 观察者不可见（vm.state 丢 parentId；生产路径创建从无外来
 *    外层事务，粘贴批的 parentId 走创建数据自带）。逐件独立 add 与生产同构 */
async function engineAdd(page: Page, widgets: Array<Record<string, unknown>>): Promise<string[]> {
  const ids = await page.evaluate((ws) => {
    const eng = (
      window as unknown as {
        __spinthDebug: {
          __debug: { engine: { add(w: unknown): void; genInitialOrder(): string } };
        };
      }
    ).__spinthDebug.__debug.engine;
    const generated: string[] = [];
    for (const w of ws) {
      const id = `e2e-${Math.random().toString(36).slice(2, 10)}`;
      generated.push(id);
      eng.add({ id, zOrder: eng.genInitialOrder(), ...w });
    }
    return generated;
  }, widgets);
  await page.waitForTimeout(400);
  return ids;
}

/** 建一个容器，返回 {id, x, y, w, h} 快照 */
async function addFrame(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Record<string, unknown> = {},
): Promise<Snap> {
  const [id] = await engineAdd(page, [
    { type: 'FRAME', color: '#ffffff', x, y, width: w, height: h, ...extra },
  ]);
  const f = (await framesOf(page)).find((s) => s.id === id)!;
  return f;
}

/** 按住世界坐标 (wx, wy) 拖动 (dx, dy) */
async function dragFrom(page: Page, wx: number, wy: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(wx, wy + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(wx + dx, wy + dy + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await openBoardDoc(page, `e2e-container-${Date.now()}`);
});

test('C-2 创建即归属：容器内画形状 → parentId 落库；容器外画不归属', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  // 容器内画矩形（真实工具路径：草稿建立即触发 adoptOnCreate）
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR); // 世界 150,150
  await page.mouse.down();
  await page.mouse.move(260, 260 + TOP_BAR, { steps: 6 }); // 世界 260,260
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const inside = (await shapesOf(page)).find((s) => s.x === 150);
  expect(inside).toBeDefined();
  expect(inside!.parentId).toBe(frame.id);

  // 容器外画矩形：无 parentId
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(700, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(790, 240 + TOP_BAR, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(3);
  const outside = (await shapesOf(page)).find((s) => s.x === 700);
  expect(outside).toBeDefined();
  expect('parentId' in outside!).toBe(false);
});

test('C-3 拖动带子：容器位移 = 子位移；undo 一步全回', async ({ page }) => {
  const [frameId] = await engineAdd(page, [
    { type: 'FRAME', color: '#ffffff', x: 100, y: 100, width: 400, height: 300 },
    {
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 150,
      y: 150,
      width: 60,
      height: 60,
    },
  ]);
  await page.waitForTimeout(100);
  const frame = (await framesOf(page)).find((s) => s.id === frameId)!;
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child.parentId).toBe(frame.id); // 创建即归属（engine.add 同流触发）

  const f0 = { x: frame.x, y: frame.y };
  const c0 = { x: child.x, y: child.y };
  // 抓标题带（世界 200, 112——带高 28 内）拖 (+80, +40)
  await dragFrom(page, 200, 112, 80, 40);
  const f1 = (await framesOf(page)).find((s) => s.id === frameId)!;
  const c1 = (await shapesOf(page)).find((s) => s.x === c0.x + (f1.x - f0.x))!;
  // 子元素同步位移（吸附修正对两者同值）
  expect(c1.x - c0.x).toBe(f1.x - f0.x);
  expect(c1.y - c0.y).toBe(f1.y - f0.y);
  // 选区 = 容器自身（子不在选区）
  expect(await selectedIds(page)).toEqual([frameId]);

  // undo 一步全回（含位移）
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  const f2 = (await framesOf(page)).find((s) => s.id === frameId)!;
  const c2 = (await shapesOf(page)).find((s) => s.id === child.id)!;
  expect(Math.abs(f2.x - f0.x)).toBeLessThan(1e-6);
  expect(Math.abs(c2.x - c0.x)).toBeLessThan(1e-6);
});

test('C-4 拖出脱离：完全离开清父；相交不全含保持', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  // 容器内画子形状（创建即归属）
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  let child = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child.parentId).toBe(frame.id);

  // 相交不全含（子右缘越容器右缘 500）：保持父
  await dragFrom(page, 180, 180, 300, 0); // 子中心 180,180 → 右缘 210+300=510 > 500
  child = (await shapesOf(page)).find((s) => s.id === child.id)!;
  expect(child.parentId).toBe(frame.id);
  expect(Math.abs(child.x - 450)).toBeLessThan(6); // 150+300（吸附容差）

  // 完全离开（拖到容器右/下界外）：清父
  await dragFrom(page, child.x + 30, child.y + 30, 200, 150);
  child = (await shapesOf(page)).find((s) => s.id === child.id)!;
  expect('parentId' in child).toBe(false);
});

test('C-5 拖入归属：外部形状完全拖进 → parentId 写入', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(700, 120 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(760, 180 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  let shape = (await shapesOf(page)).find((s) => s.x === 700)!;
  expect('parentId' in shape).toBe(false);

  // 完全拖进容器（中心 730,150 → 200,200：rect (170,170,60,60) 全含）
  await dragFrom(page, 730, 150, -530, 50);
  shape = (await shapesOf(page)).find((s) => s.id === shape.id)!;
  expect(shape.parentId).toBe(frame.id);
});

test('C-6 删除级联：删容器连子删；undo 一步全回（含 parentId）', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child.parentId).toBe(frame.id);

  // 选中容器（点标题带）→ Delete：容器与子都消失
  await page.mouse.click(200, 112 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]);
  await page.keyboard.press('Delete');
  await expect.poll(() => modelCount(page)).toBe(0);

  // undo 一步全回（parentId 随 Y.Map 回滚）
  await page.keyboard.press('Meta+z');
  await expect.poll(() => modelCount(page)).toBe(2);
  const childBack = (await shapesOf(page)).find((s) => s.id === child.id)!;
  expect(childBack.parentId).toBe(frame.id);
});

test('C-10 容器在子之下：置顶后点子元素命中子元素', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;

  // 选中容器并置顶（I3 钳制：容器仍压回子之下）
  await page.mouse.click(200, 112 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]);
  await page.evaluate(() => {
    const pub = (window as unknown as { __spinth: { bringToFront(): void } }).__spinth;
    pub.bringToFront();
  });
  await page.waitForTimeout(300);
  // 点子元素中心：命中子元素（不是盖在上面的容器）
  await page.mouse.click(180, 180 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([child.id]);
});

/** 合成剪贴板事件（clipboard.spec 同款：DataTransfer 直通，绕 headless 权限） */
async function fireClipboard(page: Page, kind: 'copy' | 'paste', plain?: string): Promise<string> {
  return page.evaluate(
    ({ kind, plain }) => {
      const dt = new DataTransfer();
      if (plain !== undefined) dt.setData('text/plain', plain);
      document.dispatchEvent(
        new ClipboardEvent(kind, { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      return dt.getData('text/plain');
    },
    { kind, plain },
  );
}

test('C-8 复制粘贴：带子快照、parentId 桶映射指向新容器；拖新容器原件不动', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child.parentId).toBe(frame.id);

  // 单选容器复制 → 粘贴（快照展开带子；落视口中心）
  await page.mouse.click(200, 112 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]);
  const plain = await fireClipboard(page, 'copy');
  const snaps = JSON.parse(plain) as Array<{ data: { type: string } }>;
  expect(snaps.map((s) => s.data.type).sort()).toEqual(['FRAME', 'SHAPE']); // 展开带子
  await fireClipboard(page, 'paste', plain);
  await expect.poll(() => modelCount(page)).toBe(4);

  const frames = await framesOf(page);
  const shapes = await shapesOf(page);
  expect(frames).toHaveLength(2);
  expect(shapes).toHaveLength(2);
  const newFrame = frames.find((f) => f.id !== frame.id)!;
  const newChild = shapes.find((s) => s.id !== child.id)!;
  expect(newChild.parentId).toBe(newFrame.id); // 桶映射：指向新容器（非原容器）

  // 拖新容器：新子跟随、原件与原子不动
  const o0 = { x: frame.x, y: frame.y };
  const oc0 = { x: child.x, y: child.y };
  await dragFrom(page, newFrame.x + 100, newFrame.y + 14, 60, 30);
  const o1 = (await framesOf(page)).find((f) => f.id === frame.id)!;
  const oc1 = (await shapesOf(page)).find((s) => s.id === child.id)!;
  expect(Math.abs(o1.x - o0.x)).toBeLessThan(1e-6); // 原容器不动
  expect(Math.abs(oc1.x - oc0.x)).toBeLessThan(1e-6); // 原子不动
});

test('C-9 框选口径：全含容器入选且子元素剔除；半含容器不入选', async ({ page }) => {
  // 布局：f1(100,100,400,300) 内 c1；f2(700,100,300,200) 内 c2；独立 z1
  //（ids 顺序 = 入参顺序：f1, c1, f2, c2, z1——跳位解构）
  const [f1, , f2] = await engineAdd(page, [
    { type: 'FRAME', color: '#ffffff', x: 100, y: 100, width: 400, height: 300 },
    {
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 150,
      y: 150,
      width: 60,
      height: 60,
    },
    { type: 'FRAME', color: '#ffffff', x: 700, y: 100, width: 300, height: 200 },
    {
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 750,
      y: 150,
      width: 60,
      height: 60,
    },
    {
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 1100,
      y: 150,
      width: 60,
      height: 60,
    },
  ]);
  await expect.poll(() => modelCount(page)).toBe(5);

  // 框 1：全含 f1（含子）、只含 f2 左半——f1 入选、c1 剔除、f2 剔除；
  // c2 完整落在框内且 f2 未入选（§4.3 只剔「入选容器」的子）→ c2 保留可选
  // 框矩形世界 (90,90)→(900,450)：f1(100..500) 全含；f2(700..1000) 半含；z1(1100..) 框外
  await page.mouse.move(90, 90 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(900, 450 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  let sel = await selectedIds(page);
  expect(sel).toContain(f1);
  expect(sel).not.toContain(f2); // 半含剔除
  const c1Id = (await shapesOf(page)).find((s) => s.x === 150)!.id;
  const c2Id = (await shapesOf(page)).find((s) => s.x === 750)!.id;
  expect(sel).not.toContain(c1Id); // 子随容器走，不单独入选
  expect(sel.sort()).toEqual([f1, c2Id].sort());

  // 框 2：全含 f2 与 c2——f2 入选、c2 剔除
  await page.mouse.move(690, 90 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(1020, 320 + TOP_BAR, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  sel = await selectedIds(page);
  expect(sel).toEqual([f2]);
});

test('C-1 拖拽创建与标题编辑：落库选中回 cursor；标题一步 undo 回空', async ({ page }) => {
  // 工具快捷键 C（specs/container-frame §4.12）
  await page.keyboard.press('c');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('frame');
  // 拖拽画容器（世界 100,100 → 500,400）
  await page.mouse.move(100, 100 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(500, 400 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(1);
  const frame = (await framesOf(page))[0]!;
  expect([frame.x, frame.y, frame.width, frame.height]).toEqual([100, 100, 400, 300]);
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]); // 松手选中
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('cursor'); // 拖拽创建回选择工具

  // 标题编辑：再点已选中的标题带 → textarea；输入 + Enter 落库
  await page.mouse.click(200, 112 + TOP_BAR);
  const ta = page.locator('textarea');
  await expect(ta).toBeVisible();
  await ta.fill('审批泳道');
  await page.keyboard.press('Enter');
  await expect.poll(() => framesOf(page).then((fs) => fs[0]!.title ?? '')).toBe('审批泳道');
  // 一步 undo：标题回空（容器仍在——空标题 keep 不删容器）
  await page.keyboard.press('Meta+z');
  await expect.poll(() => framesOf(page).then((fs) => fs[0]!.title ?? '')).toBe('');
  expect(await modelCount(page)).toBe(1);
});

test('C-11 只读：按 C 不出工具、拖动不写、标题不进编辑、右键无「移出容器」', async ({
  page,
  context,
}) => {
  const docId = `e2e-c11-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');
  // leader 建容器；follower 只读断言
  await addFrame(page, 100, 100, 400, 300);
  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // 按 C：钳成 cursor（工具不出）
  await pageB.keyboard.press('c');
  await expect
    .poll(() =>
      pageB.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('cursor');

  // 拖容器标题带：零写（modelCount 恒 1）
  await pageB.mouse.move(200, 112 + TOP_BAR);
  await pageB.mouse.down();
  await pageB.mouse.move(280, 152 + TOP_BAR, { steps: 6 });
  await pageB.mouse.up();
  await pageB.waitForTimeout(400);
  expect(await modelCount(pageB)).toBe(1);
  const framePos = await pageB.evaluate(() => {
    const f = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((s) => s.type === 'FRAME');
    return { x: f?.x as number, y: f?.y as number };
  });
  expect([framePos.x, framePos.y]).toEqual([100, 100]); // 未被拖动

  // 标题不进编辑（无 textarea 出现）
  await pageB.mouse.click(200, 112 + TOP_BAR);
  await pageB.mouse.click(200, 112 + TOP_BAR);
  await pageB.waitForTimeout(300);
  await expect(pageB.locator('textarea')).toHaveCount(0);

  // 右键：只读降级画布菜单，无「移出容器」
  await pageB.mouse.click(200, 112 + TOP_BAR, { button: 'right' });
  await expect(pageB.locator('[data-spinth-context-menu]')).toBeVisible();
  await expect(pageB.getByText('移出容器')).toHaveCount(0);
});
