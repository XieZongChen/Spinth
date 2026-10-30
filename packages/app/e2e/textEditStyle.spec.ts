/** 排版与样式 E2E（docs/17 §4/C2/C3）：主题色/档位/字号色板/实时跟随/marks */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { textOf } from './helpers/textProbeE2e';
import { barPick } from './helpers/widgetProbeE2e';

test('主题化默认文字色（docs/17 C2）：深色主题下编辑器默认色为浅色', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spinth.theme', 'dark'));
  const docId = `e2e-theme-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 600, y: 300 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  // 无 textColor override 时默认随主题（dark = #ededf2）
  await expect(editor).toHaveCSS('color', 'rgb(237, 237, 242)');
});

test('默认档入表（2026-10-16 用户实测揪出）：字号/行高触发钮显示各类型默认值而非占位圈', async ({
  page,
}) => {
  const docId = `e2e-typo-default-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // TEXT：选中（空内容不删——未进编辑直接点选）→ 字号触发钮显 16、行高显 1.5
  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 600, y: 300 } });
  await page.keyboard.type('占位');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar).toBeVisible();
  const textTrigger = bar.locator('button[aria-label="字号"]');
  await expect(textTrigger).toContainText('16');
  await expect(bar.locator('button[aria-label="行高"]')).toContainText('1.5');

  // 面板：行高默认档（1.5）选中态 + 六档计数（1.2/1.4/1.45/1.5/1.6/2.0）
  await bar.locator('button[aria-label="行高"]').click();
  const panel = page.locator('[data-spinth-popover-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('button[aria-checked="true"]')).toHaveAttribute(
    'aria-label',
    '1.5 倍行高',
  );
  await expect(panel.locator('button')).toHaveCount(6);
  await page.keyboard.press('Escape');

  // STICKY：拖建（创建即回 cursor + 选中 → ActionBar 现身）→ 字号 15 / 行高 1.45
  await page.keyboard.press('s');
  await canvas.hover({ position: { x: 700, y: 400 } });
  await page.mouse.down();
  await page.mouse.move(820, 500, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const bar2 = page.locator('[data-spinth-action-bar]');
  await expect(bar2).toBeVisible();
  await expect(bar2.locator('button[aria-label="字号"]')).toContainText('15');
  await expect(bar2.locator('button[aria-label="行高"]')).toContainText('1.45');
});

test('排版打磨（docs/17 §4）：ActionBar 改字号落库 + TEXT 高度重排 + 对齐落库', async ({
  page,
}) => {
  const docId = `e2e-typo-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 创建 TEXT 输入两行文字退出（保持选中 → ActionBar 现身）
  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 600, y: 300 } });
  await page.keyboard.type('字号重排第一行');
  await page.keyboard.press('Enter');
  await page.keyboard.type('第二行');
  await page.keyboard.press('Escape');
  await expect.poll(async () => await textOf(page, 'TEXT'), { timeout: 5_000 }).toContain('第二行');

  const stateOf = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => v.type === 'TEXT');
      return {
        fontSize: s?.fontSize as number | undefined,
        align: s?.align as string | undefined,
        lineHeight: s?.lineHeight as number | undefined,
        height: s?.height as number,
      };
    });
  const before = await stateOf();

  // 字号 16 → 32：落库 + 高度重排（约翻倍，断言显著增大防度量噪声）
  await barPick(page, '字号', '32 号');
  await expect.poll(async () => (await stateOf()).fontSize, { timeout: 5_000 }).toBe(32);
  const after = await stateOf();
  expect(after.height).toBeGreaterThan(before.height * 1.6);
  // undo：字号回退（undefined → 默认 16——改档是一个撤销单元）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await stateOf()).fontSize, { timeout: 5_000 }).toBeUndefined();

  // 对齐 → 居中：落库（渲染经 measureDoc 段落级 x 重排，快速路径守卫已含 align）
  await barPick(page, '对齐', '居中');
  await expect.poll(async () => (await stateOf()).align, { timeout: 5_000 }).toBe('center');

  // 行高 1.5 → 2.0：落库 + 高度重排（两行 64→80，断言显著增大防度量噪声；
  // 快速路径守卫第四键——改行高若被当纯平移跳过，高度重排断言即失败）
  const hBefore = await stateOf();
  await barPick(page, '行高', '2 倍行高');
  await expect.poll(async () => (await stateOf()).lineHeight, { timeout: 5_000 }).toBe(2);
  expect((await stateOf()).height).toBeGreaterThan(hBefore.height * 1.15);
  // undo：行高回退（undefined → 默认 1.5——同字号档位先例一个撤销单元）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await stateOf()).lineHeight, { timeout: 5_000 }).toBeUndefined();
});

test('排版打磨（docs/17 §4）：文字颜色选色落库 + undo 回退（排版四键补全）', async ({ page }) => {
  const docId = `e2e-typo-color-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 600, y: 300 } });
  await page.keyboard.type('文字颜色');
  await page.keyboard.press('Escape'); // 退出保留选中 → ActionBar 现身
  await expect
    .poll(async () => await textOf(page, 'TEXT'), { timeout: 5_000 })
    .toContain('文字颜色');

  const colorOf = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => v.type === 'TEXT');
      return s?.textColor as string | undefined;
    });
  expect(await colorOf()).toBeUndefined(); // 默认随主题，非实例值

  // 色板选色（swatch 选项 aria-label = 色值本体）→ textColor 落库
  await barPick(page, '文字颜色', '#2563eb');
  await expect.poll(colorOf, { timeout: 5_000 }).toBe('#2563eb');
  // undo：实例色回退（undefined → 默认随主题）——一个撤销单元
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(colorOf, { timeout: 5_000 }).toBeUndefined();
});

