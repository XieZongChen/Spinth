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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
