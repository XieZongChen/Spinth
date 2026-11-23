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
  zOrder?: string;
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

/** 文档真值（model.toJSON）。批量路径（粘贴批 / undo·redo 恢复）里紧随创建的
 *  写入对 mid-transaction 才挂上的 vm 观察者不可见——vmStates 会停在创建时的
 *  值（实测：旧归属重判把文档清成无父，vm.state 仍显示归属）。归属类断言在
 *  这些路径上必须读文档，否则是假绿 */
async function modelOf(page: Page, id: string): Promise<Snap | null> {
  return page.evaluate((widgetId) => {
    const eng = (
      window as unknown as {
        __spinthDebug: {
          __debug: { engine: { getModelById(id: string): { toJSON(): unknown } | undefined } };
        };
      }
    ).__spinthDebug.__debug.engine;
    return (eng.getModelById(widgetId)?.toJSON() as Snap | undefined) ?? null;
  }, id);
}

/** 真渲染层级（root.zOrder——viewport 排序依据；vm.state.zOrder 只是投影） */
async function renderZOrderOf(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(
    (widgetId) =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { vmPositions: Array<{ id: string; zOrder?: string }> } };
        }
      ).__spinthDebug.__debug.vmPositions.find((v) => v.id === widgetId)?.zOrder,
    id,
  );
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

/** 已选中的容器：抓住西边不可见热区（边线中点，10 屏幕 px 厚）拖到 toX——
 *  缩小容器。缩放不重判归属，是把子元素变成「完全在父框外却仍持有 parentId」
 *  的唯一途径（拖动会按三态脱离） */
async function dragWestEdgeTo(page: Page, frame: Snap, toX: number): Promise<void> {
  const y = frame.y + frame.height / 2;
  await page.mouse.move(frame.x, y + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(toX, y + TOP_BAR, { steps: 8 });
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

test('C-7 缩放不缩放子：拖角外扩只改容器 rect，子元素逐值不变', async ({ page }) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child0 = (await shapesOf(page)).find((s) => s.x === 150)!;

  // 选中容器（点标题带）→ 拖东南角手柄外扩（F-6d 同款角点手势）
  await page.mouse.click(200, 112 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]);
  await page.waitForTimeout(250); // 等 RectEditor 手柄挂载
  const c = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const corner = { x: frame.x + frame.width + c.left, y: frame.y + frame.height + c.top };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 容器外扩生效；子元素 rect 逐值不变（不缩放、不挪位）
  const frame1 = (await framesOf(page)).find((s) => s.id === frame.id)!;
  expect(frame1.width).toBeGreaterThan(frame.width);
  expect(frame1.height).toBeGreaterThan(frame.height);
  const child1 = (await shapesOf(page)).find((s) => s.id === child0.id)!;
  expect([child1.x, child1.y, child1.width, child1.height]).toEqual([
    child0.x,
    child0.y,
    child0.width,
    child0.height,
  ]);
  // 归属不受缩放影响（子仍在容器内）
  expect(child1.parentId).toBe(frame.id);
});

