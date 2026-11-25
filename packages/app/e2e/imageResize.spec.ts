/** IMAGE 手柄缩放 E2E：按住 Shift 锁定宽高比（能力位 keepRatio，docs/05 §4.4）。
 *  普通拖拽自由缩放（现状不变） */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { imageState } from './helpers/imageProbeE2e';
import { worldToScreen } from './helpers/coverageE2e';

interface IImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 图片矩形的文档真值（model.toJSON） */
async function imageRect(page: Page): Promise<IImageRect> {
  return page.evaluate(() => {
    const dbg = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmStates: Array<Record<string, unknown>>;
            engine: { getModelById(id: string): { toJSON(): unknown } | undefined };
          };
        };
      }
    ).__spinthDebug.__debug;
    const id = String(dbg.vmStates.find((s) => s.type === 'IMAGE')!.id);
    const data = dbg.engine.getModelById(id)!.toJSON() as IImageRect;
    return { x: data.x, y: data.y, width: data.width, height: data.height };
  });
}

/** 拖放一张 200×100 的纯色 PNG（canvas 现生成）→ IMAGE 按自然尺寸落库 */
async function dropWideImage(page: Page): Promise<void> {
  const rect = await page.locator('#stage-container').boundingBox();
  expect(rect).not.toBeNull();
  await page.evaluate(
    ({ x, y }) =>
      new Promise<void>((resolve, reject) => {
        const cv = document.createElement('canvas');
        cv.width = 200;
        cv.height = 100;
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(0, 0, 200, 100);
        cv.toBlob((blob) => {
          if (!blob) {
            reject(new Error('canvas toBlob failed'));
            return;
          }
          const dt = new DataTransfer();
          dt.items.add(new File([blob], 'wide.png', { type: 'image/png' }));
          document.querySelector('#stage-container')!.dispatchEvent(
            new DragEvent('drop', {
              dataTransfer: dt,
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
            }),
          );
          resolve();
        }, 'image/png');
      }),
    { x: rect!.x + 300, y: rect!.y + 200 },
  );
  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => (await imageRect(page)).width, { timeout: 5_000 }).toBe(200);
}

/** 从右下角手柄拖出 dx×dy（shift = 全程按住 Shift） */
async function dragSeHandle(page: Page, r: IImageRect, dx: number, dy: number, shift: boolean) {
  const corner = await worldToScreen(page, r.x + r.width, r.y + r.height);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + dx, corner.y + dy, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
}

test('IMAGE 缩放：按住 Shift 拖角手柄锁定宽高比，undo 一步回；普通拖拽自由缩放', async ({
  page,
}) => {
  await page.goto(`/?doc=e2e-image-ratio-${Date.now()}`);
  await waitForSynced(page);
  await dropWideImage(page);
  const before = await imageRect(page);
  expect(before.width).toBe(200);
  expect(before.height).toBe(100); // 2:1

  // 创建即选中 → 右下角手柄可拖。Shift +150×60：自由缩放是 350×160（宽 +75%、
  // 高 +60%）→ 宽为主轴 → 高按 2:1 派生 175
  await dragSeHandle(page, before, 150, 60, true);
  const locked = await imageRect(page);
  expect(locked.width).toBeCloseTo(350, 6);
  expect(locked.height).toBeCloseTo(175, 6);
  expect(locked.width / locked.height).toBeCloseTo(2, 6);
  // 对侧角（左上）不动
  expect(locked.x).toBeCloseTo(before.x, 6);
  expect(locked.y).toBeCloseTo(before.y, 6);

  // 一次拖拽一次撤销：回到 200×100
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  const undone = await imageRect(page);
  expect(undone.width).toBe(200);
  expect(undone.height).toBe(100);

  // 普通拖拽（不按 Shift）：自由缩放，宽高比随之改变
  await dragSeHandle(page, undone, 150, 60, false);
  const free = await imageRect(page);
  expect(free.width).toBeCloseTo(350, 6);
  expect(free.height).toBeCloseTo(160, 6);
});
