import type { Page } from '@playwright/test';
import {} from '@playwright/test';

/**
 * 旋转 E2E（docs/05 §8 旋转首版）：拖柄落库/undo 单步、Shift 步进、锚定线跟随、
 * 旋转态命中（AABB 角空区不选）、旋转态 resize（指针逆旋转进局部）。
 * 断言走数据探针（vmStates.rotation）+ rotateHandle 探针定位手柄。
 */

export interface Probe {
  count: number;
  shapes: Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  }>;
  lines: Array<{
    id?: string;
    points: Array<[number, number]>;
    startNodeId: string | null;
    endNodeId: string | null;
  }>;
  selected: string[];
}

export async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            modelCount: number;
            vmStates: Array<Record<string, unknown>>;
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
          rotation: s.rotation as number | undefined,
        })),
      lines: d.vmStates
        .filter((s) => s.type === 'LINE')
        .map((s) => ({
          id: String(s.id),
          points: s.points as Array<[number, number]>,
          startNodeId: (s.startNodeId ?? null) as string | null,
          endNodeId: (s.endNodeId ?? null) as string | null,
        })),
      selected: d.selectedIds,
    };
  });
}

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

/** 旋转柄屏幕坐标（探针世界坐标 → 屏幕） */
export async function rotateHandleScreen(page: Page): Promise<{ x: number; y: number }> {
  const world = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { rotateHandle: { x: number; y: number } | null } };
      }
    ).__spinthDebug.__debug;
    return d.rotateHandle!;
  });
  return worldToScreen(page, world.x, world.y);
}

export async function dragCreateRect(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('r');
  await page.mouse.move(x, y + 44);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80 + 44, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}
