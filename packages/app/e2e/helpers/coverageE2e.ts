import type { Page } from '@playwright/test';
import {} from '@playwright/test';

/**
 * 补齐 E2E（盘点 P2）：redo 全链路 / 图层操作 / ActionBar 色板族 / SHAPE 缩放 /
 * 快捷键面——均为已落地功能零护栏面。断言数据探针优先（docs/15 §3）。
 */

export interface VProbe {
  count: number;
  shapes: Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    borderStyle: string;
    zOrder?: string;
  }>;
  scale: number;
  selected: string[];
}

export async function probe(page: Page): Promise<VProbe> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            modelCount: number;
            vmStates: Array<Record<string, unknown>>;
            vmPositions: Array<{ id: string; x: number; y: number }>;
            selectedIds: string[];
          };
        };
      }
    ).__spinthDebug.__debug;
    return {
      count: d.modelCount,
      shapes: d.vmStates
        .filter((s) => s.type === 'SHAPE')
        .map((s) => ({
          id: String(s.id),
          x: s.x as number,
          y: s.y as number,
          width: s.width as number,
          height: s.height as number,
          color: String(s.color),
          borderStyle: String(s.borderStyle),
          zOrder: s.zOrder as string | undefined,
        })),
      scale: (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
        .value,
      selected: d.selectedIds,
    };
  });
}

/** 屏幕坐标换算（探针世界 → canvas 局部 + 顶栏 44）——公开查询 toScreenPoint */
export async function worldToScreen(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy]) => {
      const s = (
        window as unknown as {
          __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
        }
      ).__spinth.toScreenPoint({ x: wx, y: wy });
      return { x: Math.round(s.x), y: Math.round(s.y + 44) };
    },
    [x, y],
  );
}
