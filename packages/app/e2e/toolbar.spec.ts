import { expect, test, type Page } from '@playwright/test';

/**
 * 工具坞常驻二级菜单 E2E（docs/12 §4 Toolbar 行，2026-10-11 形状四型首例）。
 *
 * 语义：面板可见性 = 工具激活的纯派生状态（激活现身 / 切走隐藏 / 点选切默认型
 * 面板保持）。本文件也是**首例工具坞 UI 点击基建**（此前 E2E 全走快捷键）。
 * 断言纪律：数据走 __spinth.__debug 探针（defaultShapeType/vmStates/cursorMode$），
 * UI 走 aria（toolbar role / menuitemradio / aria-checked）。
 */

/** 控件中心（世界 → 屏幕：canvas 顶栏 44px） */
async function centerOf(page: Page, type: string): Promise<{ x: number; y: number }> {
  return page.evaluate((t) => {
    const s = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, number>> } } }
    ).__spinth.__debug.vmStates.find((v) => String(v.type) === t)!;
    return { x: s.x + s.width / 2, y: s.y + s.height / 2 + 44 };
  }, type);
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

test('常驻二级菜单：工具坞点击激活 → 切默认型 → 建件随型 → 隐藏跟随', async ({ page }) => {
  const docId = `e2e-toolbar-flyout-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const shapeBtn = () =>
    page.getByRole('toolbar', { name: '画板工具' }).getByRole('button', { name: /\(R\)$/ }); // 12 型任一（标题随默认型动态）
  const mode = () =>
    page.evaluate(() =>
      (
        window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
      ).__spinth.cursorMode$.getValue(),
    );

  // 1. 工具坞 UI 点击激活形状工具（首例 toolbar 点击路径）→ 面板常驻现身、当前默认 rect 选中
  await expect(flyout).toBeHidden(); // 未激活不显示
  await shapeBtn().click();
  await expect.poll(mode).toBe('shape');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('button[aria-checked="true"]')).toHaveAttribute('aria-label', '矩形');
  // 型数单源断言（__debug.shapeTypeOptions 探针 = SHAPE_TYPE_OPTIONS 同源——20 型
  // 扩展批起随 core 常量自动增长；E2E 不能直 import @spinth/core：barrel 会把 pixi
  // 拉进 playwright 转译链炸 ESM 互操作）
  // + 两行网格布局（既有设计同款）。宽度/高度双向断言：absolute 无宽容器 + flex-wrap
  // 曾塌缩成 46px 宽 420px 高单列（29 轮审查揪出），当时唯一上界断言 46≤328 恒真
  // 放行——布局守卫必须含下界
  const shapeIds = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { shapeTypeOptions: string[] } } }).__spinth
        .__debug.shapeTypeOptions,
  );
  await expect(flyout.locator('button[role="menuitemradio"]')).toHaveCount(shapeIds.length);
  const box = await flyout.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
  expect(box.w).toBeGreaterThanOrEqual(180); // 2×6 网格 ≈6×32+gap+padding ≈214
  expect(box.h).toBeLessThanOrEqual(120); // 两行封顶（塌缩单列时高 420 必越界）

  // 2. 点选「椭圆」：切默认型（探针）+ 选中圈移动 + 按钮图标/标题随型 + 面板保持（工具仍激活）
  await flyout.locator('button[aria-label="椭圆"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __spinth: { __debug: { defaultShapeType: string } } }).__spinth
            .__debug.defaultShapeType,
      ),
    )
    .toBe('ellipse');
  await expect(flyout.locator('button[aria-checked="true"]')).toHaveAttribute('aria-label', '椭圆');
  await expect(shapeBtn()).toHaveAccessibleName('椭圆 (R)');
  await expect(flyout).toBeVisible(); // 常驻：点选不收起

  // 3. 拖建：新件 shapeType = ellipse（默认型生效）；创建完成回 cursor → 面板随之隐藏
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (
          window as unknown as {
            __spinth: { __debug: { vmStates: Array<Record<string, unknown>>; modelCount: number } };
          }
        ).__spinth.__debug;
        return s.modelCount === 1
          ? String((s.vmStates[0] as { shapeType?: string }).shapeType)
          : '';
      }),
    )
    .toBe('ellipse');
  await expect.poll(mode).toBe('cursor'); // 创建即回选择工具（既有语义）
  await expect(flyout).toBeHidden(); // 派生隐藏

  // 4. 快捷键 'r' 再激活：面板带会话记忆现身（椭圆仍选中）；Esc 取消工具 → 面板隐藏
  await page.keyboard.press('r');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('button[aria-checked="true"]')).toHaveAttribute('aria-label', '椭圆');
  await page.keyboard.press('Escape');
  await expect.poll(mode).toBe('cursor');
  await expect(flyout).toBeHidden();
});

test('line 常驻二级菜单：默认线型切换 + 双创建链（工具拉线与 quick-add 同源）', async ({
  page,
}) => {
  const docId = `e2e-toolbar-line-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const lineOf = () =>
    page.evaluate(() => {
      const l = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => String(v.type) === 'LINE') as
        { lineType?: string; strokeWidth?: number } | undefined;
      return l ? `${l.lineType}:${l.strokeWidth}` : '';
    });

  // 1. 'l' 激活 → 面板现身（两组：线型 3 + 线宽 4 = 7 项，折线/2 像素线宽默认选中）
  await page.keyboard.press('l');
  await expect(flyout).toBeVisible();
  const checkedLabels = flyout.locator('button[aria-checked="true"]');
  await expect(checkedLabels).toHaveCount(2);
  await expect(checkedLabels.nth(0)).toHaveAttribute('aria-label', '折线');
  await expect(checkedLabels.nth(1)).toHaveAttribute('aria-label', '2 像素线宽');
  await expect(flyout.locator('button[role="menuitemradio"]')).toHaveCount(7);

  // 2. 切「直线」→ 聚合探针 + 选中圈移动，面板保持（line 工具建线不回 cursor）
  await flyout.locator('button[aria-label="直线"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
            }
          ).__spinth.__debug.defaultToolOptions['line']?.['type'],
      ),
    )
    .toBe('STRAIGHT');
  await expect(flyout.locator('button[aria-checked="true"][aria-label="直线"]')).toHaveCount(1);
  await expect(flyout).toBeVisible();

  // 3. 工具拉线链：空白处拖一条线 → lineType = STRAIGHT
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await page.mouse.up();
  await expect.poll(lineOf).toBe('STRAIGHT:2');
  await expect(flyout).toBeVisible(); // line 建线后工具保持激活（参考同款）

  // 4. quick-add 链同源：删线 → 'r' 单击建形状 A（单击创建不回 cursor 不选中——基类
  //    仅拖拽分支选中新件回 cursor）→ Escape 回 cursor → 点选 A → hover 底边中点
  //    外移 24 连接点 → 点击 = quick-add（建线+新形状）→ 线也是 STRAIGHT
  await page.keyboard.press('ControlOrMeta+z'); // 删线
  await page.waitForTimeout(200);
  await page.keyboard.press('r');
  await page.mouse.click(450, 350); // screen → world (450,306)：A 默认 120×80 = world (390,266)-(510,346)
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // 形状工具保持激活（单击创建）——回 cursor
  await page.waitForTimeout(200);
  await page.mouse.click(450, 350); // 选中 A（连接点随之常显）
  await page.waitForTimeout(300);
  // 底边中点 world (450,346) 外移 24 → screen (450, 346+24+44) = (450,414)
  await page.mouse.move(450, 414);
  await page.waitForTimeout(250);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  // quick-add 产物：新 LINE + 新 SHAPE，线型/线宽走会话默认 STRAIGHT:2
  await expect.poll(lineOf).toBe('STRAIGHT:2');
});

