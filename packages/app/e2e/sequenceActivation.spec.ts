/** UML 时序图 E2E——批次 3：激活条（specs/sequence-diagram §10 Q-10、Q-11、Q-13、Q-14 与
 *  Q-9 的激活条部分）。生命线 / 条夹具用 engineAdd 搭建；创建一律经 UI 手势（时序图工具 →
 *  二级菜单选「激活条」→ 轴上按下纵向拖）；消息经 UI 画出；落库断言读 model.toJSON()
 *  文档真值。组合片段预设属批次 4——Q-13 用现有容器验证「不进容器」。 */
import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc, waitForSynced } from './helpers/boardE2e';
import {
  activationDoc,
  activationsOf,
  backToCursor,
  canRedoOf,
  canUndoOf,
  clickWorld,
  cursorModeOf,
  docOf,
  dragWorld,
  engineAdd,
  holdDrag,
  lineDoc,
  linePreviewOf,
  lifelinesOf,
  linesOf,
  modelCountOf,
  pasteAtWorld,
  pressActivationTool,
  pressMessageTool,
  type LineSnap,
  selectedIdsOf,
  toPage,
  waitSaved,
} from './helpers/sequenceE2e';
import { cleanupDoc } from './helpers/projectFileE2e';

const docIdOf = (tag: string): string => `e2e-seqact-${tag}-${Date.now()}`;

/** 夹具：qa 轴 x = 300、qb 轴 x = 620；轴段都是 y 136…620（y 100 高 520、头框 36） */
const AX = 300;
const BX = 620;
const LIFELINE_W = 120;

interface LifeSpec {
  id: string;
  x: number;
}

/** 贴 axisX 的条（宽 10，中心线 = 轴） */
const bar = (
  id: string,
  axisX: number,
  y: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  type: 'ACTIVATION',
  x: axisX - 5,
  y,
  width: 10,
  height: 80,
  ...extra,
});

async function setup(
  page: Page,
  docId: string,
  lives: LifeSpec[],
  more: Array<Record<string, unknown>> = [],
): Promise<void> {
  await openBoardDoc(page, docId);
  await engineAdd(
    page,
    [
      ...lives.map((l) => ({
        id: l.id,
        type: 'LIFELINE',
        label: l.id.toUpperCase(),
        x: l.x,
        y: 100,
        width: LIFELINE_W,
        height: 520,
      })),
      ...more,
    ],
    // 夹具不包外层事务：engineAdd 内逐件 add
  );
}

/** |a − b| < 0.5；note = 断言说明 */
function near(a: number, b: number, note?: string): void {
  const tol = 0.5;
  expect(Math.abs(a - b), `${note ? `${note}：` : ''}${a} 应约等于 ${b}`).toBeLessThan(tol);
}

