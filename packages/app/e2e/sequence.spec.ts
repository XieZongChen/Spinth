/** UML 时序图 E2E——批次 1：生命线（specs/sequence-diagram §10 Q-1 / Q-2 / Q-16 /
 *  Q-18 / Q-20…Q-23）。断言走 __spinthDebug.__debug 探针（世界坐标），指针坐标经
 *  公开查询 toScreenPoint 现算；批量路径后的断言读 model.toJSON() 文档真值。
 *  轴锚定 / 消息 / 激活条 / 片段属后续批次，不在本 spec。 */
import { expect, test } from '@playwright/test';
import { openBoardDoc, waitForSynced } from './helpers/boardE2e';
import {
  backToCursor,
  clickCreateLifeline,
  clickWorld,
  cursorModeOf,
  docOf,
  dragWorld,
  editorFrameOf,
  engineAdd,
  lifelinesOf,
  modelCountOf,
  type LifelineSnap,
  obstaclesOf,
  pressSequenceTool,
  rectOf,
  selectedIdsOf,
  toPage,
  vmStates,
  waitSaved,
} from './helpers/sequenceE2e';
import {
  cleanupDoc,
  exportViaMenu,
  importViaInput,
  waitForImportedNav,
} from './helpers/projectFileE2e';
import { MOBILE, boxWithin, noDocHScroll, openBoard } from './helpers/layoutE2e';

const docIdOf = (tag: string): string => `e2e-seq-${tag}-${Date.now()}`;

/** 已选中控件的某个手柄从世界 (x1, y1) 拖到 (x2, y2)；onDrag 在按住时回调（断言拖拽中状态） */
async function dragHandle(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  onDrag?: () => Promise<void>,
): Promise<void> {
  const a = await toPage(page, x1, y1);
  const b = await toPage(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await onDrag?.();
  await page.mouse.up();
  await page.waitForTimeout(300); // 等 RectEditor 手柄按新几何重挂
}

test('Q-1 创建：单击落默认 120×520 按下点居中、工具保持、不选中；滑移 8px 仍按单击；拖拽跟手松手选中回 cursor', async ({
  page,
}) => {
  const docId = docIdOf('q1');
  await openBoardDoc(page, docId);
  await pressSequenceTool(page);

  // ① 单击（世界 300,200）：默认尺寸、按下点居中
  const a = await clickCreateLifeline(page, 300, 200);
  expect(rectOf(a)).toEqual([240, -60, 120, 520]);
  expect(a.label).toBe('');
  expect(await cursorModeOf(page)).toBe('sequence'); // 工具保持可连击
  expect(await selectedIdsOf(page)).toEqual([]); // 不选中

  // ② 滑移 8px（低于 10 屏幕 px 的单击 / 拖拽分界）仍按单击
  const p = await toPage(page, 700, 200);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => (await lifelinesOf(page)).length).toBe(2);
  const b = (await lifelinesOf(page)).find((l) => l.x === 640 && l.y === -60);
  expect(b, '8px 滑移应仍落单击默认尺寸、按下点居中').toBeDefined();
  expect(rectOf(b!)).toEqual([640, -60, 120, 520]);

  // ③ 拖拽画图（世界 200,400 → 320,760）：草稿跟手，松手选中并回选择工具
  await dragWorld(page, 200, 400, 320, 760);
  await expect.poll(async () => (await lifelinesOf(page)).length).toBe(3);
  const c = (await lifelinesOf(page)).find((l) => l.x === 200 && l.y === 400)!;
  expect(rectOf(c)).toEqual([200, 400, 120, 360]);
  expect(await cursorModeOf(page)).toBe('cursor');
  await expect.poll(() => selectedIdsOf(page)).toEqual([c.id]);

  // ④ 草稿下限 60×120：拖出 20×20 的小框落成下限尺寸
  await pressSequenceTool(page);
  await dragWorld(page, 900, 100, 920, 120, 4);
  await expect.poll(async () => (await lifelinesOf(page)).length).toBe(4);
  const d = (await lifelinesOf(page)).find((l) => l.x === 900 && l.y === 100)!;
  expect(rectOf(d)).toEqual([900, 100, 60, 120]);

  await cleanupDoc(page, docId);
});

