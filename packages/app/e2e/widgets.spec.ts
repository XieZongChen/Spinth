import { expect, test, type Page } from '@playwright/test';

/**
 * 控件交互 E2E（多批次累积，见各 test 名与段注释）：
 * - 4.10 验收（docs/13）：线不可整体拖动/缩放；画笔可拖可缩（CI 条件跳过——
 *   合成输入管线级塌缩，docs/15 §3）
 * - docs/08 §10 连线批次 1-5 / 3.7：quick-add、段滑移、选中态手柄、曲线、
 *   ActionBar v2、首末段滑移
 * - eraser 分段橡皮（docs/03/04）：一分为二/undo/Esc 取消/方括号调大小/全擦
 * 断言数据探针（vmStates.points / editorFrame）优先于截图（docs/15 §3）。
 */

interface WProbe {
  modelCount: number;
  editorFrame: { x: number; y: number; width: number; height: number } | null;
  selectionFrame: { x: number; y: number; width: number; height: number } | null;
  line: { points: Array<[number, number]> } | null;
  pen: { points: Array<[number, number]> } | null;
}

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

async function probe(page: Page): Promise<WProbe> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            modelCount: number;
            editorFrame: WProbe['editorFrame'];
            selectionFrame: WProbe['selectionFrame'];
            vmStates: Array<Record<string, unknown>>;
          };
        };
      }
    ).__spinth.__debug;
    const byType = (t: string) =>
      d.vmStates.find((s) => s.type === t) as { points: Array<[number, number]> } | undefined;
    return {
      modelCount: d.modelCount,
      editorFrame: d.editorFrame,
      selectionFrame: d.selectionFrame,
      line: byType('LINE') ?? null,
      pen: byType('PEN') ?? null,
    };
  });
}

/** 建两个矩形（连线锚定端），返回各自中心屏幕坐标 */
async function createTwoRects(
  page: Page,
): Promise<{ a: { x: number; y: number }; b: { x: number; y: number } }> {
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(820, 380, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  return { a: { x: 460, y: 340 }, b: { x: 760, y: 340 } };
}

test('4.10 线不可整体拖动/缩放：拖线身与拖缩放角均无效果', async ({ page }) => {
  const docId = `e2e-line-inert-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
        (window as unknown as { __spinth: { __debug: { lineSegments: unknown[] | null } } })
          .__spinth.__debug.lineSegments,
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
  await ready(page);
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
              __spinth: { __debug: { selectionFrame: { x: number; y: number } | null } };
            }
          ).__spinth.__debug.selectionFrame;
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
  await ready(page);
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
// ---------------------------------------------------------------------------

interface ILineProbe {
  modelCount: number;
  selectedIds: string[];
  lineAnchors: Array<{ x: number; y: number }> | null;
  lineAnchorActive: number | null;
  linePreview: Array<[number, number]> | null;
  lineGhost: boolean;
  lineGhostMode: 'rect' | 'line' | null;
  lineGhostBounds: string;
  cursorMode: string;
}

async function lineProbe(page: Page): Promise<ILineProbe> {
  return page.evaluate(() => {
    const s = (
      window as unknown as {
        __spinth: {
          cursorMode$: { getValue(): string };
          __debug: {
            modelCount: number;
            selectedIds: string[];
            lineAnchors: ILineProbe['lineAnchors'];
            lineAnchorActive: ILineProbe['lineAnchorActive'];
            linePreview: ILineProbe['linePreview'];
            lineGhost: ILineProbe['lineGhost'];
            lineGhostMode: ILineProbe['lineGhostMode'];
            lineGhostBounds: ILineProbe['lineGhostBounds'];
          };
        };
      }
    ).__spinth;
    return {
      modelCount: s.__debug.modelCount,
      selectedIds: s.__debug.selectedIds,
      lineAnchors: s.__debug.lineAnchors,
      lineAnchorActive: s.__debug.lineAnchorActive,
      linePreview: s.__debug.linePreview,
      lineGhost: s.__debug.lineGhost,
      lineGhostMode: s.__debug.lineGhostMode,
      lineGhostBounds: s.__debug.lineGhostBounds,
      cursorMode: s.cursorMode$.getValue(),
    };
  });
}

/** 建一个矩形，返回中心屏幕坐标 */
async function createRect(page: Page, cx: number, cy: number): Promise<void> {
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('批次1：line 工具悬停对象显示四边连接点、移开消失', async ({ page }) => {
  const docId = `e2e-line-anchor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
  await ready(page);
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
  await ready(page);
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  expect(lp[lp.length - 1]![0]).toBeGreaterThan(900); // 模型终点跟随 B 的新位置

  // 路由质量（用户实测回归：移动后穿模）：连线不得穿过任一矩形内部
  const rects = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
  await ready(page);
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

test('批次2：选中形状四点常显；hover 连接点放大出影子；拖点建线两端锚定', async ({ page }) => {
  const docId = `e2e-quickbtn-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
  await ready(page);
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
        __spinth: { __debug: { vmStates: Array<Record<string, unknown>> }; selectedIds: string[] };
      }
    ).__spinth.__debug;
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
  await ready(page);
  await createRect(page, 450, 350);

  // 从探针取 A 实测 bounds → B 放在 A 右侧 quick-add 落位矩形处（坐标反推铁律）
  const a = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
        __spinth: { __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] } };
      }
    ).__spinth.__debug;
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
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.filter((s) => s.type === 'SHAPE').length,
  );
  expect(after).toBe(3); // 空闲方向正常建新形状
});

test('批次2：quick-add 方向已有带连线元素 → 新形状一上一下交替错开（参考折线分支）', async ({
  page,
}) => {
  const docId = `e2e-quickadd-stagger-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350);

  // A 实测 bounds；B 放 A 右侧正对落位（先作为无连线孤立元素被接入）
  const a = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
          __spinth: {
            __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] };
          };
        }
      ).__spinth.__debug;
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
});

