import { expect, type Page } from '@playwright/test';

/** 时序图 E2E 公共 helper（specs/sequence-diagram §10）：断言走 __spinthDebug.__debug
 *  探针（世界坐标）；指针坐标经公开查询 toScreenPoint 现算（世界 → 画布局部 +
 *  顶栏 44），不硬编码视口原点与缩放。批量路径后的断言读 model.toJSON() 文档真值。 */

export const TOP_BAR = 44;

export interface LifelineSnap {
  id: string;
  type: string;
  label?: string;
  parentId?: string;
  zOrder?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 世界 → 页面坐标（公开查询 toScreenPoint：画布局部 + 顶栏） */
export async function toPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy, bar]) => {
      const s = (
        window as unknown as {
          __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
        }
      ).__spinth.toScreenPoint({ x: wx, y: wy });
      return { x: Math.round(s.x), y: Math.round(s.y + bar) };
    },
    [x, y, TOP_BAR],
  );
}

export async function vmStates<T = Record<string, unknown>>(page: Page): Promise<T[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __spinthDebug: { __debug: { vmStates: unknown[] } } }
      ).__spinthDebug.__debug.vmStates.slice() as T[],
  );
}

export async function lifelinesOf(page: Page): Promise<LifelineSnap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'LIFELINE') as LifelineSnap[];
}

export async function cursorModeOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    (
      window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
    ).__spinth.cursorMode$.getValue(),
  );
}

export async function selectedIdsOf(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { selectedIds: string[] } } }).__spinthDebug
        .__debug.selectedIds,
  );
}

/** 缩放编辑框当前矩形（未选中 = null） */
export async function editorFrameOf(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              editorFrame: { x: number; y: number; width: number; height: number } | null;
            };
          };
        }
      ).__spinthDebug.__debug.editorFrame,
  );
}

/** 最近一次避障集合（network.spec N-6 同款探针） */
export async function obstaclesOf(page: Page): Promise<Array<Record<string, number>> | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: { __debug: { lastRouteObstacles: Array<Record<string, number>> | null } };
        }
      ).__spinthDebug.__debug.lastRouteObstacles,
  );
}

/** 文档真值（model.toJSON）——批量路径 / undo·redo 后 vm.state 可能滞后 */
export async function docOf(page: Page, id: string): Promise<LifelineSnap | null> {
  return page.evaluate((widgetId) => {
    const eng = (
      window as unknown as {
        __spinthDebug: {
          __debug: { engine: { getModelById(i: string): { toJSON(): unknown } | undefined } };
        };
      }
    ).__spinthDebug.__debug.engine;
    return (eng.getModelById(widgetId)?.toJSON() as LifelineSnap | undefined) ?? null;
  }, id);
}

export async function modelCountOf(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __spinthDebug: { __debug: { modelCount: number } } }).__spinthDebug
        .__debug.modelCount,
  );
}

/** 快捷键 Q 进时序图工具，等到模式落地 */
export async function pressSequenceTool(page: Page): Promise<void> {
  await page.keyboard.press('q');
  await expect.poll(() => cursorModeOf(page)).toBe('sequence');
}

/** 快捷键 V 回选择工具 */
export async function backToCursor(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await expect.poll(() => cursorModeOf(page)).toBe('cursor');
}

export async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const p = await toPage(page, x, y);
  await page.mouse.click(p.x, p.y);
}

export async function dragWorld(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  steps = 8,
): Promise<void> {
  const a = await toPage(page, x1, y1);
  const b = await toPage(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** 时序图工具已激活：在世界 (x, y) 单击创建一条生命线（默认尺寸按下点居中），
 *  返回新件的 vm 快照 */
export async function clickCreateLifeline(page: Page, x: number, y: number): Promise<LifelineSnap> {
  const before = new Set((await lifelinesOf(page)).map((l) => l.id));
  await clickWorld(page, x, y);
  await expect
    .poll(async () => (await lifelinesOf(page)).filter((l) => !before.has(l.id)).length)
    .toBe(1);
  return (await lifelinesOf(page)).find((l) => !before.has(l.id))!;
}

/** 批量建件（engine.add，bench / network 先例）：id 由调用方给；**不包外层事务**
 *  ——外层事务内「创建后紧接的写入」对 mid-transaction 才挂上的 vm 观察者不可见 */
export async function engineAdd(
  page: Page,
  widgets: Array<Record<string, unknown>>,
): Promise<void> {
  await page.evaluate((ws) => {
    const eng = (
      window as unknown as {
        __spinthDebug: {
          __debug: { engine: { add(w: unknown): void; genInitialOrder(): string } };
        };
      }
    ).__spinthDebug.__debug.engine;
    for (const w of ws) eng.add({ zOrder: eng.genInitialOrder(), ...w });
  }, widgets);
  await page.waitForTimeout(400);
}

/** 等防抖持久化落盘（刷新前的必要等待） */
export async function waitSaved(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __spinth: { persistState$: { getValue(): string } } }
      ).__spinth.persistState$.getValue() === 'saved',
    undefined,
    { timeout: 10_000 },
  );
}

export function rectOf(s: { x: number; y: number; width: number; height: number }): number[] {
  return [s.x, s.y, s.width, s.height];
}
