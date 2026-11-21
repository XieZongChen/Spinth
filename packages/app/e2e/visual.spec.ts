import { expect, test, type Page } from '@playwright/test';
import { barPick, createRect } from './helpers/widgetProbeE2e';
import type { Probe } from './helpers/mindProbeE2e';

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

  // 4. Escape 清选中（选中把手凸出 bbox 左缘会假阳性——33 轮审查坑①）后截图。
  //    page 级 clip（locator 级 toHaveScreenshot 忽略 clip，旧基线实为整画布
  //    含工具坞 DOM——UI 改动会误伤本用例，specs/flowchart-closeout 二轮返工）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot('delay-tall.png', {
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

  // 整帧是设计意图（底色/点阵/默认文字色全在画布上），但**清选区后再截**——
  // 退出编辑仍单选会带 ActionBar/手柄入镜，ActionBar 改动会误伤主题基线
  // （一轮返工 theme-light 变/dark 不变的根因，specs/linux-visual §14.10）
  await page.keyboard.press('Escape'); // 再一次 Esc：清选区（退出编辑的 Esc 已按过）
  await page.waitForTimeout(200);
  await expect(page.locator('canvas').first()).toHaveScreenshot('theme-light.png', {
    clip: canvasClip,
  });

  // 切深色 → 整帧对比（底色/点阵/默认文字色全变）；reload 后无选中态
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
  // 下划线为 pixi 无原生能力的手绘 Graphics，位置/线宽以此快照为视觉定稿依据）。
  // page 级 clip（locator 级忽略 clip——旧基线实为整画布含工具坞 DOM，
  // specs/flowchart-closeout 二轮返工）
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
  await expect(page).toHaveScreenshot('marks-render.png', {
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
  // 容器慢机实测 25s+（darwin 24.6s 贴线）——30s 全局超时在 linux 容器两连
  // 溢出（4.3 批实证）；场景级提到 60s，超时保护仍在
  test.setTimeout(60_000);
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

/** 脑图基线样本（specs/tree-diagrams §14.3，Phase 2）：根 + 右 2 层 + 左 1 层。
 *  建图锚点 (500,300)；清选区后截画布区（DOM chrome 不入镜）。 */
async function buildMindSample(page: Page, vertical: boolean): Promise<void> {
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250); // 根编辑器自动打开
  // 编辑器内连 Tab：根→A→A1（右侧/下侧链 3 层）
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (vertical) {
    // 选中根（建图锚点固定）→ 排列方向 → 上下
    await page.mouse.click(560, 320);
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '排列方向' }).click();
    await page.getByRole('menuitemradio', { name: '上下' }).click();
    await page.waitForTimeout(300);
  }
  // 左侧（上侧）分支：焦点根 → Tab with 'left' 不可行（快捷键无侧向）——
  // 经 AddButtons 左钮：点根 → data-spinth-mind-add=left
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.mouse.click(560, 320);
  await page.waitForTimeout(250);
  await page.click('[data-spinth-mind-add="left"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

test('视觉快照 @visual：脑图横向样本（根 + 右链 3 层 + 左分支，specs/tree-diagrams §14.3）', async ({
  page,
}) => {
  const docId = `e2e-vis-mind-h-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await buildMindSample(page, false);
  await expect(page).toHaveScreenshot('mind-horizontal.png', {
    clip: { x: 120, y: 150, width: 1100, height: 480 },
  });
});

test('视觉快照 @visual：脑图竖向样本（同树切上下——转置镜像，specs/tree-diagrams §14.3）', async ({
  page,
}) => {
  const docId = `e2e-vis-mind-v-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await buildMindSample(page, true);
  await expect(page).toHaveScreenshot('mind-vertical.png', {
    clip: { x: 300, y: 80, width: 860, height: 660 },
  });
});

/** 网络拓扑基线样本（specs/network-diagram §12.2，4.3）：
 *  云区域（无填充虚线框 + 标题）+ 10 设备（含防火墙着色）+ 正交避障链路 +
 *  线上标签。设备/区域批量走 dev engine（bench 先例）；线一律 UI 拉线
 *  （锚定/避障语义必须走真实手势，裸 add 不触发 reattach——network.spec
 *  前置实证）；标签经 model.update 直写 text。清选区后 clip 到内容截图。 */
test('视觉快照 @visual：网络拓扑样本（云区域 + 10 设备 + 正交链路 + 线上标签，specs/network-diagram §12.2）', async ({
  page,
}) => {
  const docId = `e2e-vis-net-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  // 搭建含 9 次 v→l 清态切换 + 逐条拉线，darwin ~23s、容器慢机超 30s 全局线
  // （flowchart-sample 同款处置）；场景搭建批量化降时后回落
  test.setTimeout(60_000);

  // 10 设备 + 区域（无填充虚线）+ 标题（specs/network-diagram §4/§5.1）
  const sym = (
    id: string,
    symbol: string,
    label: string,
    cx: number,
    cy: number,
    color?: string,
  ) => ({
    id,
    type: 'SYMBOL',
    symbol,
    label,
    x: cx - 50,
    y: cy - 63,
    width: 100,
    height: 126,
    ...(color ? { color } : {}),
  });
  await page.evaluate(
    (ws) => {
      const d = (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              engine: {
                transact(fn: () => void): void;
                add(w: unknown): void;
                genInitialOrder(): string;
              };
            };
          };
        }
      ).__spinthDebug.__debug;
      d.engine.transact(() => {
        for (const w of ws) d.engine.add({ zOrder: d.engine.genInitialOrder(), ...w });
      });
    },
    [
      sym('v-internet', 'net-internet', 'Internet', 160, 160),
      sym('v-user', 'net-user', '办公网用户', 160, 360),
      sym('v-fw', 'net-firewall', '防火墙', 340, 160, '#dc2626'), // 短标签：96px 带宽下 darwin/linux 字体度量差异会把「DMZ 防火墙」截成两截
      sym('v-lb', 'net-load-balancer', 'LB-01', 340, 360),
      sym('v-cloud', 'net-cloud', '公有云', 480, 360),
      {
        id: 'v-zone',
        type: 'SHAPE',
        shapeType: 'rect',
        color: '#e8f0fb',
        borderStyle: 'dashed',
        borderWidth: 1,
        fill: 'none',
        autoHeight: false,
        x: 560,
        y: 60,
        width: 520,
        height: 460,
      },
      {
        id: 'v-zone-title',
        type: 'TEXT',
        text: '<p>生产 VPC</p>',
        x: 572,
        y: 68,
        width: 160,
        height: 40,
      },
      sym('v-router', 'net-router', '核心路由', 620, 160),
      sym('v-switch', 'net-switch', '接入交换', 780, 160),
      sym('v-db', 'net-database', '主库', 940, 160),
      sym('v-web1', 'net-server', 'Web-01', 620, 340),
      sym('v-storage', 'net-storage', '对象存储', 940, 340),
    ],
  );
  await page.waitForTimeout(500);

  // 9 条链路（UI 拉线）。起止点沿 A→B 方向各从中心偏移 40px——指针落在
  // 图形区内但不在正中心（nearestJoin 对 dx=dy=0 恒落 top，中心拉线会绕到
  // 图形上方穿过标题/标签，与 spec §14「侧上方进入」口径相反——审查返工）
  await page.keyboard.press('l');
  const LINKS: Array<[number, number, number, number, string | null]> = [
    [160, 160, 340, 160, '<p>HTTPS 443</p>'], // 互联网→防火墙
    [160, 360, 340, 160, null], // 用户→防火墙
    [340, 160, 340, 360, null], // 防火墙→负载均衡
    [340, 360, 480, 360, null], // 负载均衡→云
    [480, 360, 620, 160, null], // 云→路由器（穿区域框——无填充豁免）
    [620, 160, 780, 160, null], // 路由器→交换机
    [780, 160, 620, 340, null], // 交换机→Web-01
    [780, 160, 940, 160, '<p>3306</p>'], // 交换机→数据库
    [940, 160, 940, 340, '<p>同步</p>'], // 数据库→存储
  ];
  const edgePoints = (
    a: [number, number],
    b: [number, number],
  ): [number, number, number, number] => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / d;
    const uy = (b[1] - a[1]) / d;
    const off = Math.min(40, d / 2 - 10);
    return [a[0] + ux * off, a[1] + uy * off, b[0] - ux * off, b[1] - uy * off];
  };
  for (let li = 0; li < LINKS.length; li++) {
    const [ax, ay, bx, by] = LINKS[li]!;
    // 上条线的选中/hover 态（ActionBar、宿主 quickDots）会让下一条的 down 被吞
    // （Esc 会退出连线工具——用 v→l 切换清态，实测连拉 9 条稳定）
    if (li > 0) {
      await page.keyboard.press('v');
      await page.keyboard.press('l');
      await page.waitForTimeout(120);
    }
    const [x1, y1, x2, y2] = edgePoints([ax, ay], [bx, by]);
    await page.mouse.move(x1, y1 + 44);
    await page.mouse.down();
    await page.mouse.move(x2, y2 + 44, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(160);
  }
  // 线上标签：按拉线顺序读线 id，model.update 直写 text（textRatio 缺省 0.5）
  await page.evaluate(
    (labels) => {
      const d = (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              vmStates: Array<{ id: string; type: string }>;
              engine: { getModelById(id: string): { update(p: unknown): void } };
            };
          };
        }
      ).__spinthDebug.__debug;
      const lineIds = d.vmStates.filter((s) => s.type === 'LINE').map((s) => s.id);
      for (const [i, text] of labels) d.engine.getModelById(lineIds[i]!)!.update({ text });
    },
    LINKS.map((l, i) => [i, l[4]]).filter(([, t]) => t !== null),
  );
  await page.waitForTimeout(400);

  // fail-fast 数据断言（基线静默缺件比截图diff更早暴露）
  const census = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug;
    const c = (t: string) => d.vmStates.filter((s) => s.type === t).length;
    return { sym: c('SYMBOL'), line: c('LINE'), shape: c('SHAPE'), text: c('TEXT') };
  });
  expect(census).toEqual({ sym: 10, line: 9, shape: 1, text: 1 });
  await page.keyboard.press('Escape'); // 退出连线工具
  await page.keyboard.press('Escape'); // 清选区/收 ActionBar
  await page.waitForTimeout(200);

  // 内容 bbox = x 112..1080 / y 60..520，外扩 24
  await expect(page).toHaveScreenshot('network-sample.png', {
    clip: { x: 88, y: 80, width: 1016, height: 508 },
  });
});

/** 组织架构基线样本（specs/tree-diagrams §14.3，Phase 3）：
 *  CEO → 3 部门 → 2 组（一分支折叠）。建图 (500,300)；清选区截画布区。 */
test('视觉快照 @visual：组织架构样本（层级对齐 + 正交总线 + 折叠徽标，specs/tree-diagrams §14.3）', async ({
  page,
}) => {
  const docId = `e2e-vis-org-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.keyboard.press('o');
  await page.mouse.click(500, 300);
  await page.waitForTimeout(300); // 根编辑器自动打开

  // 三部门：编辑器内 Escape → 根焦点下 AddButtons child 槽连点（跟焦点，
  // 每次点「当前焦点」的下槽 = 逐层下钻会成链——改为点 sibling 槽成兄弟）
  await page.keyboard.press('Tab'); // 部门 A（焦点 A）
  await page.waitForTimeout(150);
  await page.click('[data-spinth-mind-add="sibling"]'); // 部门 B（焦点 B）
  await page.waitForTimeout(200);
  await page.click('[data-spinth-mind-add="sibling"]'); // 部门 C（焦点 C）
  await page.waitForTimeout(200);
  // 部门 A 下两组：↑ 回根 ← 到 A（前兄弟）→ child 槽 ×2（跟焦点成 A1、A1 的 sibling A2）
  await page.keyboard.press('ArrowUp'); // 根
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowLeft'); // C→B→A？——不跨叔语义：根的前兄弟无 → 直接经探针更稳
  await page.waitForTimeout(120);
  // 用探针定位 A（x 最小的部门）点击选中后建组
  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const kids = d.mindNodes.slice(1).filter((n) => n.worldRect.y === d.mindNodes[1]!.worldRect.y);
    const a = kids.reduce((m, n) => (n.worldRect.x < m.worldRect.x ? n : m));
    return {
      x: c.left + a.worldRect.x + a.worldRect.width / 2,
      y: c.top + a.worldRect.y + a.worldRect.height / 2,
      id: a.id,
    };
  });
  await page.keyboard.press('Escape'); // 清选区（防再点已选中进编辑）
  await page.waitForTimeout(150);
  await page.mouse.click(geo.x, geo.y); // 选中 A
  await page.waitForTimeout(250);
  await page.click('[data-spinth-mind-add="child"]'); // 组 1（焦点组 1；org 槽位无侧）
  await page.waitForTimeout(200);
  await page.click('[data-spinth-mind-add="sibling"]'); // 组 2
  await page.waitForTimeout(200);
  // 折叠 A（徽标 +N）：Escape 清选区 → 探针定位 A 点击选中 → Cmd+.（直接
  // ArrowUp 依赖焦点链路，组 2 建立后焦点在组 2，↑=父 A 理论可达但时序敏感）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(geo.x, geo.y); // A 中心（geo 已算）
  await page.waitForTimeout(250);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(300);
  // 折叠态数据断言（徽标渲染由 treeCollapse T-3 锁定；此处锁「样本含折叠分支」）。
  // 必须在 Escape 清选区前读（nodesDebug 依赖焦点图）
  const folded = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const a = d.mindNodes.find((n) => n.collapsed);
    return a
      ? { id: a.id, hidden: a.hiddenCount, visible: d.mindNodes.filter((n) => n.visible).length }
      : null;
  });
  expect(folded).not.toBeNull();
  expect(folded!.hidden).toBe(2); // 两组被折叠
  expect(folded!.visible).toBe(4); // 根 + 三部门
  // 根无徽标的数据面（审查返工三轮：hiddenCount 不冒泡——根未折叠恒 0，
  // 与折叠节点唯一徽标互补，不只靠截图容差）
  const rootRow = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const r = d.mindNodes[0]!;
    return { collapsed: r.collapsed, hidden: r.hiddenCount };
  });
  expect(rootRow).toEqual({ collapsed: false, hidden: 0 });
  await page.keyboard.press('Escape'); // 清选区/收 ActionBar
  await page.waitForTimeout(200);

  await expect(page).toHaveScreenshot('org-sample.png', {
    clip: { x: 200, y: 150, width: 1000, height: 520 },
  });
});
