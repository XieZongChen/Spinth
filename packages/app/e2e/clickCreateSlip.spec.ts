import { expect, test, type Page } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';

/**
 * 工具单击创建的滑移容差（docs/04 §2，specs/click-create-slip）：形状工具激活后
 * 在画布单击，按下到松开间滑移 < 10 屏幕 px 一律按单击——默认 120×80、以按下点
 * 为中心、工具保持（可连击放置）、不选中。旧 5px 分界下同样的手抖会画出 8×8
 * 小图形并被选中、回选择工具。
 */

/** 世界 → 屏幕（canvas 顶栏 44px，默认视口 1x 无平移） */
const sy = (worldY: number): number => worldY + 44;

interface IShapeGeom {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function snapshot(
  page: Page,
): Promise<{ shapes: IShapeGeom[]; selectedIds: string[]; mode: string }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __spinth: { cursorMode$: { getValue(): string } };
      __spinthDebug: {
        __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] };
      };
    };
    const d = w.__spinthDebug.__debug;
    return {
      shapes: d.vmStates
        .filter((v) => String(v.type) === 'SHAPE')
        .map((v) => ({
          x: Number(v.x),
          y: Number(v.y),
          width: Number(v.width),
          height: Number(v.height),
        })),
      selectedIds: d.selectedIds,
      mode: w.__spinth.cursorMode$.getValue(),
    };
  });
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
  await expect.poll(async () => (await snapshot(page)).mode).toBe('shape');

  // 1. 水平滑 7px：旧 5px 分界下会画出 8×8 小图形
  await slipClick(page, 500, 306, 7, 0);
  await expect
    .poll(async () => (await snapshot(page)).shapes)
    .toEqual([
      { x: 440, y: 266, width: 120, height: 80 }, // 中心 = 按下点 (500,306)
    ]);
  let s = await snapshot(page);
  expect(s.mode).toBe('shape'); // 工具保持激活
  expect(s.selectedIds).toEqual([]); // 单击不选中

  // 2. 工具仍激活 → 斜向滑 (6,5)（≈7.8px）再点一次：连击放置第二个默认图形
  await slipClick(page, 800, 306, 6, 5);
  await expect.poll(async () => (await snapshot(page)).shapes.length).toBe(2);
  s = await snapshot(page);
  expect(s.shapes[1]).toEqual({ x: 740, y: 266, width: 120, height: 80 });
  expect(s.mode).toBe('shape');
  expect(s.selectedIds).toEqual([]);
});
