import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';

/**
 * 边缘自动滚屏 E2E（specs/edge-auto-scroll §7.5 E-1..E-5）。
 *
 * 坐标纪律：页面坐标一律 canvas boundingBox 盒相对（顶栏高度会变，禁止裸写
 * 页面绝对坐标/硬编码 44px 偏移）；世界 ↔ 屏幕断言走公开 `toScreenPoint`，
 * 视口状态走公开 `vpBounds$`。跟手断言用既有 `__debug.selectionFrame`
 * 探针（选区框每帧 moveTo = 预览世界位置；D7 不新增 debug 字段）。
 * 只断言方向与下限，不断言精确像素（防 CI 抖动）。
 */

interface VpBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function vpBounds(page: Page): Promise<VpBounds> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __spinth: { vpBounds$: { getValue(): VpBounds } };
      }
    ).__spinth.vpBounds$.getValue(),
  );
}

/** 世界 → canvas 局部屏幕（公开查询；世界 → 页面再加 canvas 原点） */
async function toScreen(
  page: Page,
  p: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x, y]) =>
      (
        window as unknown as {
          __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
        }
      ).__spinth.toScreenPoint({ x, y }),
    [p.x, p.y],
  );
}

/** 选区框世界位 → 屏幕位（单次 evaluate 原子读取：滚屏每帧都在动，
 *  分两次 evaluate 会跨帧撕裂——同帧配对才有「跟手」断言意义） */
async function selectionFrameScreen(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          __debug: { selectionFrame: { x: number; y: number } | null };
          toScreenPoint(p: { x: number; y: number }): { x: number; y: number };
        };
      }
    ).__spinth;
    const f = w.__debug.selectionFrame;
    return f ? w.toScreenPoint({ x: f.x, y: f.y }) : null;
  });
}

async function vmGeom(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((wid) => {
    const s = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates.find((v) => v.id === wid)!;
    return { x: Number(s.x), y: Number(s.y) };
  }, id);
}

