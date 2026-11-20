/** 符号控件 E2E（specs/symbol-widget §9.2 S-1..S-9）：创建/连击/编辑/标签几何/
 *  图形区锚定/种类切换/撤销持久化/只读/着色。断言走数据探针（docs/15 §3）。 */
import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc, waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/widgetProbeE2e';
import { modelCount } from './helpers/projectFileE2e';
import { waitRole } from './helpers/multiTabE2e';

/** 世界→屏幕纵偏移：顶栏 44px（clickCreateSlip 同款口径；初始视口 scale=1） */
const TOP_BAR = 44;

interface SymState {
  id: string;
  symbol: string;
  label: string;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function symbols(page: Page): Promise<SymState[]> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates
      .filter((s) => s.type === 'SYMBOL')
      .map((s) => ({
        id: String(s.id),
        symbol: String(s.symbol),
        label: String(s.label ?? ''),
        ...(s.color !== undefined ? { color: String(s.color) } : {}),
        x: s.x as number,
        y: s.y as number,
        width: s.width as number,
        height: s.height as number,
      })),
  );
}

async function cursorMode(page: Page): Promise<string> {
  return page.evaluate(() =>
    (
      window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
    ).__spinth.cursorMode$.getValue(),
  );
}

async function pickSymbolTool(page: Page): Promise<void> {
  await page.keyboard.press('n');
  await expect.poll(() => cursorMode(page)).toBe('symbol');
}

test.beforeEach(async ({ page }) => {
  await openBoardDoc(page, `e2e-symbol-${Date.now()}`);
});

test('S-1 工具坞选符号 → 单击创建默认服务器，工具保持可连击', async ({ page }) => {
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(1);
  let syms = await symbols(page);
  expect(syms[0]!.symbol).toBe('net-server');
  // 默认尺寸 96×128，以点击点（世界 300,300）为中心
  expect(syms[0]!.width).toBe(96);
  expect(syms[0]!.height).toBe(128);
  expect(Math.abs(syms[0]!.x - (300 - 48))).toBeLessThan(1);
  expect(Math.abs(syms[0]!.y - (300 - 64))).toBeLessThan(1);
  // 单击创建：不选中、工具保持（连击放第二个）
  expect(await cursorMode(page)).toBe('symbol');
  await page.mouse.click(450, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(2);
  syms = await symbols(page);
  expect(syms.every((s) => s.symbol === 'net-server')).toBe(true);
});

test('S-2 拖拽创建尺寸跟手、松手选中回选择工具；<10px 滑移仍是单击', async ({ page }) => {
  await pickSymbolTool(page);
  // 拖拽 100×100（世界 400,400 → 500,500）
  await page.mouse.move(400, 400 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(500, 500 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(1);
  let syms = await symbols(page);
  expect(Math.abs(syms[0]!.width - 100)).toBeLessThan(1);
  expect(Math.abs(syms[0]!.height - 100)).toBeLessThan(1);
  // 拖拽创建：选中新件 + 回选择工具
  expect(await cursorMode(page)).toBe('cursor');
  const selected = await page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { selectedIds: string[] } };
        }
      ).__spinthDebug.__debug.selectedIds,
  );
  expect(selected).toEqual([syms[0]!.id]);

  // <10px 滑移 = 单击语义：默认尺寸、按下点居中、工具保持
  await pickSymbolTool(page);
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(705, 404, { steps: 3 }); // ~6.4px 屏幕位移
  await page.mouse.up();
  await expect.poll(() => modelCount(page)).toBe(2);
  syms = await symbols(page);
  expect(syms[1]!.width).toBe(96);
  expect(syms[1]!.height).toBe(128);
  expect(await cursorMode(page)).toBe('symbol');
});

test('S-3 双击进编辑：Esc 取消不落库，回车落库出现标签', async ({ page }) => {
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(1);
  await page.keyboard.press('v');

  // 双击进编辑 → Esc：label 保持空
  await page.mouse.dblclick(300, 280 + TOP_BAR);
  await expect(page.locator('#spinth-text-layer [contenteditable="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#spinth-text-layer [contenteditable="true"]')).toBeHidden();
  expect((await symbols(page))[0]!.label).toBe('');

  // 双击 → 输入 → Enter 落库
  await page.mouse.dblclick(300, 280 + TOP_BAR);
  await page.locator('#spinth-text-layer [contenteditable="true"]').click();
  await page.keyboard.type('核心交换机');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await symbols(page))[0]!.label).toBe('核心交换机');
});