test('编辑中排版实时跟随（docs/17 C3）：远端/程序化改字号，编辑器不重建换装新字号', async ({
  page,
}) => {
  const docId = `e2e-follow-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 600, y: 300 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  await expect(editor).toHaveCSS('font-size', '16px');
  await page.keyboard.type('跟随');

  // 程序化改字号（不经 DOM 点击——ActionBar 点击会触发「点外退出」；
  // 等价协同远端变更路径）
  await page.evaluate(() =>
    (
      window as unknown as { __spinth: { updateSelectedStyle(p: Record<string, unknown>): void } }
    ).__spinth.updateSelectedStyle({ fontSize: 24 }),
  );
  // 编辑器 DOM 换装 24px（sameTarget 重放——不重建，输入内容保持）
  await expect(editor).toHaveCSS('font-size', '24px');
  await expect(editor).toContainText('跟随');
});

test('marks 渲染（docs/17 §4）：富文本粘贴 → 退出后渲染层含 bold/italic/underline/color span', async ({
  page,
}) => {
  const docId = `e2e-marks-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 600, y: 300 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');

  // 富文本粘贴（TipTap 粘贴管线产 marks；合成 Cmd+B 对 ProseMirror keymap
  // 不生效——合成键盘事件兼容问题，真实硬件键盘不受影响，挂账 docs/17 §4）
  await editor.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<p>前<strong>中粗</strong><em>中斜</em><u>下划</u><span style="color: #dc2626">红字</span>后</p>',
    );
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await page.keyboard.press('Escape'); // flush 退出 → 渲染层接管

  // 落库含 marks + 渲染探针（textSpans 与渲染同源 htmlToDoc；italic/underline
  // 2026-10-10 补齐——此前 em/u 在画布静默降级为无样式）
  await expect
    .poll(async () => await textOf(page, 'TEXT'), { timeout: 5_000 })
    .toContain('<strong>');
  const spans = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __spinth: {
              __debug: {
                textSpans: Array<{
                  text: string;
                  bold?: boolean;
                  italic?: boolean;
                  underline?: boolean;
                  color?: string;
                }>;
              };
            };
          }
        ).__spinth.__debug.textSpans,
    );
  await expect
    .poll(
      async () => {
        const s = await spans();
        return (
          s.some((x) => x.bold === true) &&
          s.some((x) => x.italic === true) &&
          s.some((x) => x.underline === true) &&
          s.some((x) => (x.color ?? '').startsWith('rgb'))
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
});