test('line 线宽：flyout 第二组切档建件随宽 + ActionBar 改宽 undo 单步（线宽笔宽批）', async ({
  page,
}) => {
  const docId = `e2e-toolbar-linewidth-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const lineWidthOf = () =>
    page.evaluate(() => {
      const l = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => String(v.type) === 'LINE') as
        { strokeWidth?: number } | undefined;
      return l?.strokeWidth ?? 0;
    });

  // 1. 'l' → 切宽 8 → 聚合探针 width=8 → 拉一条线 strokeWidth=8 落库（双创建链之一）
  await page.keyboard.press('l');
  await flyout.locator('button[aria-label="8 像素线宽"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
            }
          ).__spinth.__debug.defaultToolOptions['line']?.['width'],
      ),
    )
    .toBe('8');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await page.mouse.up();
  await expect.poll(lineWidthOf).toBe(8);

  // 2. 选中该线 → ActionBar 线宽 popover 改 4 → 落库 4 → undo 单步回 8
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(500, 394); // 线中段 world (500,350) → screen +44
  await page.waitForTimeout(250);
  const bar = page.locator('[data-spinth-action-bar]');
  await bar.locator('button[aria-label="线宽"]').click();
  await page.locator('[data-spinth-popover-panel] button[aria-label="4 像素线宽"]').click();
  await expect.poll(lineWidthOf).toBe(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(lineWidthOf).toBe(8);
});

test('pen 常驻二级菜单：默认颜色切换 + 新笔随色（swatch 型选中圈）', async ({ page }) => {
  const docId = `e2e-toolbar-pen-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const penOf = () =>
    page.evaluate(() => {
      const p = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates
        .filter((v) => String(v.type) === 'PEN')
        .at(-1) as { color?: string; strokeWidth?: number } | undefined;
      return p ? `${p.color}:${p.strokeWidth ?? 'def'}` : '';
    });

  // 1. 'p' 激活 → 面板现身（两组：色 6 + 笔宽 4 = 10 项；#1f2937/4 像素笔宽默认选中）
  await page.keyboard.press('p');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('button[role="menuitemradio"]')).toHaveCount(10);
  await expect(flyout.locator('button[aria-checked="true"][aria-label="#1f2937"]')).toHaveCount(1);
  await expect(flyout.locator('button[aria-checked="true"][aria-label="4 像素笔宽"]')).toHaveCount(
    1,
  );

  // 2. 切红色 → 聚合探针 + 选中圈移动（swatch ring），面板保持（pen 落笔不回 cursor）
  await flyout.locator('button[aria-label="#dc2626"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
            }
          ).__spinth.__debug.defaultToolOptions['pen']?.['color'],
      ),
    )
    .toBe('#dc2626');
  await expect(flyout.locator('button[aria-checked="true"][aria-label="#dc2626"]')).toHaveCount(1);
  await expect(flyout).toBeVisible();

  // 3. 画一笔 → 新笔 color = #dc2626、默认档笔宽零字段（vmStates 回落 4）
  //    （步间 80ms 保 60ms 采样出点——eraser 批先例）
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(400 + i * 40, 300 + i * 10, { steps: 1 });
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  await expect.poll(penOf).toBe('#dc2626:4');

  // 4. 笔宽组切 12 → 聚合探针 → 再画一笔 strokeWidth=12 落库（非默认档显式写）
  await flyout.locator('button[aria-label="12 像素笔宽"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
            }
          ).__spinth.__debug.defaultToolOptions['pen']?.['width'],
      ),
    )
    .toBe('12');
  await page.mouse.move(500, 500);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(500 + i * 30, 500, { steps: 1 });
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  await expect.poll(penOf).toBe('#dc2626:12');

  // 5. 选中该笔 → ActionBar 笔宽 popover 改 8 → undo 单步回 12
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(555, 500); // 第二笔 screen y=500（起笔 screen 500 → world 456）——线上中段
  const bar = page.locator('[data-spinth-action-bar]');
  await bar.locator('button[aria-label="笔宽"]').click();
  await page.locator('[data-spinth-popover-panel] button[aria-label="8 像素笔宽"]').click();
  await expect.poll(penOf).toBe('#dc2626:8');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(penOf).toBe('#dc2626:12');
});

