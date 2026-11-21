/** 网络拓扑 E2E（specs/network-diagram §12.1 N-1..N-6）：设备创建/命名/锚定/
 *  区域编组/避障/无填充豁免。坐标纪律：断言走 __spinthDebug.__debug 探针
 *  （世界坐标），指针坐标 = 世界 + 顶栏 44。设备批量搭建走 dev 注入 engine
 *  （bench.spec 先例）；**线一律 UI 拉线**——裸 add 的锚定线不触发 reattach
 *  也不随宿主移动（本批实证），锚定语义必须走真实手势路径。 */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';

const TOP_BAR = 44;
type Pt = [number, number];

interface SymSnap {
  id: string;
  symbol: string;
  label: string;
  color?: string;
  groupId?: string;
  type: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function vmStates<T = SymSnap>(page: Page): Promise<T[]> {
  return page.evaluate(() =>
    (
      window as unknown as { __spinthDebug: { __debug: { vmStates: unknown[] } } }
    ).__spinthDebug.__debug.vmStates.slice(),
  );
}

async function symbolsOf(page: Page): Promise<SymSnap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'SYMBOL') as SymSnap[];
}

/** 批量建设备/区域（engine.add，bench.spec 先例） */
async function engineAdd(page: Page, widgets: Array<Record<string, unknown>>): Promise<void> {
  await page.evaluate((ws) => {
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
  }, widgets);
  await page.waitForTimeout(400);
}

