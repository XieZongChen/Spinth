/** 画笔 E2E（4.10/1.9-1.10）：可拖可缩（CI 条件跳过——合成输入管线级塌缩，docs/15 §3）/手势取消 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/widgetProbeE2e';

test('4.10 画笔可拖：points 整体平移 @timing', async ({ page }) => {
  // 拖起点必须避开 RectEditor 四边不可见热区（±5px 全宽/全高）与四角柄——
  // 2026-10-17 外部审查证伪「CI 管线塌缩」旧定性：此前取 bbox 底边中点
  // （V 形笔迹中点索引≈谷底），按下命中 S 向缩放热区 → 拖拽被解释成纵向
  // resize（frame 原点不动、x 不变、首点锚定——与「塌缩成 click、frame 停
  // 原点」的旧观测完全同形）。真根因即热区命中，CI skip 撤除。
  // 拖拽自同步防御（每步探针 + 补发 + 整段重试）保留——对慢环境仍有效。
  test.setTimeout(120_000);
  const docId = `e2e-pen-drag-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /画笔/ }).click();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(560, 340, { steps: 4 });
  await page.mouse.move(620, 300, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect((await probe(page)).pen).not.toBeNull();

  // 弧长比例取点：落在臂上、距 bbox 四边有充足内缩（V 形 1/4 弧长处
  // 内缩 ≈20px），对采样稀疏鲁棒（相邻采样点间线性插值恒在笔迹上）
  const arcPoint = (pts: Array<[number, number]>, frac: number): [number, number] => {
    const segs: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      segs.push(d);
      total += d;
    }
    let want = total * frac;
    for (let i = 0; i < segs.length; i++) {
      if (want <= segs[i]!) {
        const t = segs[i] === 0 ? 0 : want / segs[i]!;
        return [
          pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * t,
          pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * t,
        ];
      }
      want -= segs[i]!;
    }
    return pts[pts.length - 1]!;
  };

  // 回 cursor，点笔画选中——点击点从探针 points 反推（世界 + canvas 偏移）
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pick = await arcPoint((await probe(page)).pen!.points, 0.25);
  const at = { x: pick[0] + c.left, y: pick[1] + c.top };
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  const before = await probe(page);
  expect(before.selectionFrame).not.toBeNull();

  // 拖笔画：所有 points 平移 (+80,+50)（±2 舍入容差）。
  // **探针自同步 + 手势级重试**（2026-10-04 第九轮审查拍板，根治门禁连续红）：
  // 饱和时 Chromium 输入管线会重排/丢弃合成输入——mouseup 插队 move（塌缩成
  // 按下+抬起）、甚至 down 本身丢失（2026-10-04 诊断实锤：frame 停在按下前
  // 原点，补发 move 也无效）。固定 15ms/60ms 等待对 CI runner 已不够
  // （10-03/10-04 两天两红）。两层防御：
  // ① 每步 move 后等 selectionFrame 探针（世界坐标，拖拽中逐帧跟随）到达
  //    该步预期位置再发下一步（该步已被消费 = 输入队列已空），超时补发同
  //    坐标 move 一次（对乱序鲁棒，重发无害）；
  // ② 整段手势一次重试机会（对 down 丢失鲁棒）——重试前重采样笔画当前位置
  //    与选中框（上次可能部分生效），真回归两次都红。
  const frameAt = (ex: number, ey: number): Promise<void> =>
    page
      .waitForFunction(
        ([x, y]) => {
          const f = (
            window as unknown as {
              __spinthDebug: { __debug: { selectionFrame: { x: number; y: number } | null } };
            }
          ).__spinthDebug.__debug.selectionFrame;
          return f !== null && Math.abs(f.x - x) <= 1 && Math.abs(f.y - y) <= 1;
        },
        [ex, ey],
        // 负载高峰下 renderer 事件积压可达数秒（2026-10-04 四连败实锤 2s 不够，
        // frame 停按下前原点且补发/重试均未及恢复）——窗口放大到 8s：积压消化
        // 后事件按序处理，探针必然到位
        { timeout: 8000, polling: 16 },
      )
      .then(() => undefined);
  const dragAndCheck = async (): Promise<void> => {
    const cur = await probe(page);
    const f0 = cur.selectionFrame!;
    const pick2 = await arcPoint(cur.pen!.points, 0.25);
    const at2 = { x: pick2[0] + c.left, y: pick2[1] + c.top }; // 上次尝试可能部分生效——重采样
    const base = cur.pen!.points;
    await page.mouse.move(at2.x, at2.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const dx = (80 * i) / 6;
      const dy = (50 * i) / 6;
      await page.mouse.move(at2.x + dx, at2.y + dy);
      try {
        await frameAt(f0.x + dx, f0.y + dy);
      } catch {
        await page.mouse.move(at2.x + dx, at2.y + dy); // 补发同坐标（对 move 乱序鲁棒）
        await frameAt(f0.x + dx, f0.y + dy);
      }
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
    const afterPts = (await probe(page)).pen!.points;
    expect(afterPts).toHaveLength(base.length);
    for (let i = 0; i < base.length; i++) {
      expect(Math.abs(afterPts[i]![0] - (base[i]![0] + 80))).toBeLessThanOrEqual(2);
      expect(Math.abs(afterPts[i]![1] - (base[i]![1] + 50))).toBeLessThanOrEqual(2);
    }
  };
  try {
    await dragAndCheck();
  } catch {
    await page.mouse.up(); // 复位可能悬着的按下态
    await page.mouse.move(20, 20);
    await page.waitForTimeout(300);
    await dragAndCheck(); // 手势级整段重试（down 丢失/事件丢弃族）
  }
});

test('4.10 画笔可缩：拖选区角手柄 bbox 重映射变大', async ({ page }) => {
  const docId = `e2e-pen-resize-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /画笔/ }).click();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(560, 340, { steps: 4 });
  await page.mouse.move(620, 300, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  const c0 = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pp0 = (await probe(page)).pen!.points;
  const mid0 = pp0[Math.floor(pp0.length / 2)]!;
  await page.mouse.click(mid0[0] + c0.left, mid0[1] + c0.top);
  await page.waitForTimeout(250);

  const before = await probe(page);
  const ef = before.editorFrame;
  expect(ef).not.toBeNull(); // 画笔可缩 → 缩放编辑框在手
  const bbox = (pts: Array<[number, number]>): { w: number; h: number } => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const beforeBox = bbox(before.pen!.points);

  // 拖 NW 角手柄向外 30px → bbox 重映射变大（禁止 root.scale——线宽/笔宽不拉伸）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  await page.mouse.move(ef!.x + c.left, ef!.y + c.top);
  await page.mouse.down();
  await page.mouse.move(ef!.x + c.left - 30, ef!.y + c.top - 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterBox = bbox((await probe(page)).pen!.points);
  expect(afterBox.w).toBeGreaterThan(beforeBox.w + 20);
  expect(afterBox.h).toBeGreaterThan(beforeBox.h + 20);
});

// ---------------------------------------------------------------------------
// 连线交互批次 1（docs/08 §10）：悬停连接点指示器 + 工具保持激活

test('1.9/1.10 手势取消面：pen 拖拽中 pointercancel 不留孤儿笔；拖拽中切工具选区框回位', async ({
  page,
}) => {
  const docId = `e2e-cancel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

  // ① pen 绘制中 pointercancel（合成事件，按下点坐标——坐标是实验变量，8 轮教训）
  await page.getByRole('button', { name: /画笔/ }).click();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(600, 360, { steps: 4 });
  await page.evaluate(
    (xy) => {
      document.querySelector('canvas')!.dispatchEvent(
        new PointerEvent('pointercancel', {
          clientX: xy.x,
          clientY: xy.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { x: 550, y: 330 },
  );
  await page.waitForTimeout(350);
  const count = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { modelCount: number } } }).__spinthDebug
        .__debug.modelCount,
  );
  expect(count).toBe(1); // 笔已成形（≥2 点）保留；cancel 后无孤儿/无悬空（修复前 drawingId 悬空）
  await page.keyboard.press('v');

  // ② 拖拽中切工具（v）：预览回弹——元素世界坐标不变（未落库）+ 选区框回到原位
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmPositions: Array<{ id: string; x: number; y: number }> } };
      }
    ).__spinthDebug.__debug;
    return d.vmPositions[0]!;
  });
  await page.mouse.move(550, 330);
  await page.mouse.down();
  await page.mouse.move(620, 380, { steps: 4 });
  await page.keyboard.press('v'); // 拖拽中切工具（修复前 dragState 悬空、视觉残留偏移）
  await page.waitForTimeout(350);
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmPositions: Array<{ id: string; x: number; y: number }> } };
      }
    ).__spinthDebug.__debug;
    return d.vmPositions[0]!;
  });
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1); // 数据未落库（cancel 语义）
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});