test('sticky 常驻二级菜单：默认底色切换 + 新便签随色', async ({ page }) => {
  const docId = `e2e-toolbar-sticky-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const stickyOf = () =>
    page.evaluate(() => {
      const p = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => String(v.type) === 'STICKY') as
        { color?: string } | undefined;
      return p?.color ?? '';
    });

  // 1. 's' 激活 → 面板现身（四色 swatch；#fff3b0 默认选中）
  await page.keyboard.press('s');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('button[aria-checked="true"]')).toHaveAttribute(
    'aria-label',
    '#fff3b0',
  );

  // 2. 切蓝 → 聚合探针 + 选中圈移动；单击创建（sticky 单击即可建 180×180）
  await flyout.locator('button[aria-label="#c9e3f7"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
            }
          ).__spinth.__debug.defaultToolOptions['sticky']?.['color'],
      ),
    )
    .toBe('#c9e3f7');
  await page.mouse.click(500, 350); // 单击建便签（sticky 单击 = 默认尺寸创建）
  await expect.poll(stickyOf).toBe('#c9e3f7');
  // 单击创建不回 cursor（基类仅拖拽分支选中新件回 cursor）→ 面板保持；
  // Escape 取消工具 → 派生隐藏
  await expect(flyout).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('cursor');
  await expect(flyout).toBeHidden();
});

test('text 常驻二级菜单：默认字号切换 + 新文本随档（text 型选项）', async ({ page }) => {
  const docId = `e2e-toolbar-text-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const textState = () =>
    page.evaluate(() => {
      const t = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((v) => String(v.type) === 'TEXT') as
        { fontSize?: number; height?: number } | undefined;
      return t ? { fontSize: t.fontSize, height: t.height } : null;
    });

  // 1. 't' 激活 → 面板现身（text 型七档含 STICKY 默认 15；16 号默认选中）
  await page.keyboard.press('t');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('button[aria-checked="true"]')).toHaveAttribute(
    'aria-label',
    '16 号',
  );

  // 2. 切 24 号 → 聚合探针（值字符串化）+ 选中圈移动
  await flyout.locator('button[aria-label="24 号"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
            }
          ).__spinth.__debug.defaultToolOptions['text']?.['fontSize'],
      ),
    )
    .toBe('24');

  // 3. 保持 text 工具激活直接点击画布（点击即创建即编辑）→ fontSize 落库 24 +
  //    几何随档（height = 24×1.5 + 2×8 = 52；面板在创建回 cursor 后派生隐藏）
  await page.mouse.click(500, 350);
  await page.waitForTimeout(300);
  const st = await textState();
  expect(st?.fontSize).toBe(24);
  expect(st?.height).toBe(24 * 1.5 + 16); // 高度初值公式随会话字号（docs/04 §2）
});