test('S-4 编辑框在标签带中心：宽随控件、缩窄后仍贴带', async ({ page }) => {
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(1);
  await page.keyboard.press('v');
  const syms = await symbols(page);
  const s = syms[0]!;

  // 双击进编辑：DOM 编辑框中心 = 标签带中心（世界 y = bbox.y + h - 12 → 屏幕
  // +TOP_BAR），宽 = 可用宽（editorFrame 探针是控件级 bbox，不反映编辑框几何）
  await page.mouse.dblclick(300, 280 + TOP_BAR);
  const EDITOR = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(EDITOR).toBeVisible();
  const frame = (await EDITOR.boundingBox())!;
  expect(Math.abs(frame.y + frame.height / 2 - (s.y + s.height - 12 + TOP_BAR))).toBeLessThan(2);
  expect(Math.abs(frame.width - (s.width - 8))).toBeLessThan(2);
  await page.keyboard.press('Escape');

  // 缩窄到 60：编辑框仍贴带（中心 y 随 h 不变、宽 = 60-8）
  await page.keyboard.press('Escape'); // 清选
  await page.evaluate(
    ({ symId, rect }) => {
      const d = (
        window as unknown as {
          __spinthDebug: {
            __debug: { engine: { getModelById(id: string): { updateRect(r: unknown): void } } };
          };
        }
      ).__spinthDebug.__debug;
      d.engine.getModelById(symId).updateRect(rect);
    },
    { symId: s.id, rect: { x: s.x, y: s.y, width: 60, height: 128 } },
  );
  await page.mouse.dblclick(300, 280 + TOP_BAR);
  await expect(EDITOR).toBeVisible();
  const frame2 = (await EDITOR.boundingBox())!;
  expect(Math.abs(frame2.y + frame2.height / 2 - (s.y + 128 - 12 + TOP_BAR))).toBeLessThan(2);
  expect(Math.abs(frame2.width - (60 - 8))).toBeLessThan(2);
});

test('S-5 连线端点吸附图形区边（≠bbox 边中点），移动符号线跟随', async ({ page }) => {
  // 并排两个符号：A(300,300) B(600,300) 中心——水平拉线无遮挡，端点应吸
  // B 图形区左边中点 (x=552, y=b.y+48)；bbox 左中点是 b.y+64（差 16 可区分）
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await page.mouse.click(600, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(2);
  const b = (await symbols(page)).find((s) => Math.abs(s.x - 552) < 1)!;

  await page.keyboard.press('l');
  await expect.poll(() => cursorMode(page)).toBe('line');
  await page.mouse.move(348, 364 + TOP_BAR); // A 中心 (348,364)
  await page.mouse.down();
  await page.mouse.move(648, 364 + TOP_BAR, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await probe(page)).line !== null).toBe(true);
  // ELBOWED 避障走下方走廊进入 B 底边：端点 = 图形区底边中点
  // ((b.x+48, b.y+h-32)），绝不是 bbox 底边中点 (b.y+h)
  const glyphBottomMidOf = (s: SymState) => ({ x: s.x + 48, y: s.y + s.height - 32 });
  let line = (await probe(page)).line!;
  let end = line.points[line.points.length - 1]!;
  expect(Math.abs(end[0] - glyphBottomMidOf(b).x)).toBeLessThan(1.5);
  expect(Math.abs(end[1] - glyphBottomMidOf(b).y)).toBeLessThan(1.5);
  expect(Math.abs(end[1] - (b.y + b.height))).toBeGreaterThan(20);

  // 移动 B：线跟随（端点随 B 新几何重锚到新图形区左中）
  await page.keyboard.press('v');
  await page.mouse.move(648, 364 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(748, 264 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const bAfter = (await symbols(page)).find((s) => s.id === b.id)!;
  line = (await probe(page)).line!;
  end = line.points[line.points.length - 1]!;
  expect(Math.abs(end[0] - glyphBottomMidOf(bAfter).x)).toBeLessThan(1.5);
  expect(Math.abs(end[1] - glyphBottomMidOf(bAfter).y)).toBeLessThan(1.5);
});

test('S-6 ActionBar 切种类：几何与标签不变、图形更换', async ({ page }) => {
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(1);
  await page.keyboard.press('v');
  await page.mouse.dblclick(300, 280 + TOP_BAR);
  await page.keyboard.type('网关');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await symbols(page))[0]!.label).toBe('网关');

  await page.mouse.click(300, 280 + TOP_BAR); // 选中
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar).toBeVisible();
  const before = (await symbols(page))[0]!;
  await bar.getByRole('button', { name: /符号类型/ }).click();
  await page.getByRole('menuitemradio', { name: '云' }).click();
  await expect.poll(async () => (await symbols(page))[0]!.symbol).toBe('net-cloud');
  const after = (await symbols(page))[0]!;
  expect(after.label).toBe('网关');
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
});

