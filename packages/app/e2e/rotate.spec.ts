import { expect, test, type Page } from '@playwright/test';

/**
 * 旋转 E2E（docs/05 §8 旋转首版）：拖柄落库/undo 单步、Shift 步进、锚定线跟随、
 * 旋转态命中（AABB 角空区不选）、旋转态 resize（指针逆旋转进局部）。
 * 断言走数据探针（vmStates.rotation）+ rotateHandle 探针定位手柄。
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
}

interface Probe {
  count: number;
  shapes: Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  }>;
  lines: Array<{
    id?: string;
    points: Array<[number, number]>;
    startNodeId: string | null;
    endNodeId: string | null;
  }>;
  selected: string[];
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            modelCount: number;
            vmStates: Array<Record<string, unknown>>;
            selectedIds: string[];
          };
        };
      }
    ).__spinth.__debug;
    return {
      count: d.modelCount,
      shapes: d.vmStates
        .filter((s) => s.type === 'SHAPE')
        .map((s) => ({
          id: String(s.id),
          x: s.x as number,
          y: s.y as number,
          width: s.width as number,
          height: s.height as number,
          rotation: s.rotation as number | undefined,
        })),
      lines: d.vmStates
        .filter((s) => s.type === 'LINE')
        .map((s) => ({
          id: String(s.id),
          points: s.points as Array<[number, number]>,
          startNodeId: (s.startNodeId ?? null) as string | null,
          endNodeId: (s.endNodeId ?? null) as string | null,
        })),
      selected: d.selectedIds,
    };
  });
}

async function worldToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy]) => {
      const w = (
        window as unknown as {
          __spinth: {
            viewport: {
              viewportInstance: { toScreen(x: number, y: number): { x: number; y: number } };
            };
          };
        }
      ).__spinth;
      const s = w.viewport.viewportInstance.toScreen(wx, wy);
      return { x: Math.round(s.x), y: Math.round(s.y + 44) };
    },
    [x, y],
  );
}

/** 旋转柄屏幕坐标（探针世界坐标 → 屏幕） */
async function rotateHandleScreen(page: Page): Promise<{ x: number; y: number }> {
  const world = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: { __debug: { rotateHandle: { x: number; y: number } | null } };
      }
    ).__spinth.__debug;
    return d.rotateHandle!;
  });
  return worldToScreen(page, world.x, world.y);
}

