import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';

/**
 * 工具单击创建的滑移容差（docs/04 §2，specs/click-create-slip）：创建工具激活后
 * 在画布单击，按下到松开间的滑移未达拖拽分界一律按单击——默认尺寸、以按下点
 * 为中心、工具保持（可连击放置）、不选中。分界：形状 10 屏幕 px（旧 5px 下同样
 * 的手抖会画出 8×8 小图形并被选中、回选择工具）；便签两轴各 ≥ 24 屏幕 px。
 */

/** 世界 → 屏幕（canvas 顶栏 44px，默认视口 1x 无平移） */
const sy = (worldY: number): number => worldY + 44;

interface IGeom {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function snapshot(
  page: Page,
  type: 'SHAPE' | 'STICKY',
): Promise<{ items: IGeom[]; selectedIds: string[]; mode: string }> {
  return page.evaluate((t) => {
    const w = window as unknown as {
      __spinth: { cursorMode$: { getValue(): string } };
      __spinthDebug: {
        __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] };
      };
    };
    const d = w.__spinthDebug.__debug;
    return {
      items: d.vmStates
        .filter((v) => String(v.type) === t)
        .map((v) => ({
          x: Number(v.x),
          y: Number(v.y),
          width: Number(v.width),
          height: Number(v.height),
        })),
      selectedIds: d.selectedIds,
      mode: w.__spinth.cursorMode$.getValue(),
    };
  }, type);
}

/** 在世界点 (wx, wy) 按下，滑移 (dx, dy) 屏幕 px 后松开 */
async function slipClick(page: Page, wx: number, wy: number, dx: number, dy: number) {
  await page.mouse.move(wx, sy(wy));
  await page.mouse.down();
  await page.mouse.move(wx + dx, sy(wy) + dy, { steps: 3 });
  await page.mouse.up();
}

test('形状工具单击滑移 < 10px：按单击落默认 120×80、以按下点为中心、工具保持可连击', async ({
  page,
}) => {
  await openBoardDoc(page, `e2e-click-slip-${Date.now()}`);
  await page.keyboard.press('r');
  await expect.poll(async () => (await snapshot(page, 'SHAPE')).mode).toBe('shape');

  // 1. 水平滑 7px：旧 5px 分界下会画出 8×8 小图形
  await slipClick(page, 500, 306, 7, 0);
  await expect
    .poll(async () => (await snapshot(page, 'SHAPE')).items)
    .toEqual([
      { x: 440, y: 266, width: 120, height: 80 }, // 中心 = 按下点 (500,306)
    ]);
  let s = await snapshot(page, 'SHAPE');
  expect(s.mode).toBe('shape'); // 工具保持激活
  expect(s.selectedIds).toEqual([]); // 单击不选中

  // 2. 工具仍激活 → 斜向滑 (6,5)（≈7.8px）再点一次：连击放置第二个默认图形
  await slipClick(page, 800, 306, 6, 5);
  await expect.poll(async () => (await snapshot(page, 'SHAPE')).items.length).toBe(2);
  s = await snapshot(page, 'SHAPE');
  expect(s.items[1]).toEqual({ x: 740, y: 266, width: 120, height: 80 });
  expect(s.mode).toBe('shape');
  expect(s.selectedIds).toEqual([]);
});

test('便签工具单击滑移（单轴 < 24px）：按单击落默认 180×180、以按下点为中心、工具保持', async ({
  page,
}) => {
  await openBoardDoc(page, `e2e-click-slip-sticky-${Date.now()}`);
  await page.keyboard.press('s');
  await expect.poll(async () => (await snapshot(page, 'STICKY')).mode).toBe('sticky');

  // 水平滑 20px：两轴未同时达 24 → 单击；若以松手点居中会整体偏右 20px
  await slipClick(page, 500, 306, 20, 0);
  await expect
    .poll(async () => (await snapshot(page, 'STICKY')).items)
    .toEqual([
      { x: 410, y: 216, width: 180, height: 180 }, // 中心 = 按下点 (500,306)
    ]);
  const s = await snapshot(page, 'STICKY');
  expect(s.mode).toBe('sticky');
  expect(s.selectedIds).toEqual([]);
});
