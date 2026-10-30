/** TEXT/STICKY 编辑会话 E2E（docs/07 §2/§7）：创建即编辑/空删/全盖/缩放不回退 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { textOf, centerOf } from './helpers/textProbeE2e';

test('TEXT：工具创建即进编辑 → 输入 Esc 退出落库 → 重进编辑内容一致', async ({ page }) => {
  const docId = `e2e-text-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 600, y: 300 } });
  // 创建即进编辑：编辑器 DOM 现身（opacity 铁律——visible 对 0 也成立）
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');

  await page.keyboard.type('spinth 文字');
  await page.keyboard.press('Escape');
  // 落库（Esc = flush 退出）：text 字段含输入内容
  await expect
    .poll(async () => await textOf(page, 'TEXT'), { timeout: 5_000 })
    .toContain('spinth 文字');

  // 重进（单击已选中）：内容一致
  const c = await centerOf(page, 'TEXT');
  await page.mouse.click(c.x, c.y);
  await expect(editor).toHaveCSS('opacity', '1');
  await expect(editor).toContainText('spinth 文字');
});

test('TEXT：空文本点外退出 = 删除控件（docs/07 §7 空删语义）', async ({ page }) => {
  const docId = `e2e-text-empty-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 500, y: 260 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');

  // 不输入，点空白画布退出 → 控件删除
  await canvas.click({ position: { x: 300, y: 500 } });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth
              .__debug.modelCount,
        ),
      { timeout: 5_000 },
    )
    .toBe(0);
});

test('STICKY：单击已选中进编辑 → 输入点外退出落库', async ({ page }) => {
  const docId = `e2e-sticky-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('s');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 620, y: 320 } });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth
              .__debug.modelCount,
        ),
      { timeout: 5_000 },
    )
    .toBe(1);

  // sticky 工具创建后不回 cursor（支持连击创建）——先回选择态；两次单击进编辑
  // （第一击选中、第二击已选中 → onActivate；间隔拉开避免组成原生 dblclick）
  await page.keyboard.press('v');
  const c = await centerOf(page, 'STICKY');
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
  await page.mouse.click(c.x, c.y);
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');

  await page.keyboard.type('便签内容 xyz');
  await canvas.click({ position: { x: 200, y: 500 } }); // 点外退出（flush）
  await expect
    .poll(async () => await textOf(page, 'STICKY'), { timeout: 5_000 })
    .toContain('便签内容');
});

test('STICKY 输入→全删→退出：删除不丢失、内容不复活（38 轮 🟠 行为锁）', async ({ page }) => {
  const docId = `e2e-sticky-undelete-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 拖建便签 → 单击已选中进编辑
  await page.keyboard.press('s');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(700, 450, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth
              .__debug.modelCount,
        ),
      { timeout: 5_000 },
    )
    .toBe(1);
  await page.keyboard.press('v');
  const c = await centerOf(page, 'STICKY');
  await page.mouse.click(c.x, c.y);
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');

  // 输入 abc（34ms 节流落库）→ 全选删除（编辑器空、模型曾有 abc）
  await page.keyboard.type('abc');
  await page.waitForTimeout(250);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(250);

  // 点外退出 → 模型 text 应为空（keep 保留空便签），不复活 abc
  await canvas.click({ position: { x: 200, y: 600 } });
  await expect
    .poll(async () => await textOf(page, 'STICKY'), { timeout: 5_000 })
    .not.toContain('abc');
  const count = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth.__debug
        .modelCount,
  );
  expect(count).toBe(1); // keep：空便签保留
});

test('STICKY 编辑框全盖 + 空内容退出保留（2026-10-16 用户实测揪出 + 拍板 keep）', async ({
  page,
}) => {
  const docId = `e2e-sticky-full-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 拖建便签（200×150 世界）
  await page.keyboard.press('s');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(700, 450, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth
              .__debug.modelCount,
        ),
      { timeout: 5_000 },
    )
    .toBe(1);
  const size = await page.evaluate(() => {
    const st = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates.find((v) => v.type === 'STICKY')!;
    return { w: st.width as number, h: st.height as number, x: st.x as number, y: st.y as number };
  });
  expect(size.w).toBeGreaterThan(40);
  expect(size.h).toBeGreaterThan(40);

  // 创建即选中（拖建回 cursor+选中）→ 单击已选中进编辑（onActivate）
  await page.keyboard.press('v');
  const c = await centerOf(page, 'STICKY');
  await page.mouse.click(c.x, c.y);
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  // 同值空 update 不再触发测高（scheduleCommit 过滤）——便签保持用户拖的高度
  await page.waitForTimeout(300);
  const hAfterEnter = await page.evaluate(() => {
    const st = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates.find((v) => v.type === 'STICKY')!;
    return st.height as number;
  });
  expect(hAfterEnter).toBe(size.h);

  // 编辑框（含蓝描边框容器）盖满整张便签：全盖样式（height/padding/border）在
  // fixed 外层容器上（contenteditable 是内层）——量父容器 rect
  const box = await editor.evaluate((el) => {
    const r = el.parentElement!.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect(box).toBeTruthy();
  const scale = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$.value,
  );
  expect(Math.abs(box!.width - size.w * scale)).toBeLessThanOrEqual(4);
  expect(Math.abs(box!.height - size.h * scale)).toBeLessThanOrEqual(4);

  // 不输入内容直接点外退出 → 便签保留（keep 拍板）
  await canvas.click({ position: { x: 200, y: 600 } });
  await page.waitForTimeout(400);
  const count = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth.__debug
        .modelCount,
  );
  expect(count).toBe(1);
});

test('P0-2 编辑中视口缩放不回退内容：滚轮 zoom 后输入保留、退出落库完整', async ({ page }) => {
  const docId = `e2e-text-zoomkeep-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 600, y: 300 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  await page.keyboard.insertText('HELLO');
  await page.waitForTimeout(400);

  // 编辑中 Ctrl+滚轮缩放（wheel 无 pointerdown → 不触发点外退出）。
  // 滚轮打在画布空白处——编辑器 DOM pointer-events:auto 会截走 wheel
  const scaleOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
          .value,
    );
  const before = await scaleOf();
  await page.mouse.move(200, 200);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400); // syncTransform 重放沉降
  expect(await scaleOf()).toBeGreaterThan(before);

  // 修复前：syncTransform 用进编辑时快照 setContent（emitUpdate:false 静默）
  // → 编辑器回退到空，退出把空内容落库
  expect(await editor.innerText()).toContain('HELLO');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect(await textOf(page, 'TEXT')).toContain('HELLO');
});
