import { expect, test, type Page } from '@playwright/test';

/**
 * 视觉快照回归（docs/15 §4，盘点 P3——此前像素级视觉验证为零）：
 * 只收「稳定可重现」场景——主题双态整帧、marks 富文本渲染、连线镂空。
 * 数据探针优先的纪律不变（docs/15 §3），本篇是补充层：颜色/粗细/镂空等
 * 纯视觉行为数据探针天然测不到。gate fast 层 grep-invert 跳过；视觉由
 * nightly/手动 visual job 容器校验（specs/linux-visual），darwin 本地直接跑。
 */

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  // 环境预检（specs/linux-visual §5.5/§10.1）：只影响失败信息，不改变像素。
  // WebGL 用离屏 canvas 探测环境能力——复用 app 的 canvas 会因上下文类型不同拿到 null。
  const env = await page.evaluate(() => {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    return { dpr: window.devicePixelRatio, webgl: !!gl };
  });
  if (env.dpr !== 1) {
    throw new Error(
      `视觉环境断言失败：devicePixelRatio 应为 1，实际 ${env.dpr}（specs/linux-visual §10.1）`,
    );
  }
  if (!env.webgl) {
    throw new Error(
      '视觉环境断言失败：WebGL 不可用——容器内检查 E2E_VISUAL_CHANNEL=bundled 的 SwiftShader flags（specs/linux-visual §5.5）',
    );
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const canvasClip = { x: 0, y: 44, width: 1440, height: 856 };

test('视觉快照 @visual：delay 扁高守界（30×240 退化窄月牙不出 bbox——32 轮 🟠-2 沉淀）', async ({
  page,
}) => {
  const docId = `e2e-vis-delay-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 1. 建 delay 120×80（世界 400,200）→ Escape 回 cursor
  const flyout = page.locator('[data-spinth-tool-flyout]');
  await page.keyboard.press('r');
  await flyout.locator('button[aria-label="延迟"]').click();
  await page.mouse.move(400, 244);
  await page.mouse.down();
  await page.mouse.move(520, 324, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  // 2. 点击选中 → 拖东南角把手 resize 至 30×240（世界右下 520,280 → 430,440）
  await page.mouse.click(460, 284);
  await page.waitForTimeout(150);
  await page.mouse.move(520, 324);
  await page.mouse.down();
  await page.mouse.move(430, 484, { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(200);

  // 3. 数据探针：30×240 精确落库（绘制守界走快照；WebGL 无 preserveDrawingBuffer
  //    不可 drawImage 读回——33 轮审查坑②）
  const st = await page.evaluate(() => {
    const s0 = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, number | string>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => String(v.shapeType) === 'delay')!;
    return { w: Number(s0.width), h: Number(s0.height) };
  });
  expect(st).toEqual({ w: 30, h: 240 });

  // 4. Escape 清选中（选中把手凸出 bbox 左缘会假阳性——33 轮审查坑①）后截图
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await expect(page.locator('canvas').first()).toHaveScreenshot('delay-tall.png', {
    clip: { x: 290, y: 234, width: 160, height: 260 }, // 世界 400,200 起局部（含描边余量）
    animations: 'disabled',
  });
});

test('视觉快照 @visual：主题双态整帧（同文档 light/dark）', async ({ page }) => {
  const docId = `e2e-vis-theme-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 画布固定内容：一矩形 + 一文字（含 marks）——主题只影响底色/点阵/默认文字色
  await page.keyboard.press('r');
  await page
    .locator('canvas')
    .first()
    .hover({ position: { x: 500, y: 250 } });
  await page.mouse.down();
  await page.mouse.move(660, 380, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 600, y: 500 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  await editor.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<p>浅色态主题探针<strong>粗</strong></p>');
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await page.keyboard.press('Escape');
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __spinthDebug: { __debug: { vmStates: Array<{ type: string; text?: string }> } };
          }
        ).__spinthDebug.__debug.vmStates.some(
          (s) => s.type === 'TEXT' && String(s.text ?? '').includes('主题探针'),
        ),
      ),
    )
    .toBe(true);

  await expect(page.locator('canvas').first()).toHaveScreenshot('theme-light.png', {
    clip: canvasClip,
  });

  // 切深色 → 整帧对比（底色/点阵/默认文字色全变）
  await page.evaluate(() => {
    localStorage.setItem('spinth.theme', 'dark');
    window.location.reload();
  });
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('canvas').first()).toHaveScreenshot('theme-dark.png', {
    clip: canvasClip,
  });
});