/** 画一条消息，返回新线的文档真值（恰好新建一条） */
async function drawMessage(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<LineSnap> {
  const before = new Set((await linesOf(page)).map((l) => l.id));
  const a = await toPage(page, from[0], from[1]);
  const b = await toPage(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const created = (await linesOf(page)).filter((l) => !before.has(l.id));
  expect(created, '应恰好新建一条线').toHaveLength(1);
  return (await lineDoc(page, created[0]!.id))!;
}

/** 已选中控件的手柄从世界 (x1,y1) 拖到 (x2,y2) */
async function dragHandle(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await holdDrag(page, x1, y1, x2, y2);
}

const undo = (page: Page): Promise<void> => page.keyboard.press('ControlOrMeta+z');
const redo = (page: Page): Promise<void> => page.keyboard.press('ControlOrMeta+Shift+z');

test('Q-10 创建：轴上单击落 80 并绑定、工具保持；下拉跟手松手选中回选择工具；上拉钳 16；头框 / 轴旁 / 轴底死区不建', async ({
  page,
}) => {
  const docId = docIdOf('q10a');
  await setup(page, docId, [
    { id: 'qa', x: AX - 60 },
    { id: 'qb', x: BX - 60 },
  ]);
  await pressActivationTool(page);
  await clickWorld(page, AX, 300);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  const [clickBar] = await activationsOf(page);
  expect(clickBar).toMatchObject({ x: 295, y: 300, width: 10, height: 80, lifelineId: 'qa' });
  expect(await cursorModeOf(page), '单击后工具保持').toBe('sequence');

  // 下拉 60：高度跟手；松手选中新件并回选择工具
  await dragWorld(page, BX, 300, BX, 360);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(2);
  const dragBar = (await activationsOf(page)).find((b) => b.id !== clickBar!.id)!;
  expect(dragBar).toMatchObject({ x: 615, y: 300, height: 60, lifelineId: 'qb' });
  expect(await selectedIdsOf(page)).toEqual([dragBar.id]);
  expect(await cursorModeOf(page)).toBe('cursor');

  // 上拉：高度钳到下限 16，顶仍是按下高度
  await pressActivationTool(page);
  await dragWorld(page, AX, 450, AX, 430);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(3);
  const upBar = (await activationsOf(page)).find((b) => b.lifelineId === 'qa' && b.y === 450)!;
  expect(upBar).toMatchObject({ x: 295, y: 450, height: 16 });

  // 不建：点头框、点轴旁空白、按下点距轴底不足 16（单击与拖拽）
  await pressActivationTool(page);
  await clickWorld(page, AX, 118);
  await clickWorld(page, AX + 80, 300);
  await dragWorld(page, AX, 610, AX, 660);
  await page.waitForTimeout(200);
  expect((await activationsOf(page)).length).toBe(3);
  await cleanupDoc(page, docId);
});

test('Q-10 绑定：拖离解绑；拖回容差内复绑并归中；两次拖拽各一步撤销', async ({ page }) => {
  const docId = docIdOf('q10b');
  await setup(page, docId, [{ id: 'qa', x: AX - 60 }], [bar('bar', AX, 300, { lifelineId: 'qa' })]);
  await clickWorld(page, AX, 340);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['bar']);

  await dragWorld(page, AX, 340, AX + 40, 340);
  let doc = (await activationDoc(page, 'bar'))!;
  expect(doc.lifelineId, '中心线离开容差 → 解绑').toBeUndefined();
  expect(doc.x).toBe(335);

  await dragWorld(page, AX + 40, 340, AX + 3, 340);
  doc = (await activationDoc(page, 'bar'))!;
  expect(doc, '拖回容差内 → 复绑并归中').toMatchObject({ x: 295, lifelineId: 'qa' });

  await undo(page);
  doc = (await activationDoc(page, 'bar'))!;
  expect(doc.x).toBe(335);
  expect(doc.lifelineId).toBeUndefined();
  await undo(page);
  doc = (await activationDoc(page, 'bar'))!;
  expect(doc).toMatchObject({ x: 295, lifelineId: 'qa' });
  await cleanupDoc(page, docId);
});

test('Q-10 级联删除：删生命线连带删条（一步 undo 全回、绑定仍在、redo 可用）', async ({ page }) => {
  const docId = docIdOf('q10c');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: AX - 60 },
      { id: 'qb', x: BX - 60 },
    ],
    [bar('bar', AX, 300, { lifelineId: 'qa' })],
  );
  expect(await modelCountOf(page)).toBe(3);
  // 点条下方的轴选中生命线
  await clickWorld(page, AX, 500);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);
  await page.keyboard.press('Delete');
  await expect.poll(() => modelCountOf(page)).toBe(1);
  expect(await activationsOf(page)).toEqual([]);

  await undo(page);
  await expect.poll(() => modelCountOf(page)).toBe(3);
  expect((await activationDoc(page, 'bar'))!.lifelineId).toBe('qa');
  expect(await canRedoOf(page), '撤销删除后重做可用').toBe(true);
  await redo(page);
  await expect.poll(() => modelCountOf(page)).toBe(1);
  await cleanupDoc(page, docId);
});