test('eraser 常驻二级菜单：大小档直设 + 圆指示即刻跟随 + 方括号共存', async ({ page }) => {
  const docId = `e2e-toolbar-eraser-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const radius = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __spinth: {
              __debug: { eraserRadius: number; defaultToolOptions: Record<string, string> };
            };
          }
        ).__spinth.__debug.eraserRadius,
    );
  const aggRadius = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __spinth: { __debug: { defaultToolOptions: Record<string, Record<string, string>> } };
          }
        ).__spinth.__debug.defaultToolOptions['eraser']?.['size'],
    );

  // 1. 'e' 激活 → 面板现身（圆点梯度五档；10px 不在档位表 → 无选中态，符合语义）
  await page.keyboard.press('e');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('button[role="menuitemradio"]')).toHaveCount(5);
  // 单排布局守卫（≤8 项走 flex 单行）：塌缩回归时五项竖排高 180+（29 轮审查）
  const eh = await flyout.evaluate((el) => el.offsetHeight);
  expect(eh).toBeLessThanOrEqual(60);

  // 2. 点选 24px → 旧探针 eraserRadius + 聚合表双通道同步（即刻生效——工具参数）
  await flyout.locator('button[aria-label="24px"]').click();
  await expect.poll(radius).toBe(24);
  await expect.poll(aggRadius).toBe('24');

  // 3. 方括号共存：']' 相对步进 +4 → 28（钳制域内），聚合表跟随
  await page.keyboard.press(']');
  await expect.poll(radius).toBe(28);
  await expect.poll(aggRadius).toBe('28');

  // 4. Escape 取消工具 → 面板派生隐藏
  await page.keyboard.press('Escape');
  await expect(flyout).toBeHidden();
});

test('形状 20 型：新型切换 + 带字建件内接 + undo（扩展批守卫）', async ({ page }) => {
  const docId = `e2e-toolbar-12shapes-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const flyout = page.locator('[data-spinth-tool-flyout]');
  const shapeState = () =>
    page.evaluate(() => {
      // 取最后一个 SHAPE（第 3 段新建的是第二件——首件停留在 triangle-up）
      const s = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates
        .filter((v) => String(v.type) === 'SHAPE')
        .at(-1)!;
      return {
        shapeType: String(s.shapeType),
        height: Number(s.height),
        text: String(s.text ?? ''),
      };
    });

  // 1. 默认型切「上三角」→ 拖建 → 新件 triangle-up
  await page.keyboard.press('r');
  await expect(flyout).toBeVisible();
  await flyout.locator('button[aria-label="上三角"]').click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await shapeState()).shapeType).toBe('triangle-up');

  // 2. 选中 → 带字内接（上三角下半中心箱）+ 切「数据库」按型重排 + undo 逐态
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  const c = await centerOf(page, 'SHAPE');
  await page.mouse.click(c.x, c.y); // 创建即选中回 cursor——单击已选中进编辑
  await expect(editor).toHaveCSS('opacity', '1');
  await page.keyboard.type('数据');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await shapeState()).text).toContain('数据');
  // 切数据库型（ActionBar 图形类型 popover）
  await page.locator('[data-spinth-action-bar] button[aria-label="图形类型"]').click();
  await page.locator('[data-spinth-popover-panel] button[aria-label="数据库"]').click();
  await expect.poll(async () => (await shapeState()).shapeType).toBe('eng-database');
  // autoHeight 公式（eng-database = textH + 108 + 30）：单行 24px 文本 → 162
  await expect.poll(async () => (await shapeState()).height).toBeGreaterThanOrEqual(160);
  // undo 一步：型与文字同回（切型单事务守卫）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await shapeState()).shapeType).toBe('triangle-up');

  // 3. 流程图八型守卫：切「起止」建胶囊 → 双击改选「页连接」重排 + undo
  await page.keyboard.press('r'); // undo/编辑后已回 cursor——重新激活形状工具
  await expect(flyout).toBeVisible();
  await flyout.locator('button[aria-label="起止"]').click();
  await page.mouse.move(400, 500);
  await page.mouse.down();
  await page.mouse.move(520, 580, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await shapeState()).shapeType).toBe('stadium');
  await page.locator('[data-spinth-action-bar] button[aria-label="图形类型"]').click();
  await page.locator('[data-spinth-popover-panel] button[aria-label="页连接"]').click();
  await expect.poll(async () => (await shapeState()).shapeType).toBe('off-page');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await shapeState()).shapeType).toBe('stadium');
});

test('390px 移动端：二级菜单 portal/fixed + 视口 clamp——完全可点（第三轮审查修复）', async ({
  page,
}) => {
  const docId = `e2e-390-${Date.now()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 激活笔工具（多组面板：颜色+笔宽——此前 absolute 被 overflow-x-auto 裁掉，
  // 审查实测 flyout.x=-114 完全出屏不可点）
  await page.keyboard.press('p');
  const flyout = page.locator('[data-spinth-tool-flyout]');
  await expect(flyout).toBeVisible();

  const box = await flyout.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);

  // 可点性判据（审查同款）：面板中心 elementFromPoint 命中面板自身非画布
  const hitSelf = await page.evaluate(
    async ({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy);
      return !!el?.closest('[data-spinth-tool-flyout]');
    },
    { cx: box!.x + box!.width / 2, cy: box!.y + box!.height / 2 },
  );
  expect(hitSelf).toBe(true);

  // 点选首个选项——面板保持（真交互，非仅可见；纯派生可见性不因点选卸载）
  await flyout.locator('button[role="menuitemradio"]').first().click();
  await expect(flyout).toBeVisible();
  // e2e 卫生：清本例 doc 库
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
});
