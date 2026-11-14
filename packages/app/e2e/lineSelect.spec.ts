/** 连线选中态 E2E（docs/08 §10 批次 3/3.7）：线身拖动禁用/段条/段滑移/首末段 */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe, createTwoRects, lineSelectionState } from './helpers/widgetProbeE2e';

async function lineSegState(
  page: Page,
): Promise<{ points: Array<[number, number]>; pinned: boolean }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    const l = d.find((s) => s.type === 'LINE') as unknown as {
      points: Array<[number, number]>;
      pinned: boolean;
    };
    return { points: l.points, pinned: l.pinned };
  });
}

test('4.10 线不可整体拖动/缩放：拖线身与拖缩放角均无效果', async ({ page }) => {
  const docId = `e2e-line-inert-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  // 连线：按在 A 上锚定起点，松在 B 上收尾
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect((await probe(page)).line).not.toBeNull();

  // 回 cursor，点线身选中——线身屏幕坐标从探针 points 反推（世界 + canvas 偏移）
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(150);
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const lp = (await probe(page)).line!.points;
  const k = Math.floor(lp.length / 2) - 1;
  // 段 1/4 处（批次 3 段条在段中点 12px 内 = 段滑移抓取区——拖点必须避开；
  // 本用例语义是「线身非段条处拖动无效果」，段条拖动见段滑移用例）
  const body = {
    x: lp[k]![0] + (lp[k + 1]![0] - lp[k]![0]) * 0.25 + c.left,
    y: lp[k]![1] + (lp[k + 1]![1] - lp[k]![1]) * 0.25 + c.top,
  };
  await page.mouse.click(body.x, body.y);
  await page.waitForTimeout(200);
  const before = await probe(page);
  expect(before.selectionFrame).toBeNull(); // 已选中（批次 3.6：单选连线不画 bbox 框——选中证明走线手柄探针）
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { lineSegments: unknown[] | null } } })
          .__spinthDebug.__debug.lineSegments,
    ),
  ).not.toBeNull();

  // 拖线身（段 1/4 处）= 段滑移（2026-09-30 参考视频对齐：线身任意点按住
  // 即拖所在段，不再要求贴段中点胶囊）。「线不可整体平移」的证明 = 两端点
  // 逐字保持（线的移动只能拖端点重锚定或随节点）；拖拽中选区框不现身
  // （moveTo 現身修复回归守卫）；pinned 落库 + undo 一步回原形
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(body.x + 20, body.y + 14, { steps: 2 });
  await page.waitForTimeout(80);
  const midDrag = await probe(page);
  expect(midDrag.selectionFrame).toBeNull(); // 拖拽中采样：框不现身
  await page.mouse.move(body.x + 60, body.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterDrag = await probe(page);
  const seg = await lineSegState(page);
  expect(seg.pinned).toBe(true); // 段滑移落库（单事务）
  expect(JSON.stringify(afterDrag.line!.points)).not.toBe(JSON.stringify(before.line!.points));
  expect(JSON.stringify([afterDrag.line!.points[0], afterDrag.line!.points.at(-1)])).toBe(
    JSON.stringify([before.line!.points[0], before.line!.points.at(-1)]),
  ); // 端点不动 = 未被整体平移
  expect(afterDrag.selectionFrame).toBeNull();
  // undo 一步回原形（段滑移 = 单撤销单元）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect(JSON.stringify((await probe(page)).line!.points)).toBe(
    JSON.stringify(before.line!.points),
  );

  // 缩放角尝试：线无缩放编辑框（resizable=false → editorFrame 空），拖角也不产生几何变化
  const ef = afterDrag.editorFrame;
  if (ef) {
    await page.mouse.move(ef.x + c.left, ef.y + c.top);
    await page.mouse.down();
    await page.mouse.move(ef.x + c.left - 30, ef.y + c.top - 30, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  } else {
    expect(ef).toBeNull(); // 线连缩放手柄都不给（不可缩放的能力位口径）
  }
  expect(JSON.stringify((await probe(page)).line!.points)).toBe(
    JSON.stringify(before.line!.points),
  );
});

test('批次3：单选连线选中态——段中点蓝条 + hover 段/端点高亮', async ({ page }) => {
  const docId = `e2e-batch3-select-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  // 画线（ELBOWED）→ Esc 清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 点线身选中（ActionBar 用例同款：路径中段中点，屏幕坐标从探针反推）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // 选中即显示段手柄：段数 = 主段数（屏显 ≥60px 的段——批次 3.6 走廊短段
  // 的胶囊贴着端点手柄挤作一团，已过滤）再剔除锚定端相邻的首/末段（2026-11
  // 近形禁拖：首末段不出胶囊），无 hover 时双 active 为 null；
  // 单选连线不画 bbox 选区框（批次 3.6）
  const s0 = await lineSelectionState(page);
  expect(s0.segments).not.toBeNull();
  const majorCount = pts.slice(1).filter(
    (p, i) =>
      i > 0 &&
      i < pts.length - 2 && // 非首末段（首末段锚定相邻，胶囊已过滤）
      Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]) >= 60,
  ).length;
  expect(s0.segments!.length).toBe(majorCount);
  expect(s0.segmentActive).toBeNull();
  expect(s0.endpointActive).toBeNull();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinthDebug: { __debug: { selectionFrame: unknown } } })
          .__spinthDebug.__debug.selectionFrame,
    ),
  ).toBeNull();

  // hover 中段中点 → 该段高亮（放大 1.25×）；端点不高亮；cursor = 拖动方向
  // （法向）双向箭头（2026-09-30 用户实测定向：水平段上下拖 ↕ ns-resize /
  // 垂直段左右拖 ↔ ew-resize——与矩形缩放手柄同惯例，光标指拖向非段向）
  const mid = Math.floor(s0.segments!.length / 2);
  const segMid = s0.segments![mid]!;
  await page.mouse.move(segMid.x + c.left, segMid.y + c.top);
  await page.waitForTimeout(120);
  const s1 = await lineSelectionState(page);
  expect(s1.segmentActive).toBe(mid);
  expect(s1.endpointActive).toBeNull();
  const expectCursor = await page.evaluate(
    ([target]) => {
      const d = (
        window as unknown as {
          __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinthDebug.__debug.vmStates;
      const p = (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
      // 与 core majorSegments 同款过滤找第 target 个主段的段号，再按段向取拖向
      // 光标；锚定端相邻的首/末段与胶囊过滤同口径剔除（2026-11 近形禁拖）
      const majors: number[] = [];
      for (let i = 0; i + 1 < p.length; i++) {
        if (i === 0 || i === p.length - 2) continue;
        if (Math.hypot(p[i + 1]![0] - p[i]![0], p[i + 1]![1] - p[i]![1]) >= 60) majors.push(i);
      }
      const i = majors[target as number]!;
      return Math.abs(p[i + 1]![0] - p[i]![0]) >= Math.abs(p[i + 1]![1] - p[i]![1])
        ? 'ns-resize'
        : 'ew-resize';
    },
    [mid],
  );
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toBe(
    expectCursor,
  );

  // hover 首段（锚定端相邻，2026-11 近形禁拖）→ 不高亮、不出拖向光标
  //（与抓取 segmentBodyGrabbable 同源——防「光标说可拖但按下无反应」）
  await page.mouse.move(
    (pts[0]![0] + pts[1]![0]) / 2 + c.left,
    (pts[0]![1] + pts[1]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(120);
  const sEdge = await lineSelectionState(page);
  expect(sEdge.segmentActive).toBeNull();
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).not.toMatch(
    /^(ns|ew)-resize$/,
  );

  // hover 起点端点 → 端点高亮、段不高亮（端点判定优先）；cursor = grab
  await page.mouse.move(pts[0]![0] + c.left, pts[0]![1] + c.top);
  await page.waitForTimeout(120);
  const s2 = await lineSelectionState(page);
  expect(s2.endpointActive).toBe(0);
  expect(s2.segmentActive).toBeNull();
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toBe('grab');

  // 离开线身（路径上方空白）→ 高亮复原、cursor 回模式默认
  await page.mouse.move(595 + c.left, 150 + c.top);
  await page.waitForTimeout(120);
  const s3 = await lineSelectionState(page);
  expect(s3.segmentActive).toBeNull();
  expect(s3.endpointActive).toBeNull();
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toBe('default');

  // 换选中目标（点选矩形）→ 线手柄全部消失（批次 3.6：此前非 LINE 分支漏
  // hide，端点圆+段条残留在画布上——用户实测截图实锤）
  await page.mouse.click(460, 340); // A 矩形中心（createTwoRects 返回值同款）
  await page.waitForTimeout(250);
  const s4 = await lineSelectionState(page);
  expect(s4.segments).toBeNull();
  expect(s4.endpointActive).toBeNull();
});

/** 批次 3：LINE 段滑移状态探针（points + pinned） */

test('批次3：段滑移——拖中段落库 pinned、undo 回退、锚定移动 U 形保持', async ({ page }) => {
  const docId = `e2e-batch3-segslide-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  // 画线 → Esc 清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 点线身选中（一次性——二次点击会进文字编辑）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // 选最长非首末段（水平长段）。主段快照（≥60px，走廊短段已过滤）按全量段
  // 中点最近匹配取抓取点——快照序号与全量段号不对应（批次 3.6）
  const sel = await lineSelectionState(page);
  expect(sel.segments).not.toBeNull();
  const segLens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
  let segIdx = -1;
  let segLen = -1;
  for (let i = 1; i < segLens.length - 1; i++) {
    if (segLens[i]! > segLen) {
      segLen = segLens[i]!;
      segIdx = i;
    }
  }
  const fullMid = {
    x: (pts[segIdx]![0] + pts[segIdx + 1]![0]) / 2,
    y: (pts[segIdx]![1] + pts[segIdx + 1]![1]) / 2,
  };
  const segMid = sel.segments!.reduce((a, b) =>
    Math.hypot(b.x - fullMid.x, b.y - fullMid.y) < Math.hypot(a.x - fullMid.x, a.y - fullMid.y)
      ? b
      : a,
  )!;
  await page.mouse.move(segMid.x + c.left, segMid.y + c.top);
  await page.mouse.down();
  await page.mouse.move(segMid.x + c.left, segMid.y + 40 + c.top, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 落库：pinned=true、被拖段中点沿法向位移 40、两端点不动
  const s1 = await lineSegState(page);
  expect(s1.pinned).toBe(true);
  const origMid = {
    x: (pts[segIdx]![0] + pts[segIdx + 1]![0]) / 2,
    y: (pts[segIdx]![1] + pts[segIdx + 1]![1]) / 2,
  };
  const nextMid = {
    x: (s1.points[segIdx]![0] + s1.points[segIdx + 1]![0]) / 2,
    y: (s1.points[segIdx]![1] + s1.points[segIdx + 1]![1]) / 2,
  };
  expect(Math.hypot(nextMid.x - origMid.x, nextMid.y - origMid.y)).toBeCloseTo(40, 0);
  expect(s1.points[0]).toEqual(pts[0]);
  expect(s1.points[s1.points.length - 1]).toEqual(pts[pts.length - 1]);

  // 单事务落库：undo 一步回退 points + pinned
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const s2 = await lineSegState(page);
  expect(s2.pinned ?? false).toBe(false); // 无键 = 未锁定（默认 ELBOWED 后不再有 reroute 兜底写）
  expect(s2.points).toEqual(pts);

  // 再滑移落库 → 拖锚定矩形 A → 首点跟随锚点、中间拐点保持（U 形不丢）。
  // 第一次滑移后段条已下移 40px——重读快照取新段条坐标（旧坐标距新段条
  // 40px 超出 12px 抓取半径，此前第二次滑移实际未抓到段条、断言靠首次
  // 落库的 pinned 侥幸通过）
  const sel2 = await lineSelectionState(page);
  const segMid2 = sel2.segments!.reduce((a, b) =>
    Math.hypot(b.x - fullMid.x, b.y - fullMid.y) < Math.hypot(a.x - fullMid.x, a.y - fullMid.y)
      ? b
      : a,
  )!;
  await page.mouse.move(segMid2.x + c.left, segMid2.y + c.top);
  await page.mouse.down();
  await page.mouse.move(segMid2.x + c.left, segMid2.y + 40 + c.top, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s3 = await lineSegState(page);
  expect(s3.pinned).toBe(true);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 30, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s4 = await lineSegState(page);
  expect(s4.pinned).toBe(true); // reattach 只重贴锚点，pinned 保持
  expect(s4.points[0]).toEqual([pts[0]![0] + 20, pts[0]![1] + 30]); // 锚点重贴（A 平移 +20,+30）
  expect(s4.points[1]).toEqual(s3.points[1]); // 中间拐点保持（U 形不丢）
  expect(s4.points[s4.points.length - 1]).toEqual(s3.points[s4.points.length - 1]);

  // 单击线身：无操作但段条保持（2026-09-30 用户实测修复——segSlide 会话
  // grab 时 hide 段条，moved<4 松手须恢复；落库路径由几何订阅重显不受影响）。
  // 拖 A 后选区在矩形——先重新点选线（点段 1/4 处，避开胶囊）
  const pts5 = (await lineSegState(page)).points;
  const midJ = Math.floor(pts5.length / 2);
  await page.mouse.click(
    pts5[midJ - 1]![0] + (pts5[midJ]![0] - pts5[midJ - 1]![0]) * 0.25 + c.left,
    pts5[midJ - 1]![1] + (pts5[midJ]![1] - pts5[midJ - 1]![1]) * 0.25 + c.top,
  );
  await page.waitForTimeout(250);
  const bodyBefore = await lineSelectionState(page);
  expect(bodyBefore.segments).not.toBeNull();
  await page.mouse.move(bodyBefore.segments![0]!.x + c.left, bodyBefore.segments![0]!.y + c.top);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  const bodyAfter = await lineSelectionState(page);
  expect(bodyAfter.segments).not.toBeNull();
});

test('批次3.7：首末段禁拖（2026-11 反转）——锚定相邻段无段条、按下无响应', async ({ page }) => {
  const docId = `e2e-seg-edge-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  const { a, b } = await createTwoRects(page);

  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // 中段上移 60：走廊首段从 30px 变 90px（≥60 主段阈值）——但首段锚定相邻，
  // 段条快照里仍不出现它（近形禁拖：胶囊与抓取同源过滤）
  const segLens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
  let segIdx = -1;
  let segLen = -1;
  for (let i = 1; i < segLens.length - 1; i++) {
    if (segLens[i]! > segLen) {
      segLen = segLens[i]!;
      segIdx = i;
    }
  }
  const fullMid = {
    x: (pts[segIdx]![0] + pts[segIdx + 1]![0]) / 2,
    y: (pts[segIdx]![1] + pts[segIdx + 1]![1]) / 2,
  };
  const pickMid = (segs: Array<{ x: number; y: number }>): { x: number; y: number } =>
    segs.reduce((x, y) =>
      Math.hypot(y.x - fullMid.x, y.y - fullMid.y) < Math.hypot(x.x - fullMid.x, x.y - fullMid.y)
        ? y
        : x,
    )!;
  let sel = await lineSelectionState(page);
  const mid0 = pickMid(sel.segments!);
  await page.mouse.move(mid0.x + c.left, mid0.y + c.top);
  await page.mouse.down();
  await page.mouse.move(mid0.x + c.left, mid0.y - 60 + c.top, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s1 = await lineSegState(page);
  expect(s1.pinned).toBe(true); // 中段滑移照常（禁拖只针对锚定相邻段）

  // 段条快照不含首末段：全部段条距首/末段中点都超出胶囊半径（≈12px 量级）
  const firstMid = {
    x: (s1.points[0]![0] + s1.points[1]![0]) / 2,
    y: (s1.points[0]![1] + s1.points[1]![1]) / 2,
  };
  const lastMid = {
    x: (s1.points.at(-1)![0] + s1.points.at(-2)![0]) / 2,
    y: (s1.points.at(-1)![1] + s1.points.at(-2)![1]) / 2,
  };
  sel = await lineSelectionState(page);
  // 非空守卫：过滤若把所有胶囊吃掉，下方循环会空跑通过（2026-11 审查返工）
  expect(sel.segments!.length).toBeGreaterThan(0);
  for (const seg of sel.segments!) {
    expect(Math.hypot(seg.x - firstMid.x, seg.y - firstMid.y)).toBeGreaterThan(24);
    expect(Math.hypot(seg.x - lastMid.x, seg.y - lastMid.y)).toBeGreaterThan(24);
  }

  // 按在首段中点拖 40：无响应——points 逐字节不变（连段滑移会话都不进入，
  // pinned 维持中段滑移的落库值）、undo 深度不动
  await page.mouse.move(firstMid.x + c.left, firstMid.y + c.top);
  await page.mouse.down();
  await page.mouse.move(firstMid.x + 40 + c.left, firstMid.y + c.top, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s2 = await lineSegState(page);
  expect(JSON.stringify(s2.points)).toBe(JSON.stringify(s1.points)); // 零位移零写
  expect(s2.pinned).toBe(true);

  // undo 一步直接回退中段滑移（首段拖拽未产生事务）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  const s3 = await lineSegState(page);
  expect(JSON.stringify(s3.points)).toBe(JSON.stringify(pts));
  expect(s3.pinned ?? false).toBe(false); // 同上：无键 = 未锁定
});