test('Q-9（激活条部分）拖生命线：条随行、绑定不变、消息跟随；一步 undo 同回', async ({ page }) => {
  const docId = docIdOf('q9b');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: AX - 60 },
      { id: 'qb', x: BX - 60 },
    ],
    [bar('bar', AX, 300, { lifelineId: 'qa' })],
  );
  await pressMessageTool(page);
  const m = await drawMessage(page, [AX + 2, 340], [BX + 2, 340]);
  near(m.points[0]![0], AX, '条覆盖该高度：起点让到条边（锚点 = 轴）');
  near(m.points[1]![0], BX + 5);
  await backToCursor(page);
  // 点条下方的轴选中生命线
  await clickWorld(page, AX, 500);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);

  // 水平拖 +120：条同位移、消息跟随
  await dragHandle(page, AX, 500, AX + 120, 500);
  expect((await docOf(page, 'qa'))!.x).toBe(AX - 60 + 120);
  expect(await activationDoc(page, 'bar')).toMatchObject({
    x: 295 + 120,
    y: 300,
    lifelineId: 'qa',
  });
  const after = (await lineDoc(page, m.id))!;
  near(after.points[0]![0], AX + 120);
  near(after.points[1]![0], BX + 5);

  await undo(page);
  expect((await docOf(page, 'qa'))!.x).toBe(AX - 60);
  expect(await activationDoc(page, 'bar')).toMatchObject({ x: 295, lifelineId: 'qa' });
  near((await lineDoc(page, m.id))!.points[0]![0], AX);
  await cleanupDoc(page, docId);
});

test('Q-11 条边让位：无条时箭头停轴上；建覆盖该高度的条后端点让到条边；消息其余数据不变；一步 undo 条与端点同回', async ({
  page,
}) => {
  const docId = docIdOf('q11a');
  await setup(page, docId, [
    { id: 'qa', x: AX - 60 },
    { id: 'qb', x: BX - 60 },
  ]);
  await pressMessageTool(page);
  const m = await drawMessage(page, [AX + 2, 340], [BX + 2, 340]);
  // 无条：锚点 = 轴 − 线端留隙 5（箭尖停在轴上）
  near(m.points[0]![0], AX - 5);
  near(m.points[1]![0], BX + 5);

  // 切回选择工具（清选区：选中消息的操作栏浮在轴上方，会吞掉后续按下）再选激活条
  await backToCursor(page);
  await pressActivationTool(page);
  await clickWorld(page, AX, 320);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  const [b] = await activationsOf(page);
  expect(b).toMatchObject({ x: 295, y: 320, height: 80, lifelineId: 'qa' });
  const covered = (await lineDoc(page, m.id))!;
  near(covered.points[0]![0], AX, '起点锚点 = 轴（箭尖 = 条边 = 轴 + 5）');
  near(covered.points[1]![0], BX + 5);
  // 消息数据不变：只有起点 x 变了
  expect(covered).toMatchObject({
    startNodeId: m.startNodeId,
    endNodeId: m.endNodeId,
    startJoin: m.startJoin,
    endJoin: m.endJoin,
    startPort: m.startPort,
    endPort: m.endPort,
    lineType: m.lineType,
  });

  // 一步撤销 = 条与让位一起回
  await undo(page);
  expect(await activationsOf(page)).toEqual([]);
  near((await lineDoc(page, m.id))!.points[0]![0], AX - 5);
  await redo(page);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  near((await lineDoc(page, m.id))!.points[0]![0], AX);
  await cleanupDoc(page, docId);
});

test('Q-11 条加长后翻转：条下方的消息原停轴上；拖底边手柄盖过它 → 让到条边；一步 undo 同回', async ({
  page,
}) => {
  const docId = docIdOf('q11b');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: AX - 60 },
      { id: 'qb', x: BX - 60 },
    ],
    [bar('bar', AX, 300, { lifelineId: 'qa' })],
  ); // 300…380
  await pressMessageTool(page);
  const inBar = await drawMessage(page, [AX + 2, 340], [BX + 2, 340]); // 条内
  const below = await drawMessage(page, [AX + 2, 440], [BX + 2, 440]); // 条下方
  near(inBar.points[0]![0], AX);
  near(below.points[0]![0], AX - 5);

  await backToCursor(page);
  await clickWorld(page, AX, 320);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['bar']);
  // 底边手柄 380 → 480：盖过下方消息（440）
  await dragHandle(page, AX, 380, AX, 480);
  expect(await activationDoc(page, 'bar')).toMatchObject({ x: 295, y: 300, height: 180 });
  near((await lineDoc(page, below.id))!.points[0]![0], AX, '下方消息翻到条边');
  near((await lineDoc(page, inBar.id))!.points[0]![0], AX);

  await undo(page);
  expect((await activationDoc(page, 'bar'))!.height).toBe(80);
  near((await lineDoc(page, below.id))!.points[0]![0], AX - 5);
  await cleanupDoc(page, docId);
});