test('Q-2 标签：再点头框进编辑、Enter 落库（清洗）；空标签保留；一步 undo；点轴不进编辑', async ({
  page,
}) => {
  const docId = docIdOf('q2');
  await openBoardDoc(page, docId);
  await pressSequenceTool(page);
  // (240,40,120,520)：头框 y 40…76，轴 x = 300、y 76…560
  const l = await clickCreateLifeline(page, 300, 300);
  await backToCursor(page);
  const textarea = page.locator('textarea');

  // 点轴：选中；已选中后再点轴：不进编辑（进入入口只认头框）
  await clickWorld(page, 300, 300);
  await expect.poll(() => selectedIdsOf(page)).toEqual([l.id]);
  await clickWorld(page, 300, 300);
  await page.waitForTimeout(300);
  await expect(textarea).toHaveCount(0);

  // 再点头框 → 进编辑；编辑器与画布标签同居中；直接 Enter（空）→ 生命线保留、标签空
  await clickWorld(page, 300, 58);
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveCSS('text-align', 'center');
  await textarea.press('Enter');
  await expect(textarea).toHaveCount(0);
  expect(await modelCountOf(page)).toBe(1);
  expect((await docOf(page, l.id))!.label).toBe('');

  // 命名 → Enter 落库；连续空白折一、首尾 trim
  await clickWorld(page, 300, 58);
  await textarea.fill('  支付  服务 ');
  await textarea.press('Enter');
  await expect.poll(async () => (await docOf(page, l.id))!.label).toBe('支付 服务');

  // 一步 undo：只回标签这一笔，生命线还在
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await docOf(page, l.id))!.label).toBe('');
  expect(await modelCountOf(page)).toBe(1);

  // 清空后提交：空标签 keep，不删生命线
  await clickWorld(page, 300, 300); // 选中（undo 后选区可能已清；已选中时点轴不进编辑）
  await clickWorld(page, 300, 58);
  await textarea.fill('订单');
  await textarea.press('Enter');
  await expect.poll(async () => (await docOf(page, l.id))!.label).toBe('订单');
  await clickWorld(page, 300, 58);
  await textarea.fill('');
  await textarea.press('Enter');
  await expect(textarea).toHaveCount(0);
  expect(await modelCountOf(page)).toBe(1);
  expect((await docOf(page, l.id))!.label).toBe('');

  await cleanupDoc(page, docId);
});