test('视觉快照 @visual：marks 渲染（粗体/斜体/下划线/彩色落画布——像素级验证）', async ({
  page,
}) => {
  const docId = `e2e-vis-marks-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 500, y: 300 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  await editor.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<p>普通<strong>粗体标记</strong><em>斜体样式</em><u>下划线样式</u><span style="color: #dc2626">红色文字</span><span style="color: #2563eb">蓝色文字</span>尾</p>',
    );
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await page.keyboard.press('Escape'); // 退出编辑 → 画布渲染接管
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const spans = (
          window as unknown as {
            __spinthDebug: {
              __debug: {
                textSpans: Array<{
                  bold?: boolean;
                  italic?: boolean;
                  underline?: boolean;
                  color?: string;
                }>;
              };
            };
          }
        ).__spinthDebug.__debug.textSpans;
        return (
          spans.some((s) => s.bold === true) &&
          spans.some((s) => s.italic === true) &&
          spans.some((s) => s.underline === true)
        );
      }),
    )
    .toBe(true);

  // 文字控件区域截图（粗细/斜体/下划线是纯视觉行为——textSpans 探针只证数据在；
  // 下划线为 pixi 无原生能力的手绘 Graphics，位置/线宽以此快照为视觉定稿依据）
  const b = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmStates: Array<{ type: string; x: number; y: number; width: number; height: number }>;
          };
        };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => v.type === 'TEXT')!;
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  });
  await expect(page.locator('canvas').first()).toHaveScreenshot('marks-render.png', {
    clip: {
      x: Math.max(0, b.x - 20),
      y: Math.max(44, b.y - 20 + 44),
      width: b.width + 40,
      height: b.height + 40,
    },
  });
});

test('视觉快照 @visual：矩形旋转 45°（pivot 渲染 + 旋转框视觉——rotate 批）', async ({ page }) => {
  const docId = `e2e-vis-rotate-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 1. 建矩形 160×100（世界 420,260）→ Escape
  await page.keyboard.press('r');
  await page.mouse.move(420, 304);
  await page.mouse.down();
  await page.mouse.move(580, 404, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  // 2. 选中 → 拖旋转柄 +45°（柄 = n 边中点外浮；终点 = 起点向量旋转 45°）
  const probe = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmStates: Array<Record<string, unknown>>;
            rotateHandle: { x: number; y: number };
          };
        };
      }
    ).__spinthDebug.__debug;
    const s0 = d.vmStates.find((v) => String(v.type) === 'SHAPE')!;
    return {
      x: s0.x as number,
      y: s0.y as number,
      w: s0.width as number,
      h: s0.height as number,
      hdl: d.rotateHandle,
    };
  });
  const c = await page.evaluate(
    ([cx, cy]) => {
      // 世界 → 屏幕走公开查询 toScreenPoint（specs/runtime-narrowing §3.8）
      const s = (
        window as unknown as {
          __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
        }
      ).__spinth.toScreenPoint({ x: cx, y: cy });
      return { x: Math.round(s.x), y: Math.round(s.y + 44) };
    },
    [probe.x + probe.w / 2, probe.y + probe.h / 2],
  );
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(150);
  const hs = await page.evaluate(
    ([,]) => {
      const p = (
        window as unknown as {
          __spinthDebug: { __debug: { rotateHandle: { x: number; y: number } } };
        }
      ).__spinthDebug.__debug.rotateHandle;
      const s = (
        window as unknown as {
          __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
        }
      ).__spinth.toScreenPoint({ x: p.x, y: p.y });
      return { x: Math.round(s.x), y: Math.round(s.y + 44) };
    },
    [0],
  );
  const rad = Math.PI / 4;
  const sv = { x: hs.x - c.x, y: hs.y - c.y };
  const end = {
    x: c.x + sv.x * Math.cos(rad) - sv.y * Math.sin(rad),
    y: c.y + sv.x * Math.sin(rad) + sv.y * Math.cos(rad),
  };
  await page.mouse.move(hs.x, hs.y);
  await page.mouse.down();
  await page.mouse.move(Math.round(end.x), Math.round(end.y), { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(250);

  // 3. 数据探针：θ ≈ π/4 落库
  const rot = await page.evaluate(() => {
    const s0 = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE')!;
    return Number(s0.rotation ?? 0);
  });
  expect(rot).toBeCloseTo(Math.PI / 4, 2);

  // 4. Escape 清选中（旋转框/手柄凸出会假阳性）后截控件区域
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot('rotate-45.png', {
    clip: { x: probe.x - 60, y: probe.y + 44 - 60, width: probe.w + 120, height: probe.h + 120 },
  });
});