test('批次2：quick-add 垂直方向已有带连线元素 → 新形状一右一左错开', async ({ page }) => {
  const docId = `e2e-quickadd-stagger-v-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await createRect(page, 450, 350);

  const a = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug;
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
        __spinth: { __debug: { vmStates: Array<Record<string, unknown>>; selectedIds: string[] } };
      }
    ).__spinth.__debug;
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
  await ready(page);
  await createRect(page, 450, 350);
  const a = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
      (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth.__debug
        .modelCount,
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
        __spinth: { __debug: { vmStates: Array<Record<string, unknown>>; modelCount: number } };
      }
    ).__spinth.__debug;
    return { modelCount: d.modelCount, lines: d.vmStates.filter((v) => v.type === 'LINE').length };
  });
  expect(after.lines).toBe(0); // 零长草稿线被 settleDrawing 清理（曾裸退残留）
  expect(after.modelCount).toBe(1);

  await page.mouse.up(); // 会话监听已移除，补 up 仅复位 Playwright 鼠标态
});

test('批次2：端点拖拽重锚定——拖离解绑为自由端、拖入新形状锚定', async ({ page }) => {
  const docId = `e2e-endpoint-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
  await ready(page);
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
async function lineStyle(
  page: Page,
): Promise<{ lineType: string; startArrow: string; endArrow: string }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    const l = d.find((s) => s.type === 'LINE') as unknown as {
      lineType: string;
      startArrow: string;
      endArrow: string;
    };
    return { lineType: l.lineType, startArrow: l.startArrow, endArrow: l.endArrow };
  });
}