/** 画一条锚定线（连线工具已激活；屏幕坐标） */
async function drawLine(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function activateLineTool(page: Page): Promise<void> {
  await page.keyboard.press('l');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('line');
}

/** 线段与矩形严格相交（内缩 0.5 防贴边误报；flowchart F-4 同款口径） */
function segCrossRect(a: Pt, b: Pt, r: { x: number; y: number; width: number; height: number }) {
  const rx1 = r.x + 0.5;
  const ry1 = r.y + 0.5;
  const rx2 = r.x + r.width - 0.5;
  const ry2 = r.y + r.height - 0.5;
  const inside = (p: Pt) => p[0] > rx1 && p[0] < rx2 && p[1] > ry1 && p[1] < ry2;
  if (inside(a) || inside(b)) return true;
  const cross = (p1: Pt, p2: Pt, x1: number, y1: number, x2: number, y2: number): boolean => {
    const d1 = (x2 - x1) * (p1[1] - y1) - (y2 - y1) * (p1[0] - x1);
    const d2 = (x2 - x1) * (p2[1] - y1) - (y2 - y1) * (p2[0] - x1);
    const d3 = (p2[0] - p1[0]) * (y1 - p1[1]) - (p2[1] - p1[1]) * (x1 - p1[0]);
    const d4 = (p2[0] - p1[0]) * (y2 - p1[1]) - (p2[1] - p1[1]) * (x2 - p1[0]);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  return (
    cross(a, b, rx1, ry1, rx2, ry1) ||
    cross(a, b, rx2, ry1, rx2, ry2) ||
    cross(a, b, rx2, ry2, rx1, ry2) ||
    cross(a, b, rx1, ry2, rx1, ry1)
  );
}

/** 符号图形区四边谓词（symbol.spec S-5 同款）：端点贴图形区矩形边界且不在带内 */
function onGlyphEdge(s: { x: number; y: number; width: number; height: number }, pt: Pt): boolean {
  const g = { x: s.x, y: s.y, w: s.width, h: Math.max(s.height - 32, 0) };
  const insideX = pt[0] >= g.x - 1.5 && pt[0] <= g.x + g.w + 1.5;
  const insideY = pt[1] >= g.y - 1.5 && pt[1] <= g.y + g.h + 1.5;
  const onEdge =
    Math.abs(pt[0] - g.x) < 1.5 ||
    Math.abs(pt[0] - (g.x + g.w)) < 1.5 ||
    Math.abs(pt[1] - g.y) < 1.5 ||
    Math.abs(pt[1] - (g.y + g.h)) < 1.5;
  return insideX && insideY && onEdge;
}

async function obstaclesOf(
  page: Page,
): Promise<Array<{ x: number; y: number; width: number; height: number }> | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { lastRouteObstacles: Array<Record<string, number>> | null } };
        }
      ).__spinthDebug.__debug.lastRouteObstacles,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?doc=e2e-net-${Date.now()}`);
  await waitForSynced(page);
});

test('N-1 工具坞连放 10 设备：计数/类型正确，连击不退工具，flyout 种类记忆', async ({ page }) => {
  await page
    .getByRole('toolbar', { name: '画板工具' })
    .getByRole('button', { name: '符号 (N)' })
    .click();
  const flyoutItem = (label: string) =>
    page.locator(`[data-spinth-tool-flyout] [role="menuitemradio"][aria-label="${label}"]`);
  // 10 设备：服务器×3 路由器×2 交换机×2 防火墙/负载均衡/云×1（§1 清单子集）
  const plan: Array<[string, number, number]> = [
    ['服务器', 150, 120],
    ['服务器', 300, 120],
    ['服务器', 450, 120],
    ['路由器', 150, 300],
    ['路由器', 300, 300],
    ['交换机', 450, 300],
    ['交换机', 600, 300],
    ['防火墙', 600, 120],
    ['负载均衡', 750, 120],
    ['云', 750, 300],
  ];
  let lastKind = '';
  for (const [kind, wx, wy] of plan) {
    if (kind !== lastKind) {
      await flyoutItem(kind).click();
      await page.waitForTimeout(120);
      lastKind = kind;
    }
    await page.mouse.click(wx, wy + TOP_BAR);
    await page.waitForTimeout(80);
  }
  await expect.poll(() => symbolsOf(page).then((s) => s.length)).toBe(10);
  // 连击不退工具（最后一击后仍是 symbol）
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
      ).__spinth.cursorMode$.getValue(),
    ),
  ).toBe('symbol');
  // 类型逐一正确（按放置位置对齐）
  const syms = await symbolsOf(page);
  const byKind: Record<string, string> = {
    服务器: 'net-server',
    路由器: 'net-router',
    交换机: 'net-switch',
    防火墙: 'net-firewall',
    负载均衡: 'net-load-balancer',
    云: 'net-cloud',
  };
  for (const [kind, wx, wy] of plan) {
    const hit = syms.find((s) => Math.abs(s.x - (wx - 48)) < 1 && Math.abs(s.y - (wy - 64)) < 1);
    expect(hit, `${kind}@(${wx},${wy}) 应存在`).toBeDefined();
    expect(hit!.symbol).toBe(byKind[kind]);
  }
});

test('N-2 命名：回车落库、Esc 不落库；缩窄后标签数据完整', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n2a',
      type: 'SYMBOL',
      symbol: 'net-switch',
      label: '',
      x: 200,
      y: 200,
      width: 96,
      height: 128,
    },
    {
      id: 'n2b',
      type: 'SYMBOL',
      symbol: 'net-server',
      label: '',
      x: 400,
      y: 200,
      width: 96,
      height: 128,
    },
  ]);
  await page.keyboard.press('v');

  // Esc = 保存退出（flush 尾字后关闭，docs/17 定稿——spec「Esc 不落库」按
  // 实现语义勘误，2026-11-21 拍板）：输入后 Esc 落库
  await page.mouse.dblclick(248, 220 + TOP_BAR);
  await page.locator('#spinth-text-layer [contenteditable="true"]').click();
  await page.keyboard.type('草稿');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect((await symbolsOf(page)).find((s) => s.id === 'n2a')!.label).toBe('草稿');
  // 清空后 Esc：空标签合法（标签带保留）
  await page.mouse.dblclick(248, 220 + TOP_BAR);
  await page.locator('#spinth-text-layer [contenteditable="true"]').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await symbolsOf(page)).find((s) => s.id === 'n2a')!.label)
    .toBe('');

  // 回车落库
  await page.mouse.dblclick(248, 220 + TOP_BAR);
  await page.locator('#spinth-text-layer [contenteditable="true"]').click();
  await page.keyboard.type('核心交换机');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await symbolsOf(page)).find((s) => s.id === 'n2a')!.label)
    .toBe('核心交换机');

  // 缩窄到 60：渲染单行截断，数据恒存完整文本（specs/symbol-widget §5.4）
  await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: { engine: { getModelById(id: string): { updateRect(r: unknown): void } } };
        };
      }
    ).__spinthDebug.__debug;
    d.engine.getModelById('n2a').updateRect({ x: 200, y: 200, width: 60, height: 128 });
  });
  await expect
    .poll(async () => (await symbolsOf(page)).find((s) => s.id === 'n2a')!.width)
    .toBe(60);
  expect((await symbolsOf(page)).find((s) => s.id === 'n2a')!.label).toBe('核心交换机');
});

test('N-3 锚点：从设备底边拉线——起点贴 A 图形区底（≠bbox 底），端点在 B 图形区边，移动 B 线跟随', async ({
  page,
}) => {
  await engineAdd(page, [
    {
      id: 'n3a',
      type: 'SYMBOL',
      symbol: 'net-server',
      label: 'A',
      x: 252,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n3b',
      type: 'SYMBOL',
      symbol: 'net-database',
      label: 'B',
      x: 552,
      y: 236,
      width: 96,
      height: 128,
    },
  ]);
  await activateLineTool(page);
  // 从 A 图形区底边中点 (300, 332) 拉到 B 中心 (600, 300)
  await drawLine(page, 300, 332 + TOP_BAR, 600, 300 + TOP_BAR);

  const line = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as { points: Pt[] };
  expect(line).toBeDefined();
  const start = line.points[0]!;
  const end = line.points[line.points.length - 1]!;
  // 起点贴 A 图形区底边（y = 236 + 96 = 332），不是 bbox 底（364）
  expect(Math.abs(start[1] - 332)).toBeLessThan(1.5);
  expect(Math.abs(start[1] - 364)).toBeGreaterThan(20);
  // 端点在 B 图形区四边之一、不进标签带（symbol S-5 口径）
  const b = (await symbolsOf(page)).find((s) => s.id === 'n3b')!;
  expect(onGlyphEdge(b, end)).toBe(true);
  expect(end[1]).toBeLessThan(b.y + b.height - 32 + 1.5);

  // 移动 B：线跟随（端点重锚到 B 新图形区边）
  await page.keyboard.press('v');
  await page.mouse.move(600, 300 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(700, 200 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const bAfter = (await symbolsOf(page)).find((s) => s.id === 'n3b')!;
  const line2 = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as {
    points: Pt[];
  };
  const end2 = line2.points[line2.points.length - 1]!;
  expect(onGlyphEdge(bAfter, end2)).toBe(true);
  expect(end2[1]).toBeLessThan(bAfter.y + bAfter.height - 32 + 1.5);
});

test('N-4 区域：无填充虚线框 + TEXT 标题 + 设备编组——整体拖动位移一致、Alt 直选设备', async ({
  page,
}) => {
  await engineAdd(page, [
    // 区域矩形（specs/network-diagram §5.1：fill none + dashed + 宽 1）
    {
      id: 'zone',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'dashed',
      borderWidth: 1,
      fill: 'none',
      autoHeight: false,
      x: 100,
      y: 100,
      width: 400,
      height: 300,
    },
    // 标题：矩形左上角内侧 8px
    {
      id: 'zone-title',
      type: 'TEXT',
      text: '<p>生产 VPC</p>',
      x: 108,
      y: 108,
      width: 160,
      height: 40,
    },
    {
      id: 'n4a',
      type: 'SYMBOL',
      symbol: 'net-server',
      label: '应用 A',
      x: 150,
      y: 200,
      width: 96,
      height: 128,
    },
    {
      id: 'n4b',
      type: 'SYMBOL',
      symbol: 'net-database',
      label: '主库',
      x: 300,
      y: 200,
      width: 96,
      height: 128,
    },
  ]);
  // 框选三件（矩形+标题+两设备 = 四件：区域含两台设备）
  await page.mouse.move(80, 80 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(520, 430 + TOP_BAR, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const selected = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } }).__spinthDebug
        .__debug.selectedIds,
  );
  expect(new Set(selected)).toEqual(new Set(['zone', 'zone-title', 'n4a', 'n4b']));

  // 建组（docs/18）：四件同 groupId
  await page.keyboard.press('ControlOrMeta+g');
  await page.waitForTimeout(300);
  const states = await vmStates(page);
  const ids = ['zone', 'zone-title', 'n4a', 'n4b'];
  const groupIds = ids.map(
    (id) => (states.find((s) => s.id === id) as { groupId?: string })?.groupId,
  );
  expect(groupIds.every((g) => g && g === groupIds[0])).toBe(true);

  // 单击组内设备 = 选中整组；拖动整体位移一致
  const before = ids.map((id) => states.find((s) => s.id === id) as SymSnap);
  await page.mouse.move(198, 264 + TOP_BAR); // 设备 A 中心
  await page.mouse.down();
  await page.mouse.move(318, 364 + TOP_BAR, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await vmStates(page);
  for (let i = 0; i < ids.length; i++) {
    const b = before[i]!;
    const a = after.find((s) => s.id === ids[i]) as SymSnap;
    expect(Math.abs(a.x - b.x - 120)).toBeLessThan(2, `${ids[i]} 位移`);
    expect(Math.abs(a.y - b.y - 100)).toBeLessThan(2, `${ids[i]} 位移`);
  }

  // Alt 直选设备（进组，docs/18 §4.2）
  await page.keyboard.down('Alt');
  await page.mouse.click(468, 348 + TOP_BAR); // 移动后 B 图形区中心（避开叠放边界的标签带）
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);
  const selectedAlt = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } }).__spinthDebug
        .__debug.selectedIds,
  );
  expect(selectedAlt).toEqual(['n4b']);
});

test('N-5 避障：三设备横排，首尾连线绕开中间设备（探针含其障碍集合）', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n5a',
      type: 'SYMBOL',
      symbol: 'net-server',
      label: 'A',
      x: 252,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n5mid',
      type: 'SYMBOL',
      symbol: 'net-switch',
      label: 'M',
      x: 552,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n5c',
      type: 'SYMBOL',
      symbol: 'net-router',
      label: 'C',
      x: 852,
      y: 236,
      width: 96,
      height: 128,
    },
  ]);
  await activateLineTool(page);
  await drawLine(page, 300, 300 + TOP_BAR, 900, 300 + TOP_BAR); // A 中心 → C 中心，水平正穿 M

  const mid = (await symbolsOf(page)).find((s) => s.id === 'n5mid')!;
  const obstacles = await obstaclesOf(page);
  expect(obstacles).not.toBeNull();
  expect(
    obstacles!.some(
      (o) =>
        Math.abs(o.x - mid.x) <= 1 &&
        Math.abs(o.y - mid.y) <= 1 &&
        Math.abs(o.width - mid.width) <= 1 &&
        Math.abs(o.height - mid.height) <= 1,
    ),
  ).toBe(true);

  // 绕行：任一段不穿 M 的 AABB
  const line = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as { points: Pt[] };
  expect(line.points.length).toBeGreaterThanOrEqual(3);
  const midRect = { x: mid.x, y: mid.y, width: mid.width, height: mid.height };
  for (let i = 0; i + 1 < line.points.length; i++) {
    expect(segCrossRect(line.points[i]!, line.points[i + 1]!, midRect)).toBe(false);
  }
});

test('N-6 无填充区域不挡线：线从区域框上穿过、框不入障碍集合', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n6a',
      type: 'SYMBOL',
      symbol: 'net-user',
      label: '客户端',
      x: 252,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n6b',
      type: 'SYMBOL',
      symbol: 'net-internet',
      label: 'Internet',
      x: 652,
      y: 236,
      width: 96,
      height: 128,
    },
    // 大无填充区域框盖住 A→B 走廊（B 在框内——设备进区域是拓扑常态）
    {
      id: 'n6zone',
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'dashed',
      borderWidth: 1,
      fill: 'none',
      autoHeight: false,
      x: 420,
      y: 140,
      width: 320,
      height: 320,
    },
  ]);
  await activateLineTool(page);
  await drawLine(page, 300, 300 + TOP_BAR, 700, 300 + TOP_BAR); // A 中心 → B 中心，水平穿框

  // 框不在最近一次避障集合（实心符号 A/B 是端点宿主被排除，框应缺席）
  const zone = (await vmStates(page)).find((s) => s.id === 'n6zone') as SymSnap;
  const obstacles = await obstaclesOf(page);
  expect(obstacles).not.toBeNull();
  expect(
    obstacles!.some(
      (o) =>
        Math.abs(o.x - zone.x) <= 1 &&
        Math.abs(o.y - zone.y) <= 1 &&
        Math.abs(o.width - zone.width) <= 1 &&
        Math.abs(o.height - zone.height) <= 1,
    ),
    `无填充框不应入障碍集合，实际 ${JSON.stringify(obstacles)}`,
  ).toBe(false);

  // 线从框上穿过：某段与框矩形相交（豁免的直接语义）
  const line = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as { points: Pt[] };
  const zoneRect = { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
  const crossing = line.points.some(
    (p, i) => i + 1 < line.points.length && segCrossRect(p, line.points[i + 1]!, zoneRect),
  );
  expect(crossing, '线应穿过无填充区域框（不绕行）').toBe(true);
});
