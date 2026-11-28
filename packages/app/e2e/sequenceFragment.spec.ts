/** UML 时序图 E2E——批次 4：组合片段（FRAME 预设）与分隔线（specs/sequence-diagram §11.2
 *  Q-12 及分隔线用例）。片段 / 分隔线一律经 UI 手势创建（时序图工具 → 二级菜单选种类）；
 *  落库断言读 model.toJSON() 文档真值。 */
import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';
import {
  backToCursor,
  clickWorld,
  cursorModeOf,
  docOf,
  dragWorld,
  engineAdd,
  framesOf,
  lineDoc,
  linesOf,
  modelCountOf,
  pressMessageTool,
  pressSequenceKind,
  rectOf,
  selectedIdsOf,
  type FrameSnap,
  type LineSnap,
} from './helpers/sequenceE2e';
import { cleanupDoc } from './helpers/projectFileE2e';

const docIdOf = (tag: string): string => `e2e-seqfrag-${tag}-${Date.now()}`;

/** 生命线夹具（sequenceMessage 同款）：宽 120（轴 = x + 60）、y 100、高 520，轴段 y 136…620 */
const LIFELINES = [
  { id: 'qa', type: 'LIFELINE', label: 'QA', x: 240, y: 100, width: 120, height: 520 },
  { id: 'qb', type: 'LIFELINE', label: 'QB', x: 560, y: 100, width: 120, height: 520 },
];

/** 用当前图元拉一条线，返回新线的文档真值（恰好新建一条） */
async function drawLine(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<LineSnap> {
  const before = new Set((await linesOf(page)).map((l) => l.id));
  await dragWorld(page, from[0], from[1], to[0], to[1]);
  const created = (await linesOf(page)).filter((l) => !before.has(l.id));
  expect(created, '应恰好新建一条线').toHaveLength(1);
  return (await lineDoc(page, created[0]!.id))!;
}

const frameDocOf = async (page: Page, id: string): Promise<FrameSnap> =>
  (await docOf(page, id)) as unknown as FrameSnap;

test('Q-12 片段预设：选 alt 拖框 → 无填充、标题 alt，选中并回选择工具；标题带可改守卫文本；单击落默认尺寸且工具保持', async ({
  page,
}) => {
  const docId = docIdOf('q12a');
  await openBoardDoc(page, docId);
  await pressSequenceKind(page, 'alt');
  await dragWorld(page, 150, 150, 650, 450);
  // 拖拽画框 = 容器工具同款：松手选中并回选择工具
  await expect.poll(() => cursorModeOf(page)).toBe('cursor');
  await expect
    .poll(async () => framesOf(page).then((fs) => fs.map(rectOf)))
    .toEqual([[150, 150, 500, 300]]);
  const f = (await framesOf(page))[0]!;
  // 预设落库：关键字写进标题、无填充（只有边框与标题压在图上）；底色仍是容器缺省
  expect(await frameDocOf(page, f.id)).toMatchObject({
    type: 'FRAME',
    fill: 'none',
    title: 'alt',
    color: '#ffffff',
  });
  expect(await selectedIdsOf(page)).toEqual([f.id]);

  // 再点已选中的标题带 → 标题 plain 编辑：守卫文本直接写进标题
  await clickWorld(page, f.x + 40, f.y + 12);
  const ta = page.locator('textarea');
  await expect(ta).toBeVisible();
  await expect(ta).toHaveValue('alt');
  await ta.fill('alt [令牌有效]');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await frameDocOf(page, f.id)).title).toBe('alt [令牌有效]');

  // 单击：loop 片段落默认 320×220、按下点居中；工具保持可连击、新件不选中
  await pressSequenceKind(page, 'loop');
  await clickWorld(page, 900, 600);
  await expect.poll(async () => (await framesOf(page)).length).toBe(2);
  const g = (await framesOf(page)).find((x) => x.id !== f.id)!;
  expect(rectOf(g)).toEqual([900 - 160, 600 - 110, 320, 220]);
  expect(await frameDocOf(page, g.id)).toMatchObject({ title: 'loop', fill: 'none' });
  expect(await cursorModeOf(page)).toBe('sequence');
  expect(await selectedIdsOf(page)).not.toContain(g.id);
  await cleanupDoc(page, docId);
});