async function dragCreateRect(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('r');
  await page.mouse.move(x, y + 44);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80 + 44, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

test('拖旋转柄 90°：rotation 落库（rad）+ undo 一步回未旋转', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-basic-${Date.now()}`);
  await ready(page);

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
  await ready(page);

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

test('锚定线跟随：转宿主 90° → 线重路由 + undo 一步同回', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-anchor-${Date.now()}`);
  await ready(page);

  await dragCreateRect(page, 260, 200);
  await dragCreateRect(page, 620, 240);
  await expect.poll(async () => (await probe(page)).count).toBe(2);

  // line 工具：A 右边中点 → B 左边中点（锚定）。世界 + 44 顶栏偏移：
  // A (260,200,120,80) 右边中点 (380,240)；B (620,240,120,80) 左边中点 (620,280)
  await page.keyboard.press('l');
  await page.mouse.move(380, 284);
  await page.mouse.down();
  await page.mouse.move(620, 324, { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  const p0 = await probe(page);
  expect(p0.lines.length).toBe(1);
  const line0 = p0.lines[0]!;
  expect(line0.startNodeId).toBeTruthy();
  expect(line0.endNodeId).toBeTruthy();

  // 转 A 90°（终点 = 柄起点向量旋转 +90°——柄在 nw 角外斜，2026-10-16 迁移）
  const a = p0.shapes[0]!;
  const center = await worldToScreen(page, a.x + a.width / 2, a.y + a.height / 2);
  const pickA = await worldToScreen(page, a.x + 10, a.y + 10);
  await page.mouse.click(pickA.x, pickA.y);
  const handle = await rotateHandleScreen(page);
  const sv = { x: handle.x - center.x, y: handle.y - center.y };
  const end90 = {
    x: center.x + sv.x * Math.cos(Math.PI / 2) - sv.y * Math.sin(Math.PI / 2),
    y: center.y + sv.x * Math.sin(Math.PI / 2) + sv.y * Math.cos(Math.PI / 2),
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(Math.round(end90.x), Math.round(end90.y), { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeCloseTo(Math.PI / 2, 2);

  const line1 = (await probe(page)).lines[0]!;
  expect(line1.points).not.toEqual(line0.points); // 重路由已发生
  // 顺时针 90°：right 边中点（局部 +x 向）转到正下方——start ≈ (cx, cy + w/2)
  const start = line1.points[0]!;
  expect(start[0]).toBeCloseTo(a.x + a.width / 2, 0);
  expect(start[1]).toBeCloseTo(a.y + a.height / 2 + a.width / 2, 0);

  // undo 一步：rotation 与线 points 同回（同撤销项——急切 reattach 序列）
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await probe(page)).shapes[0]!.rotation, { timeout: 5000 })
    .toBeUndefined();
  const line2 = (await probe(page)).lines[0]!;
  expect(line2.points).toEqual(line0.points);
});

test('旋转态命中：45° 后 AABB 角空区点击不选中、实体中心选中', async ({ page }) => {
  await page.goto(`/?doc=e2e-rotate-hit-${Date.now()}`);
  await ready(page);

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
  await ready(page);

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

test('锚定线扫角无穿体（2026-10-16 用户实测揪出——quantizeJoin 出线方向 + 首末段避让豁免）', async ({
  page,
}) => {
  await page.goto(`/?doc=e2e-rotate-sweep-${Date.now()}`);
  await ready(page);

  // 建 A、B + 线 A右中 → B左中
  for (const [x, y] of [
    [260, 200],
    [620, 240],
  ]) {
    await dragCreateRect(page, x, y);
  }
  await expect.poll(async () => (await probe(page)).count).toBe(2);
  await page.keyboard.press('l');
  await page.mouse.move(380, 284);
  await page.mouse.down();
  await page.mouse.move(620, 324, { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  // 扫 9 个角度：直写 rotation（真实 update 管线触发 reattach）→ 段中点严格体内判定
  for (const deg of [30, 60, 90, 135, 180, 225, 270, 315, 340]) {
    await page.evaluate((d) => {
      const eng = (
        window as unknown as {
          __spinth: {
            engine: {
              yWidgets: { toArray(): Array<{ get(k: string): unknown }> };
              getModelById(id: string): { update(p: Record<string, unknown>): void };
            };
          };
        }
      ).__spinth.engine;
      const shape = eng.yWidgets.toArray().find((w) => w.get('type') === 'SHAPE')!;
      eng.getModelById(shape.get('id') as string).update({ rotation: (d * Math.PI) / 180 });
    }, deg);
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const d = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates;
      const a = d.find((v) => v.type === 'SHAPE')!;
      const l = d.find((v) => v.type === 'LINE')!;
      return {
        a: {
          x: a.x as number,
          y: a.y as number,
          w: a.width as number,
          h: a.height as number,
          r: (a.rotation ?? 0) as number,
        },
        pts: l.points as Array<[number, number]>,
      };
    });
    // 严格体内（margin 3px）采样每段中点
    const cx = r.a.x + r.a.w / 2,
      cy = r.a.y + r.a.h / 2;
    const inBody = (p: [number, number]): boolean => {
      const dx = p[0] - cx,
        dy = p[1] - cy;
      const lx = dx * Math.cos(-r.a.r) - dy * Math.sin(-r.a.r);
      const ly = dx * Math.sin(-r.a.r) + dy * Math.cos(-r.a.r);
      return lx > -r.a.w / 2 + 3 && lx < r.a.w / 2 - 3 && ly > -r.a.h / 2 + 3 && ly < r.a.h / 2 - 3;
    };
    let hits = 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const mid: [number, number] = [
        (r.pts[i]![0] + r.pts[i + 1]![0]) / 2,
        (r.pts[i]![1] + r.pts[i + 1]![1]) / 2,
      ];
      if (inBody(mid)) hits++;
    }
    expect(hits, `deg=${deg} 穿体段数`).toBe(0);
  }
});
