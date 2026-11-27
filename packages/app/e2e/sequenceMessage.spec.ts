/** UML 时序图 E2E——批次 2：轴锚定 + 消息（specs/sequence-diagram §10 Q-3…Q-9、Q-15、
 *  Q-19 悬停光标部分）。生命线用 engineAdd 搭建；消息一律经 UI 手势画出（时序图工具 →
 *  二级菜单选消息种类 → 轴上按下拖到另一条轴）；落库断言读 model.toJSON() 文档真值。
 *  激活条 / 片段 / 线上文字侧别属后续批次，不在本 spec。 */
import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';
import {
  backToCursor,
  clickWorld,
  cursorModeOf,
  docOf,
  dragWorld,
  engineAdd,
  lineAnchorsOf,
  lineDoc,
  linesOf,
  linePreviewOf,
  modelCountOf,
  pressMessageTool,
  type LineSnap,
  selectedIdsOf,
  toPage,
} from './helpers/sequenceE2e';
import { cleanupDoc } from './helpers/projectFileE2e';

const docIdOf = (tag: string): string => `e2e-seqmsg-${tag}-${Date.now()}`;

/** 生命线夹具：宽 120（轴 = x + 60）、头高 36；缺省 y = 100、高 520（轴段 y 136…620） */
const LIFELINE_W = 120;
const HEAD_H = 36;
const AXIS_LEN = 520 - HEAD_H;

interface LifeSpec {
  id: string;
  x: number;
  y?: number;
  height?: number;
}

const shape = (id: string, x: number, y: number): Record<string, unknown> => ({
  id,
  type: 'SHAPE',
  shapeType: 'rect',
  color: '#e8f0fb',
  borderStyle: 'solid',
  text: '',
  x,
  y,
  width: 100,
  height: 80,
});

async function setup(
  page: Page,
  docId: string,
  lives: LifeSpec[],
  more: Array<Record<string, unknown>> = [],
): Promise<void> {
  await openBoardDoc(page, docId);
  await engineAdd(page, [
    ...lives.map((l) => ({
      id: l.id,
      type: 'LIFELINE',
      label: l.id.toUpperCase(),
      x: l.x,
      y: l.y ?? 100,
      width: LIFELINE_W,
      height: l.height ?? 520,
    })),
    ...more,
  ]);
}

/** |a − b| < tol */
function near(a: number, b: number, tol = 0.5): void {
  expect(Math.abs(a - b), `${a} 应约等于 ${b}（±${tol}）`).toBeLessThan(tol);
}

