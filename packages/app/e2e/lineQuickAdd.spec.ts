/** quick-add E2E（docs/08 §10 批次 2）：四点常显/点击建对/交替落位/打断清理 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { lineProbe, createRect } from './helpers/widgetProbeE2e';

test('批次2：选中形状四点常显；hover 连接点放大出影子；拖点建线两端锚定', async ({ page }) => {
  const docId = `e2e-quickbtn-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  await createRect(page, 850, 550);

  // 选中 A（cursor 模式点击）→ 四向连接点常显（探针非空）
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  let p = await lineProbe(page);
  expect(p.lineAnchors).not.toBeNull();
  expect(p.lineAnchors!).toHaveLength(4);
  expect(p.cursorMode).toBe('cursor');

  // 指针移到底边锚点上（client = world + 44 画布偏移）→ 未到外移点：无影子
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const anchorClient = { x: 450 + c.left, y: 346 + c.top }; // A 底锚 (450,346) world
  await page.mouse.move(anchorClient.x, anchorClient.y);
  await page.waitForTimeout(150);
  p = await lineProbe(page);
  expect(p.lineGhost).toBe(false);

  // 按下连接点（形状外 24px 外移点）→ hover 命中：该点放大（bottom=2）+ 影子预览。
  // 沉降等待：CI 慢环境下 hover/渲染管线滞后会让判定落空
  await page.mouse.move(anchorClient.x, anchorClient.y + 24);
  await page.waitForTimeout(250);
  const preDown = await lineProbe(page);
  console.log(
    '[pre-down]',
    JSON.stringify({
      anchors: preDown.lineAnchors?.length,
      active: preDown.lineAnchorActive,
      ghost: preDown.lineGhost,
    }),
  );
  expect(preDown.lineAnchorActive).toBe(2); // bottom（JOINS 序 top/right/bottom/left）
  expect(preDown.lineGhost).toBe(true); // hover 影子预览（参考同款）

  await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(350);
  p = await lineProbe(page);
  console.log('[after-drop]', JSON.stringify({ mc: p.modelCount, sel: p.selectedIds }));
  expect(p.modelCount).toBe(3); // 2 rect + 1 line
  const line = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const l = d.find((s) => s.type === 'LINE') as unknown as {
      startNodeId: string | null;
      endNodeId: string | null;
    };
    return { s: l.startNodeId, e: l.endNodeId };
  });
  expect(line.s).not.toBeNull();
  expect(line.e).not.toBeNull();
  void c;
});

test('批次2：点击连接点 = quick-add（连线 + 默认矩形自动创建）', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  const docId = `e2e-quickadd-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);

  // 选中 A → 移到底锚外移点（连接点）→ hover 影子 → 点击
  await page.mouse.click(450, 350);
  await page.waitForTimeout(200);
  console.log('[after-select]', JSON.stringify((await lineProbe(page)).selectedIds));
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  await page.mouse.move(450 + c.left, 346 + 24 + c.top); // 连接点（边中点外 24）
  await page.waitForTimeout(250);
  const atDot = await lineProbe(page);
  console.log(
    '[at-dot]',
    JSON.stringify({
      sel: atDot.selectedIds,
      ghost: atDot.lineGhost,
      active: atDot.lineAnchorActive,
    }),
  );
  expect(atDot.lineGhost).toBe(true); // hover 连接点 → 影子预览
  // 点击（down+up 无位移）= quick-add
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);

  const d = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: {
          __debug: { vmStates: Array<Record<string, unknown>> };
          selectedIds: string[];
        };
      }
    ).__spinthDebug.__debug;
    const shapes = dd.vmStates.filter((s) => s.type === 'SHAPE');
    const lineVm = dd.vmStates.find((s) => s.type === 'LINE') as unknown as {
      startNodeId: string | null;
      endNodeId: string | null;
      id: string;
    };
    const line = { startNodeId: lineVm.startNodeId, endNodeId: lineVm.endNodeId, id: lineVm.id };
    return { shapes, line, selectedIds: dd.selectedIds };
  });
  expect(d.shapes).toHaveLength(2);
  expect(d.line.startNodeId).not.toBeNull();
  expect(d.line.endNodeId).not.toBeNull();
  const newShape = d.shapes.find((s) => String(s.id) !== d.line.startNodeId)!;
  console.log(
    '[ids]',
    JSON.stringify({
      sel: d.selectedIds,
      start: d.line.startNodeId,
      end: d.line.endNodeId,
      shapes: d.shapes.map((s) => String(s.id)),
    }),
  );
  expect(d.selectedIds).toEqual([String(newShape.id)]); // 选中新形状
  // 新矩形在 A 底锚正下 QUICK_ADD_GAP（110px，锚 (450,346) → 中心 (450,496) world）
  expect(Math.abs(Number(newShape.x) + Number(newShape.width) / 2 - 450)).toBeLessThanOrEqual(2);
});

test('批次2：quick-add 方向被形状占据 → 只建连线锚定它（参考：无新形状、选中连线）', async ({
  page,
}) => {
  const docId = `e2e-quickadd-occupied-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);

  // 从探针取 A 实测 bounds → B 放在 A 右侧 quick-add 落位矩形处（坐标反推铁律）
  const a = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const s = d.find((v) => v.type === 'SHAPE') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: Number(s.x), y: Number(s.y), w: Number(s.width), h: Number(s.height) };
  });
  // 右锚 = (a.x+a.w, a.y+a.h/2)；落位矩形近边 = 右锚 x + 110，宽 = a.w
  const bCx = a.x + a.w + 110 + a.w / 2;
  const bCy = a.y + a.h / 2;
  await createRect(page, bCx, bCy);
  await page.waitForTimeout(200);

  // 选中 A → hover 右外移点（右锚 + 24px）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  await page.mouse.click(a.x + a.w / 2 + c.left, a.y + a.h / 2 + c.top);
  await page.waitForTimeout(250);
  await page.mouse.move(a.x + a.w + 24 + c.left, a.y + a.h / 2 + c.top);
  await page.waitForTimeout(250);
  const atDot = await lineProbe(page);
  expect(atDot.lineGhost).toBe(true);
  expect(atDot.lineGhostMode).toBe('line'); // 预览 = 灰线连已有形状（非幽灵矩形）

  // 点击（无位移）→ 只有连线：无新形状、锚定 B、选中连线
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const d = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: {
          __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] };
        };
      }
    ).__spinthDebug.__debug;
    return {
      shapes: dd.vmStates.filter((s) => s.type === 'SHAPE'),
      line: dd.vmStates.find((s) => s.type === 'LINE') as unknown as
        { id: string; startNodeId: string | null; endNodeId: string | null } | undefined,
      selectedIds: dd.selectedIds,
    };
  });
  expect(d.shapes).toHaveLength(2); // 无第三个形状
  expect(d.line).toBeDefined();
  expect(d.line!.startNodeId).not.toBeNull();
  expect(d.line!.endNodeId).not.toBeNull(); // 锚定 B
  expect(d.line!.endNodeId).not.toBe(d.line!.startNodeId);
  expect(d.selectedIds).toEqual([d.line!.id]); // 参考：选中连线（非目标形状）

  // 对照：底方向空闲 → 幽灵矩形模式 + 点击仍建新形状
  await page.keyboard.press('Escape'); // 清选区（连线选中态）
  await page.waitForTimeout(200);
  await page.mouse.click(a.x + a.w / 2 + c.left, a.y + a.h / 2 + c.top); // 重新选中 A
  await page.waitForTimeout(250);
  await page.mouse.move(a.x + a.w / 2 + c.left, a.y + a.h + 24 + c.top); // 底外移点
  await page.waitForTimeout(250);
  const atBottom = await lineProbe(page);
  expect(atBottom.lineGhostMode).toBe('rect'); // 空闲方向 = 幽灵矩形
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates.filter((s) => s.type === 'SHAPE').length,
  );
  expect(after).toBe(3); // 空闲方向正常建新形状
});

test('批次2：quick-add 方向已有带连线元素 → 新形状一上一下交替错开（参考折线分支）', async ({
  page,
}) => {
  const docId = `e2e-quickadd-stagger-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);

  // A 实测 bounds；B 放 A 右侧正对落位（先作为无连线孤立元素被接入）
  const a = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const s = d.find((v) => v.type === 'SHAPE') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: Number(s.x), y: Number(s.y), w: Number(s.width), h: Number(s.height) };
  });
  const bCx = a.x + a.w + 110 + a.w / 2;
  const bCy = a.y + a.h / 2;
  await createRect(page, bCx, bCy);
  await page.waitForTimeout(200);

  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const aCx = a.x + a.w / 2;
  const aCy = a.y + a.h / 2;
  const hoverRightDot = async () => {
    await page.mouse.click(aCx + c.left, aCy + c.top); // 选中 A
    await page.waitForTimeout(250);
    await page.mouse.move(a.x + a.w + 24 + c.left, aCy + c.top); // 右外移点
    await page.waitForTimeout(250);
  };
  const clickDot = async () => {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  const snapshot = () =>
    page.evaluate(() => {
      const dd = (
        window as unknown as {
          __spinthDebug: {
            __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] };
          };
        }
      ).__spinthDebug.__debug;
      return {
        shapes: dd.vmStates.filter((s) => s.type === 'SHAPE') as Array<{
          id: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }>,
        lines: dd.vmStates.filter((s) => s.type === 'LINE') as Array<{
          id: string;
          startJoin: string | null;
          endJoin: string | null;
          endNodeId: string | null;
          points: Array<[number, number]>;
        }>,
        selectedIds: dd.selectedIds,
      };
    });

  // 第一次：B 无连线 → 只连线接入（右边出线 1 条 = 分支成员 B）
  await hoverRightDot();
  await clickDot();
  let s = await snapshot();
  expect(s.shapes).toHaveLength(2);
  expect(s.lines).toHaveLength(1);
  const aId = s.shapes.find((sh) => Number(sh.x) === a.x)!.id;
  const bId = s.shapes.find((sh) => sh.id !== aId)!.id;

  // 第二次：方向已有带连线元素 → 新形状错开「上 1 槽」（stride = 80 + 70 = 150，整卡位不重叠）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await hoverRightDot();
  const atDot = await lineProbe(page);
  expect(atDot.lineGhostMode).toBe('rect'); // 预览 = 幽灵矩形（错开落位）
  await clickDot();
  s = await snapshot();
  expect(s.shapes).toHaveLength(3); // 新形状 C（不再叠加到 B 上）
  const up = s.shapes.find((sh) => sh.id !== aId && sh.id !== bId)!;
  expect(Number(up.x) + Number(up.width) / 2).toBeCloseTo(bCx, 0); // x 仍正对
  expect(Number(up.y) + Number(up.height) / 2).toBeCloseTo(bCy - 150, 0); // 上 1 槽
  const lineC = s.lines.find((l) => l.endNodeId === up.id)!;
  expect(lineC.points.length).toBeGreaterThanOrEqual(3); // routeElbow 折线（拐弯接入）
  expect(s.selectedIds).toEqual([up.id]); // 选中新形状

  // 第三次：第 3 槽 = 下 1（一上一下交替）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await hoverRightDot();
  await clickDot();
  s = await snapshot();
  expect(s.shapes).toHaveLength(4);
  const down = s.shapes.find((sh) => sh.id !== aId && sh.id !== bId && sh.id !== up.id)!;
  expect(Number(down.y) + Number(down.height) / 2).toBeCloseTo(bCy + 150, 0); // 下 1 槽
  expect(s.lines.find((l) => l.endNodeId === down.id)).toBeDefined();

  // 三次后 A 右边 3 条线：点击落定重排已物化分槽（起点 y 互异——未物化则
  // 全停在连接点 t=0.5 同一 y，2026-11 quick-add 落定重排修复的创建侧锁）
  const aRight = s.lines.filter((l) => l.startJoin === 'right' && l.points.length >= 2);
  expect(aRight.length).toBe(3);
  const startYs = aRight.map((l) => Number(l.points[0]![1]));
  expect(new Set(startYs).size).toBe(3);

  // 删除 B（第一次接入的目标）：A→B 线解绑悬空原位（解绑保持原位契约）；
  // 组内悬空端仍计数 → 幸存线槽位不变 → 起点不跳槽（2026-11 用户实测
  // 「同方向 quick-add 两节点删其一、两条连线扭曲」的回归锁——扭曲根因
  // 是创建时未物化槽位、删除时首次物化跳槽重路由）
  const beforeDel = await snapshot();
  const lineB = beforeDel.lines.find((l) => l.endNodeId === bId)!;
  const survivorsBefore = beforeDel.lines
    .filter((l) => l.id !== lineB.id)
    .map((l) => [l.id, l.points[0]] as const);
  // 选中 B：B 中心可能被 A→up 折线穿过（点击命中线不命中形）——扫 B 内部
  // 点位直到选中 B 为止
  const bShape = beforeDel.shapes.find((sh) => sh.id === bId)!;
  const bX = Number(bShape.x);
  const bY = Number(bShape.y);
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.2, 0.8],
    [0.8, 0.2],
    [0.15, 0.15],
    [0.85, 0.85],
    [0.5, 0.15],
  ]) {
    await page.mouse.click(
      bX + Number(bShape.width) * fx + c.left,
      bY + Number(bShape.height) * fy + c.top,
    );
    await page.waitForTimeout(180);
    const selNow = (await snapshot()).selectedIds;
    if (selNow.length === 1 && selNow[0] === bId) break;
  }
  expect((await snapshot()).selectedIds).toEqual([bId]);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const afterDel = await snapshot();
  expect(afterDel.shapes).toHaveLength(3); // B 已删
  const dangling = afterDel.lines.find((l) => l.id === lineB.id)!;
  expect(dangling.endNodeId).toBeNull(); // 解绑为自由端
  expect(JSON.stringify(dangling.points)).toBe(JSON.stringify(lineB.points)); // 原位不动
  for (const [id, start] of survivorsBefore) {
    const l = afterDel.lines.find((x) => x.id === id)!;
    expect(JSON.stringify(l.points[0])).toBe(JSON.stringify(start)); // 起点槽位不跳
  }
});

test('批次2：quick-add 垂直方向已有带连线元素 → 新形状一右一左错开', async ({ page }) => {
  const docId = `e2e-quickadd-stagger-v-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);

  const a = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const s = d.find((v) => v.type === 'SHAPE') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: Number(s.x), y: Number(s.y), w: Number(s.width), h: Number(s.height) };
  });
  const aCx = a.x + a.w / 2;
  const aCy = a.y + a.h / 2;
  const bCx = aCx; // B 放 A 正下落位
  const bCy = a.y + a.h + 110 + a.h / 2;
  await createRect(page, bCx, bCy);
  await page.waitForTimeout(200);

  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const hoverBottomDot = async () => {
    await page.mouse.click(aCx + c.left, aCy + c.top);
    await page.waitForTimeout(250);
    await page.mouse.move(aCx + c.left, a.y + a.h + 24 + c.top); // 底外移点
    await page.waitForTimeout(250);
  };
  const clickDot = async () => {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  // 第一次：B 无连线 → 只连线（底边出线 1 条）
  await hoverBottomDot();
  await clickDot();
  const first = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug;
    return dd.vmStates.filter((v) => v.type === 'SHAPE') as Array<{ id: string; x: number }>;
  });
  expect(first).toHaveLength(2);

  // 第二次：底方向已有带连线元素 → 新形状「右 1 槽」（stride = 120 + 70 = 190，整卡位不重叠）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await hoverBottomDot();
  await clickDot();
  const s = await page.evaluate(() => {
    const dd = (
      window as unknown as {
        __spinthDebug: {
          __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] };
        };
      }
    ).__spinthDebug.__debug;
    return {
      shapes: dd.vmStates.filter((v) => v.type === 'SHAPE') as Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>,
      lines: dd.vmStates.filter((v) => v.type === 'LINE') as Array<{
        id: string;
        startJoin: string | null;
        endNodeId: string | null;
        points: Array<[number, number]>;
      }>,
      selectedIds: dd.selectedIds,
    };
  });
  expect(s.shapes).toHaveLength(3);
  const aIdV = first.find((sh) => Number(sh.x) === a.x)!.id;
  const bIdV = first.find((sh) => sh.id !== aIdV)!.id;
  const right = s.shapes.find((sh) => sh.id !== aIdV && sh.id !== bIdV)!;
  expect(Number(right.y) + Number(right.height) / 2).toBeCloseTo(bCy, 0); // y 仍正对
  expect(Number(right.x) + Number(right.width) / 2).toBeCloseTo(aCx + 190, 0); // 右 1 槽
  const lineR = s.lines.find((l) => l.endNodeId === right.id)!;
  expect(lineR.startJoin).toBe('bottom'); // 从源同一边（底）出发
  expect(lineR.points.length).toBeGreaterThanOrEqual(3); // 折线
  expect(s.selectedIds).toEqual([right.id]);
});

test('批次2：quick-add 手势被打断（pointercancel）→ 零长草稿线清理不残留', async ({ page }) => {
  const docId = `e2e-quickadd-cancel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);
  const a = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const s = d.find((v) => v.type === 'SHAPE') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: Number(s.x), y: Number(s.y), w: Number(s.width), h: Number(s.height) };
  });
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());

  // 选中 A → 按下右连接点（startConnectorFrom 立即建零长草稿线）→ 不松手直接打断。
  // cancel 事件坐标必须给按下点（复审教训：分支判定依赖事件坐标，坐标是实验变量）
  await page.mouse.click(a.x + a.w / 2 + c.left, a.y + a.h / 2 + c.top);
  await page.waitForTimeout(250);
  const dotX = a.x + a.w + 24 + c.left;
  const dotY = a.y + a.h / 2 + c.top;
  await page.mouse.move(dotX, dotY);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const during = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { modelCount: number } } }).__spinthDebug
        .__debug.modelCount,
  );
  expect(during).toBe(2); // A + 按下即建的草稿线

  await page.evaluate(
    ([x, y]) => window.dispatchEvent(new PointerEvent('pointercancel', { clientX: x, clientY: y })),
    [dotX, dotY],
  );
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: { vmStates: Array<Record<string, unknown>>; modelCount: number };
        };
      }
    ).__spinthDebug.__debug;
    return { modelCount: d.modelCount, lines: d.vmStates.filter((v) => v.type === 'LINE').length };
  });
  expect(after.lines).toBe(0); // 零长草稿线被 settleDrawing 清理（曾裸退残留）
  expect(after.modelCount).toBe(1);

  await page.mouse.up(); // 会话监听已移除，补 up 仅复位 Playwright 鼠标态
});

test('quick-add 单撤销单元：第二次 quick-add（建线+建形+让位重排）Ctrl+Z 一步回退', async ({
  page,
}) => {
  const docId = `e2e-quickadd-undo-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await createRect(page, 450, 350);

  const a = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const s = d.find((v) => v.type === 'SHAPE') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: Number(s.x), y: Number(s.y), w: Number(s.width), h: Number(s.height) };
  });
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const aCx = a.x + a.w / 2;
  const aCy = a.y + a.h / 2;
  const hoverRightDot = async () => {
    await page.mouse.click(aCx + c.left, aCy + c.top); // 选中 A
    await page.waitForTimeout(250);
    await page.mouse.move(a.x + a.w + 24 + c.left, aCy + c.top); // 右外移点
    await page.waitForTimeout(250);
  };
  const clickDot = async () => {
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  const snap = () =>
    page.evaluate(() => {
      const dd = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug;
      return {
        shapes: dd.vmStates.filter((s) => s.type === 'SHAPE').length,
        lines: dd.vmStates
          .filter((s) => s.type === 'LINE')
          .map((l) => (l as { points: Array<[number, number]> }).points),
      };
    });

  // 第一次：方向空闲 → 建 B1 + L1（n=1 槽 0.5）
  await hoverRightDot();
  await clickDot();
  const s1 = await snap();
  expect(s1.shapes).toBe(2);
  expect(s1.lines).toHaveLength(1);
  const l1Pts = JSON.stringify(s1.lines[0]);

  // 第二次：同边分支 → 建 B2 + L2 + L1 让位槽位物化（onSettled 并入同捕获窗）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await hoverRightDot();
  await clickDot();
  const s2 = await snap();
  expect(s2.shapes).toBe(3);
  expect(s2.lines).toHaveLength(2);

  // 单撤销单元：Ctrl+Z 一步回退「建线 + 建形 + 既有线让位」（三写同窗）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const s3 = await snap();
  expect(s3.shapes).toBe(2);
  expect(s3.lines).toHaveLength(1);
  expect(JSON.stringify(s3.lines[0])).toBe(l1Pts); // L1 回 0.5 槽原几何

  // redo 完整恢复
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(300);
  const s4 = await snap();
  expect(s4.shapes).toBe(3);
  expect(s4.lines).toHaveLength(2);
});