test('S-7 创建与命名各为独立撤销步；刷新恢复', async ({ page }) => {
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(1);
  // 创建与命名必须分属不同撤销项：隔出 500ms 捕获窗（连击窗内两写并一步）
  await page.waitForTimeout(700);
  await page.keyboard.press('v');
  await page.mouse.dblclick(300, 280 + TOP_BAR);
  await page.keyboard.type('持久验证');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await symbols(page))[0]!.label).toBe('持久验证');
  await page.waitForTimeout(700);

  // undo 1：命名回退（label 清空、控件还在）
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await symbols(page))[0]!.label).toBe('');
  expect(await modelCount(page)).toBe(1);
  // undo 2：创建回退（控件删除）
  await page.keyboard.press('Meta+z');
  await expect.poll(() => modelCount(page)).toBe(0);
  // redo ×2：控件与名字都回来（两 redo 之间等模型恢复，高负载下背靠背会丢拍）
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(() => modelCount(page)).toBe(1);
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(async () => (await symbols(page))[0]!.label).toBe('持久验证');

  // 刷新恢复（IndexedDB）——先等防抖持久化落盘（persistState$ 'saved'），
  // reload 后原地等 synced（再 goto 会双导航竞态）
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __spinth: { persistState$: { getValue(): string } } }
      ).__spinth.persistState$.getValue() === 'saved',
    undefined,
    { timeout: 10_000 },
  );
  await page.reload();
  await waitForSynced(page);
  // IndexedDB 存 Yjs 增量日志：恢复时创建事务先到、label 事务后到——poll 等
  await expect.poll(async () => (await symbols(page))[0]?.label).toBe('持久验证');
  expect((await symbols(page))[0]!.symbol).toBe('net-server');
});

test('S-8 只读跟随：符号工具禁用、双击不进编辑', async ({ page, context }) => {
  const docId = (await page.url().match(/doc=([^&]+)/))![1]!;
  await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: { engine: { add(w: unknown): void; genInitialOrder(): string } };
        };
      }
    ).__spinthDebug.__debug;
    d.engine.add({
      id: 'ro-sym',
      type: 'SYMBOL',
      zOrder: d.engine.genInitialOrder(),
      symbol: 'net-router',
      label: '只读符号',
      x: 200,
      y: 200,
      width: 96,
      height: 128,
    } as never);
  });
  await expect.poll(() => modelCount(page)).toBe(1);

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}`);
  await pageB.waitForFunction(
    () =>
      (
        window as unknown as { __spinth?: { docState$: { getValue(): string } } }
      ).__spinth?.docState$?.getValue() === 'synced',
  );
  await waitRole(pageB, 'follower');

  // 符号工具按钮禁用；N 键被只读闸门拦截
  const symbolBtn = pageB
    .getByRole('toolbar', { name: '画板工具' })
    .getByRole('button', { name: '符号 (N)' });
  await expect(symbolBtn).toBeDisabled();
  await pageB.keyboard.press('n');
  await expect.poll(() => cursorMode(pageB)).toBe('cursor');
  // 双击符号不进编辑
  await pageB.mouse.dblclick(248, 180 + TOP_BAR);
  await pageB.waitForTimeout(300);
  await expect(pageB.locator('#spinth-text-layer [contenteditable="true"]')).toBeHidden();
});

test('S-9 着色：ActionBar 选色落库、撤销回主题色、刷新保真', async ({ page }) => {
  await pickSymbolTool(page);
  await page.mouse.click(300, 300 + TOP_BAR);
  await expect.poll(() => modelCount(page)).toBe(1);
  await page.keyboard.press('v');
  await page.mouse.click(300, 280 + TOP_BAR);

  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: /颜色/ }).click();
  await page.getByRole('menuitemradio', { name: '#dc2626' }).click();
  await expect.poll(async () => (await symbols(page))[0]!.color).toBe('#dc2626');
  await page.waitForTimeout(700); // 出捕获窗：选色独立成撤销项

  // 撤销一步：回到主题色（color 字段消失 = 缺省）
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await symbols(page))[0]!.color).toBe(undefined);
  // 重做 + 刷新：显式色保真
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(async () => (await symbols(page))[0]!.color).toBe('#dc2626');
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __spinth: { persistState$: { getValue(): string } } }
      ).__spinth.persistState$.getValue() === 'saved',
    undefined,
    { timeout: 10_000 },
  );
  await page.reload();
  await waitForSynced(page);
  await expect.poll(async () => (await symbols(page))[0]?.color).toBe('#dc2626');
});