/** 按下 (x1,y1) 拖到 (x2,y2) 松手（holdMs = 按住不动多久，模拟慢拖） */
async function drawGesture(
  page: Page,
  from: [number, number],
  to: [number, number],
  holdMs = 0,
): Promise<void> {
  const a = await toPage(page, from[0], from[1]);
  const b = await toPage(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** 画一条消息，返回新线的文档真值（恰好新建一条） */
async function drawMessage(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<LineSnap> {
  const before = new Set((await linesOf(page)).map((l) => l.id));
  await drawGesture(page, from, to);
  const created = (await linesOf(page)).filter((l) => !before.has(l.id));
  expect(created, '应恰好新建一条线').toHaveLength(1);
  return (await lineDoc(page, created[0]!.id))!;
}

/** 已选中控件的手柄从世界 (x1,y1) 拖到 (x2,y2)；onDrag 在按住时回调 */
async function dragHandle(
  page: Page,
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
  await page.waitForTimeout(300);
}

const canvasCursor = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('canvas')!.style.cursor);

test('Q-3 同步消息：A 轴按下拖到 B 轴 → STRAIGHT 实心箭头，两端落在按下高度', async ({ page }) => {
  const docId = docIdOf('q3');
  // 轴 x = 300 / 620，轴段 y 136…620
  await setup(page, docId, [
    { id: 'qa', x: 240 },
    { id: 'qb', x: 560 },
  ]);
  await pressMessageTool(page, '同步消息');
  // 按下 (302, 300)：轴右侧 2px；松手 (622, 350)：指针比起点低 50——高度仍锁定在 300
  const m = await drawMessage(page, [302, 300], [622, 350]);
  expect(m).toMatchObject({
    type: 'LINE',
    lineType: 'STRAIGHT',
    startArrow: 'none',
    endArrow: 'solid',
    dashed: false,
    startNodeId: 'qa',
    endNodeId: 'qb',
    startJoin: 'right',
    endJoin: 'left',
  });
  expect(m.points).toHaveLength(2);
  // 高度 = 按下高度（两端一致）
  near(m.points[0]![1], 300);
  near(m.points[1]![1], 300);
  // 端口还原的高度 = 按下高度（4 位小数）
  near(100 + HEAD_H + AXIS_LEN * m.startPort!, 300);
  near(100 + HEAD_H + AXIS_LEN * m.endPort!, 300);
  // 起点在 A 轴去向侧、箭头停在 B 轴上（各让出一个线端留隙 5）
  near(m.points[0]![0], 295);
  near(m.points[1]![0], 625);
  // 落定后选中该线、工具保持激活
  expect(await selectedIdsOf(page)).toEqual([m.id]);
  expect(await cursorModeOf(page)).toBe('sequence');
  // 一步撤销 = 移除这条消息；重做恢复
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => modelCountOf(page)).toBe(2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => modelCountOf(page)).toBe(3);
  await cleanupDoc(page, docId);
});

test('Q-4 异步 / 返回消息：预设落库（返回 = 开放箭头 + 虚线；异步 = 开放箭头实线）', async ({
  page,
}) => {
  const docId = docIdOf('q4');
  await setup(page, docId, [
    { id: 'qa', x: 240 },
    { id: 'qb', x: 560 },
  ]);
  await pressMessageTool(page, '返回消息');
  const ret = await drawMessage(page, [302, 220], [622, 260]);
  expect(ret).toMatchObject({
    lineType: 'STRAIGHT',
    startArrow: 'none',
    endArrow: 'arrow',
    dashed: true,
  });
  await pressMessageTool(page, '异步消息');
  const asy = await drawMessage(page, [302, 320], [622, 360]);
  expect(asy).toMatchObject({ lineType: 'STRAIGHT', endArrow: 'arrow', dashed: false });
  expect((await linesOf(page)).map((l) => l.id).sort()).toEqual([asy.id, ret.id].sort());
  await cleanupDoc(page, docId);
});

test('Q-5 落空取消：松手在空白 / 普通形状 → 模型与撤销栈不变；起点不在轴上不建线；慢拖后撤销不复活草稿', async ({
  page,
}) => {
  const docId = docIdOf('q5');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: 240 },
      { id: 'qb', x: 560 },
    ],
    [shape('sq', 860, 120)],
  );
  const undoBtn = page.getByTitle('撤销 (Cmd+Z)');
  // engineAdd 的搭建步骤本身可撤销（步数取决于捕获窗口）——全部撤销再重做，把栈
  // 规整成「一步」：之后一次撤销应恰好清空画板
  let undos = 0;
  while (!(await undoBtn.isDisabled()) && undos < 10) {
    await page.keyboard.press('ControlOrMeta+z');
    undos += 1;
    await page.waitForTimeout(80);
  }
  expect(await modelCountOf(page)).toBe(0);
  for (let i = 0; i < undos; i += 1) {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(80);
  }
  expect(await modelCountOf(page)).toBe(3);

  await pressMessageTool(page);
  const base = await modelCountOf(page);
  await drawGesture(page, [302, 300], [1050, 650]); // 空白
  await drawGesture(page, [302, 300], [900, 160]); // 普通形状上
  await drawGesture(page, [900, 160], [622, 300]); // 起点在普通形状上
  await drawGesture(page, [302, 300], [1050, 650], 700); // 慢拖（超过捕获窗口）后落空
  expect(await modelCountOf(page)).toBe(base);

  // 撤销栈不变：一次撤销恰好清空画板并清栈。判别——草稿若入过栈（慢拖时创建与取消
  // 删除落在不同撤销项），这一步撤销会把已取消的草稿复活成悬空线（计数 1 而非 0）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => modelCountOf(page)).toBe(0);
  await expect(undoBtn).toBeDisabled();
  await cleanupDoc(page, docId);
});

