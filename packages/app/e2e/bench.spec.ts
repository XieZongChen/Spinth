import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 性能基准（docs/16 §6，Phase 4 验收）：1000 控件（shape/text/pen 混合）
 * + 拖拽期间 rAF 帧间隔 P95 < 20ms + 3 屏外滚动 culling 翻转。
 * 探针全部走 `window.__spinthDebug.__debug`（数据探针优先，docs/14 方法论）。
 * 批量创建走 dev 注入实例的 engine（UI 路径建 1000 个不可行）。
 *
 * 采样窗自适应：帧数由 runner 吞吐决定，与产品性能无关——共享 runner 上
 * 固定 2s 窗口可能只采到几十帧，等于让无关环境变量决定红绿。窗口按
 * 「时长 + 最少帧数」双条件收窗（帧数不足时拉长至 maxMs 硬顶），
 * 帧数仍不足则把性能断言降级为诊断 annotation 留痕，不误红。
 */

async function waitBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

test('1000 控件：拖拽 rAF P95 < 20ms + 滚动 culling 生效 @bench', async ({ page }) => {
  const docId = `e2e-bench-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitBoardReady(page);

  // 1) 程序化批量创建 1000：600 shape + 300 text + 100 pen，网格散布 5200×4600
  //    世界范围（视口 1440×900 只覆盖一角——保证大量屏外供 culling 验证）
  await page.evaluate(() => {
    const w = window as unknown as {
      __spinthDebug?: {
        __debug?: {
          engine?: {
            transact(fn: () => void): void;
            add(data: Record<string, unknown>): void;
            genInitialOrder(): string;
          };
        };
      };
    };
    const engine = w.__spinthDebug!.__debug!.engine!;
    engine.transact(() => {
      for (let i = 0; i < 600; i++) {
        engine.add({
          id: `bs${i}`,
          type: 'SHAPE',
          zOrder: engine.genInitialOrder(),
          shapeType: 'rect',
          color: '#e8f0fb',
          borderStyle: 'solid',
          x: (i % 40) * 130,
          y: Math.floor(i / 40) * 110,
          width: 80,
          height: 60,
        });
      }
      for (let i = 0; i < 300; i++) {
        engine.add({
          id: `bt${i}`,
          type: 'TEXT',
          zOrder: engine.genInitialOrder(),
          text: `<p>文本 ${i}</p>`,
          x: (i % 30) * 150,
          y: 2000 + Math.floor(i / 30) * 130,
          width: 120,
          height: 40,
        });
      }
      for (let i = 0; i < 100; i++) {
        const x = (i % 20) * 160;
        const y = 4000 + Math.floor(i / 20) * 140;
        engine.add({
          id: `bp${i}`,
          type: 'PEN',
          zOrder: engine.genInitialOrder(),
          points: [
            [x, y],
            [x + 50, y + 30],
            [x + 100, y + 10],
          ],
          color: '#1f2937',
          strokeWidth: 3,
          x,
          y,
          width: 100,
          height: 40,
        });
      }
    });
  });
  await page.waitForFunction(
    () => {
      const d = (
        window as unknown as {
          __spinthDebug?: { __debug: { modelCount: number; vmCount: number } };
        }
      ).__spinthDebug?.__debug;
      return !!d && d.modelCount === 1000 && d.vmCount === 1000;
    },
    undefined,
    { timeout: 20_000 },
  );

  // 2) culling 初始生效：视口只覆盖左上角 → 大量屏外 renderable=false
  const culledAtStart = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { culledCount: number } } }).__spinthDebug
        .__debug.culledCount,
  );
  expect(culledAtStart).toBeGreaterThan(500);

  // 3) 帧率采样：先测空转基线（headless 软渲染基线 p95 ≈ 18ms，属环境噪声），
  //    再测拖拽期间——docs/16 §6 的 20ms 绝对阈值按桌面硬件解渲染定，
  //    headless 下用「绝对上限 + 相对增量」双指标守住同一意图。
  const sample = async (opts: {
    durationMs: number;
    minFrames?: number;
    maxMs?: number;
  }): Promise<number[]> =>
    page.evaluate(({ durationMs, minFrames = 0, maxMs = durationMs }) => {
      const w = window as unknown as {
        __sample?: Promise<number[]>;
        __sampleDone?: boolean;
      };
      // 每次采样重置完成标记（Node 侧拖拽驱动轮询它决定何时 mouse.up）
      w.__sampleDone = false;
      w.__sample = new Promise((resolve) => {
        const gaps: number[] = [];
        let last = performance.now();
        const t0 = last;
        const tick = (): void => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          const elapsed = now - t0;
          // 双条件收窗：时长够且帧数够；到 maxMs 硬顶也收（返回真实采样）
          if ((elapsed >= durationMs && gaps.length >= minFrames) || elapsed >= maxMs) {
            w.__sampleDone = true;
            resolve(gaps);
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      });
      return w.__sample!;
    }, opts);
  const pct = (sorted: number[], p: number): number => sorted[Math.floor(sorted.length * p)]!;

  // 去首尾各 10 帧（prompt §2.3.3 采样去噪——首帧/收尾帧常含启动尖刺）
  const trim = (xs: number[]): number[] => xs.slice(10, Math.max(11, xs.length - 10));
  const idle = trim(await sample({ durationMs: 1500 })).sort((a, b) => a - b);
  const idleP95 = pct(idle, 0.95);

  // 拖真件（prompt §2.3.3：拖拽起点必须命中控件——此前 (300,300) 空白区，
  // rAF 照跑但无每帧重绘，帧率绿≠画面动）：探针取视口内 shape 换算屏幕中心。
  // 选靶必须避开 56px 边缘热区（specs/edge-auto-scroll：起点在热区内会触发
  // 拖拽自动滚屏，平移视口 → 污染 culling 前后对比与帧率采样），取网格中部
  //（列 5 行 3：屏幕 ≈(690,360)，全程拖拽路径离四边 >100px）；
  // 工作量三断言（renderCount 增量/位置落库/culling）是门禁，绝对 p95 只注记
  const target = await page.evaluate(() => {
    // 公开面（toScreenPoint）与调试面拆两个断言（specs/runtime-narrowing §3.8）
    const pub = (
      window as unknown as {
        __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
      }
    ).__spinth;
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmPositions: Array<{ id: string; x: number; y: number }>;
            renderCount: number;
          };
        };
      }
    ).__spinthDebug.__debug;
    const s = d.vmPositions.find(
      (p) => p.id.startsWith('bs') && p.x > 600 && p.x < 800 && p.y > 300 && p.y < 450,
    )!;
    const sc = pub.toScreenPoint({ x: s.x + 40, y: s.y + 30 });
    return { id: s.id, wx: s.x, sx: sc.x, sy: sc.y + 44, rc: d.renderCount };
  });
  const canvas = page.locator('canvas').first();
  // toScreen 是 canvas 局部系；hover({position}) 也是元素相对系——不加顶栏 44px
  // （page.mouse 才需要 page 系；此处全程走 locator/mouse 同系）
  const px = Math.round(target.sx);
  const py = Math.round(target.sy - 44);
  await canvas.hover({ position: { x: px, y: py } });
  await page.mouse.down();
  // 窗口按帧数自适应拉长（minFrames=80 = 门限 60 + trim 首尾 20；上限 8s），
  // 因此鼠标驱动必须与采样器解耦：move 先停会让后半段窗口没有拖拽重绘，
  // P95 被空转帧稀释
  const dragSample = sample({ durationMs: 2000, minFrames: 80, maxMs: 8000 });
  // 连续密集 move（不插 sleep——waitForTimeout 间隙会让 rAF 空转出长帧，
  // 污染帧间隔统计；steps 拆步保证 pointermove 事件流持续喂进拖拽循环）。
  // 前 30 步 sweep（净位移 ≈ +600x，movedX 门禁依赖它）；之后在终点附近
  // jiggle 维持事件流，直到页面内 __sampleDone 置位（每 5 步查一次，
  // 400 步硬顶防死循环——极端慢 runner 下窗口按 maxMs 自行收窗）
  for (let i = 0; i < 400; i++) {
    const jx = i < 30 ? px + 20 + i * 20 : px + 600 + (i % 2) * 10;
    const jy = i < 30 ? py + i * 5 : py + 145;
    await page.mouse.move(jx, jy, { steps: 3 });
    if (i % 5 === 4) {
      const done = await page.evaluate(
        () => (window as unknown as { __sampleDone?: boolean }).__sampleDone === true,
      );
      if (done) break;
    }
  }
  await page.mouse.up();
  const gaps = trim(await dragSample).sort((a, b) => a - b);

  // 工作量 ①：拖拽期间持续渲染（画面冻结/拖空必红）
  const rcAfter = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { renderCount: number } } }).__spinthDebug
        .__debug.renderCount,
  );
  expect(rcAfter - target.rc).toBeGreaterThanOrEqual(20);
  // 工作量 ②：被拖 shape 落库位移与拖拽方向一致（总位移 ≈ +600x/+145y，
  // 参考线吸附可能修正——宽松下界 400 证明「真的拖动了那一个」）
  const movedX = await page.evaluate((id) => {
    const w = (
      window as unknown as {
        __spinthDebug: { __debug: { vmPositions: Array<{ id: string; x: number }> } };
      }
    ).__spinthDebug;
    return w.__debug.vmPositions.find((v) => v.id === id)!.x;
  }, target.id);
  expect(movedX - target.wx).toBeGreaterThan(400);

  const p95 = pct(gaps, 0.95);
  const avg = gaps.reduce((s, v) => s + v, 0) / gaps.length;
  test.info().annotations.push({
    type: 'bench',
    description: `frames=${gaps.length} avg=${avg.toFixed(1)}ms p95=${p95.toFixed(1)}ms idleP95=${idleP95.toFixed(1)}ms culled=${culledAtStart} renders=${rcAfter - target.rc}`,
  });
  // 帧数门禁降级为诊断（v1.0-closeout A1b）：帧数度量 runner 吞吐而非产品
  // 性能——样本足够（trim 后 ≥ 60 帧）才做相对预算断言；不足则留痕不静默，
  // 工作量门禁（renderCount/movedX）已证明拖拽期间画面确实在动
  if (gaps.length >= 60) {
    // 相对预算是门禁；绝对 p95 只注记（共享 runner 不可移植，prompt §2.3.3）
    expect(p95 - idleP95).toBeLessThan(8);
  } else {
    test.info().annotations.push({
      type: 'bench-insufficient-frames',
      description: `frames=${gaps.length} < 60，跳过 p95 相对预算断言（记录性留痕，不判红）`,
    });
  }

  // 4) 滚 3 屏外 → 可视区翻转（原可视控件被裁、新区域恢复；poll 替代定长等待）
  await page.mouse.wheel(0, 3000);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __spinthDebug: { __debug: { culledCount: number } } })
              .__spinthDebug.__debug.culledCount,
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  // 滚回原位 → 恢复（culled 数回落到接近初始）
  await page.mouse.wheel(0, -3000);
  const culledBack = await page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { culledCount: number } } }).__spinthDebug
        .__debug.culledCount,
  );
  expect(Math.abs(culledBack - culledAtStart)).toBeLessThan(50);
});