test('Q-12 片段不拦截也不带动：框内点消息线身选中消息；拖标题带只动片段，生命线 / 激活条 / 消息不动', async ({
  page,
}) => {
  const docId = docIdOf('q12b');
  await openBoardDoc(page, docId);
  await engineAdd(page, [
    ...LIFELINES,
    // 绑定在 qa 上的激活条（贴轴：x = 轴 − 5），y 240…360
    { id: 'bar1', type: 'ACTIVATION', x: 295, y: 240, width: 10, height: 120, lifelineId: 'qa' },
  ]);
  await pressMessageTool(page, '同步消息');
  const m = await drawLine(page, [302, 400], [622, 400]);
  await backToCursor(page);
  const others = ['qa', 'qb', 'bar1'] as const;
  const snap0 = await Promise.all(others.map((id) => docOf(page, id)));
  const m0 = await lineDoc(page, m.id);

  // alt 片段罩住两条生命线的轴段、激活条与消息（头框在片段上方）
  await pressSequenceKind(page, 'alt');
  await dragWorld(page, 180, 200, 740, 460);
  await expect.poll(() => cursorModeOf(page)).toBe('cursor');
  await expect.poll(async () => (await framesOf(page)).length).toBe(1);
  const f = (await framesOf(page))[0]!;
  // 时序图件不进容器（S5）：片段建好后生命线 / 激活条的文档都没有 parentId
  for (const id of others) expect('parentId' in (await docOf(page, id))!).toBe(false);

  // 片段内部空白不拦截指针：点框内的消息线身 → 选中消息，片段不选中
  await clickWorld(page, 1000, 700);
  await expect.poll(() => selectedIdsOf(page)).toEqual([]);
  await clickWorld(page, 430, 400); // 消息线身（避开线中点）
  await expect.poll(() => selectedIdsOf(page)).toEqual([m.id]);

  // 拖标题带：只动片段——生命线、激活条、消息的文档逐值不变
  await dragWorld(page, f.x + 60, f.y + 12, f.x + 110, f.y + 42);
  await expect
    .poll(async () => rectOf((await framesOf(page))[0]!))
    .toEqual([f.x + 50, f.y + 30, f.width, f.height]);
  for (const [i, id] of others.entries()) expect(await docOf(page, id)).toEqual(snap0[i]);
  expect(await lineDoc(page, m.id)).toEqual(m0);
  await cleanupDoc(page, docId);
});

test('分隔线：空白拖出 → 两端自由的虚线直线（无箭头、无锚定、无端口），选中且工具保持；一步撤销移除', async ({
  page,
}) => {
  const docId = docIdOf('divider');
  await openBoardDoc(page, docId);
  await engineAdd(page, LIFELINES);
  await pressSequenceKind(page, '分隔线');
  const before = await modelCountOf(page);
  // 从 A 左侧空白拖到 B 右侧空白——中途穿过两条轴，两端都不被吸走
  const line = await drawLine(page, [180, 400], [740, 400]);
  expect(line).toMatchObject({
    type: 'LINE',
    lineType: 'STRAIGHT',
    startArrow: 'none',
    endArrow: 'none',
    dashed: true,
    startNodeId: null,
    endNodeId: null,
  });
  expect('startPort' in line).toBe(false);
  expect('endPort' in line).toBe(false);
  expect(line.points).toEqual([
    [180, 400],
    [740, 400],
  ]);
  expect(await selectedIdsOf(page)).toEqual([line.id]);
  expect(await cursorModeOf(page)).toBe('sequence');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => modelCountOf(page)).toBe(before);
  await cleanupDoc(page, docId);
});

test('分隔线在片段内：起止点落在片段内部空白不被吸走；单击与滑移不足不留痕、撤销栈不多出一步', async ({
  page,
}) => {
  const docId = docIdOf('divider-frame');
  await openBoardDoc(page, docId);
  await pressSequenceKind(page, 'alt');
  await dragWorld(page, 150, 250, 750, 500);
  await expect.poll(() => cursorModeOf(page)).toBe('cursor');
  await expect.poll(async () => (await framesOf(page)).length).toBe(1);
  const count0 = await modelCountOf(page);

  await pressSequenceKind(page, '分隔线');
  // 单击 / 滑移 2px：草稿落定即取消，模型不变
  await clickWorld(page, 500, 400);
  await page.waitForTimeout(200);
  expect(await modelCountOf(page)).toBe(count0);
  await dragWorld(page, 500, 400, 502, 401);
  expect(await modelCountOf(page)).toBe(count0);

  // 在片段内部空白画：两端落自由点（片段的边框环与标题带都不在起止点上）
  const line = await drawLine(page, [330, 460], [590, 460]);
  expect(line).toMatchObject({
    lineType: 'STRAIGHT',
    dashed: true,
    startNodeId: null,
    endNodeId: null,
  });
  expect(line.points).toEqual([
    [330, 460],
    [590, 460],
  ]);

  // 撤销栈：分隔线一步、片段一步——中间没有草稿留下的空步
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => modelCountOf(page)).toBe(count0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => modelCountOf(page)).toBe(count0 - 1);
  expect(await framesOf(page)).toHaveLength(0);
  await cleanupDoc(page, docId);
});

test('片段预设不泄漏：时序图工具里建过 alt 片段后，切到容器工具（C）拖框 → 普通容器（无填充态、标题空）', async ({
  page,
}) => {
  const docId = docIdOf('preset-leak');
  await openBoardDoc(page, docId);
  await pressSequenceKind(page, 'alt');
  await clickWorld(page, 300, 300);
  await expect.poll(async () => (await framesOf(page)).length).toBe(1);
  expect((await frameDocOf(page, (await framesOf(page))[0]!.id)).fill).toBe('none');
  // 切走工具后再没有时序图事件来清预设——只能靠模式订阅
  await backToCursor(page);
  await page.keyboard.press('c');
  await expect.poll(() => cursorModeOf(page)).toBe('frame');
  await dragWorld(page, 700, 150, 1000, 400);
  await expect.poll(async () => (await framesOf(page)).length).toBe(2);
  const normal = (await framesOf(page)).find((x) => x.width === 300)!;
  const d = await frameDocOf(page, normal.id);
  // 普通容器的创建数据只有类型 / 层级 / 几何 / 底色——没有预设的两个键
  expect('fill' in d).toBe(false);
  expect('title' in d).toBe(false);
  await cleanupDoc(page, docId);
});
