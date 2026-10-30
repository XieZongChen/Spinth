/** 线上文字 E2E（docs/08 §6 批次 3）：滑移/二次编辑/有字双胶囊 */
import { expect, test, type Page } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { createTwoRects, lineSelectionState } from './helpers/widgetProbeE2e';

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
  await waitForSynced(page);
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
  await waitForSynced(page);
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