test('Q-11 删条端点复位（一步 undo 条与端点同回、redo 可用）；拖条纵向盖过消息时拖拽中即预览跟随', async ({
  page,
}) => {
  const docId = docIdOf('q11c');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: AX - 60 },
      { id: 'qb', x: BX - 60 },
    ],
    [bar('bar', AX, 300, { lifelineId: 'qa' })],
  );
  await pressMessageTool(page);
  const m = await drawMessage(page, [AX + 2, 340], [BX + 2, 340]);
  near(m.points[0]![0], AX);

  // 删条 → 端点复位到轴 − 5
  await backToCursor(page);
  await clickWorld(page, AX, 320);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['bar']);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await activationsOf(page)).length).toBe(0);
  near((await lineDoc(page, m.id))!.points[0]![0], AX - 5);
  await undo(page);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  near((await lineDoc(page, m.id))!.points[0]![0], AX);
  expect(await canRedoOf(page)).toBe(true);
  await redo(page);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(0);
  near((await lineDoc(page, m.id))!.points[0]![0], AX - 5);

  // 新建一条不覆盖消息的条（400…480），向上拖盖过消息：拖拽中预览已让到条边
  await pressActivationTool(page);
  await clickWorld(page, AX, 400);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  const [b] = await activationsOf(page);
  await backToCursor(page);
  await clickWorld(page, AX, 440);
  await expect.poll(() => selectedIdsOf(page)).toEqual([b!.id]);
  await holdDrag(page, AX, 440, AX, 340, async () => {
    const preview = await linePreviewOf(page);
    expect(preview, '拖拽中应有消息预览路由').not.toBeNull();
    near(preview![0]![0], AX, '拖拽中：预览端点已让到条边');
  });
  expect(await activationDoc(page, b!.id)).toMatchObject({ x: 295, y: 300, lifelineId: 'qa' });
  near((await lineDoc(page, m.id))!.points[0]![0], AX);
  // 急刻重路由与拖拽同一撤销项（留给微任务相会裂成第二步：一步 undo 只回端点不回条）
  await undo(page);
  expect(await activationDoc(page, b!.id)).toMatchObject({ y: 400 });
  near((await lineDoc(page, m.id))!.points[0]![0], AX - 5);
  await cleanupDoc(page, docId);
});

test('Q-13 不进容器：容器内建的激活条无 parentId（创建即归属路径拒绝）；沿轴拖 / 从容器外拖进都不归属', async ({
  page,
}) => {
  const docId = docIdOf('q13');
  await setup(
    page,
    docId,
    [{ id: 'qa', x: AX - 60 }],
    [
      // 容器盖住生命线下段（片段预设属批次 4，这里用现有容器）
      { id: 'f1', type: 'FRAME', color: '#ffffff', x: 200, y: 450, width: 200, height: 150 },
    ],
  );
  await pressActivationTool(page);
  await clickWorld(page, AX, 500); // 容器内的轴上
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  const [inside] = await activationsOf(page);
  expect(inside).toMatchObject({ x: 295, y: 500, lifelineId: 'qa' });
  expect(inside!.parentId, '容器内建的条不归属').toBeUndefined();
  expect((await docOf(page, 'qa'))!.parentId).toBeUndefined();

  // 沿轴在容器内拖：不归属
  await backToCursor(page);
  await dragWorld(page, AX, 540, AX, 560);
  expect((await activationDoc(page, inside!.id))!.parentId).toBeUndefined();

  // 容器外建的条，整个拖进容器：仍不归属
  await pressActivationTool(page);
  await clickWorld(page, AX, 200);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(2);
  const outside = (await activationsOf(page)).find((b) => b.id !== inside!.id)!;
  await backToCursor(page);
  await dragWorld(page, AX, 240, AX, 520);
  const draggedIn = (await activationDoc(page, outside.id))!;
  expect(draggedIn.parentId, '从容器外拖进容器仍不归属').toBeUndefined();
  expect(draggedIn.lifelineId).toBe('qa');
  await cleanupDoc(page, docId);
});