test('C-10 容器在子之下：置顶后点子元素命中子元素 + zOrder 断言', async ({ page }) => {
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
  // 层级断言（审查返工强化）：置顶后容器 key 仍小于全部子元素
  let pair = await vmStates(page);
  const fTop = pair.find((s) => s.id === frame.id)!;
  const cTop = pair.find((s) => s.id === child.id)!;
  expect((fTop.zOrder as string) < (cTop.zOrder as string)).toBe(true);
  // 点子元素中心：命中子元素（不是盖在上面的容器）
  await page.mouse.click(180, 180 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([child.id]);

  // 审查返工 P1 场景：先有形状（低 zOrder）、后画容器（高 zOrder 盖住形状）、
  // 再把形状拖进容器——归属写入同事务把容器钳到子之下（否则白底盖住形状）
  //（ids 顺序 = 入参顺序：先 shape 后 frame——shapeId 取第一个）
  const [shapeId] = await engineAdd(page, [
    {
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 1200,
      y: 100,
      width: 60,
      height: 60,
    },
    { type: 'FRAME', color: '#ffffff', x: 600, y: 60, width: 400, height: 200 }, // 后画：zOrder 更高
  ]);
  const lateFrame = (await framesOf(page)).find((s) => s.x === 600)!;
  pair = await vmStates(page);
  // 前置确认：容器确实盖在形状上（倒置存在，钳制有活干）
  expect(
    (lateFrame.zOrder as string) > (pair.find((s) => s.id === shapeId)!.zOrder as string),
  ).toBe(true);
  // 真实拖拽形状入晚画容器（中心 1230,130 → 680,130：全含于晚容器、
  // 不含于第一个容器——x 650 > 500）。先过 captureTimeout：拖拽是独立撤销项
  // （上方 engineAdd 的建件写入没有 stopCapturing，窗口内会并项）
  await page.waitForTimeout(650);
  await dragFrom(page, 1230, 130, -550, 0);
  pair = await vmStates(page);
  const movedShape = pair.find((s) => s.id === shapeId)!;
  const clampedFrame = pair.find((s) => s.id === lateFrame.id)!;
  expect(movedShape.parentId).toBe(lateFrame.id);
  expect(clampedFrame.zOrder! < movedShape.zOrder!).toBe(true);
  // 一步 undo：位移 + 设父 + 钳制同事务（I6）——三者一并回退，不多不少
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await vmStates(page)).find((s) => s.id === shapeId)!.x).toBe(1200);
  pair = await vmStates(page);
  const undoneShape = pair.find((s) => s.id === shapeId)!;
  const undoneFrame = pair.find((s) => s.id === lateFrame.id)!;
  expect('parentId' in undoneShape).toBe(false); // 设父回退
  expect(undoneFrame.zOrder! > undoneShape.zOrder!).toBe(true); // 钳制回退（容器回到形状之上）
  expect(await modelCount(page)).toBe(4); // 建件未被牵连
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

test('C-12 项目文件往返：容器/标题/parentId/headerSide 全部恢复', async ({ page }) => {
  const [frameId] = await engineAdd(page, [
    {
      type: 'FRAME',
      color: '#ffffff',
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      title: '审批',
      headerSide: 'left',
    },
  ]);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child.parentId).toBe(frameId);

  // 导出 → 导入新文档（N-10 同款：等 URL 切走再等 synced）
  const { exportViaMenu, importViaInput, waitForImportedNav } =
    await import('./helpers/projectFileE2e');
  const docBefore = (await page.url().match(/doc=([^&]+)/))![1]!;
  const { fileName, path } = await exportViaMenu(page);
  expect(fileName).toMatch(/\.spinth\.zip$/);
  await importViaInput(page, path);
  await waitForImportedNav(page, docBefore);

  // 全量恢复：容器四要素 + 归属
  await expect.poll(() => framesOf(page).then((fs) => fs.length)).toBe(1);
  const frame = (await framesOf(page))[0]!;
  expect(frame.title).toBe('审批');
  expect(frame.headerSide).toBe('left');
  expect([frame.x, frame.y, frame.width, frame.height]).toEqual([100, 100, 400, 300]);
  const child2 = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child2.parentId).toBe(frame.id);
});