test('批次3：ActionBar 线型/箭头切换——折线与菱形落库 + undo 回退', async ({ page }) => {
  const docId = `e2e-batch3-style-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a, b } = await createTwoRects(page);

  // 画线（工具保持激活）→ Esc 回 cursor 并清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED'); // 新线一律正交折线（docs/08 §4 决策）

  // 点线身选中（路径中段中点——首末中点在肘部内侧不在路径上，docs/15）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(200);

  // ActionBar「折线」→ lineType 落库 ELBOWED（rerouteLine 随 lineType diff 触发重路由）。
  // v2 多级：点「线型」触发钮展开面板 → 点「折线」选项
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED');

  // 终点箭头「菱形箭头」（v2：两组箭头独立触发钮，「终点箭头」面板内选择）
  await barPick(page, '终点箭头', '菱形箭头');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).endArrow).toBe('diamond');

  // 单事务落库 + stopCapturing → undo 一步回退菱形（ControlOrMeta 平台映射键）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).endArrow).toBe('arrow');
});

/** ActionBar v2 多级控件（2026-10-03）：点触发钮展开二级面板 → 点选项应用 */
async function barPick(page: Page, trigger: string, option: string): Promise<void> {
  await page.locator(`[data-spinth-action-bar] button[aria-label="${trigger}"]`).click();
  await page.locator(`[data-spinth-popover-panel] button[aria-label="${option}"]`).first().click();
}

/** 批次 3：线上文字状态探针（text + textRatio） */
async function lineTextState(page: Page): Promise<{ text: string; textRatio: number }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    const l = d.find((s) => s.type === 'LINE') as unknown as { text: string; textRatio: number };
    return { text: l.text, textRatio: l.textRatio };
  });
}

test('批次3：线上文字沿路径滑移——拖动改 textRatio 落库、undo 回退、点击进编辑', async ({
  page,
}) => {
  const docId = `e2e-batch3-slide-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a, b } = await createTwoRects(page);

  // 画线（ELBOWED 两端同轴退化直线）→ Esc 清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 点线身选中 → 单击已选中的线身不进编辑（2026-09-30 拍板：单击一律无编辑
  // 语义）→ 双击线身 = 双击位置创建文字进编辑。
  // 点击点取段 1/4 处（避开段中点胶囊手柄——点手柄=段滑移）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  const bodyX = pts[midI - 1]![0] + (pts[midI]![0] - pts[midI - 1]![0]) * 0.25 + c.left;
  const bodyY = pts[midI - 1]![1] + (pts[midI]![1] - pts[midI - 1]![1]) * 0.25 + c.top;
  await page.mouse.click(bodyX, bodyY); // 选中
  // 隔开双击窗口（系统双击间隔可设慢于默认 500ms——1200ms 稳妥，
  // 不隔会与下一次 click 组成原生 dblclick 直接进编辑）
  await page.waitForTimeout(1200);
  await page.mouse.click(bodyX, bodyY); // 单击已选中的线身：无操作
  await page.waitForTimeout(250);
  // 编辑器 DOM 构造即常驻（detach 只置 opacity:0）——「进编辑」按 opacity:1 判
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('#spinth-text-layer > div')).some(
        (d) => d.style.opacity === '1',
      ),
    ),
  ).toBe(false);
  await page.mouse.dblclick(bodyX, bodyY); // 双击 = 创建文字进编辑
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('#spinth-text-layer > div')).some(
        (d) => d.style.opacity === '1',
      ),
    ),
  ).toBe(true);
  // 编辑态选框视觉规格（参考复刻，2026-10）：透明底 + 功能蓝描边 + 文字居中
  const frame = await page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('#spinth-text-layer > div')).find(
      (el) => el.style.opacity === '1',
    )!;
    const cs = getComputedStyle(d);
    return {
      borderColor: cs.borderColor,
      borderWidth: cs.borderWidth,
      background: cs.backgroundColor,
      textAlign: cs.textAlign,
      width: cs.width,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
    };
  });
  expect(frame.borderColor).toBe('rgb(40, 120, 255)'); // #2878ff 功能蓝
  expect(parseFloat(frame.borderWidth)).toBeGreaterThan(0);
  expect(frame.background).toBe('rgba(0, 0, 0, 0)'); // 透明底：画布点阵透出
  expect(frame.textAlign).toBe('center');
  // 宽度自适应：空内容时钳定在 min 60px（替换旧固定 200px）
  expect(frame.minWidth).toBe('60px');
  expect(frame.maxWidth).toBe('240px');
  expect(parseFloat(frame.width)).toBeCloseTo(60, 0);
  // 编辑期镂空 = 编辑器框实测矩形（2026-10-02 用户实测揪出：空文字未落库时
  // 无镂空、线从框下穿过）——空内容即断线，框宽 = min-width 60px
  const knockout0 = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { lineKnockout: { width: number } | null } } })
        .__spinth.__debug.lineKnockout,
  );
  expect(knockout0).not.toBeNull();
  expect(knockout0!.width).toBeGreaterThanOrEqual(60);
  // 编辑期拖拽手柄全收（refreshHandles editingId 守卫——框内不再压胶囊/端点圆）
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinth: { __debug: { lineSegments: unknown } } }).__spinth.__debug
          .lineSegments,
    ),
  ).toBeNull();
  // 打字变宽即时跟随（syncEditorFrame 不等 34ms 节流落库）；
  // 内容须长过 min-width 60px（'SLIDE' 仅 ~58px 仍在钳定内，框不变宽）
  await page.keyboard.type('SLIDE-1234567890');
  await page.waitForTimeout(150);
  const knockout1 = await page.evaluate(
    () =>
      (
        window as unknown as {
          __spinth: { __debug: { lineKnockout: { width: number; height: number } | null } };
        }
      ).__spinth.__debug.lineKnockout,
  );
  expect(knockout1!.width).toBeGreaterThan(knockout0!.width);
  await page.keyboard.press('Escape'); // exitEdit 前冲刷节流（尾字不丢）
  await page.waitForTimeout(300);
  const s0 = await lineTextState(page);
  expect(s0.text).toContain('SLIDE'); // text 落库为 TipTap HTML（<p>SLIDE</p>）
  const ratio0 = s0.textRatio;
  // 文字中心 = pointAtRatio(ratio0)——ELBOWED 路径多点（两端走廊+水平段），
  // ratio 是全路径弧长比，须按弧长参数化反算（线性插值 pts[0]→pts[1] 会按在
  // 第一段走廊上、出文字 bbox——首跑实锤）。evaluate 内联折线弧长插值。
  const textPt = await page.evaluate(
    ({ pts, ratio }: { pts: Array<[number, number]>; ratio: number }) => {
      let total = 0;
      const segs: Array<{
        ax: number;
        ay: number;
        bx: number;
        by: number;
        len: number;
        acc: number;
      }> = [];
      for (let i = 1; i < pts.length; i++) {
        const len = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
        segs.push({
          ax: pts[i - 1]![0],
          ay: pts[i - 1]![1],
          bx: pts[i]![0],
          by: pts[i]![1],
          len,
          acc: total,
        });
        total += len;
      }
      const d = ratio * total;
      for (const s of segs) {
        if (d <= s.acc + s.len) {
          const t = s.len > 0 ? (d - s.acc) / s.len : 0;
          return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t };
        }
      }
      const last = pts[pts.length - 1]!;
      return { x: last[0], y: last[1] };
    },
    { pts, ratio: ratio0 },
  );
  const textX = textPt.x + c.left;
  const textY = textPt.y + c.top;

  // 按住文字沿路径拖（分步等待防输入饱和，docs/15）→ textRatio 视觉跟随、松手落库
  await page.mouse.move(textX, textY);
  await page.mouse.down();
  await page.mouse.move(textX + 24, textY + 12);
  await page.waitForTimeout(15);
  await page.mouse.move(textX + 48, textY + 24);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s1 = await lineTextState(page);
  expect(s1.text).toContain('SLIDE');
  expect(s1.textRatio).not.toBe(ratio0); // 滑移落库（ratioAtPoint 随指针最近点变化）

  // update + stopCapturing = 单撤销单元：undo 一步回退 ratio、text 保留
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await lineTextState(page)).textRatio).toBe(ratio0);
  expect((await lineTextState(page)).text).toContain('SLIDE');
});

