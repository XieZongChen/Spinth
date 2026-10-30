/** 旋转 E2E（docs/05 §8）：拖柄/Shift 步进/命中/旋转态 resize */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, worldToScreen, rotateHandleScreen, dragCreateRect } from './helpers/rotateE2e';

test('拖旋转柄 90°：rotation 落库（rad）+ undo 一步回未旋转', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-basic-${Date.now()}`);
  await waitForSynced(page);

  await dragCreateRect(page, 300, 200);
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;
  expect(s0.rotation).toBeUndefined(); // 「默认档零字段」——未旋转不落库

  // 选中 → 旋转柄（nw 角外斜 45°，2026-10-16 迁移）→ 拖「起点向量旋转 +90°」
  const center = await worldToScreen(page, s0.x + s0.width / 2, s0.y + s0.height / 2);
  await page.mouse.click(center.x, center.y);
  const handle = await rotateHandleScreen(page);
  // 柄位数据断言（视觉快照清选中后不含柄，柄位靠数学锁）：≈ nw 角外斜 20px
  const hWorld = await page.evaluate(
    () =>
      (
        window as unknown as {
          __spinth: { __debug: { rotateHandle: { x: number; y: number } | null } };
        }
      ).__spinth.__debug.rotateHandle,
  );
  const diag = Math.SQRT1_2;
  expect(hWorld!.x).toBeCloseTo(s0.x - diag * 20, 0);
  expect(hWorld!.y).toBeCloseTo(s0.y - diag * 20, 0);
  const sv = { x: handle.x - center.x, y: handle.y - center.y };
  const end90 = {
    x: center.x + sv.x * Math.cos(Math.PI / 2) - sv.y * Math.sin(Math.PI / 2),
    y: center.y + sv.x * Math.sin(Math.PI / 2) + sv.y * Math.cos(Math.PI / 2),
  };
  await page.mouse.move(handle.x, handle.y);
  // hover 旋转柄：canvas 光标 = 自绘旋转指针（SVG cursor，2026-10-16 用户反馈）
  await expect
    .poll(() => page.evaluate(() => document.querySelector('canvas')!.style.cursor), {
      timeout: 3000,
    })
    .toContain('url("data:image/svg+xml');
  await page.mouse.down();
  await page.mouse.move(Math.round(end90.x), Math.round(end90.y), { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeCloseTo(Math.PI / 2, 2);

  // undo 一步回未旋转（与创建同款的单事务语义）
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeUndefined();
});

test('Shift 步进：~20° 拖拽量化落库 15°（π/12）', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-step-${Date.now()}`);
  await waitForSynced(page);

  await dragCreateRect(page, 300, 200);
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;
  const cx = s0.x + s0.width / 2;
  const cy = s0.y + s0.height / 2;

  const center = await worldToScreen(page, cx, cy);
  await page.mouse.click(center.x, center.y);
  const handle = await rotateHandleScreen(page);
  // 终点 = 中心 + 起点向量旋转 20°（构造 Δ=20°，Shift 量化到 15°）
  const rad = (20 * Math.PI) / 180;
  const startVec = { x: handle.x - center.x, y: handle.y - center.y };
  const end = {
    x: center.x + startVec.x * Math.cos(rad) - startVec.y * Math.sin(rad),
    y: center.y + startVec.x * Math.sin(rad) + startVec.y * Math.cos(rad),
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(Math.round(end.x), Math.round(end.y), { steps: 6 });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeCloseTo(Math.PI / 12, 3);
});

test('旋转态命中：45° 后 AABB 角空区点击不选中、实体中心选中', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-hit-${Date.now()}`);
  await waitForSynced(page);

  await dragCreateRect(page, 400, 260);
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;
  const cx = s0.x + s0.width / 2;
  const cy = s0.y + s0.height / 2;

  // 转 45°
  const center = await worldToScreen(page, cx, cy);
  await page.mouse.click(center.x, center.y);
  const handle = await rotateHandleScreen(page);
  const rad = Math.PI / 4;
  const startVec = { x: handle.x - center.x, y: handle.y - center.y };
  const end = {
    x: center.x + startVec.x * Math.cos(rad) - startVec.y * Math.sin(rad),
    y: center.y + startVec.x * Math.sin(rad) + startVec.y * Math.cos(rad),
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(Math.round(end.x), Math.round(end.y), { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeCloseTo(Math.PI / 4, 2);

  // 清选 → 点 AABB 左上角空区（外接矩形角、旋转实体外）→ 不选中
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await probe(page)).selected.length).toBe(0);
  const half = (s0.width + s0.height) / 2 / Math.SQRT2;
  const corner = await worldToScreen(page, cx - half + 2, cy - half + 2);
  await page.mouse.click(corner.x, corner.y);
  await page.waitForTimeout(250);
  expect((await probe(page)).selected.length).toBe(0);

  // 点实体中心 → 选中
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await probe(page)).selected.length).toBe(1);
});

test('旋转态 resize：拖角改宽高（指针逆旋转进局部——沿控件自身轴缩放）', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-resize-${Date.now()}`);
  await waitForSynced(page);

  await dragCreateRect(page, 400, 260);
  await expect.poll(async () => (await probe(page)).count).toBe(1);
  const s0 = (await probe(page)).shapes[0]!;
  const cx = s0.x + s0.width / 2;
  const cy = s0.y + s0.height / 2;

  // 转 90°（纵条；终点 = 柄起点向量旋转 +90°）→ 拖「旋转后」的东南角手柄
  const center = await worldToScreen(page, cx, cy);
  await page.mouse.click(center.x, center.y);
  const handle = await rotateHandleScreen(page);
  const sv2 = { x: handle.x - center.x, y: handle.y - center.y };
  const end2 = {
    x: center.x + sv2.x * Math.cos(Math.PI / 2) - sv2.y * Math.sin(Math.PI / 2),
    y: center.y + sv2.x * Math.sin(Math.PI / 2) + sv2.y * Math.cos(Math.PI / 2),
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(Math.round(end2.x), Math.round(end2.y), { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeCloseTo(Math.PI / 2, 2);

  // 顺时针 90°：局部 se 角（中心 + w/2·x + h/2·y）→ 世界 (cx − h/2, cy + w/2)
  const seWorld = { x: cx - s0.height / 2, y: cy + s0.width / 2 };
  const se = await worldToScreen(page, seWorld.x, seWorld.y);
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(se.x + 40, se.y + 30, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  // 世界拖 (+40,+30) 逆旋转 −90° 到局部 = (+30,−40)：width +30、height −40
  // （数据 width/height 是局部尺寸，旋转不互换；vpScale=1）
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.width, { timeout: 5000 })
    .toBeCloseTo(s0.width + 30, 0);
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.height, { timeout: 5000 })
    .toBeCloseTo(s0.height - 40, 0);
});