/** 拖拽建 120×80 矩形（世界左上角 = 建件时的 canvas 局部坐标），返回新件 id */
async function dragCreateRect(page: Page, x: number, y: number): Promise<string> {
  const box = (await page.locator('#stage-container').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 120, box.y + y + 80, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const id = await page.evaluate((tx) => {
    const states = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates.filter((v) => String(v.type) === 'SHAPE');
    const s = states.find((v) => Math.abs(Number(v.x) - tx) < 2)!;
    return String(s.id);
  }, x);
  await page.keyboard.press('Escape'); // 工具保持激活——回 cursor
  await page.waitForTimeout(80);
  return id;
}

/** 建件 + 按住中心拖到右热区（box.width − 12）停住；返回断言所需基准量 */
async function dragIntoRightZone(
  page: Page,
  worldX: number,
  worldY: number,
): Promise<{
  box: { x: number; y: number; width: number; height: number };
  id: string;
  before: VpBounds;
  pressScreen: { x: number; y: number };
  holdScreen: { x: number; y: number };
}> {
  const id = await dragCreateRect(page, worldX, worldY);
  const box = (await page.locator('#stage-container').boundingBox())!;
  const pressScreen = await toScreen(page, { x: worldX + 60, y: worldY + 40 }); // 矩形中心
  const before = await vpBounds(page);
  await page.mouse.move(box.x + pressScreen.x, box.y + pressScreen.y);
  await page.mouse.down();
  // 过阻尼（≥10px）再进热区——顺序即 D6 语义
  await page.mouse.move(box.x + pressScreen.x + 24, box.y + pressScreen.y, { steps: 4 });
  const holdScreen = { x: box.width - 12, y: pressScreen.y };
  await page.mouse.move(box.x + holdScreen.x, box.y + holdScreen.y, { steps: 8 });
  return { box, id, before, pressScreen, holdScreen };
}

test('E-1 右热区：视口滚动且元素跟手（屏幕位置恒 ≈ 指针 − grabOffset）', async ({ page }) => {
  await openBoardDoc(page, `e2e-edge-scroll-${Date.now()}`);
  const { id, before, pressScreen, holdScreen } = await dragIntoRightZone(page, 100, 100);
  // 视口确实在滚（只查公开流；右热区 = panBy 负值 = vpBounds.x 增大）
  await page.waitForFunction(
    (x0) =>
      (
        window as unknown as { __spinth: { vpBounds$: { getValue(): { x: number } } } }
      ).__spinth.vpBounds$.getValue().x >
      x0 + 80,
    before.x,
    { timeout: 5_000 },
  );
  // 元素仍然跟手（G1/G2 核心）：选区框（预览世界位）映射屏幕 = 指针 − grabOffset
  const frameScreen = (await selectionFrameScreen(page))!;
  const grabOffset = {
    x: pressScreen.x - 100, // 按下时指针 − 元素屏幕左上（世界 100,100 = 屏幕 100,100）
    y: pressScreen.y - 100,
  };
  expect(Math.abs(frameScreen.x - (holdScreen.x - grabOffset.x))).toBeLessThan(2);
  expect(Math.abs(frameScreen.y - (holdScreen.y - grabOffset.y))).toBeLessThan(2);
  expect(id).toBeTruthy();
  await page.mouse.up();
});

test('E-2 松手落库 = 起点 + 指针位移 + 滚屏位移；Cmd+Z 一次回原位', async ({ page }) => {
  await openBoardDoc(page, `e2e-edge-scroll-${Date.now()}`);
  const { id, before, pressScreen, holdScreen } = await dragIntoRightZone(page, 100, 100);
  await page.waitForFunction(
    (x0) =>
      (
        window as unknown as { __spinth: { vpBounds$: { getValue(): { x: number } } } }
      ).__spinth.vpBounds$.getValue().x >
      x0 + 80,
    before.x,
    { timeout: 5_000 },
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  // 世界位移 = 指针屏幕位移/scale + ΔvpBounds.x（后者本就是世界单位）
  const after = await vpBounds(page);
  const data = await vmGeom(page, id);
  const expectedX = 100 + (holdScreen.x - pressScreen.x) + (after.x - before.x);
  expect(Math.abs(data.x - expectedX)).toBeLessThan(2);
  // 一次撤销完整回退（G3：一次 transact = 一次 undo）
  await page.keyboard.press('Escape'); // 清选中态，避免影响
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(100);
  const undone = await vmGeom(page, id);
  expect(Math.abs(undone.x - 100)).toBeLessThan(2);
});

test('E-3 指针回中心 → 视口停止滚动（连续采样相等）', async ({ page }) => {
  await openBoardDoc(page, `e2e-edge-scroll-${Date.now()}`);
  const { box, before } = await dragIntoRightZone(page, 100, 100);
  await page.waitForFunction(
    (x0) =>
      (
        window as unknown as { __spinth: { vpBounds$: { getValue(): { x: number } } } }
      ).__spinth.vpBounds$.getValue().x >
      x0 + 40,
    before.x,
    { timeout: 5_000 },
  );
  // 指针回到画布中心（仍按住）→ 离热区 → 停滚
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(150);
  const s1 = await vpBounds(page);
  await page.waitForTimeout(250);
  const s2 = await vpBounds(page);
  expect(s2.x).toBe(s1.x);
  await page.mouse.up();
});

test('E-4 反例（D6）：边缘按下但未过阻尼 → 不滚屏', async ({ page }) => {
  await openBoardDoc(page, `e2e-edge-scroll-${Date.now()}`);
  // 矩形右半伸入右热区：按在 (worldX+100, 140)（距右缘 40px < 56）
  const worldX = 1300;
  const id = await dragCreateRect(page, worldX, 100);
  const box = (await page.locator('#stage-container').boundingBox())!;
  const before = await vpBounds(page);
  await page.mouse.move(box.x + worldX + 100, box.y + 140);
  await page.mouse.down();
  // 亚阻尼抖动（3px < 10px 阈值）：在热区内但不构成拖拽
  await page.mouse.move(box.x + worldX + 103, box.y + 142, { steps: 2 });
  await page.waitForTimeout(300);
  const after = await vpBounds(page);
  expect(after.x).toBe(before.x); // 未过阻尼绝不滚（update 收到 dragging=false）
  await page.mouse.up();
  await page.waitForTimeout(100);
  const data = await vmGeom(page, id);
  expect(Math.abs(data.x - worldX)).toBeLessThan(2); // 且未发生位移
});

interface MindNode {
  id: string;
  text: string;
  worldRect: { x: number; y: number; width: number; height: number };
}

async function mindNodes(page: Page): Promise<MindNode[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinth: { __debug: { mindNodes: MindNode[] } };
        }
      ).__spinth.__debug.mindNodes,
  );
}