test('线上文字：二次进入编辑——光标落末尾无旧选区、编辑期手柄隐藏、退出恢复', async ({ page }) => {
  const docId = `e2e-line-text-reenter-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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

  // 双击线身进编辑（第一次）→ 输入 AAAA → Esc（编辑器内 Esc 不清选区）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  const bodyX = pts[midI - 1]![0] + (pts[midI]![0] - pts[midI - 1]![0]) * 0.25 + c.left;
  const bodyY = pts[midI - 1]![1] + (pts[midI]![1] - pts[midI - 1]![1]) * 0.25 + c.top;
  await page.mouse.dblclick(bodyX, bodyY);
  await page.waitForTimeout(250);
  await page.keyboard.type('AAAA');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // 退出后线仍单选 → 选中态手柄恢复（exitEdit 的恢复分支）
  expect((await lineSelectionState(page)).segments).not.toBeNull();

  // 二次双击进入（hitTestPoint 按数据层原始 pts，镂空断口不影响命中）
  await page.waitForTimeout(250);
  await page.mouse.dblclick(bodyX, bodyY);
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('#spinth-text-layer > div')).some(
        (d) => d.style.opacity === '1',
      ),
    ),
  ).toBe(true);
  // 编辑期手柄再次全收
  const sel0 = await lineSelectionState(page);
  expect(sel0.segments).toBeNull();
  // 框镂空正常（线在标签处断开）
  const ko = await page.evaluate(
    () =>
      (window as unknown as { __spinth: { __debug: { lineKnockout: { width: number } | null } } })
        .__spinth.__debug.lineKnockout,
  );
  expect(ko).not.toBeNull();
  expect(ko!.width).toBeGreaterThanOrEqual(60);
  // 光标在内容末尾且 collapsed（TipTap 单例不清 selection——旧会话选区
  // 曾以蓝色高亮块残留，focus('end') 修复的护栏）
  const caret = await page.evaluate(() => {
    const s = window.getSelection();
    return {
      collapsed: s.isCollapsed,
      offset: s.anchorOffset,
      len: s.anchorNode?.textContent?.length ?? -1,
    };
  });
  expect(caret.collapsed).toBe(true);
  expect(caret.offset).toBe(caret.len);

  // Esc 退出 → 手柄恢复
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect((await lineSelectionState(page)).segments).not.toBeNull();
});

test('线上文字：有字连线选中态——文字两侧各一个拖拽手柄（参考双胶囊）', async ({ page }) => {
  const docId = `e2e-line-text-capsule-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a, b } = await createTwoRects(page);

  // 画线（两矩形同轴 → 唯一水平段直线）→ Esc 清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 双击线身加文字 → Esc 退出（线保持选中）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  const bodyX = pts[midI - 1]![0] + (pts[midI]![0] - pts[midI - 1]![0]) * 0.25 + c.left;
  const bodyY = pts[midI - 1]![1] + (pts[midI]![1] - pts[midI - 1]![1]) * 0.25 + c.top;
  await page.mouse.dblclick(bodyX, bodyY);
  await page.waitForTimeout(250);
  await page.keyboard.type('LBL');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 退出编辑（有字）→ 双胶囊：文字镂空两侧各一个锚点
  const st0 = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            lineSegments: Array<{ x: number; y: number }> | null;
            lineKnockout: { x: number; width: number } | null;
          };
        };
      }
    ).__spinth.__debug;
    return { segments: d.lineSegments, knockout: d.lineKnockout };
  });
  expect(st0.segments).not.toBeNull();
  expect(st0.segments!.length).toBe(2); // 唯一段直线：文字左右两侧各一
  const koL = st0.knockout!.x;
  const koR = st0.knockout!.x + st0.knockout!.width;
  const sorted = [...st0.segments!].sort((p, q) => p.x - q.x);
  expect(sorted[0]!.x).toBeLessThan(koL); // 左锚点在镂空左侧
  expect(sorted[1]!.x).toBeGreaterThan(koR); // 右锚点在镂空右侧

  // 拖左侧胶囊 = 段滑移（端点保持、几何变化、pinned 落库——画出的 ELBOWED
  // 已是 5 点阶梯路由，滑移按所在段保形/拆段，点数不作为断言口径）
  const capsX = sorted[0]!.x + c.left;
  const capsY = sorted[0]!.y + c.top;
  const before = await page.evaluate(
    () =>
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((s) => s.type === 'LINE') as {
        points: Array<[number, number]>;
        pinned?: boolean;
      },
  );
  await page.mouse.move(capsX, capsY);
  await page.mouse.down();
  await page.mouse.move(capsX, capsY - 40);
  await page.waitForTimeout(15);
  await page.mouse.move(capsX, capsY - 80);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(
    () =>
      (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates.find((s) => s.type === 'LINE') as {
        points: Array<[number, number]>;
        pinned?: boolean;
      },
  );
  expect(JSON.stringify(after.points)).not.toBe(JSON.stringify(before.points)); // 滑移生效
  expect(after.points[0]).toEqual(before.points[0]); // 起点端保持
  expect(after.points[after.points.length - 1]).toEqual(before.points[before.points.length - 1]); // 终点端保持
  expect(after.pinned).toBe(true);

  // 点空白清选区（手柄全收）→ 重新单选 → 双胶囊恢复（同口径）
  await page.mouse.click(80, 600);
  await page.waitForTimeout(250);
  expect((await lineSelectionState(page)).segments).toBeNull();
  // 重选点击点 = 变形后折线中段中点（拖动后线已是几字形，原胶囊点不在线上）
  const i = Math.floor(after.points.length / 2) - 1;
  const reX = after.points[i]![0] + (after.points[i + 1]![0] - after.points[i]![0]) / 2 + c.left;
  const reY = after.points[i]![1] + (after.points[i + 1]![1] - after.points[i]![1]) / 2 + c.top;
  await page.mouse.click(reX, reY);
  await page.waitForTimeout(250);
  const st1 = await lineSelectionState(page);
  expect(st1.segments).not.toBeNull();
  expect(st1.segments!.length).toBe(2);
});

