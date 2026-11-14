/** 连线端点 E2E（docs/08 §10 批次 2）：端点拖拽重锚定/解绑保持原位 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { createRect } from './helpers/widgetProbeE2e';

test('批次2：端点拖拽重锚定——拖离解绑为自由端、拖入新形状锚定', async ({ page }) => {
  const docId = `e2e-endpoint-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  await createRect(page, 850, 550);
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(460, 358);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const pts0 = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  // 回 cursor 并点线身选中（切模式清选区——须重新点选）
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  const cm = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  // 点在路径中段的中点（首末中点会落在 U 形肘部内侧、不在路径上）
  const midI = Math.floor(pts0.length / 2);
  await page.mouse.click(
    (pts0[midI - 1]![0] + pts0[midI]![0]) / 2 + cm.left,
    (pts0[midI - 1]![1] + pts0[midI]![1]) / 2 + cm.top,
  );
  await page.waitForTimeout(200);
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const endPt = pts[pts.length - 1]!;

  // 拖终点手柄（世界→client 加偏移）到空白处 → 解绑为自由端
  await page.mouse.move(endPt[0] + c.left, endPt[1] + c.top);
  await page.mouse.down();
  await page.mouse.move(950, 750, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(250);
  let d = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return dd.find((s) => s.type === 'LINE') as unknown as {
      endNodeId: string | null;
      points: Array<[number, number]>;
    };
  });
  const glog = await page.evaluate(
    () => (window as unknown as { __gestureLog?: string[] }).__gestureLog,
  );
  console.log('[gesture]', JSON.stringify(glog));
  expect(d.endNodeId).toBeNull(); // 拖离 = 自由端
  expect(Math.abs(d.points[d.points.length - 1]![0] - 950)).toBeLessThanOrEqual(3);

  // 再拖自由端到 B 上 → 重锚定
  const cur = d.points[d.points.length - 1]!;
  await page.mouse.move(cur[0] + c.left, cur[1] + c.top);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(250);
  d = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return dd.find((s) => s.type === 'LINE') as unknown as { endNodeId: string | null };
  });
  expect(d.endNodeId).not.toBeNull(); // 重锚定到 B
});

test('批次2：解绑——删除锚定形状，连线保留且端点保持原位', async ({ page }) => {
  const docId = `e2e-unbind-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  await createRect(page, 850, 550);
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(460, 358);
  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return {
      line: dd.find((s) => s.type === 'LINE') as unknown as {
        points: Array<[number, number]>;
        startNodeId: string | null;
        endNodeId: string | null;
      },
    };
  });
  // 删 A（选中 + Backspace）
  await page.getByRole('button', { name: /选择/ }).click();
  await page.mouse.click(460, 340);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const line = dd.find((s) => s.type === 'LINE') as unknown as
      | { points: Array<[number, number]>; startNodeId: string | null; endNodeId: string | null }
      | undefined;
    return { line, shapes: dd.filter((s) => s.type === 'SHAPE').length };
  });
  expect(after.shapes).toBe(1); // A 已删
  expect(after.line).toBeDefined(); // 连线保留
  expect(after.line!.startNodeId).toBeNull(); // 解绑
  expect(after.line!.endNodeId).not.toBeNull(); // B 端仍锚定
  expect(JSON.stringify(after.line!.points)).toBe(JSON.stringify(before.line.points)); // 端点保持原位
});

/** 批次 3：线样式探针（vmStates 投影的 lineType/箭头字段） */

test('五轮/六轮：端点拖成同边自环触发全量重排——已有自环让位外环不重叠 + 撤销一步', async ({
  page,
}) => {
  const docId = `e2e-endpoint-respread-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 500, 400); // A 世界 (440,316,120,80)
  // 第一条：top→top 自环（拉线路径，F-5b 同款）
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(500, 362);
  await page.mouse.down();
  await page.mouse.move(510, 362, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  // 第二条：A 顶边 → 自由空间普通线
  await page.mouse.move(500, 362);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  // 回 cursor 选中普通线（按 endNodeId=null 区分）
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  const cm = () => document.querySelector('canvas')!.getBoundingClientRect();
  const lines = () =>
    page.evaluate(() => {
      const dd = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates;
      return dd
        .filter((s) => s.type === 'LINE')
        .map(
          (s) =>
            s as unknown as {
              id: string;
              startNodeId: string | null;
              startJoin: string | null;
              endNodeId: string | null;
              endJoin: string | null;
              points: Array<[number, number]>;
            },
        );
    });
  const ls0 = await lines();
  expect(ls0).toHaveLength(2);
  const normalIdx = ls0.findIndex((l) => l.endNodeId === null);
  expect(normalIdx).toBeGreaterThanOrEqual(0);
  const normal = ls0[normalIdx]!;
  // 点线身选中普通线
  const c0 = await page.evaluate(cm);
  const midI = Math.floor(normal.points.length / 2);
  await page.mouse.click(
    (normal.points[midI - 1]![0] + normal.points[midI]![0]) / 2 + c0.left,
    (normal.points[midI - 1]![1] + normal.points[midI]![1]) / 2 + c0.top,
  );
  await page.waitForTimeout(250);
  // 拖终点手柄回 A 顶边内侧（世界 (500,318)）→ 变第二条同边自环
  const endPt = normal.points[normal.points.length - 1]!;
  await page.mouse.move(endPt[0] + c0.left, endPt[1] + c0.top);
  await page.mouse.down();
  await page.mouse.move(500, 362, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  // 两线均为同边自环 + 嵌套展开 {80, 120}（onSettled → reattachAll 让位外环）
  const ls1 = await lines();
  expect(ls1).toHaveLength(2);
  for (const l of ls1) expect(l.endNodeId).not.toBeNull();
  const spans = ls1
    .map((l) => {
      const xs = l.points.map((p) => p[0]);
      return Math.max(...xs) - Math.min(...xs);
    })
    .sort((a, b) => a - b);
  expect(spans[0]).toBeCloseTo(80, 0);
  expect(spans[1]).toBeCloseTo(120, 0);

  // 端点 patch + onSettled 全量重排同事务 → 一次 undo 同时回退被拖线与让位自环
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const ls2 = await lines();
  const snap = (arr: typeof ls0) =>
    Object.fromEntries(
      arr.map((l) => [
        l.id,
        {
          startNodeId: l.startNodeId,
          startJoin: l.startJoin,
          endNodeId: l.endNodeId,
          endJoin: l.endJoin,
          points: l.points,
        },
      ]),
    );
  expect(snap(ls2)).toEqual(snap(ls0));
});
