import type { Page } from '@playwright/test';
import {} from '@playwright/test';

/**
 * 旋转 E2E（docs/05 §8）：旋转手柄入口暂时隐藏（specs/rotate-hide）期间，旋转态
 * 用 `setShapeRotation` 数据注入建立（模拟已旋转的旧文档），守护渲染/命中/缩放/
 * 连线锚定等数据链路；手柄手势用例暂跳过、恢复入口时启用。
 * 断言走数据探针（vmStates.rotation）+ rotateHandle 探针（坐标 + visible）。
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

/** 旋转柄探针原值（世界坐标 + 是否可见；未单选 rect 型时为 null） */
export async function rotateHandleProbe(
  page: Page,
): Promise<{ x: number; y: number; visible: boolean } | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __spinthDebug: {
            __debug: { rotateHandle: { x: number; y: number; visible: boolean } | null };
          };
        }
      ).__spinthDebug.__debug.rotateHandle,
  );
}

/** 数据注入：直写 SHAPE 的 rotation（真实 update 管线——连线 reattach 等响应照常
 *  触发）。入口隐藏期间用它建立旋转态，等价「已旋转的旧文档」 */
export async function setShapeRotation(page: Page, id: string, rad: number): Promise<void> {
  await page.evaluate(
    ([wid, r]) => {
      (
        window as unknown as {
          __spinthDebug: {
            __debug: {
              engine: { getModelById(id: string): { update(p: Record<string, unknown>): void } };
            };
          };
        }
      ).__spinthDebug.__debug.engine
        .getModelById(wid as string)
        .update({ rotation: r as number });
    },
    [id, rad] as const,
  );
}

/** 拖建 120×80 矩形（世界左上 (x,y)）。拖拽创建松手即选中新件并回选择工具，
 *  末尾 Escape 只是清掉选中 */
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
