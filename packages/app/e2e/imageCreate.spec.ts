/** IMAGE 创建 E2E：拖放/粘贴两条入口（合成事件直驱，docs/19） */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { imageState, PNG_B64 } from './helpers/imageProbeE2e';

test('拖放创建：drop 文件到画布 → IMAGE 落库 + natural 尺寸 + 选中', async ({ page }) => {
  const docId = `e2e-img-drop-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  const rect = await page.locator('#stage-container').boundingBox();
  expect(rect).not.toBeNull();
  await page.evaluate(
    ({ x, y, b64 }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
      document.querySelector('#stage-container')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x: rect!.x + 400, y: rect!.y + 260, b64: PNG_B64 },
  );

  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  const st = await imageState(page);
  // 1×1 natural：宽高 1:1 落库（长边钳 480 上限内）
  expect(st.img?.width).toBe(1);
  expect(st.img?.height).toBe(1);
  expect(st.img?.srcLen).toBeGreaterThan(50); // dataURL 已落库
  // 创建即选中（ActionBar 面向选中态）
  const selected = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { selectedIds: string[] } } }).__spinth.__debug
        .selectedIds,
  );
  expect(selected).toHaveLength(1);
});

test('粘贴创建：paste 图片文件 → IMAGE 落库于视口中心', async ({ page }) => {
  const docId = `e2e-img-paste-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, PNG_B64);

  await expect.poll(async () => (await imageState(page)).count, { timeout: 5_000 }).toBe(1);
  const st = await imageState(page);
  expect(st.img?.srcLen).toBeGreaterThan(50);
  // 真渲染断言（P0 修复配套）：贴图即出 sprite（非灰框占位）
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
              }
            ).__spinth.__debug.vmStates.find((v) => v.type === 'IMAGE')?.hasSprite ?? false,
        ),
      { timeout: 8_000 },
    )
    .toBe(true);
});