/** 批次 3：单选连线选中态探针（段中点手柄快照 + hover 段/端点下标） */
async function lineSelectionState(page: Page): Promise<{
  segments: Array<{ x: number; y: number }> | null;
  segmentActive: number | null;
  endpointActive: number | null;
}> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            lineSegments: Array<{ x: number; y: number }> | null;
            lineSegmentActive: number | null;
            lineEndpointActive: number | null;
          };
        };
      }
    ).__spinth.__debug;
    return {
      segments: d.lineSegments,
      segmentActive: d.lineSegmentActive,
      endpointActive: d.lineEndpointActive,
    };
  });
}

test('批次3：单选连线选中态——段中点蓝条 + hover 段/端点高亮', async ({ page }) => {
  const docId = `e2e-batch3-select-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // 选中即显示段手柄：段数 = 主段数（屏显 ≥60px 的段——批次 3.6 走廊短段
  // 的胶囊贴着端点手柄挤作一团，已过滤），无 hover 时双 active 为 null；
  // 单选连线不画 bbox 选区框（批次 3.6）
  const s0 = await lineSelectionState(page);
  expect(s0.segments).not.toBeNull();
  const majorCount = pts
    .slice(1)
    .filter((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]) >= 60).length;
  expect(s0.segments!.length).toBe(majorCount);
  expect(s0.segmentActive).toBeNull();
  expect(s0.endpointActive).toBeNull();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinth: { __debug: { selectionFrame: unknown } } }).__spinth
          .__debug.selectionFrame,
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
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug.vmStates;
      const p = (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
      // 与 core majorSegments 同款过滤找第 target 个主段的段号，再按段向取拖向光标
      const majors: number[] = [];
      for (let i = 0; i + 1 < p.length; i++) {
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
async function lineSegState(
  page: Page,
): Promise<{ points: Array<[number, number]>; pinned: boolean }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    const l = d.find((s) => s.type === 'LINE') as unknown as {
      points: Array<[number, number]>;
      pinned: boolean;
    };
    return { points: l.points, pinned: l.pinned };
  });
}

test('批次3：段滑移——拖中段落库 pinned、undo 回退、锚定移动 U 形保持', async ({ page }) => {
  const docId = `e2e-batch3-segslide-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
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
  expect(s2.pinned).toBe(false);
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

test('批次4：曲线线型——ActionBar 切换 CURVE 落库 + undo + 选中态端点圆无段条', async ({ page }) => {
  const docId = `e2e-batch4-curve-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const { a, b } = await createTwoRects(page);

  // 画线（ELBOWED，锚定走廊点将成为曲线切向）→ Esc 清选区
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 选中线（段 1/4 处，避开段条抓取区）
  const c = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect());
  const pts = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // ActionBar「曲线」→ lineType 落库 CURVE（schema 枚举 + updateSelectedStyle 管线；v2 多级）
  await barPick(page, '线型', '曲线');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('CURVE');

  // 曲线选中态：端点圆仍在、无段条（flatten 短弦全被 majorSegments 过滤——
  // 曲线无段语义，段滑移禁用）
  const sel = await lineSelectionState(page);
  expect(sel.segments).toEqual([]);

  // undo 一步回退 ELBOWED（单事务）；段条恢复
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED');
  const sel2 = await lineSelectionState(page);
  expect(sel2.segments!.length).toBeGreaterThan(0);

  // 再切曲线：命中走 flatten 折线（线上文字 ratio 定位复用）——点贝塞尔
  // t=0.5 中点重新选中再切回折线（连线中点不在曲线上——S 弯沿切向偏移）
  await barPick(page, '线型', '曲线');
  await page.waitForTimeout(250);
  const curveMid = await page.evaluate(
    ({ pts }: { pts: Array<[number, number]> }) => {
      const p = pts.map((q) => ({ x: q[0], y: q[1] }));
      const p0 = p[0]!;
      const p3 = p[p.length - 1]!;
      const norm = (ax: number, ay: number, bx: number, by: number) => {
        const l = Math.hypot(bx - ax, by - ay) || 1;
        return { x: (bx - ax) / l, y: (by - ay) / l };
      };
      const d0 = p.length > 2 ? norm(p0.x, p0.y, p[1]!.x, p[1]!.y) : norm(p0.x, p0.y, p3.x, p3.y);
      const d3 =
        p.length > 2
          ? norm(p3.x, p3.y, p[p.length - 2]!.x, p[p.length - 2]!.y)
          : norm(p3.x, p3.y, p0.x, p0.y);
      const arm = Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4;
      const c1 = { x: p0.x + d0.x * arm, y: p0.y + d0.y * arm };
      const c2 = { x: p3.x + d3.x * arm, y: p3.y + d3.y * arm };
      // 三次贝塞尔 t=0.5 = (p0 + 3c1 + 3c2 + p3) / 8
      return {
        x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
        y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
      };
    },
    { pts },
  );
  await page.mouse.click(curveMid.x + c.left, curveMid.y + c.top);
  await page.waitForTimeout(200);
  await barPick(page, '线型', '折线');
  await page.waitForTimeout(250);
  expect((await lineStyle(page)).lineType).toBe('ELBOWED');
});

test('ActionBar v2：多级 popover + 中文 tooltip + bar 收窄（参考视频规格）', async ({ page }) => {
  const docId = `e2e-bar-v2-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  const bar = page.locator('[data-spinth-action-bar]');
  await expect(bar).toBeVisible();

  // 1) 一级 9 个按钮位（线型/线宽笔宽批增的线宽/虚线/起箭头/终箭头/颜色 +
  //    排版打磨批 B 增的字号/文字颜色，再/删除）——原 11 个文字平铺位收进二级
  //    面板（v2 定案）；LINE 排版项无对齐（恒 center 与锚点绑定，docs/17 §4）
  const labels = await bar
    .locator('button[aria-label]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual([
    '线型',
    '线宽',
    '虚线',
    '起点箭头',
    '终点箭头',
    '颜色',
    '字号',
    '文字颜色',
    '导出 PNG',
    '删除',
  ]);
  // 2) bar 收窄护栏（原 LINE 全套文字样式 ~400px+；排版批 B +2 位实测 ~337、
  //    线宽批 +1 图标位 ~371、导出批 +1 公共动作位 ~405——阈值 430。35 轮 🟡
  //    「再抬时重审」注：导出为一次性动作钮非样式项（不属「收纳稀释」），且
  //    相对原始 400+ 平铺仍显著收窄；下次样式项再挤入时应转次级 popover）
  expect(await bar.evaluate((el) => el.offsetWidth)).toBeLessThan(430);

  // 3) 点「线型」→ 二级面板现身、触发钮 expanded、当前值描边圈（aria-checked）
  await bar.locator('button[aria-label="线型"]').click();
  const panel = page.locator('[data-spinth-popover-panel]');
  await expect(panel).toBeVisible();
  expect(await bar.locator('button[aria-label="线型"]').getAttribute('aria-expanded')).toBe('true');
  expect(await panel.locator('button[aria-checked="true"]').getAttribute('aria-label')).toBe(
    '折线',
  ); // 新线一律 ELBOWED

  // 4) 面板展开时触发钮 tooltip 抑制（hover 600ms 无气泡）
  await bar.locator('button[aria-label="线型"]').hover();
  await page.waitForTimeout(900); // tooltip 400ms 延迟 + 负载余量（全套件并发时敏，隔离复跑绿）
  expect(await page.locator('[data-spinth-tooltip]').count()).toBe(0);

  // 5) Esc 收起；hover「虚线」600ms → 中文 tooltip 现身、移开即隐
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await bar.locator('button[aria-label="虚线"]').hover();
  await page.waitForTimeout(900); // tooltip 400ms 延迟 + 负载余量（全套件并发时敏，隔离复跑绿）
  await expect(page.locator('[data-spinth-tooltip]')).toHaveText('虚线');
  await page.mouse.move(20, 600);
  await expect(page.locator('[data-spinth-tooltip]')).toHaveCount(0);

  // 6) 色板 popover（swatch 选项）：点选落库 + 点选后面板收起
  await bar.locator('button[aria-label="颜色"]').click();
  await page.locator('[data-spinth-popover-panel] button').nth(2).click(); // LINE_PALETTE[2] #2563eb
  await page.waitForTimeout(250);
  const color = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return String((d.find((s) => s.type === 'LINE') as { color: string }).color);
  });
  expect(color).toBe('#2563eb');
  expect(await page.locator('[data-spinth-popover-panel]').count()).toBe(0);
});