test('C-13 三泳道样本：left 表头 3 容器 × 每行 2 任务 + 跨行正交连线；移行动跟随；导出 PNG', async ({
  page,
}) => {
  // 3 行泳道（headerSide left：左侧 112 表头列）+ 每行 2 任务（矩形）
  const ROWS = [
    { y: 100, name: '申请' },
    { y: 260, name: '审批' },
    { y: 420, name: '归档' },
  ];
  const widgets: Array<Record<string, unknown>> = [];
  for (const r of ROWS) {
    widgets.push({
      type: 'FRAME',
      color: '#ffffff',
      title: r.name,
      headerSide: 'left',
      x: 100,
      y: r.y,
      width: 600,
      height: 140,
    });
    widgets.push({
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 200,
      y: r.y + 40,
      width: 120,
      height: 60,
    });
    widgets.push({
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 380,
      y: r.y + 40,
      width: 120,
      height: 60,
    });
  }
  const ids = await engineAdd(page, widgets);
  await expect.poll(() => modelCount(page)).toBe(9);
  // 每行任务归属对应泳道（创建即归属：engine.add 同流）
  const frames = await framesOf(page);
  const shapes = await shapesOf(page);
  for (const f of frames) {
    const own = shapes.filter((s) => s.y > f.y && s.y < f.y + 140);
    expect(own).toHaveLength(2);
    for (const s of own) expect(s.parentId).toBe(f.id);
  }

  // 跨行正交连线：行 1 首任务 → 行 2 首任务（连线工具，默认 ELBOWED）
  await page.keyboard.press('l');
  await page.mouse.move(260, 170 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(260, 330 + TOP_BAR, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect
    .poll(() => vmStates(page).then((vs) => vs.filter((s) => s.type === 'LINE').length))
    .toBe(1);

  // 移动第 2 行（抓左表头列）：该行任务跟随、他行不动
  // （先回选择工具——线工具下 down 是拉新手势不是移动）
  await page.keyboard.press('v');
  const row2Frame = frames.find((f) => f.y === 260)!;
  const row2Tasks = shapes.filter((s) => s.y === 300);
  const row1Frame = frames.find((f) => f.y === 100)!;
  const row1Tasks = shapes.filter((s) => s.y === 140);
  const before = {
    r2f: { ...row2Frame },
    r2t: row2Tasks.map((t) => ({ ...t })),
    r1f: { ...row1Frame },
    r1t: row1Tasks.map((t) => ({ ...t })),
  };
  await page.mouse.move(150, 330 + TOP_BAR); // 行 2 左表头列内
  await page.mouse.down();
  await page.mouse.move(230, 370 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await vmStates(page);
  const moved = (id: string) => after.find((s) => s.id === id)!;
  const dxF = moved(row2Frame.id).x - before.r2f.x;
  const dyF = moved(row2Frame.id).y - before.r2f.y;
  expect(Math.abs(dxF)).toBeGreaterThan(5); // 确有位移
  for (const t of before.r2t) {
    expect(moved(t.id).x - t.x).toBe(dxF); // 任务与容器同位移
    expect(moved(t.id).y - t.y).toBe(dyF);
  }
  expect(moved(row1Frame.id).x).toBe(before.r1f.x); // 他行不动
  for (const t of before.r1t) expect(moved(t.id).x).toBe(t.x);

  // 导出 PNG（右键画布菜单——点行 3 下方的空白画布，元素菜单无导出项）
  await page.mouse.click(400, 640 + TOP_BAR, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  const dl = page.waitForEvent('download', { timeout: 10_000 });
  await menu.getByRole('menuitem', { name: '导出画布 PNG' }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe('spinth-board.png');
  expect((await import('node:fs')).statSync((await download.path())!).size).toBeGreaterThan(1000);
  void ids;
});

test('C-14 恢复保真：框外子随容器删除后 undo 仍归属且无幻影撤销项；先画后框的形状 undo 仍是顶层', async ({
  page,
}) => {
  // ── 场景 A：缩小容器 → 子元素完全在父框外、却仍持有 parentId ──
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;
  expect(child.parentId).toBe(frame.id);

  await page.mouse.click(200, 112 + TOP_BAR); // 标题带：首次点击只选中
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]);
  await page.waitForTimeout(250); // 等 RectEditor 边热区挂载
  await dragWestEdgeTo(page, frame, 300); // 容器缩到 300..500；子在 150..210
  let f = (await framesOf(page))[0]!;
  expect(Math.abs(f.x - 300)).toBeLessThan(1.5);
  expect((await shapesOf(page))[0]!.parentId).toBe(frame.id); // 缩放不重判归属

  // 删容器（连子删）。容器仍选中——不再点标题带：点已选中的件会进标题编辑
  await page.keyboard.press('Delete');
  await expect.poll(() => modelCount(page)).toBe(0);
  // 过 captureTimeout：恢复若偷写归属，会成为独立撤销项而不会并入旧项
  await page.waitForTimeout(700);
  await page.keyboard.press('Meta+z');
  await expect.poll(() => modelCount(page)).toBe(2);
  f = (await framesOf(page))[0]!;
  // 读文档真值：恢复批里紧随创建的重判写入对 vm 观察者不可见——vmStates 会
  // 停在创建时的值而掩盖「文档被清父」（修前实测：文档无父、vm.state 仍归属）
  expect((await modelOf(page, child.id))!.parentId).toBe(frame.id); // 曾被清成 undefined
  expect(Math.abs(f.x - 300)).toBeLessThan(1.5); // 这一步只回退了删除
  // 再 undo = 回退缩放：恢复没有留下幻影撤销项
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => Math.abs((await framesOf(page))[0]!.x - 100) < 0.01).toBe(true);

  // ── 场景 B：先画形状、后画容器（建容器不收养）——形状是顶层件 ──
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(700, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(760, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(3);
  await engineAdd(page, [
    { type: 'FRAME', color: '#ffffff', x: 600, y: 100, width: 400, height: 300 },
  ]);
  await expect.poll(() => modelCount(page)).toBe(4);
  const top = (await shapesOf(page)).find((s) => s.x === 700)!;
  expect('parentId' in top).toBe(false); // 建容器不收养既有元素
  expect(await selectedIds(page)).toEqual([top.id]); // 拖拽创建选中新件
  await page.waitForTimeout(650); // 建件写入没有 stopCapturing：过窗口再删
  await page.keyboard.press('Delete');
  await expect.poll(() => modelCount(page)).toBe(3);
  await page.waitForTimeout(700);
  await page.keyboard.press('Meta+z');
  await expect.poll(() => modelCount(page)).toBe(4);
  const back = (await modelOf(page, top.id))!; // 文档真值（同场景 A）
  expect('parentId' in back).toBe(false); // 曾被收养进后画的容器
  expect([back.x, back.y, back.width, back.height]).toEqual([700, 150, 60, 60]);
});

test('C-15 粘贴保真：复制「容器 + 框外子」→ 副本子仍归属副本容器；顶层件的副本落进容器内仍是顶层', async ({
  page,
}) => {
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page)).find((s) => s.x === 150)!;
  await page.mouse.click(200, 112 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([frame.id]);
  await page.waitForTimeout(250);
  await dragWestEdgeTo(page, frame, 300); // 子成了「框外子」

  // 复制「容器 + 框外子」→ 粘贴（落视口中心）：副本子的 parentId 由粘贴桶映射
  // 给足，创建路径不得重判（曾按 rule 3 清成 undefined——副本与原件分叉）
  const plain = await fireClipboard(page, 'copy');
  await fireClipboard(page, 'paste', plain);
  await expect.poll(() => modelCount(page)).toBe(4);
  const newFrame = (await framesOf(page)).find((s) => s.id !== frame.id)!;
  const newChild = (await shapesOf(page)).find((s) => s.id !== child.id)!;
  expect(newFrame.width).toBeCloseTo(200, 1); // 副本保持缩小后的几何
  // 读文档真值：粘贴批在事务内，紧随创建的重判写入对 vm 观察者不可见
  // （修前实测：文档清成无父、vm.state 仍显示归属——vmStates 断言假绿）
  expect((await modelOf(page, newChild.id))!.parentId).toBe(newFrame.id);

  // 顶层件的副本落进容器内：粘贴是复制既有状态，不替用户新做归属决定
  // （I5 三条写路径不含粘贴；要归属就拖一下——C-5 拖入归属）
  // 粘贴落点 = 视口中心（快照包络左上角落定）——围绕中心显式放一个容器，
  // 保证副本确实落在某个存活容器内（否则这条断言是空过）
  const vp = await page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              viewport: {
                vpBounds$: { value: { x: number; y: number; width: number; height: number } };
              };
            };
          };
        }
      ).__spinthDebug.__debug.viewport.vpBounds$.value,
  );
  const center = { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 };
  const [padId] = await engineAdd(page, [
    {
      type: 'FRAME',
      color: '#ffffff',
      x: center.x - 40,
      y: center.y - 40,
      width: 300,
      height: 300,
    },
  ]);
  const [topId] = await engineAdd(page, [
    {
      type: 'SHAPE',
      color: '#e8f0fb',
      shapeType: 'rect',
      text: '',
      x: 1200,
      y: 100,
      width: 60,
      height: 60,
    },
  ]);
  expect('parentId' in (await shapesOf(page)).find((s) => s.id === topId)!).toBe(false);
  await page.mouse.click(1230, 130 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([topId]);
  const plain2 = await fireClipboard(page, 'copy');
  await fireClipboard(page, 'paste', plain2);
  await expect.poll(() => modelCount(page)).toBe(7); // 4 + 容器 + 顶层件 + 它的副本
  const copy = (await shapesOf(page)).find(
    (s) => s.id !== topId && s.id !== child.id && s.id !== newChild.id,
  )!;
  const pad = (await framesOf(page)).find((s) => s.id === padId)!;
  // 前置：副本落在视口中心、完全在那个容器内
  expect(Math.abs(copy.x - center.x)).toBeLessThan(0.01);
  expect(Math.abs(copy.y - center.y)).toBeLessThan(0.01);
  expect(copy.x).toBeGreaterThanOrEqual(pad.x);
  expect(copy.x + copy.width).toBeLessThanOrEqual(pad.x + pad.width);
  expect(copy.y).toBeGreaterThanOrEqual(pad.y);
  expect(copy.y + copy.height).toBeLessThanOrEqual(pad.y + pad.height);
  expect('parentId' in (await modelOf(page, copy.id))!).toBe(false); // 仍是顶层（文档真值）
});

