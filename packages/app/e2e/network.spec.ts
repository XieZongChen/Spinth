/** 网络拓扑 E2E（specs/network-diagram §12.1 N-1..N-11）：创建/命名/锚定/
 *  区域编组/避障/无填充豁免/同边多线/撤销/持久化/项目文件往返+PNG/只读。
 *  坐标纪律：断言走 __spinthDebug.__debug 探针
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
  const g = { x: s.x, y: s.y, w: s.width, h: Math.max(s.height - 28, 0) };
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

test('N-2 命名：回车/Esc 均落库（flush 语义）、清空合法；缩窄后标签数据完整', async ({ page }) => {
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
  // 从 A 图形区底边中点 (300, 336) 拉到 B 中心 (600, 300)——图形区底 = 236+100（GAP 4）
  await drawLine(page, 300, 336 + TOP_BAR, 600, 300 + TOP_BAR);

  const line = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as { points: Pt[] };
  expect(line).toBeDefined();
  const start = line.points[0]!;
  const end = line.points[line.points.length - 1]!;
  // 起点贴 A 图形区底边（y = 236 + 100 = 336），不是 bbox 底（364）
  expect(Math.abs(start[1] - 336)).toBeLessThan(1.5);
  expect(Math.abs(start[1] - 364)).toBeGreaterThan(20);
  // 端点在 B 图形区四边之一、不进标签带（symbol S-5 口径）
  const b = (await symbolsOf(page)).find((s) => s.id === 'n3b')!;
  expect(onGlyphEdge(b, end)).toBe(true);
  expect(end[1]).toBeLessThan(b.y + b.height - 28 + 1.5);

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
  expect(end2[1]).toBeLessThan(bAfter.y + bAfter.height - 28 + 1.5);
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

test('N-7 同边多线：两条线默认重叠，拖端点分开后各自落库', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n7a',
      type: 'SYMBOL',
      symbol: 'net-server',
      label: 'A',
      x: 252,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n7b',
      type: 'SYMBOL',
      symbol: 'net-switch',
      label: 'B',
      x: 652,
      y: 236,
      width: 96,
      height: 128,
    },
  ]);
  await activateLineTool(page);
  await drawLine(page, 300, 300 + TOP_BAR, 700, 300 + TOP_BAR); // 线 1
  await drawLine(page, 300, 300 + TOP_BAR, 700, 300 + TOP_BAR); // 线 2（同手势）
  const lines = async () =>
    (
      (await vmStates(page)).filter((s) => s.type === 'LINE') as unknown as Array<{
        points: Pt[];
        endNodeId: string | null;
        endPort?: number | null;
      }>
    ).sort((a, b) => a.points[0]![0] - b.points[0]![0]);
  // 默认重叠：同边 0.5 单点——两线起点相同（docs/08 §3）
  let ls = await lines();
  expect(ls).toHaveLength(2);
  expect(Math.abs(ls[0]!.points[0]![0] - ls[1]!.points[0]![0])).toBeLessThan(1.5);
  expect(Math.abs(ls[0]!.points[0]![1] - ls[1]!.points[0]![1])).toBeLessThan(1.5);

  // 选中一条（点重叠路径中段——命中 z 序最上者），拖**选中那条**的终点手柄
  // （点击命中的不一定是排序 ls[1]——手柄坐标必须按 selectedIds 重读）
  await page.keyboard.press('v');
  const anyPts = ls[1]!.points;
  const mid = Math.floor(anyPts.length / 2);
  await page.mouse.click(
    (anyPts[mid - 1]![0] + anyPts[mid]![0]) / 2,
    (anyPts[mid - 1]![1] + anyPts[mid]![1]) / 2 + TOP_BAR,
  );
  await page.waitForTimeout(250);
  const selId = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } }).__spinthDebug
        .__debug.selectedIds[0],
  );
  expect(selId).toBeTruthy();
  const selPts = ((await vmStates(page)).find((v) => v.id === selId) as unknown as { points: Pt[] })
    .points;
  const endPt = selPts[selPts.length - 1]!;
  await page.mouse.move(endPt[0], endPt[1] + TOP_BAR);
  await page.mouse.down();
  // B 顶边非中点（t≈0.21）——拖到边中点 = 显式 port 0.5 = 默认同位（不分开）
  await page.mouse.move(672, 236 + TOP_BAR, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // 分开后各自落库：两线终点分开（欧氏距离——同边不同锚点 x 可能相同、差在 y）
  ls = await lines();
  const e0 = ls[0]!.points.at(-1)!;
  const e1 = ls[1]!.points.at(-1)!;
  expect(Math.hypot(e0[0] - e1[0], e0[1] - e1[1])).toBeGreaterThan(10);
  expect(ls.every((l) => l.endNodeId === 'n7b')).toBe(true);
});

test('N-8 撤销/重做：删除、移动、建组各一步，创建再一步（四个独立撤销步）', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n8z',
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
    {
      id: 'n8a',
      type: 'SYMBOL',
      symbol: 'net-server',
      label: 'A',
      x: 150,
      y: 200,
      width: 96,
      height: 128,
    },
    {
      id: 'n8b',
      type: 'SYMBOL',
      symbol: 'net-database',
      label: 'B',
      x: 300,
      y: 200,
      width: 96,
      height: 128,
    },
  ]);
  await page.waitForTimeout(700); // 出创建捕获窗：建组独立成步
  // 建组（框选三件）
  await page.mouse.move(80, 80 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(520, 430 + TOP_BAR, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+g');
  await page.waitForTimeout(700);
  const groupOf = async () => {
    const st = await vmStates(page);
    return (st.find((s) => s.id === 'n8a') as { groupId?: string })?.groupId ?? null;
  };
  expect(await groupOf()).toBeTruthy();
  // 移动组（拖 A 中心）
  await page.mouse.move(198, 264 + TOP_BAR);
  await page.mouse.down();
  await page.mouse.move(278, 304 + TOP_BAR, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const movedX = async () => (await vmStates(page)).find((s) => s.id === 'n8a')!.x;
  const afterMove = await movedX();
  // 删除组（选中态即整组）
  await page.keyboard.press('Delete'); // edit.delete = delete,backspace（无修饰）
  await page.waitForTimeout(700);
  await expect.poll(async () => (await vmStates(page)).length).toBe(0);

  // undo 1：删除回退（三件回来）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await vmStates(page)).length).toBe(3);
  // undo 2：移动回退
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => movedX()).not.toBe(afterMove);
  // undo 3：建组回退（groupId 清除）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => groupOf()).toBe(null);
  // undo 4：创建回退（全删）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await vmStates(page)).length).toBe(0);
  // 重放（每次等模型恢复再按——redo 背靠背会丢拍，symbol S-7 同坑）：
  // redo1=创建（件回）、redo2=建组（groupId 回）→ 中间态断点；redo3=移动、
  // redo4=删除——**redo 全链终态 = 删除后**（与 undo 前一致）
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(300);
  }
  await expect.poll(async () => (await vmStates(page)).length).toBe(3);
  expect(await groupOf()).toBeTruthy();
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(300);
  }
  await expect.poll(async () => (await vmStates(page)).length).toBe(0);
});

test('N-9 持久化：刷新后设备/标签/颜色/组/线全部保真', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n9a',
      type: 'SYMBOL',
      symbol: 'net-firewall',
      label: 'DMZ 防火墙',
      color: '#dc2626',
      groupId: 'g-net',
      x: 252,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n9b',
      type: 'SYMBOL',
      symbol: 'net-internet',
      label: 'Internet',
      groupId: 'g-net',
      x: 552,
      y: 236,
      width: 96,
      height: 128,
    },
  ]);
  await activateLineTool(page);
  await drawLine(page, 300, 300 + TOP_BAR, 600, 300 + TOP_BAR);
  const lineBefore = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as {
    points: Pt[];
    startNodeId: string;
    endNodeId: string;
  };
  // 刷新（先等防抖持久化落盘——S-7 教训）
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __spinth: { persistState$: { getValue(): string } } }
      ).__spinth.persistState$.getValue() === 'saved',
    undefined,
    { timeout: 10_000 },
  );
  await page.reload();
  await waitForSynced(page);
  // IndexedDB 存 Yjs 增量日志：恢复时创建事务先到、标签/颜色事务后到——poll 等
  await expect
    .poll(async () => (await symbolsOf(page)).find((s) => s.id === 'n9a')?.label)
    .toBe('DMZ 防火墙');
  const a = (await symbolsOf(page)).find((s) => s.id === 'n9a')!;
  expect(a.color).toBe('#dc2626');
  expect(a.groupId).toBe('g-net');
  const b = (await symbolsOf(page)).find((s) => s.id === 'n9b')!;
  expect(b.groupId).toBe('g-net');
  await expect
    .poll(async () => {
      const l = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as
        { points: Pt[] } | undefined;
      return l?.points?.at(-1)?.[1];
    })
    .toBeLessThan(236 + 128); // 线回来了且终点在 B 的 bbox 上方（图形区边）
  const lineAfter = (await vmStates(page)).find((s) => s.type === 'LINE') as unknown as {
    startNodeId: string;
    endNodeId: string;
  };
  expect(lineAfter.startNodeId).toBe(lineBefore.startNodeId);
  expect(lineAfter.endNodeId).toBe(lineBefore.endNodeId);
});

test('N-10 项目文件往返 + PNG 导出：设备/标签/组/线在新文档恢复', async ({ page }) => {
  await engineAdd(page, [
    {
      id: 'n10a',
      type: 'SYMBOL',
      symbol: 'net-load-balancer',
      label: 'LB-01',
      groupId: 'g-rt',
      x: 252,
      y: 236,
      width: 96,
      height: 128,
    },
    {
      id: 'n10b',
      type: 'SYMBOL',
      symbol: 'net-storage',
      label: '对象存储',
      groupId: 'g-rt',
      x: 552,
      y: 236,
      width: 96,
      height: 128,
    },
  ]);
  await activateLineTool(page);
  await drawLine(page, 300, 300 + TOP_BAR, 600, 300 + TOP_BAR);

  // 导出 .spinth.zip（符号零资产条目——zip 内无 assets/ 之外的内容变动）
  // 导入导航等待必须先等 URL 切走（helper 注释的坑：只等 synced 会撞在途导航）
  const { exportViaMenu, importViaInput, waitForImportedNav } =
    await import('./helpers/projectFileE2e');
  const docBefore = (await page.url().match(/doc=([^&]+)/))![1]!;
  const { fileName, path } = await exportViaMenu(page);
  expect(fileName).toMatch(/^spinth-e2e-net-\d+-\d{8}-\d{6}\.spinth\.zip$/);
  const { unzipSync } = await import('fflate');
  const zip = unzipSync(new Uint8Array((await import('node:fs')).readFileSync(path)));
  expect(zip['manifest.json']).toBeTruthy();
  expect(zip['document.yjs']).toBeTruthy();

  // 导入为新文档 → 全量恢复
  await importViaInput(page, path);
  await waitForImportedNav(page, docBefore);
  await expect
    .poll(async () => (await symbolsOf(page)).find((s) => s.id === 'n10a')?.label)
    .toBe('LB-01');
  const a = (await symbolsOf(page)).find((s) => s.id === 'n10a')!;
  expect(a.groupId).toBe('g-rt');
  const b = (await symbolsOf(page)).find((s) => s.id === 'n10b')!;
  expect(b.symbol).toBe('net-storage');
  await expect
    .poll(async () => (await vmStates(page)).filter((s) => s.type === 'LINE').length)
    .toBe(1);

  // PNG 导出（右键菜单整画布）
  await page.mouse.click(200, 500, { button: 'right' });
  const menu = page.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  const dl = page.waitForEvent('download', { timeout: 10_000 });
  await menu.getByRole('menuitem', { name: '导出画布 PNG' }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe('spinth-board.png');
  const pngPath = await download.path();
  expect((await import('node:fs')).statSync(pngPath!).size).toBeGreaterThan(1000);
});

test('N-11 只读：工具禁用、双击不进编辑、ActionBar 不出现', async ({ page, context }) => {
  const docId = (await page.url().match(/doc=([^&]+)/))![1]!;
  await engineAdd(page, [
    {
      id: 'n11a',
      type: 'SYMBOL',
      symbol: 'net-router',
      label: '核心路由',
      x: 200,
      y: 200,
      width: 96,
      height: 128,
    },
  ]);
  await expect.poll(() => symbolsOf(page).then((s) => s.length)).toBe(1);

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}`);
  await waitForSynced(pageB);
  await pageB.waitForFunction(
    (r) =>
      document.querySelector('[data-spinth-tab-role]')?.getAttribute('data-spinth-tab-role') === r,
    'follower',
    { timeout: 20_000 },
  );
  await expect.poll(() => symbolsOf(pageB).then((s) => s.length)).toBe(1);

  // 工具禁用（符号/形状/连线）
  const bar = pageB.getByRole('toolbar', { name: '画板工具' });
  await expect(bar.getByRole('button', { name: '符号 (N)' })).toBeDisabled();
  await expect(bar.getByRole('button', { name: /\(R\)$/ })).toBeDisabled();
  await expect(bar.getByRole('button', { name: /连线/ })).toBeDisabled();

  // 双击设备图形区中心不进编辑
  await pageB.mouse.dblclick(248, 248 + TOP_BAR);
  await pageB.waitForTimeout(300);
  await expect(pageB.locator('#spinth-text-layer [contenteditable="true"]')).toBeHidden();

  // 只读不建选区 → ActionBar 不出现（multiTabReadonly 口径）
  await pageB.mouse.click(248, 248 + TOP_BAR);
  await pageB.waitForTimeout(300);
  await expect(
    await pageB.evaluate(
      () =>
        (
          window as unknown as { __spinth: { selected$: { getValue(): string[] } } }
        ).__spinth.selected$.getValue().length,
    ),
  ).toBe(0);
  await expect(pageB.locator('[data-spinth-action-bar]')).toHaveCount(0);
});