test('Q-6 自消息：同轴纵向拖 ≥ 8 → ELBOWED 四点环朝按下侧；间距 < 8 取消', async ({ page }) => {
  const docId = docIdOf('q6');
  // A 轴 x = 300、B 轴 x = 620
  await setup(page, docId, [
    { id: 'qa', x: 240 },
    { id: 'qb', x: 560 },
  ]);
  await pressMessageTool(page);
  // A 轴右侧按下（302）、向下拖 60
  const right = await drawMessage(page, [302, 200], [302, 260]);
  expect(right).toMatchObject({
    lineType: 'ELBOWED',
    startNodeId: 'qa',
    endNodeId: 'qa',
    startJoin: 'right',
    endJoin: 'right',
  });
  expect(right.points).toHaveLength(4);
  near(right.points[0]![0], 295);
  near(right.points[0]![1], 200);
  near(right.points[1]![0], 325); // 环深 30，朝按下侧（右）
  near(right.points[3]![0], 295);
  near(right.points[3]![1], 260);
  near(100 + HEAD_H + AXIS_LEN * right.startPort!, 200);
  near(100 + HEAD_H + AXIS_LEN * right.endPort!, 260);
  // B 轴左侧按下（618）
  const left = await drawMessage(page, [618, 200], [618, 260]);
  expect(left).toMatchObject({
    startNodeId: 'qb',
    endNodeId: 'qb',
    startJoin: 'left',
    endJoin: 'left',
  });
  near(left.points[0]![0], 625);
  near(left.points[1]![0], 595); // 朝左

  // 纵向间距 5（< 8）：不画环，落定取消
  const base = await modelCountOf(page);
  await drawGesture(page, [302, 400], [302, 405]);
  expect(await modelCountOf(page)).toBe(base);
  await cleanupDoc(page, docId);
});

test('Q-7 消息平移：拖线身只动 y（一步 undo）；↑ 微移有效、← 零写入；拖出轴底被钳住', async ({
  page,
}) => {
  const docId = docIdOf('q7');
  await setup(page, docId, [
    { id: 'qa', x: 240 },
    { id: 'qb', x: 560 },
  ]);
  await pressMessageTool(page);
  const m = await drawMessage(page, [302, 300], [622, 350]);
  await backToCursor(page);

  // 线身中点 (460, 300)：按下即选中并拖动 +60
  await dragWorld(page, 460, 300, 460, 360);
  const moved = (await lineDoc(page, m.id))!;
  near(moved.points[0]![1], 360);
  near(moved.points[1]![1], 360);
  near(moved.points[0]![0], 295); // x 不动
  near(moved.points[1]![0], 625);
  near(100 + HEAD_H + AXIS_LEN * moved.startPort!, 360);
  near(100 + HEAD_H + AXIS_LEN * moved.endPort!, 360);

  // 一步 undo 回到 300
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await lineDoc(page, m.id))!.points[0]![1]).toBeLessThan(300.5);

  // 键盘微移：↑ 有效；← 零写入
  await clickWorld(page, 460, 300);
  await expect.poll(() => selectedIdsOf(page)).toEqual([m.id]);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await lineDoc(page, m.id))!.points[0]![1]).toBeLessThan(300);
  const up = (await lineDoc(page, m.id))!;
  near(up.points[1]![1], up.points[0]![1]);
  await page.keyboard.press('ArrowLeft');
  expect(await lineDoc(page, m.id)).toEqual(up);

  // 拖出轴底：从线身拖到 y = 700 → 两端钳到轴底 620
  await dragWorld(page, 460, up.points[0]![1], 460, 700);
  const clamped = (await lineDoc(page, m.id))!;
  near(clamped.points[0]![1], 620);
  near(clamped.points[1]![1], 620);
  expect(clamped.startPort).toBe(1);
  expect(clamped.endPort).toBe(1);
  await cleanupDoc(page, docId);
});

