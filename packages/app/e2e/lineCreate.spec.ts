/** 连线创建 E2E（docs/08 §10 批次 1）：line 工具悬停/创建/保持激活/预览跟随 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { lineProbe, createRect } from './helpers/widgetProbeE2e';

test('批次1：line 工具悬停对象显示四边连接点、移开消失', async ({ page }) => {
  const docId = `e2e-line-anchor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 500, 350);

  await page.getByRole('button', { name: /连线/ }).click();
  // 悬停对象内部 → 探针出现四边中点（四点各不相同、呈十字分布）
  await page.mouse.move(500, 350);
  await page.waitForTimeout(120);
  let p = await lineProbe(page);
  const p0 = p;
  expect(p.lineAnchors).not.toBeNull();
  expect(p.lineAnchors!).toHaveLength(4);
  const xs = p.lineAnchors!.map((a) => a.x);
  const ys = p.lineAnchors!.map((a) => a.y);
  expect(new Set(xs).size).toBe(3); // 左/中/右
  expect(new Set(ys).size).toBe(3); // 上/中/下
  // 十字对称：左右关于中心对称、上下同
  const left = p.lineAnchors!.find((a) => a.x === Math.min(...xs))!;
  const right = p.lineAnchors!.find((a) => a.x === Math.max(...xs))!;
  expect(Math.abs(left.x + right.x - 1000)).toBeLessThanOrEqual(4); // 2×500

  // 移开到空白 → 指示器消失
  await page.mouse.move(900, 700);
  await page.waitForTimeout(120);
  p = await lineProbe(page);
  expect(p.lineAnchors).toBeNull();

  // 边缘容差（用户实测回归）：光标压在左连接点上（元素边**外** 3px）指示器
  // 不消失、最近点高亮 = left（JOINS 序 3）——严格 point-in-bounds 曾闪烁。
  // 探针是世界坐标，mouse.move 是屏幕坐标——加画布偏移（坐标纪律 docs/15）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const leftAnchor = p0.lineAnchors!.find(
    (a) => a.x === Math.min(...p0.lineAnchors!.map((q) => q.x)),
  )!;
  await page.mouse.move(leftAnchor.x - 3 + c.left, leftAnchor.y + c.top);
  await page.waitForTimeout(120);
  p = await lineProbe(page);
  expect(p.lineAnchors).not.toBeNull();
  expect(p.lineAnchorActive).toBe(3);

  // 光标在元素内部偏上 → 最近点 = top（0）
  await page.mouse.move(500 + c.left, 286 + c.top);
  await page.waitForTimeout(120);
  p = await lineProbe(page);
  expect(p.lineAnchorActive).toBe(0);
});

test('批次1：连线工具创建后保持激活——连续画两条不必切工具', async ({ page }) => {
  const docId = `e2e-line-stay-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  await createRect(page, 850, 550);

  await page.getByRole('button', { name: /连线/ }).click();
  // 第一条：A → B
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  let p = await lineProbe(page);
  expect(p.modelCount).toBe(3);
  expect(p.cursorMode).toBe('line'); // 工具保持激活（曾回切 cursor）

  // 第二条：B → A（不切工具直接画——回归护栏：曾创建即回切）
  await page.mouse.move(850, 550);
  await page.mouse.down();
  await page.mouse.move(450, 350, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  p = await lineProbe(page);
  expect(p.modelCount).toBe(4);
  expect(p.cursorMode).toBe('line');
  expect(p.selectedIds).toHaveLength(1); // 新线选中

  // Esc 回 cursor（文档化退出路径）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect((await lineProbe(page)).cursorMode).toBe('cursor');
});

test('批次1：拖动锚定图形时连线实时跟随（预览跟随 + 松手落库）', async ({ page }) => {
  const docId = `e2e-line-follow-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  await createRect(page, 850, 550);

  // 连线 A→B（两端锚定）
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect((await lineProbe(page)).modelCount).toBe(3);

  // move 工具拖 B：**松手前**（预览期）探针应已有视觉路由——
  // 曾只在松手落库后 reattach，拖动中连线掉在原地（用户实测）
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  await page.mouse.move(850, 550);
  await page.mouse.down();
  await page.mouse.move(950, 550, { steps: 5 });
  await page.waitForTimeout(150);
  const mid = await lineProbe(page);
  expect(mid.linePreview).not.toBeNull(); // 预览期实时重路由
  expect(mid.linePreview!.length).toBeGreaterThanOrEqual(2);
  const previewEndX = mid.linePreview![mid.linePreview!.length - 1]![0];
  expect(previewEndX).toBeGreaterThan(900); // 终点已追到预览位置附近

  // 松手落库：模型 points 终态 = 跟随后的位置
  await page.mouse.up();
  await page.waitForTimeout(300);
  const lp = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  expect(lp[lp.length - 1]![0]).toBeGreaterThan(900); // 模型终点跟随 B 的新位置

  // 路由质量（用户实测回归：移动后穿模）：连线不得穿过任一矩形内部
  const rects = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return d
      .filter((s) => s.type === 'SHAPE')
      .map((s) => ({
        x: Number(s.x),
        y: Number(s.y),
        width: Number(s.width),
        height: Number(s.height),
      }));
  });
  for (let i = 0; i + 1 < lp.length; i++) {
    const x0 = Math.min(lp[i]![0], lp[i + 1]![0]);
    const x1 = Math.max(lp[i]![0], lp[i + 1]![0]);
    const y0 = Math.min(lp[i]![1], lp[i + 1]![1]);
    const y1 = Math.max(lp[i]![1], lp[i + 1]![1]);
    for (const r of rects) {
      const cross =
        x0 < r.x + r.width - 0.5 && x1 > r.x + 0.5 && y0 < r.y + r.height - 0.5 && y1 > r.y + 0.5;
      expect(cross).toBe(false);
    }
  }
});

test('批次1：绘制中拖入目标元素触发指示器（端点吸附反馈）', async ({ page }) => {
  const docId = `e2e-line-drawanchor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  await createRect(page, 850, 550);

  // line 工具：从 A 拖出，向 B 移动但**不松手**——指示器应显示 B 的连接点
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(650, 450, { steps: 4 }); // 途中空白：指示器应隐藏
  await page.waitForTimeout(120);
  let p = await lineProbe(page);
  expect(p.lineAnchors).toBeNull(); // 空白处无指示

  await page.mouse.move(850, 550, { steps: 4 }); // 进入 B：指示器亮起
  await page.waitForTimeout(120);
  p = await lineProbe(page);
  expect(p.lineAnchors).not.toBeNull();
  expect(p.lineAnchors!).toHaveLength(4);
  expect(p.lineAnchorActive).not.toBeNull();

  // 松手：锚定落库 + 指示器隐藏
  await page.mouse.up();
  await page.waitForTimeout(200);
  p = await lineProbe(page);
  expect(p.modelCount).toBe(3);
  expect(p.lineAnchors).toBeNull();
});

// ---------------------------------------------------------------------------
// 批次 2（docs/08 §10）：选中形状 → 四向连接点常显 + 快捷按钮连线/quick-add；
// 端点拖拽重锚定；解绑。交互为参考同款（选中驱动，非悬停驱动）。
// ---------------------------------------------------------------------------