test('批次3.7：首末段滑移——锚点端保持、被拖段跟随（参考拖段语义）', async ({ page }) => {
  const docId = `e2e-seg-edge-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug.vmStates;
    return (d.find((s) => s.type === 'LINE') as { points: Array<[number, number]> }).points;
  });
  const midI = Math.floor(pts.length / 2);
  await page.mouse.click(
    (pts[midI - 1]![0] + pts[midI]![0]) / 2 + c.left,
    (pts[midI - 1]![1] + pts[midI]![1]) / 2 + c.top,
  );
  await page.waitForTimeout(250);

  // 中段上移 60：走廊首段从 30px 变 90px（≥60 主段阈值）→ 首段条出现
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
  expect(s1.pinned).toBe(true);

  // 拖首段条（快照第一项 = 段号升序首个主段）右移 40：锚点端 p0 保持、
  // 被拖段跟随、其余段求交顺连（slideSegment 首段分支）
  sel = await lineSelectionState(page);
  expect(sel.segments!.length).toBeGreaterThan(1);
  const firstSeg = sel.segments![0]!;
  const p0Before = s1.points[0]!;
  await page.mouse.move(firstSeg.x + c.left, firstSeg.y + c.top);
  await page.mouse.down();
  await page.mouse.move(firstSeg.x + 40 + c.left, firstSeg.y + c.top, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s2 = await lineSegState(page);
  expect(s2.pinned).toBe(true);
  expect(s2.points[0]).toEqual(p0Before); // 锚点端保持（参考：首尾仍在连接端点）
  expect(JSON.stringify(s2.points)).not.toBe(JSON.stringify(s1.points)); // 被拖段跟随落库

  // undo 一步只回退首段滑移（p0 全程未动）
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(250);
  const s3 = await lineSegState(page);
  expect(JSON.stringify(s3.points)).toBe(JSON.stringify(s1.points));
  expect(s3.pinned).toBe(true); // 前一步的 pinned 不被回退（单事务）
});

test('eraser 分段橡皮：扫过中部一分为二 + undo 一步恢复 + 全擦删除', async ({ page }) => {
  const docId = `e2e-eraser-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 画一条水平长笔画（步间 80ms 保证 60ms 采样节流出 ≥4 点）
  await page.keyboard.press('p');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  for (let x = 360; x <= 660; x += 60) {
    await page.mouse.move(x, 300, { steps: 1 });
    await page.waitForTimeout(80);
  }
  await page.mouse.up();

  const penState = () =>
    page.evaluate(() => {
      const d = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug;
      const pens = d.vmStates.filter((v) => String(v.type) === 'PEN');
      const pts = pens.reduce((n, p) => n + ((p.points as unknown[] | undefined)?.length ?? 0), 0);
      return { count: pens.length, pts };
    });
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(1);
  expect((await penState()).pts).toBeGreaterThanOrEqual(4);

  // 画笔不参与快捷创建（2026-10-08 用户拍板）：选中画笔 → 四向连接点不出现
  await page.keyboard.press('v');
  await page.mouse.click(480, 300);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinth: { __debug: { lineAnchors: unknown } } }).__spinth
              .__debug.lineAnchors,
        ),
      { timeout: 5_000 },
    )
    .toBeNull();
  await page.keyboard.press('Escape');

  // e 切橡皮，垂直扫过笔画中部（页面 y 300 = 世界 256，扫掠线穿笔画）
  await page.keyboard.press('e');
  await page.mouse.move(480, 250);
  await page.mouse.down();
  for (let y = 270; y <= 340; y += 14) {
    await page.mouse.move(480, y, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();

  // 中部被擦：一条 → 两条（分段保留）
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(2);

  // undo 一步恢复一条（拖动期间的切割事务靠 captureTimeout 窗口合并，pen 同款）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(1);

  // Escape 中途取消（拖动中按 Esc）：undo 回退本手势 + 模式不被 edit.escape 切走
  await page.mouse.move(480, 250);
  await page.mouse.down();
  for (let y = 270; y <= 310; y += 14) {
    await page.mouse.move(480, y, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.keyboard.press('Escape'); // 指针仍按住
  await page.mouse.up();
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(1); // 取消 = 未擦
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __spinth: { cursorMode$: { value: string } } }).__spinth.cursorMode$
          .value,
    ),
  ).toBe('eraser');

  // 全擦：沿笔画全长反复扫 → 删除（PEN 0 条）
  await page.mouse.move(300, 290);
  await page.mouse.down();
  for (let x = 320; x <= 680; x += 30) {
    await page.mouse.move(x, 290 + (x % 60 === 0 ? 10 : 0), { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.move(680, 310);
  await page.mouse.up();
  await expect.poll(async () => (await penState()).count, { timeout: 5_000 }).toBe(0);

  // 大小可调（方括号）：] ×2 半径 10→18（探针断言；4~40 钳制）
  const radiusOf = () =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { __debug: { eraserRadius: number } } }).__spinth.__debug
          .eraserRadius,
    );
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await expect.poll(radiusOf, { timeout: 5_000 }).toBe(18);
  await page.keyboard.press('[');
  await expect.poll(radiusOf, { timeout: 5_000 }).toBe(14);
});