test('E-5 脑图节点拖到边缘：视口滚动中松手成新图，落点贴住指针屏幕位（相对断言）', async ({
  page,
}) => {
  await openBoardDoc(page, `e2e-edge-scroll-mind-${Date.now()}`);
  // 建脑图（默认根 + Tab 一个右子），同 mindSelect 4.9 的建树节奏；
  // 创建期点击用画布盒相对坐标（canvas 局部 (600,280)≈既有 spec 的页面 (600,320)）
  const box0 = (await page.locator('#stage-container').boundingBox())!;
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(box0.x + 600, box0.y + 280);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // 退出根编辑
  await page.waitForTimeout(120);
  await page.mouse.click(box0.x + 610, box0.y + 290); // 选中根（焦点）
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 建右子并进入编辑
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // 保留默认文本退出
  await page.waitForTimeout(150);

  const nodes = await mindNodes(page);
  const root = nodes.find((n) => n.text.includes('中心'))!;
  const child = nodes.find((n) => n.id !== root.id && n.worldRect.x > root.worldRect.x)!;
  const box = (await page.locator('#stage-container').boundingBox())!;
  const childCenter = {
    x: child.worldRect.x + child.worldRect.width / 2,
    y: child.worldRect.y + child.worldRect.height / 2,
  };
  const childScreen = await toScreen(page, childCenter);
  const before = await vpBounds(page);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth.__debug
          .modelCount,
    ),
  ).toBe(1);

  await page.mouse.move(box.x + childScreen.x, box.y + childScreen.y);
  await page.mouse.down();
  await page.mouse.move(box.x + childScreen.x + 24, box.y + childScreen.y, { steps: 4 }); // 过判拖阈值
  const holdScreen = { x: box.width - 12, y: childScreen.y };
  await page.mouse.move(box.x + holdScreen.x, box.y + holdScreen.y, { steps: 8 });
  await page.waitForFunction(
    (x0) =>
      (
        window as unknown as { __spinth: { vpBounds$: { getValue(): { x: number } } } }
      ).__spinth.vpBounds$.getValue().x >
      x0 + 40,
    before.x,
    { timeout: 5_000 },
  );
  // 热区内直接松手（边滚边落库路径——up 首行停滚，落点在松手瞬间锁定）
  await page.mouse.up();
  await page.waitForTimeout(250);

  const modelCount1 = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth.__debug
        .modelCount,
  );
  expect(modelCount1).toBe(2); // 原图 + 拖出成新图
  const mapCount = await page.evaluate(
    () =>
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.filter((v) => String(v.type) === 'MIND_MAP').length,
  );
  expect(mapCount).toBe(2);
  // 相对断言（对时间不变，无采样竞态）：松手后新图根中心映射屏幕 ≈ 松手瞬间
  // 指针屏幕位。120 容差同时吸收两项：① 根节点相对图原点居中的布局偏移；
  // ② 松手后 followFocus 把越界新图拉回可视区的再平移（holdScreen 距右缘仅
  // 12px，节点右缘越界 → 约几十 px）——有效余量 ~60px，挡「补偿失效」（数百
  // px 量级）仍足够。nodesDebug 只遍历焦点图（松手后 = 新图，单节点 = 被拖
  // 子节点）
  const landedScreen = await page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          __debug: { mindNodes: MindNode[] };
          toScreenPoint(p: { x: number; y: number }): { x: number; y: number };
        };
      }
    ).__spinth;
    const n = w.__debug.mindNodes.find((x) => !x.text.includes('中心'));
    if (!n) return null;
    return w.toScreenPoint({
      x: n.worldRect.x + n.worldRect.width / 2,
      y: n.worldRect.y + n.worldRect.height / 2,
    });
  });
  expect(landedScreen).not.toBeNull();
  expect(Math.abs(landedScreen!.x - holdScreen.x)).toBeLessThan(120);
  expect(Math.abs(landedScreen!.y - holdScreen.y)).toBeLessThan(120);
});