test('Q-16 只读（follower 标签）：按 Q 钳回 cursor、工具钮禁用、拖动不写、不进标签编辑', async ({
  page,
  context,
}) => {
  const docId = docIdOf('q16');
  await openBoardDoc(page, docId);
  await pressSequenceTool(page);
  await clickCreateLifeline(page, 300, 300);

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}`);
  await waitForSynced(pageB);
  await pageB.waitForFunction(
    (r) =>
      document.querySelector('[data-spinth-tab-role]')?.getAttribute('data-spinth-tab-role') === r,
    'follower',
    { timeout: 20_000 },
  );
  await expect.poll(async () => (await lifelinesOf(pageB)).length).toBe(1);

  // 工具钮禁用；快捷键 Q 被只读钳制拦下
  const bar = pageB.getByRole('toolbar', { name: '画板工具' });
  await expect(bar.getByRole('button', { name: '时序图 (Q)' })).toBeDisabled();
  await pageB.keyboard.press('q');
  await pageB.waitForTimeout(300);
  expect(await cursorModeOf(pageB)).toBe('cursor');

  // 画布上按下拖动：不写文档
  await dragWorld(pageB, 600, 200, 700, 500);
  expect(await modelCountOf(pageB)).toBe(1);
  expect((await lifelinesOf(pageB)).length).toBe(1);

  // 点头框两次：只读不建选区、不进标签编辑、无操作栏
  await clickWorld(pageB, 300, 58);
  await clickWorld(pageB, 300, 58);
  await pageB.waitForTimeout(300);
  await expect(pageB.locator('textarea')).toHaveCount(0);
  expect(await selectedIdsOf(pageB)).toEqual([]);
  await expect(pageB.locator('[data-spinth-action-bar]')).toHaveCount(0);
  await pageB.close();
  await cleanupDoc(page, docId);
});

test.describe('Q-18 390px', () => {
  test.use({ viewport: MOBILE });

  test('工具坞第 12 钮可达、图元组二级菜单不出视口；快捷键 Q 切工具', async ({ page }) => {
    const docId = docIdOf('q18');
    await openBoard(page, docId);
    const dock = page.locator('[data-spinth-toolbar]');
    const btn = dock.getByRole('button', { name: '时序图 (Q)' });
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect.poll(() => cursorModeOf(page)).toBe('sequence');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');

    const flyout = page.locator('[data-spinth-tool-flyout]');
    await expect(flyout).toBeVisible();
    await boxWithin(flyout, MOBILE, 8);
    await boxWithin(dock, MOBILE, 0);
    await noDocHScroll(page);
    // 图元组（批次 1 只有生命线）：唯一项即当前种类；点选不越界、工具不切走
    const item = flyout.getByRole('menuitemradio', { name: '生命线' });
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', 'true');
    expect(await cursorModeOf(page)).toBe('sequence');

    // 390 视口内单击创建（视口原点经 toScreenPoint 现算，不依赖硬编码偏移）
    const l = await clickCreateLifeline(page, 195, 300);
    expect([l.width, l.height]).toEqual([120, 520]);

    // 快捷键 Q：切走再切回
    await backToCursor(page);
    await pressSequenceTool(page);
    await cleanupDoc(page, docId);
  });
});

test('Q-20 命中口径：点轴旁空白不选中、点轴选中；框选只碰头旁空白不入选、擦过轴带入选', async ({
  page,
}) => {
  const docId = docIdOf('q20');
  await openBoardDoc(page, docId);
  await pressSequenceTool(page);
  // (240,40,120,520)：头框 y 40…76，轴带 x 294…306、y 76…560
  const l = await clickCreateLifeline(page, 300, 300);
  await backToCursor(page);

  // 轴旁空白（世界 260,300：离轴 40 > 半宽 6）——不选中
  await clickWorld(page, 260, 300);
  await page.waitForTimeout(300);
  expect(await selectedIdsOf(page)).toEqual([]);

  // 点轴 → 选中
  await clickWorld(page, 300, 300);
  await expect.poll(() => selectedIdsOf(page)).toEqual([l.id]);

  // 框选只罩轴旁空白（x 244…290，y 200…280：不碰头框、不碰轴带）→ 不入选
  await clickWorld(page, 900, 700); // 点空白清选区
  await expect.poll(() => selectedIdsOf(page)).toEqual([]);
  await dragWorld(page, 244, 200, 290, 280, 6);
  await page.waitForTimeout(300);
  expect(await selectedIdsOf(page), '框选擦过轴旁空白不应选中').toEqual([]);

  // 框选擦过轴带（x 280…320）→ 入选
  await dragWorld(page, 280, 200, 320, 280, 6);
  await expect.poll(() => selectedIdsOf(page)).toEqual([l.id]);

  await cleanupDoc(page, docId);
});

test('Q-21 缩放整形：被拖边跟手、宽度以轴对称、下限 60×120、一步 undo；拖拽中编辑框与目标矩形贴合', async ({
  page,
}) => {
  const docId = docIdOf('q21');
  await openBoardDoc(page, docId);
  await pressSequenceTool(page);
  // (240,40,120,520)：轴 x = 300、底边 560
  const l = await clickCreateLifeline(page, 300, 300);
  await backToCursor(page);
  await clickWorld(page, 300, 300);
  await expect.poll(() => selectedIdsOf(page)).toEqual([l.id]);
  await expect.poll(() => editorFrameOf(page)).toEqual({ x: 240, y: 40, width: 120, height: 520 });
  const docRect = async () => rectOf((await docOf(page, l.id))!);

  // 东边手柄（360,300）拖到 460：右边跟手 → 宽 = 2 × (460 − 300) = 320、x = 140（轴不动）
  await dragHandle(page, 360, 300, 460, 300, async () => {
    // 拖拽中：编辑框就是整形后的目标矩形（预览 / 编辑框 / 落库同源）
    await expect
      .poll(() => editorFrameOf(page))
      .toEqual({
        x: 140,
        y: 40,
        width: 320,
        height: 520,
      });
  });
  expect(await docRect()).toEqual([140, 40, 320, 520]);
  expect((await docOf(page, l.id))!.x + 160).toBe(300); // 轴 x 不因缩放移动（140 + 320 / 2）

  // 一步 undo / redo
  await page.keyboard.press('Meta+z');
  await expect.poll(docRect).toEqual([240, 40, 120, 520]);
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(docRect).toEqual([140, 40, 320, 520]);
  await clickWorld(page, 300, 300); // 重选（undo / redo 可能清选区）
  await expect.poll(() => selectedIdsOf(page)).toEqual([l.id]);
  await expect.poll(() => editorFrameOf(page)).toEqual({ x: 140, y: 40, width: 320, height: 520 });

  // 西边手柄（140,300）拖到 100：左边跟手 → 宽 = 2 × (300 − 100) = 400、x = 100
  await dragHandle(page, 140, 300, 100, 300);
  expect(await docRect()).toEqual([100, 40, 400, 520]);

  // 向内拖过下限：东边手柄（500,300）拖到 315 → 半宽 15 → 钳到宽 60、x = 270
  await dragHandle(page, 500, 300, 315, 300);
  expect(await docRect()).toEqual([270, 40, 60, 520]);

  // 高度下限 120：南边手柄（300,560）拖到 70 → 钳到 120、顶边不动
  await dragHandle(page, 300, 560, 300, 70);
  expect(await docRect()).toEqual([270, 40, 60, 120]);

  // 北边手柄（300,40）拖过底边 → 仍钳 120、锚底边
  await dragHandle(page, 300, 40, 300, 200);
  expect(await docRect()).toEqual([270, 40, 60, 120]);

  await cleanupDoc(page, docId);
});

test('Q-22 容器内建生命线文档无 parentId；通用折线穿过生命线不绕行、不入障碍集合', async ({
  page,
}) => {
  const docId = docIdOf('q22');
  await openBoardDoc(page, docId);
  await engineAdd(page, [
    { id: 'q22frame', type: 'FRAME', color: '#ffffff', x: 100, y: 60, width: 500, height: 640 },
    {
      id: 'q22a',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      x: 660,
      y: 300,
      width: 80,
      height: 60,
    },
    {
      id: 'q22b',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      x: 1100,
      y: 300,
      width: 80,
      height: 60,
    },
  ]);

  await pressSequenceTool(page);
  // 完全落进容器（x 290…410 ⊂ 100…600，y 140…660 ⊂ 60…700）——若参与归属会被收养
  const inside = await clickCreateLifeline(page, 350, 400);
  const outside = await clickCreateLifeline(page, 900, 300); // (840,40,120,520)：正压在 A→B 走廊上
  await backToCursor(page);

  // 文档真值：两条生命线都无 parentId
  expect(await docOf(page, inside.id)).not.toHaveProperty('parentId');
  expect(await docOf(page, outside.id)).not.toHaveProperty('parentId');

  // 连线工具：A 右缘内 → B 左缘内（y = 330，水平穿过容器外那条生命线）。按下 /
  // 松开点偏到朝向对方的边附近——压在正中心时最近边判定落到 top，线走顶边绕行
  //（存量口径，与本批无关）
  await page.keyboard.press('l');
  await expect.poll(() => cursorModeOf(page)).toBe('line');
  const drawBetween = async (y: number): Promise<void> => {
    const a = await toPage(page, 735, y);
    const b = await toPage(page, 1105, y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  await drawBetween(330);

  // 生命线不入最近一次避障集合
  const obstacles = await obstaclesOf(page);
  expect(obstacles).not.toBeNull();
  const contains = (o: Array<Record<string, number>>, r: LifelineSnap) =>
    o.some(
      (c) =>
        Math.abs(c.x! - r.x) <= 1 &&
        Math.abs(c.y! - r.y) <= 1 &&
        Math.abs(c.width! - r.width) <= 1 &&
        Math.abs(c.height! - r.height) <= 1,
    );
  expect(
    contains(obstacles!, outside),
    `生命线不应入障碍集合，实际 ${JSON.stringify(obstacles)}`,
  ).toBe(false);

  // 线不绕行：两端贴 A 右缘 / B 左缘，一条水平直线
  const lastLine = async () =>
    ((await vmStates(page)).filter((s) => s.type === 'LINE').at(-1) as unknown as
      { points: Array<[number, number]> } | undefined)!.points;
  expect(await lastLine()).toEqual([
    [740, 330],
    [1100, 330],
  ]);

  // 对照（判别实现，防恒真）：走廊上换成同尺寸的实心形状 → 线绕行、形状入障碍集合
  await engineAdd(page, [
    {
      id: 'q22c',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      x: 660,
      y: 700,
      width: 80,
      height: 60,
    },
    {
      id: 'q22d',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      x: 1100,
      y: 700,
      width: 80,
      height: 60,
    },
    {
      id: 'q22wall',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      x: 840,
      y: 640,
      width: 120,
      height: 180,
    },
  ]);
  await page.keyboard.press('l');
  await expect.poll(() => cursorModeOf(page)).toBe('line');
  await drawBetween(730);
  const detour = await lastLine();
  expect(detour.length, `实体挡路时线应绕行，实际 ${JSON.stringify(detour)}`).toBeGreaterThan(2);
  expect(detour.some((p) => p[1] !== 730)).toBe(true);
  expect(
    contains((await obstaclesOf(page))!, {
      x: 840,
      y: 640,
      width: 120,
      height: 180,
    } as LifelineSnap),
  ).toBe(true);

  await cleanupDoc(page, docId);
});

test('Q-23 刷新恢复与项目文件往返：生命线几何与标签保真', async ({ page }) => {
  const docId = docIdOf('q23');
  await openBoardDoc(page, docId);
  await pressSequenceTool(page);
  const l = await clickCreateLifeline(page, 300, 300);
  await backToCursor(page);
  await clickWorld(page, 300, 300);
  await expect.poll(() => selectedIdsOf(page)).toEqual([l.id]);
  await clickWorld(page, 300, 58);
  await page.locator('textarea').fill('订单服务');
  await page.locator('textarea').press('Enter');
  await expect.poll(async () => (await docOf(page, l.id))!.label).toBe('订单服务');
  // 改一次几何（非默认尺寸）：东边手柄外拖 → (140,40,320,520)
  await dragHandle(page, 360, 300, 460, 300);
  expect(rectOf((await docOf(page, l.id))!)).toEqual([140, 40, 320, 520]);

  // 刷新恢复（先等防抖持久化落盘）
  await waitSaved(page);
  await page.reload();
  await waitForSynced(page);
  await expect.poll(async () => (await lifelinesOf(page)).length).toBe(1);
  const afterReload = (await lifelinesOf(page))[0]!;
  expect(rectOf(afterReload)).toEqual([140, 40, 320, 520]);
  expect(afterReload.label).toBe('订单服务');

  // 项目文件往返：导出 .spinth.zip → 导入为新文档
  const { path } = await exportViaMenu(page);
  await importViaInput(page, path);
  await waitForImportedNav(page, docId);
  await expect.poll(async () => (await lifelinesOf(page)).length).toBe(1);
  const imported = (await lifelinesOf(page))[0]!;
  expect(rectOf(imported)).toEqual([140, 40, 320, 520]);
  expect(imported.label).toBe('订单服务');

  await cleanupDoc(page, docId);
});
