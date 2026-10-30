import type { Page } from '@playwright/test';

/** 控件/连线 E2E 公共探针 helper（specs/split-large-files §5.3）：
 *  从原 widgets.spec.ts 抽取（语义逐字一致）；断言数据探针优先于截图（docs/15 §3）。 */

export interface WProbe {
  modelCount: number;
  editorFrame: { x: number; y: number; width: number; height: number } | null;
  selectionFrame: { x: number; y: number; width: number; height: number } | null;
  line: { points: Array<[number, number]> } | null;
  pen: { points: Array<[number, number]> } | null;
}

export async function probe(page: Page): Promise<WProbe> {
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

export interface ILineProbe {
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

export async function lineProbe(page: Page): Promise<ILineProbe> {
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

/** 建两个矩形（连线锚定端），返回各自中心屏幕坐标 */
export async function createTwoRects(
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

/** 建一个矩形，返回中心屏幕坐标 */
export async function createRect(page: Page, cx: number, cy: number): Promise<void> {
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** ActionBar v2 多级控件（2026-10-03）：点触发钮展开二级面板 → 点选项应用 */
export async function barPick(page: Page, trigger: string, option: string): Promise<void> {
  await page.locator(`[data-spinth-action-bar] button[aria-label="${trigger}"]`).click();
  await page.locator(`[data-spinth-popover-panel] button[aria-label="${option}"]`).first().click();
}

export async function lineSelectionState(page: Page): Promise<{
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
