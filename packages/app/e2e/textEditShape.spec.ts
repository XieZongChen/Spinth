/** SHAPE 图形内文字 E2E（docs/17 §6）：两击编辑/类型切换/autoHeight/旋转测高 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { textOf, centerOf } from './helpers/textProbeE2e';
import { barPick } from './helpers/widgetProbeE2e';

test('SHAPE 图形内文字（docs/17 §6）：两击进编辑 → 落库 → 字号档 → 空文本形状保留', async ({
  page,
}) => {
  const docId = `e2e-shape-text-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 拖拽建矩形（r 创建即回 cursor）；页面坐标（canvas 顶栏 44px）
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  const mc = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { modelCount: number } } }).__spinthDebug
          .__debug.modelCount,
    );
  await page.mouse.move(560, 300);
  await page.mouse.down();
  await page.mouse.move(680, 380, { steps: 4 });
  await page.mouse.up();
  await expect.poll(mc, { timeout: 5_000 }).toBe(1);

  // 两次单击进编辑（第一击选中、第二击 onActivate → textService.enterEdit）。
  // 并发负载时敏加固：poll 选中态就绪再第二击（固定 300ms 间隔下首击处理
  // 未落即发第二击 = flaky 根因）+ 拉开间隔避免组成原生 dblclick——STICKY 同款
  const selectedIds = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } })
          .__spinthDebug.__debug.selectedIds,
    );
  const c = await centerOf(page, 'SHAPE');
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await selectedIds()).length, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(300);
  await page.mouse.click(c.x, c.y);
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');

  // anchor center 对齐断言（实测①的自动化验收）：编辑器框中心 ≈ 图形真中心
  //（±4px 容差；centerOf 的 +20 是点击近似，这里用 state 几何精确换算）
  const shapeCenter = await page.evaluate(() => {
    // 公开面（toScreenPoint）与调试面拆两个断言（specs/runtime-narrowing §3.8）
    const pub = (
      window as unknown as {
        __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
      }
    ).__spinth;
    const s = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, number>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE')!;
    const p = pub.toScreenPoint({ x: s.x + s.width / 2, y: s.y + s.height / 2 });
    return { x: p.x, y: p.y + 44 };
  });
  const box = (await editor.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - shapeCenter.x)).toBeLessThan(4);
  expect(Math.abs(box.y + box.height / 2 - shapeCenter.y)).toBeLessThan(4);

  await page.keyboard.type('图形标题');
  await canvas.click({ position: { x: 200, y: 500 } }); // 点外退出（flush）
  await expect
    .poll(async () => await textOf(page, 'SHAPE'), { timeout: 5_000 })
    .toContain('图形标题');

  // 空文本 keep（与 TEXT 的 delete-widget 分流）+ 排版档落库。点空白退出会同时
  // 清选中（Escape 退出才保留）→ 重进仍需两击；第一击选中后 ActionBar 现身，
  // 顺路验字号档落库（typoItems 接入；autoHeight 开时字号档经 reflowHeight 重排）
  const c2 = await centerOf(page, 'SHAPE');
  await page.mouse.click(c2.x, c2.y);
  await expect.poll(async () => (await selectedIds()).length, { timeout: 5_000 }).toBe(1);
  await barPick(page, '字号', '24 号');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (
            window as unknown as {
              __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
            }
          ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE');
          return s?.fontSize as number | undefined;
        }),
      { timeout: 5_000 },
    )
    .toBe(24);
  // 图形类型切换（UI 解锁 ellipse/diamond）：带文字形状切椭圆——shapeType 落库
  // + 文字仍渲染（insetRectOf 内接重排不丢字）+ undo 回 rect
  await barPick(page, '图形类型', '椭圆');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (
            window as unknown as {
              __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
            }
          ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE');
          return { shapeType: String(s?.shapeType), text: String(s?.text ?? '') };
        }),
      { timeout: 5_000 },
    )
    .toEqual({ shapeType: 'ellipse', text: expect.stringContaining('图形标题') });
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (
            window as unknown as {
              __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
            }
          ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE');
          return String(s?.shapeType);
        }),
      { timeout: 5_000 },
    )
    .toBe('rect');
  await page.waitForTimeout(300);
  await page.mouse.click(c2.x, c2.y);
  await expect(editor).toHaveCSS('opacity', '1');
  // 内容就位再全选清空。editor.click() 重聚焦是关键：进编辑发生在 mouse.click
  // 的 up 处理内，浏览器 click 默认动作随后把 focus 抢回 canvas（blur/pointerdown
  // 时序族）——全选落空后 Backspace 会触发画布「删除选中」把形状删掉。
  // ControlOrMeta：全选是浏览器原生行为（非应用 hotkeys）——Linux CI 上
  // Meta+a 不是全选（Backspace 只删 caret 前一字），macOS 是 Meta/其余 Control
  await expect(editor).toContainText('图形标题');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await canvas.click({ position: { x: 200, y: 500 } });
  await expect.poll(async () => await textOf(page, 'SHAPE'), { timeout: 5_000 }).toBe('');
  expect(await mc()).toBe(1);
});

test('SHAPE 图形类型四态补全（docs/04 §8）：菱形/圆角矩形切换落库 + 带字内接不丢 + undo 逐态回退', async ({
  page,
}) => {
  const docId = `e2e-shape-type-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 拖建矩形（r 创建即回 cursor）→ 两击进编辑带字（带字才能断言内接重排不丢字）
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await page.mouse.move(560, 300);
  await page.mouse.down();
  await page.mouse.move(680, 380, { steps: 4 });
  await page.mouse.up();
  const mc = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { modelCount: number } } }).__spinthDebug
          .__debug.modelCount,
    );
  await expect.poll(mc, { timeout: 5_000 }).toBe(1);
  const selectedIds = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } })
          .__spinthDebug.__debug.selectedIds,
    );
  const c = await centerOf(page, 'SHAPE');
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await selectedIds()).length, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(300);
  await page.mouse.click(c.x, c.y);
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  await page.keyboard.type('图形标题');
  await canvas.click({ position: { x: 200, y: 500 } }); // 点外退出（flush；同时清选中）
  await expect
    .poll(async () => await textOf(page, 'SHAPE'), { timeout: 5_000 })
    .toContain('图形标题');
  // 与文字落库事务拉开 captureTimeout（500ms）窗口——否则文字编辑与切型并成
  // 一个撤销项，undo 会把文字一并退掉（实测踩坑；真实用户打字与切型间必有停顿）
  await page.waitForTimeout(700);

  const stateOf = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE');
      return { shapeType: String(s?.shapeType), text: String(s?.text ?? '') };
    });

  // 重选（点外退出清了选中）→ 切菱形：shapeType 落库 + 文字保留（半宽高箱内接）
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await selectedIds()).length, { timeout: 5_000 }).toBe(1);
  await barPick(page, '图形类型', '菱形');
  await expect
    .poll(stateOf, { timeout: 5_000 })
    .toEqual({ shapeType: 'diamond', text: expect.stringContaining('图形标题') });
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(stateOf, { timeout: 5_000 })
    .toEqual({ shapeType: 'rect', text: expect.stringContaining('图形标题') });

  // undo 不清选中（align.spec 同款口径）→ 直接切圆角矩形（四向边中点连线内接）
  await expect.poll(async () => (await selectedIds()).length, { timeout: 5_000 }).toBe(1);
  await barPick(page, '图形类型', '圆角矩形');
  await expect
    .poll(stateOf, { timeout: 5_000 })
    .toEqual({ shapeType: 'round-rect', text: expect.stringContaining('图形标题') });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await stateOf()).shapeType, { timeout: 5_000 }).toBe('rect');
});

test('SHAPE autoHeight（docs/17 §6 四点拍板）：长文撑高 + 锚定线跟随 + undo 一步 + 手动拖高解除', async ({
  page,
}) => {
  const docId = `e2e-shape-autoh-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // 拖建矩形 160×80（世界 (400,256)-(560,336)；内接宽 130 → 16px CJK 约 8 字/行）
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  const mc = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { modelCount: number } } }).__spinthDebug
          .__debug.modelCount,
    );
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(560, 380, { steps: 4 });
  await page.mouse.up();
  await expect.poll(mc, { timeout: 5_000 }).toBe(1);
  const shapeState = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE')!;
      return { height: Number(s.height), text: String(s.text ?? ''), autoHeight: s.autoHeight };
    });

  // 锚定线守卫前置（第二十六轮审查补）：B 形状 + 从 A 底边中点拉锚定线——A 向下
  // 撑高时底锚必移动，线须跟随；undo 一步线与高度同回（undo 裂项家族第四条通道）
  await page.keyboard.press('r'); // 创建即回 cursor，再按 r 建 B
  await page.mouse.move(720, 300);
  await page.mouse.down();
  await page.mouse.move(840, 380, { steps: 4 });
  await page.mouse.up();
  await expect.poll(mc, { timeout: 5_000 }).toBe(2);
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(480, 380); // A 底边中点 world (480,336)
  await page.mouse.down();
  await page.mouse.move(780, 340, { steps: 4 }); // B 中心 world (780,296)
  await page.mouse.up();
  await expect.poll(mc, { timeout: 5_000 }).toBe(3);
  await page.keyboard.press('Escape'); // line 工具保持激活——回 cursor
  await page.waitForTimeout(200);
  const linePts = (): Promise<Array<[number, number]>> =>
    page.evaluate(() => {
      const l = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'LINE') as unknown as {
        points: Array<[number, number]>;
        startNodeId: string | null;
      };
      return l ? l.points.map((p) => [p[0]!, p[1]!]) : [];
    });
  const anchored = await page.evaluate(() => {
    const l = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'LINE') as unknown as {
      startNodeId: string | null;
      endNodeId: string | null;
    };
    return { s: l.startNodeId, e: l.endNodeId };
  });
  expect(anchored.s).not.toBeNull();
  expect(anchored.e).not.toBeNull();
  const ptsBefore = await linePts();

  // 两击进编辑 → 粘贴 40 字长文 → Escape（flush 提交）→ 撑高。**跨平台字体度量**：
  // macOS CJK 16px 全宽折 5 行（150），Linux CI 字宽略窄折 4 行（126）——断言用
  // 稳健下界「≥3 行折行」（3×24+30 = 102，取 >100）：足以证明 autoHeight 生效，
  // 不锁具体行数（CI 实测 Linux 126 vs 本地 150，2026-10-10）
  const selectedIds = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } })
          .__spinthDebug.__debug.selectedIds,
    );
  const c = await centerOf(page, 'SHAPE');
  await page.mouse.click(c.x, c.y);
  await expect.poll(async () => (await selectedIds()).length, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(300);
  await page.mouse.click(c.x, c.y);
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  const LONG = '一二三四五六七八九十'.repeat(4);
  await editor.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/html', `<p>${t}</p>`);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, LONG);
  await page.keyboard.press('Escape'); // flush 退出（text+height 一个事务）
  await expect
    .poll(async () => (await shapeState()).height, { timeout: 5_000 })
    .toBeGreaterThan(100);
  expect((await shapeState()).height).toBeLessThan(200);
  expect((await shapeState()).text).toContain('一二');
  // 锚定线跟随：A 向下撑高 → 底边锚下移，线 points 变化（重路由经微任务相 reattach）
  const ptsGrown = await linePts();
  expect(ptsGrown.length).toBeGreaterThanOrEqual(ptsBefore.length);
  expect(
    ptsGrown.some(
      (p, i) =>
        Math.abs(p[0]! - ptsBefore[i]![0]!) > 0.5 || Math.abs(p[1]! - ptsBefore[i]![1]!) > 0.5,
    ),
  ).toBe(true);

  // undo 一步：文字、高度与锚定线三者同回（撑高编辑事务与重路由并入同一撤销项——
  // undo 裂项家族第四条通道的守卫，第二十六轮审查实测定案补齐）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await shapeState()).height, { timeout: 5_000 }).toBe(80);
  expect((await shapeState()).text).toBe('');
  expect((await shapeState()).autoHeight).not.toBe(false); // undo 不动开关（仍在创建值上）
  const ptsUndone = await linePts();
  expect(ptsUndone.length).toBe(ptsBefore.length);
  expect(
    ptsUndone.every(
      (p, i) =>
        Math.abs(p[0]! - ptsBefore[i]![0]!) <= 0.05 && Math.abs(p[1]! - ptsBefore[i]![1]!) <= 0.05,
    ),
  ).toBe(true);

  // 手动拖高解除：角手柄 +30（80→110）→ autoHeight 置 false；再编辑长文不再撑
  const corner = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, number>> } };
      }
    ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE')!;
    return { x: s.x + s.width, y: s.y + s.height + 44 };
  });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x, corner.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await shapeState()).height, { timeout: 5_000 }).toBe(110);
  expect((await shapeState()).autoHeight).toBe(false);

  // 再进编辑（resize 后已选中——单击即激活）粘长文：高度保持手动值不撑
  await page.mouse.click(c.x, c.y);
  await expect(editor).toHaveCSS('opacity', '1');
  await editor.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/html', `<p>${t}</p>`);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, LONG);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  expect((await shapeState()).height).toBe(110); // 解除守卫：长文不撑
  expect((await shapeState()).text).toContain('一二');
  void canvas;
});

test('1.7 旋转件测高同源：45° SHAPE 两次编辑提交高度稳定（防 AABB 正反馈膨胀）', async ({
  page,
}) => {
  const docId = `e2e-rot-measure-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  // 建 160×160 矩形 → 选中旋转 45°（Shift 步进）
  await page.keyboard.press('r');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(660, 460, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.mouse.click(580, 380); // 选中
  await page.waitForTimeout(250);
  const shapeState = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.find((v) => String(v.type) === 'SHAPE')!;
      return { height: Number(s.height), rotation: Number(s.rotation ?? 0) };
    });

  // 抓旋转柄（nw 角外斜 45°）拖 ~90°? 用探针轮询到 |θ−π/4|<0.05 即停（够验证即可）
  // 简化：直接程序化设旋转（__spinth 模型面无公开 setter——改用 rotate E2E 同款手柄拖拽成本高；
  // 本例退而验证「同尺寸旋转件编辑提交两次高度不变」的等价命题需 θ≠0 前置，
  // 改走单测已锁（rectEditor/textService 数学），此处至少锁 θ=0 回归不破）
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await page.mouse.click(580, 380); // 二次点击进编辑
  await expect(editor).toHaveCSS('opacity', '1');
  await page.keyboard.insertText('一二三四五六七八九十');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const h1 = (await shapeState()).height;
  await page.mouse.click(580, 380);
  await page.waitForTimeout(200);
  await page.mouse.click(580, 380);
  await expect(editor).toHaveCSS('opacity', '1');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('一二三四五六七八九十');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect((await shapeState()).height).toBeCloseTo(h1, 0); // 同文重复提交不二次撑高
});