test('1.11③ eraser 切割保组：编组笔擦断后新段继承 groupId', async ({ page }) => {
  const docId = `e2e-eraser-group-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 先建一块矩形（编组需 ≥2 件）
  await page.keyboard.press('r');
  await page.mouse.move(300, 240);
  await page.mouse.down();
  await page.mouse.move(360, 280, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  // 画一笔长折线（中段可擦）
  await page.getByRole('button', { name: /画笔/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.move(700, 450, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  // 编组（框选单笔 → ActionBar 编组）
  await page.keyboard.press('v');
  await page.mouse.move(280, 220);
  await page.mouse.down();
  await page.mouse.move(760, 500, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(
    (
      await page.evaluate(
        () =>
          (window as unknown as { __spinth: { __debug: { selectedIds: string[] } } }).__spinth
            .__debug.selectedIds,
      )
    ).length,
  ).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+g'); // 快捷键入口（ActionBar 定位对笔画不稳）
  await page.waitForTimeout(300);
  const gid = (
    await page.evaluate(() => {
      const d = (
        window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
      ).__spinth.__debug;
      return d.vmStates.filter((s) => s.type === 'PEN').map((s) => String(s.groupId ?? ''));
    })
  )[0];
  expect(gid).toBeTruthy();

  // 橡皮扫断中段（笔中点上下扫过——线宽容差内）
  await page.keyboard.press('e');
  await page.mouse.move(550, 280);
  await page.mouse.down();
  await page.mouse.move(550, 330, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  const gids = await page.evaluate(() => {
    const d = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } } }
    ).__spinth.__debug;
    return d.vmStates.filter((s) => s.type === 'PEN').map((s) => String(s.groupId ?? ''));
  });
  expect(gids.length).toBe(2); // 一分为二
  expect(new Set(gids).size).toBe(1); // 两段同组（修复前新段脱组）
  expect(gids[0]).toBe(gid);
});

test('1.9/1.10 手势取消面：pen 拖拽中 pointercancel 不留孤儿笔；拖拽中切工具选区框回位', async ({
  page,
}) => {
  const docId = `e2e-cancel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

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
      (window as unknown as { __spinth: { __debug: { modelCount: number } } }).__spinth.__debug
        .modelCount,
  );
  expect(count).toBe(1); // 笔已成形（≥2 点）保留；cancel 后无孤儿/无悬空（修复前 drawingId 悬空）
  await page.keyboard.press('v');

  // ② 拖拽中切工具（v）：预览回弹——元素世界坐标不变（未落库）+ 选区框回到原位
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: { __debug: { vmPositions: Array<{ id: string; x: number; y: number }> } };
      }
    ).__spinth.__debug;
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
        __spinth: { __debug: { vmPositions: Array<{ id: string; x: number; y: number }> } };
      }
    ).__spinth.__debug;
    return d.vmPositions[0]!;
  });
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1); // 数据未落库（cancel 语义）
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});
