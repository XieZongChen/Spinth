import { expect, test, type Page } from '@playwright/test';
import { barPick, createRect } from './helpers/widgetProbeE2e';

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

test('视觉快照 @visual：矩形旋转 45°（pivot 渲染——已旋转旧文档像素基线）', async ({ page }) => {
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

  // 2. 数据注入精确 45°（旋转手柄入口暂隐藏，specs/rotate-hide；注入等价已旋转
  //    的旧文档，真实 update 管线）
  const probe = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: { vmStates: Array<Record<string, unknown>> };
        };
      }
    ).__spinthDebug.__debug;
    const s0 = d.vmStates.find((v) => String(v.type) === 'SHAPE')!;
    return {
      id: String(s0.id),
      x: s0.x as number,
      y: s0.y as number,
      w: s0.width as number,
      h: s0.height as number,
    };
  });
  await page.evaluate(
    ([id, r]) => {
      (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              engine: { getModelById(k: string): { update(p: Record<string, unknown>): void } };
            };
          };
        }
      ).__spinthDebug.__debug.engine
        .getModelById(id as string)
        .update({ rotation: r as number });
    },
    [probe.id, Math.PI / 4] as const,
  );
  await page.waitForTimeout(250);

  // 3. 数据探针：θ = π/4 落库（注入为精确值）
  const rot = await page.evaluate(() => {
    const s0 = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE')!;
    return Number(s0.rotation ?? 0);
  });
  expect(rot).toBeCloseTo(Math.PI / 4, 6);

  // 4. 截控件区域（无选中，不含旋转框/手柄）
  await expect(page).toHaveScreenshot('rotate-45.png', {
    clip: { x: probe.x - 60, y: probe.y + 44 - 60, width: probe.w + 120, height: probe.h + 120 },
  });
});

test('视觉快照 @visual：流程图样本（S1 白底黑框 + 回边 + 线上标签，specs/flowchart-closeout §18.2）', async ({
  page,
}) => {
  const docId = `e2e-vis-flowchart-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // S1 场景（spec §19.1）：stadium 起止 / 菱形判定 / 矩形过程 三节点 +
  // 两条正向锚定线 + 一条回边（C 底 → A 右）+ 三处线上标签。
  // 世界坐标：A 480..600/218..298，B 菱形 660..780/400..480，C 920..1040/400..480。
  // 形状工具一次创建后即回 cursor（连线工具才保持激活）——用 createRect 每件点按钮
  await createRect(page, 540, 302); // A（屏幕中心 540,302）
  await createRect(page, 720, 484); // B
  await createRect(page, 980, 484); // C
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  // A 切起止（stadium）、B 切菱形（决策节点）：选中 → 图形类型
  await page.mouse.click(540, 282); // A 中心
  await page.waitForTimeout(200);
  await barPick(page, '图形类型', '起止');
  await page.waitForTimeout(200);
  await page.mouse.click(720, 484); // B 中心（世界 720,440）
  await page.waitForTimeout(200);
  await barPick(page, '图形类型', '菱形');
  await page.waitForTimeout(200);

  // S1 白底黑框：三个节点统一 填充 #ffffff + 边框 #000000 + 2px
  for (const [cx, cy] of [
    [540, 282],
    [720, 484],
    [980, 484],
  ]) {
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(150);
    await barPick(page, '填充色', '#ffffff');
    await barPick(page, '边框色', '#000000');
    await barPick(page, '边框宽', '2 px');
    await page.waitForTimeout(150);
  }

  // 锚定连线 ×3：A 底 → B 顶；B 右 → C 左；回边 C 底 → A 右（默认 ELBOWED + 终点箭头）
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(540, 336); // A 底边内侧（世界 540,292）
  await page.mouse.down();
  await page.mouse.move(720, 452, { steps: 5 }); // B 顶边内侧（世界 720,408）
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.mouse.move(774, 484); // B 右缘内侧（世界 774,440）
  await page.mouse.down();
  await page.mouse.move(926, 484, { steps: 5 }); // C 左缘内侧（世界 926,440）
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.mouse.move(980, 518); // C 底边内侧（世界 980,474）
  await page.mouse.down();
  await page.mouse.move(598, 280, { steps: 6 }); // A 右缘内侧（世界 598,236）
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // 清工具与选中（不含手柄/ActionBar）
  await page.waitForTimeout(150);

  // 三处线上标签（spec §18.2 S1：双击线身 → 输入 → Esc）。线序 = 创建序：
  // 0 = A→B、1 = B→C、2 = 回边。双击点取该线**各段中点中距其他线段 >14px 的
  // 第一个**（按段长降序）——回边走廊会穿过其他线的主段中点，命中取 top
  // 会把标签打到别的线上（实测 x=630 回边竖段挡住 A→B 主段中点）
  const allLinePts = async (): Promise<Array<Array<[number, number]>>> =>
    page.evaluate(() =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates
        .filter((v) => String(v.type) === 'LINE')
        .map(
          (v) =>
            ((v as { points?: Array<[number, number]> }).points ?? []) as Array<[number, number]>,
        ),
    );
  const distToSeg = (px: number, py: number, a: [number, number], b: [number, number]): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  };
  const pickDblclickAt = (
    pts: Array<[number, number]>,
    others: Array<Array<[number, number]>>,
  ): { x: number; y: number } => {
    const segs = pts.slice(0, -1).map((p, i) => ({
      len: Math.hypot(pts[i + 1]![0] - p[0], pts[i + 1]![1] - p[1]),
      a: p,
      b: pts[i + 1]!,
    }));
    segs.sort((s, t) => t.len - s.len);
    for (const s of segs) {
      const mx = (s.a[0] + s.b[0]) / 2;
      const my = (s.a[1] + s.b[1]) / 2;
      const blocked = others.some((o) =>
        o.slice(0, -1).some((p, j) => distToSeg(mx, my, p, o[j + 1]!) <= 14),
      );
      if (!blocked) return { x: mx, y: my + 44 }; // canvas 顶栏偏移
    }
    const f = segs[0]!;
    return { x: (f.a[0] + f.b[0]) / 2, y: (f.a[1] + f.b[1]) / 2 + 44 };
  };
  for (const [i, label] of ['请求', '判定', '回退'].entries()) {
    const lines = await allLinePts();
    const at = pickDblclickAt(
      lines[i] ?? [],
      lines.filter((_, j) => j !== i),
    );
    await page.mouse.dblclick(at.x, at.y);
    await page.keyboard.type(label);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    // 标签必达（否则基线静默缺标签）：双击点被其他线抢占时 fail-fast
    const texts = await page.evaluate(() =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates
        .filter((v) => String(v.type) === 'LINE')
        .map((v) => String(v.text ?? '')),
    );
    if (!(texts[i] ?? '').includes(label)) {
      throw new Error(
        `线上标签「${label}」未落库（texts=${JSON.stringify(texts)} pts=${JSON.stringify(lines)} at=${JSON.stringify(at)}）`,
      );
    }
  }
  // 清选区（双击退编辑后仍单选——手柄/ActionBar 不入镜）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // page 级 clip（locator 级 toHaveScreenshot 的 clip 选项被忽略——基线曾是
  // 整画布 1440×856，specs/flowchart-closeout 返工；rotate 用例同款 page 级写法）
  await expect(page).toHaveScreenshot('flowchart-sample.png', {
    clip: { x: 380, y: 224, width: 700, height: 380 }, // 世界 380..1080 / 180..560
  });
});