test('Q-8 加长保高度：拖底边加长 / 顶边下移 / 顶边拖回，消息高度逐值不变、端口重写；缩短后钳到底', async ({
  page,
}) => {
  const docId = docIdOf('q8');
  // 高 300：轴段 y 136…400
  await setup(page, docId, [
    { id: 'qa', x: 240, height: 300 },
    { id: 'qb', x: 560, height: 300 },
  ]);
  await pressMessageTool(page);
  const m = await drawMessage(page, [302, 250], [622, 280]);
  const yOf = async (): Promise<number> => (await lineDoc(page, m.id))!.points[0]![1];
  const startPortOf = async (): Promise<number> => (await lineDoc(page, m.id))!.startPort!;
  near(await yOf(), 250);

  await backToCursor(page);
  // 选中 A（点头框）
  await clickWorld(page, 300, 118);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);

  // 底边手柄 (300, 400) 拖到 600：轴加长 200，消息高度不变、A 侧端口按新轴长重写
  await dragHandle(page, 300, 400, 300, 600);
  expect((await docOf(page, 'qa'))!.height).toBe(500);
  near(await yOf(), 250);
  const portAfterGrow = await startPortOf();
  expect(portAfterGrow).toBeLessThan(m.startPort!);

  // 顶边手柄 (300, 100) 下移到 160：轴顶下移，消息高度不变
  await dragHandle(page, 300, 100, 300, 160);
  expect((await docOf(page, 'qa'))!.y).toBe(160);
  near(await yOf(), 250);
  const portAfterTopDown = await startPortOf();
  expect(portAfterTopDown).toBeLessThan(portAfterGrow);

  // 顶边拖回 100：端口回到加长后的值（幂等）
  await dragHandle(page, 300, 160, 300, 100);
  expect((await docOf(page, 'qa'))!.y).toBe(100);
  near(await yOf(), 250);
  expect(await startPortOf()).toBe(portAfterGrow);

  // 缩短：底边从 600 拖到 220（下限高 120）→ 消息落到轴外，A 侧钳到底（t = 1）
  await dragHandle(page, 300, 600, 300, 220);
  expect((await docOf(page, 'qa'))!.height).toBe(120);
  const clamped = (await lineDoc(page, m.id))!;
  near(clamped.points[0]![1], 220);
  expect(clamped.startPort).toBe(1);
  near(clamped.points[1]![1], 250); // B 侧不受影响
  await cleanupDoc(page, docId);
});

test('Q-9 生命线拖动 → 消息跟随（拖拽中预览 = 落库）；拖到与邻线顶边对齐 → 参考线吸附', async ({
  page,
}) => {
  const docId = docIdOf('q9');
  // A 比 B 低 40（y 140 vs 100）
  await setup(page, docId, [
    { id: 'qa', x: 240, y: 140 },
    { id: 'qb', x: 560, y: 100 },
  ]);
  await pressMessageTool(page);
  const m = await drawMessage(page, [302, 300], [622, 350]);
  await backToCursor(page);
  // 选中 A（点头框）
  await clickWorld(page, 300, 158);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);

  // 水平拖 A +60：从轴上按下；拖拽中消息预览跟随
  await dragHandle(page, 300, 420, 360, 420, async () => {
    const preview = await linePreviewOf(page);
    expect(preview, '拖拽中应有消息预览路由').not.toBeNull();
    near(preview![0]![0], 355);
    near(preview![1]![0], 625);
  });
  const after = (await lineDoc(page, m.id))!;
  near(after.points[0]![0], 355);
  near(after.points[0]![1], 300);
  near(after.points[1]![0], 625);
  near(after.points[1]![1], 300);
  expect(after.startPort).toBe(m.startPort); // 纯平移不改 t
  expect((await docOf(page, 'qa'))!.x).toBe(300);

  // 向上拖 45（期望位移比「与 B 顶边对齐」多 5，在吸附阈值内）→ A 顶边吸到 y = 100
  await clickWorld(page, 360, 460); // 轴上重选（落库后选区可能已清）
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);
  await dragWorld(page, 360, 460, 360, 415);
  const a = (await docOf(page, 'qa'))!;
  expect(a.y, '顶边应吸附到邻线顶边 y = 100').toBe(100);
  // 消息 A 侧随宿主上移 40（端口不变）；B 侧不动
  const snapped = (await lineDoc(page, m.id))!;
  near(snapped.points[0]![1], 260);
  near(snapped.points[1]![1], 300);
  expect(snapped.startPort).toBe(m.startPort);
  await cleanupDoc(page, docId);
});

