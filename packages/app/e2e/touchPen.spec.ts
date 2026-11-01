import { expect, test, type Page } from '@playwright/test';
import { openBoard } from './helpers/layoutE2e';

/**
 * 触摸/笔指针通道 E2E（specs/a11y-closeout §13.5-7）：真实浏览器 CDP 注入
 * touchStart/Move/End 与 pointerType=pen 鼠标事件——证明 pixi 归一后缺省
 * button 的指针不会被主键过滤误挡（单测真值表锁语义，本层锁真浏览器行为）。
 * 与 pen.spec.ts（画笔工具的鼠标路径）无关，勿混淆。
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

/** 断言前等两帧 rAF：触摸事件到 pixi 建件是异步管线，防时序 flake（计划 §10） */
async function waitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function boardState(page: Page): Promise<{ modelCount: number; selected: number }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __spinth?: { selected$: { getValue(): string[] } };
      __spinthDebug?: { __debug: { modelCount: number } };
    };
    return {
      modelCount: w.__spinthDebug?.__debug.modelCount ?? -1,
      selected: w.__spinth?.selected$.getValue().length ?? 0,
    };
  });
}

async function cleanupDoc(page: Page, docId: string): Promise<void> {
  await page.evaluate((id) => indexedDB.deleteDatabase(`spinth-doc:${id}`), docId);
}

test('触摸：touchStart/Move/End 拖出矩形并选中（缺省 button 不被主键过滤误挡）', async ({
  page,
}) => {
  const docId = `e2e-tp1-${Date.now()}`;
  await openBoard(page, docId);
  await page.keyboard.press('r');
  const cdp = await page.context().newCDPSession(page);
  // 画布中央起拖（避开 56px 边缘自动滚屏热区与顶栏 44px）
  const from = { x: 195, y: 400 };
  const to = { x: 295, y: 480 };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: from.x, y: from.y }],
  });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          id: 1,
          x: from.x + ((to.x - from.x) * i) / 6,
          y: from.y + ((to.y - from.y) * i) / 6,
        },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitTwoFrames(page);
  await page.waitForTimeout(300);
  const s = await boardState(page);
  expect(s.modelCount, `触摸拖拽后 modelCount 应为 1（实际 ${s.modelCount}）`).toBe(1);
  expect(s.selected, `建件后应自动选中 1 个（实际 ${s.selected}）`).toBe(1);
  await expect(page.locator('[data-spinth-action-bar]')).toBeVisible();
  await cleanupDoc(page, docId);
});

test('笔：pointerType=pen 三段式拖动建件（同一过滤分支）', async ({ page }) => {
  const docId = `e2e-tp2-${Date.now()}`;
  await openBoard(page, docId);
  await page.keyboard.press('r');
  const cdp = await page.context().newCDPSession(page);
  const from = { x: 195, y: 400 };
  const to = { x: 295, y: 480 };
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'pen',
  });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + ((to.x - from.x) * i) / 6,
      y: from.y + ((to.y - from.y) * i) / 6,
      button: 'left',
      buttons: 1,
      pointerType: 'pen',
    });
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'pen',
  });
  await waitTwoFrames(page);
  await page.waitForTimeout(300);
  const s = await boardState(page);
  expect(s.modelCount, `笔拖拽后 modelCount 应为 1（实际 ${s.modelCount}）`).toBe(1);
  expect(s.selected, `建件后应自动选中 1 个（实际 ${s.selected}）`).toBe(1);
  await cleanupDoc(page, docId);
});
