import type { Page } from '@playwright/test';

/** 脑图 E2E 公共探针 helper（specs/split-large-files §5.3）：
 *  断言用 `__spinthDebug.__debug` 数据探针（docs/14：截图会撒谎，探针优先）。 */

export interface Probe {
  modelCount: number;
  renderCount: number;
  selectedIds: string[];
  mindFocus: {
    nodeId: string;
    isRoot: boolean;
    worldRect: { x: number; y: number; width: number; height: number };
  } | null;
  mindNodes: Array<{
    id: string;
    text: string;
    worldRect: { x: number; y: number; width: number; height: number };
  }>;
  dropPreview: { x: number; y: number; width: number; height: number } | null;
  selectionFrame: { x: number; y: number; width: number; height: number } | null;
}

export async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    return {
      modelCount: d.modelCount,
      renderCount: d.renderCount,
      selectedIds: d.selectedIds,
      mindFocus: d.mindFocus,
      mindNodes: d.mindNodes,
      dropPreview: d.dropPreview,
      selectionFrame: d.selectionFrame,
    };
  });
}

/** 幽灵位置/透明度（transform 解析：matrix3d 取 12/13，matrix 取 4/5）。
 *  断言现身必须用 opacity 数值——Playwright 对 opacity:0 也判 visible。 */
export async function ghostPos(
  page: Page,
  mode: string,
): Promise<{ x: number; y: number; opacity: string }> {
  return page.locator(`[data-spinth-tool-ghost="${mode}"]`).evaluate((el) => {
    const cs = getComputedStyle(el);
    const nums = cs.transform.match(/[-\d.]+/g)?.map(Number) ?? [];
    return { x: nums[12] ?? nums[4] ?? 0, y: nums[13] ?? nums[5] ?? 0, opacity: cs.opacity };
  });
}
