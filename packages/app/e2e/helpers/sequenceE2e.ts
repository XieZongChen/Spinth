import { expect, type Page } from '@playwright/test';

/** 时序图 E2E 公共 helper（specs/sequence-diagram §10）：断言走 __spinthDebug.__debug
 *  探针（世界坐标）；指针坐标经公开查询 toScreenPoint 现算（世界 → 画布局部 +
 *  顶栏 44），不硬编码视口原点与缩放。批量路径后的断言读 model.toJSON() 文档真值。 */

export const TOP_BAR = 44;

export interface LifelineSnap {
  id: string;
  type: string;
  label?: string;
  head?: string;
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

/** 连线文档 / vm 快照（消息断言用；可选键缺省 = 数据里没有这个键） */
export interface LineSnap {
  id: string;
  type: string;
  points: Array<[number, number]>;
  startNodeId: string | null;
  endNodeId: string | null;
  startJoin: string | null;
  endJoin: string | null;
  startPort?: number;
  endPort?: number;
  lineType: string;
  startArrow: string;
  endArrow: string;
  dashed: boolean;
  /** 线上文字（HTML）与其侧别（缺省 = 骑线镂空，数据里没有这个键或值为 undefined） */
  text?: string;
  textRatio?: number;
  textSide?: 'above' | 'below';
}

/** 最近一次的线上文字盒（E2E 探针 lineKnockout）：骑线 = 镂空矩形（字形 + 内边距），
 *  侧别 = 字形盒；无字 / 未选中线 = null */
export async function lineKnockoutOf(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              lineKnockout: { x: number; y: number; width: number; height: number } | null;
            };
          };
        }
      ).__spinthDebug.__debug.lineKnockout,
  );
}

export async function linesOf(page: Page): Promise<LineSnap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'LINE') as LineSnap[];
}

export async function lineDoc(page: Page, id: string): Promise<LineSnap | null> {
  return docOf(page, id) as unknown as LineSnap | null;
}

/** 连线工具 / 选中态的连接点快照（E2E 探针 lineAnchors；null = 未显示） */
export async function lineAnchorsOf(page: Page): Promise<Array<{ x: number; y: number }> | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: {
            __debug: { lineAnchors: Array<{ x: number; y: number }> | null };
          };
        }
      ).__spinthDebug.__debug.lineAnchors,
  );
}

/** 最近一帧拖拽预览路由（E2E 探针 linePreview；null = 未在预览） */
export async function linePreviewOf(page: Page): Promise<Array<[number, number]> | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: {
            __debug: { linePreview: Array<[number, number]> | null };
          };
        }
      ).__spinthDebug.__debug.linePreview,
  );
}

/** 时序图二级菜单选图元（菜单项可访问名 = 选项 label），等到该项点亮 */
export async function setSequenceKind(page: Page, label: string): Promise<void> {
  const item = page
    .locator('[data-spinth-tool-flyout]')
    .getByRole('menuitemradio', { name: label });
  await item.click();
  await expect(item).toHaveAttribute('aria-checked', 'true');
}

/** 时序图消息工具：Q 进工具 + 二级菜单选消息种类 */
export async function pressMessageTool(
  page: Page,
  kind: '同步消息' | '异步消息' | '返回消息' = '同步消息',
): Promise<void> {
  await pressSequenceTool(page);
  await setSequenceKind(page, kind);
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

/** 激活条快照（批次 3）：lifelineId 缺省 = 未绑定；可选键缺省 = 数据里没有这个键 */
export interface ActivationSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lifelineId?: string;
  parentId?: string;
  zOrder?: string;
}

export async function activationsOf(page: Page): Promise<ActivationSnap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'ACTIVATION') as ActivationSnap[];
}

/** 激活条文档真值（绑定断言读它——拖拽 / 粘贴批量路径后 vm.state 可能滞后） */
export async function activationDoc(page: Page, id: string): Promise<ActivationSnap | null> {
  return docOf(page, id) as unknown as ActivationSnap | null;
}

/** 时序图激活条工具：Q 进工具 + 二级菜单选「激活条」 */
export async function pressActivationTool(page: Page): Promise<void> {
  await pressSequenceTool(page);
  await setSequenceKind(page, '激活条');
}

/** 时序图工具 + 二级菜单选任意种类的图元（分隔线 / 片段 alt·opt·loop·par 等；
 *  菜单项可访问名 = 选项 label——片段项就是关键字本身） */
export async function pressSequenceKind(page: Page, label: string): Promise<void> {
  await pressSequenceTool(page);
  await setSequenceKind(page, label);
}

/** 容器快照（组合片段 = FRAME 预设，specs/sequence-diagram §6.1）：fill / title 可选 */
export interface FrameSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  fill?: string;
  color?: string;
  parentId?: string;
}

export async function framesOf(page: Page): Promise<FrameSnap[]> {
  return (await vmStates(page)).filter((s) => s.type === 'FRAME') as FrameSnap[];
}

/** 撤销 / 重做可用性（公开输出流 canUndo$ / canRedo$ 的当前值） */
export async function canUndoOf(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (
      window as unknown as { __spinth: { canUndo$: { getValue(): boolean } } }
    ).__spinth.canUndo$.getValue(),
  );
}

export async function canRedoOf(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (
      window as unknown as { __spinth: { canRedo$: { getValue(): boolean } } }
    ).__spinth.canRedo$.getValue(),
  );
}

/** 粘贴到指定世界点（公开命令 pasteAt：快照左上角落点），等一拍让新件建好 */
export async function pasteAtWorld(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    (target) => {
      (
        window as unknown as { __spinth: { pasteAt(t: { x: number; y: number }): void } }
      ).__spinth.pasteAt(target);
    },
    { x, y },
  );
  await page.waitForTimeout(300);
}

/** 已选中控件的手柄 / 条身从世界 (x1,y1) 按住拖到 (x2,y2)；按住期间回调 onDrag
 *  （读拖拽预览），最后才松手 */
export async function holdDrag(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  onDrag?: () => Promise<void>,
): Promise<void> {
  const a = await toPage(page, x1, y1);
  const b = await toPage(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await onDrag?.();
  await page.mouse.up();
  await page.waitForTimeout(300);
}