test('C-16 粘贴层级：子先于容器入批（选区序 [子, 容器]）→ 副本容器在文档与渲染两层都在副本子之下', async ({
  page,
}) => {
  // 粘贴批按选区序入批：子在前 → 子副本的 zOrder 先生成（更低）、容器副本后
  // 生成（更高）——白底容器会盖住子。§4.7 钳制必须同时落到文档（model）与
  // 渲染（root.zOrder）：批内写入对刚建 vm 的观察者不可见，只写文档不生效
  const frame = await addFrame(page, 100, 100, 400, 300);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(150, 150 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(210, 210 + TOP_BAR, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  const child = (await shapesOf(page))[0]!;
  expect(child.parentId).toBe(frame.id);

  // 选区序 [子, 容器]：先点子，再 Shift 点容器标题带。修饰键须显式按住——
  // mouse.click 的 modifiers 选项在本应用不产生 shiftKey（实测选区被替换）
  await page.mouse.click(180, 180 + TOP_BAR);
  await expect.poll(() => selectedIds(page)).toEqual([child.id]);
  await page.keyboard.down('Shift');
  await page.mouse.click(200, 112 + TOP_BAR);
  await page.keyboard.up('Shift');
  await expect.poll(() => selectedIds(page)).toEqual([child.id, frame.id]);

  const plain = await fireClipboard(page, 'copy');
  await fireClipboard(page, 'paste', plain);
  await expect.poll(() => modelCount(page)).toBe(4);
  const newFrame = (await framesOf(page)).find((s) => s.id !== frame.id)!;
  const newChild = (await shapesOf(page)).find((s) => s.id !== child.id)!;
  expect((await modelOf(page, newChild.id))!.parentId).toBe(newFrame.id);
  // 文档层：容器副本 zOrder < 子副本 zOrder
  const frameDoc = (await modelOf(page, newFrame.id))!.zOrder!;
  const childDoc = (await modelOf(page, newChild.id))!.zOrder!;
  expect(frameDoc < childDoc).toBe(true);
  // 渲染层：root.zOrder（viewport 排序依据）同样压在子之下
  const frameZ = await renderZOrderOf(page, newFrame.id);
  const childZ = await renderZOrderOf(page, newChild.id);
  expect(frameZ).toBeDefined();
  expect(childZ).toBeDefined();
  expect(frameZ! < childZ!).toBe(true);
  // 行为：点子副本中心命中的是子副本（被容器盖住时命中的是容器）
  await page.keyboard.press('Escape');
  await page.mouse.click(
    newChild.x + newChild.width / 2,
    newChild.y + newChild.height / 2 + TOP_BAR,
  );
  await expect.poll(() => selectedIds(page)).toEqual([newChild.id]);
});