test('Q-15 流程图回归：普通形状间拉线仍落 0.5 中点、无 startPort 键；普通直线线身不可拖', async ({
  page,
}) => {
  const docId = docIdOf('q15');
  // 形状 (240,200) / (560,200)，各 100×80：相对边中点 (340, 240) / (560, 240)
  await setup(page, docId, [], [shape('s1', 240, 200), shape('s2', 560, 200)]);
  await page.keyboard.press('l');
  await expect.poll(() => cursorModeOf(page)).toBe('line');
  const before = (await linesOf(page)).length;
  await drawGesture(page, [335, 240], [565, 240]);
  const created = (await linesOf(page)).filter((l) => l.type === 'LINE');
  expect(created).toHaveLength(before + 1);
  const line = (await lineDoc(page, created[0]!.id))!;
  expect(line).toMatchObject({
    startNodeId: 's1',
    endNodeId: 's2',
    startJoin: 'right',
    endJoin: 'left',
  });
  expect(line).not.toHaveProperty('startPort');
  expect(line).not.toHaveProperty('endPort');
  expect(line.points).toEqual([
    [340, 240],
    [560, 240],
  ]);

  // 普通直线（两端锚在普通形状上）：线身拖不动
  await engineAdd(page, [
    {
      id: 'straight',
      type: 'LINE',
      lineType: 'STRAIGHT',
      startNodeId: 's1',
      endNodeId: 's2',
      startJoin: 'right',
      endJoin: 'left',
      points: [
        [340, 260],
        [560, 260],
      ],
      color: '#4b5563',
      strokeWidth: 2,
      startArrow: 'none',
      endArrow: 'arrow',
      dashed: false,
      text: '',
      textRatio: 0.5,
      pinned: false,
    },
  ]);
  await backToCursor(page);
  await dragWorld(page, 450, 260, 450, 320);
  const straight = (await lineDoc(page, 'straight'))!;
  expect(straight.points).toEqual([
    [340, 260],
    [560, 260],
  ]);
  expect(await modelCountOf(page)).toBe(4);
  await cleanupDoc(page, docId);
});

test('Q-19（批次 2 部分）轴消息线身 hover 光标 ns-resize；端点附近 grab；普通 STRAIGHT 线无光标', async ({
  page,
}) => {
  const docId = docIdOf('q19');
  await setup(page, docId, [
    { id: 'qa', x: 240 },
    { id: 'qb', x: 560 },
  ]);
  await pressMessageTool(page);
  // hover 判定只对单选连线生效
  const m = await drawMessage(page, [302, 300], [622, 350]);
  // 切回选择工具会清选区——点线身重新选中
  await backToCursor(page);
  await clickWorld(page, 460, 300);
  await expect.poll(() => selectedIdsOf(page)).toEqual([m.id]);

  const hoverAt = async (x: number, y: number): Promise<string> => {
    const p = await toPage(page, x, y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    return canvasCursor(page);
  };
  // 线身中点（距两端都 > 12）：上下可拖
  expect(await hoverAt(460, 300)).toBe('ns-resize');
  // 端点附近：拖端点重锚定
  expect(await hoverAt(625, 300)).toBe('grab');
  // 离开线身：光标复原（既不是线身拖向也不是端点抓取）
  expect(['ns-resize', 'grab']).not.toContain(await hoverAt(460, 340));

  // 普通直线：线身无光标、端点 grab
  await engineAdd(page, [
    {
      id: 'plain',
      type: 'LINE',
      lineType: 'STRAIGHT',
      points: [
        [760, 200],
        [960, 200],
      ],
      color: '#4b5563',
      strokeWidth: 2,
      startArrow: 'none',
      endArrow: 'arrow',
      dashed: false,
      text: '',
      textRatio: 0.5,
      pinned: false,
      startNodeId: null,
      endNodeId: null,
      startJoin: null,
      endJoin: null,
    },
  ]);
  await clickWorld(page, 860, 200);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['plain']);
  expect(['ns-resize', 'grab']).not.toContain(await hoverAt(860, 200));
  expect(await hoverAt(960, 200)).toBe('grab');
  await cleanupDoc(page, docId);
});

test('轴宿主不再出四向连接点；连线工具悬停生命线时连接点在轴上（贴包围盒外沿不出）', async ({
  page,
}) => {
  const docId = docIdOf('axis');
  await setup(page, docId, [{ id: 'qa', x: 240 }]);
  await backToCursor(page);
  // 选中生命线：无四向连接点
  await clickWorld(page, 300, 118);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);
  expect(await lineAnchorsOf(page)).toBeNull();

  // 连线工具悬停：轴旁 → 轴上指针高度的单点
  await page.keyboard.press('l');
  await expect.poll(() => cursorModeOf(page)).toBe('line');
  const hover = async (x: number, y: number): Promise<void> => {
    const p = await toPage(page, x, y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
  };
  await hover(304, 300);
  expect(await lineAnchorsOf(page)).toEqual([{ x: 300, y: 300 }]);
  // 包围盒内、轴带外（离轴 50）：无悬停点
  await hover(350, 300);
  expect(await lineAnchorsOf(page)).toBeNull();
  await cleanupDoc(page, docId);
});