test('Q-14 复制粘贴：复制生命线带激活条、lifelineId 指向副本（一步 undo）；单独粘贴的条落在轴上重绑、落在空白不绑', async ({
  page,
}) => {
  const docId = docIdOf('q14');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: AX - 60 },
      { id: 'qb', x: BX - 60 },
    ],
    [bar('bar', AX, 300, { lifelineId: 'qa' })],
  );
  // 选生命线（点条下方的轴）→ 复制 → 粘贴
  await clickWorld(page, AX, 500);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['qa']);
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => modelCountOf(page)).toBe(5);
  const lives = await lifelinesOf(page);
  const copyLife = lives.find((l) => l.id !== 'qa' && l.id !== 'qb')!;
  const copyBar = (await activationsOf(page)).find((b) => b.id !== 'bar')!;
  expect(copyBar.lifelineId, '副本条指向副本生命线').toBe(copyLife.id);
  expect(copyBar.lifelineId).not.toBe('qa');
  await undo(page);
  await expect.poll(() => modelCountOf(page)).toBe(3);

  // 单独复制条：落在 qb 的轴上 → 重绑 qb 并归中；落在空白 → 不绑
  await clickWorld(page, AX, 320);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['bar']);
  await page.keyboard.press('ControlOrMeta+c');
  await pasteAtWorld(page, BX - 5, 300);
  await expect.poll(() => modelCountOf(page)).toBe(4);
  const onAxis = (await activationsOf(page)).find((b) => b.id !== 'bar')!;
  expect(onAxis).toMatchObject({ x: BX - 5, y: 300, lifelineId: 'qb' });
  await pasteAtWorld(page, 800, 300);
  await expect.poll(() => modelCountOf(page)).toBe(5);
  const onBlank = (await activationsOf(page)).find((b) => b.id !== 'bar' && b.id !== onAxis.id)!;
  expect(onBlank.x).toBe(800);
  expect(onBlank.lifelineId).toBeUndefined();
  await cleanupDoc(page, docId);
});

test('补充：缩放只改高度（宽恒 10、x 不变）；← 微移绑定中被归中；刷新恢复后绑定与端点不变、撤销栈为空', async ({
  page,
}) => {
  const docId = docIdOf('extra');
  await setup(
    page,
    docId,
    [
      { id: 'qa', x: AX - 60 },
      { id: 'qb', x: BX - 60 },
    ],
    [bar('bar', AX, 300, { lifelineId: 'qa' })],
  );
  await pressMessageTool(page);
  const m = await drawMessage(page, [AX + 2, 340], [BX + 2, 340]);
  await backToCursor(page);

  // se 手柄外拖：只留高度
  await clickWorld(page, AX, 320);
  await expect.poll(() => selectedIdsOf(page)).toEqual(['bar']);
  await dragHandle(page, AX + 5, 380, AX + 45, 480);
  expect(await activationDoc(page, 'bar')).toMatchObject({
    x: 295,
    y: 300,
    width: 10,
    height: 180,
  });
  expect(await lifelinesOf(page)).toHaveLength(2);

  // ← 微移：绑定中被归中（净位移为零）
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  expect(await activationDoc(page, 'bar')).toMatchObject({ x: 295, lifelineId: 'qa' });

  // 刷新恢复
  await waitSaved(page);
  await page.reload();
  await waitForSynced(page);
  await expect.poll(async () => (await activationsOf(page)).length).toBe(1);
  expect((await activationDoc(page, 'bar'))!).toMatchObject({
    x: 295,
    y: 300,
    height: 180,
    lifelineId: 'qa',
  });
  const restored = (await lineDoc(page, m.id))!;
  near(restored.points[0]![0], AX);
  near(restored.points[1]![0], BX + 5);
  expect(await canUndoOf(page), '恢复不产生撤销项').toBe(false);
  await cleanupDoc(page, docId);
});
