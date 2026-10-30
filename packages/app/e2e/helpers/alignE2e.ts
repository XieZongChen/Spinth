import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * 多选对齐/分布 E2E（docs/05 §7，2026-10）。
 *
 * 覆盖面：六向对齐的 x/y 两轴数学、分布等距（两端不动）、可用性（2 选分布禁用/
 * 单选无对齐键）、自由线 points 平移参与、锚定线跟随宿主（对齐后重路由 +
 * undo 一步形状与线同回——单事务含重路由合并的守卫）。
 *
 * 坐标纪律：断言一律走 __spinth.__debug 探针（vmStates/selectedIds/selectionFrame
 * 世界坐标）；点击/框选操作坐标从探针与 canvas rect 反推，禁手写裸屏数字。
 * PEN 不单设用例——commitDrag 平移既有护栏（widgets 4.10），对齐只是新调用方。
 */

export interface IProbe {
  modelCount: number;
  selectedIds: string[];
  vmStates: Array<Record<string, unknown>>;
  selectionFrame: { x: number; y: number; width: number; height: number } | null;
  mindNodes: Array<{
    id: string;
    text: string;
    worldRect: { x: number; y: number; width: number; height: number };
  }>;
}

export async function probe(page: Page): Promise<IProbe> {
  return page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: IProbe } }).__spinth.__debug;
    return {
      modelCount: d.modelCount,
      selectedIds: [...d.selectedIds],
      vmStates: d.vmStates,
      selectionFrame: d.selectionFrame ? { ...d.selectionFrame } : null,
      mindNodes: d.mindNodes,
    };
  });
}

export interface RectSnap {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 按世界 x 排序的 SHAPE 快照 */
export function shapesOf(p: IProbe): RectSnap[] {
  return p.vmStates
    .filter((s) => s.type === 'SHAPE')
    .map((s) => ({
      id: String(s.id),
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
    }))
    .sort((a, b) => a.x - b.x);
}

/** 线 points 快照（自由线平移/锚定线重路由断言用） */
type Pt = [number, number];
export function linePointsOf(p: IProbe): Pt[] {
  const l = p.vmStates.find((s) => s.type === 'LINE') as unknown as { points: Pt[] } | undefined;
  return l ? l.points.map((pt) => [pt[0]!, pt[1]!] as Pt) : [];
}

/** 容差比较（updateRect 两位小数取整 / points 浮点——0.1 内视为相等） */
export function close(a: number, b: number, tol = 0.1): boolean {
  return Math.abs(a - b) <= tol;
}

export async function createRect(page: Page, cx: number, cy: number): Promise<void> {
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** 空白处框选（起点避开元素） */
export async function marquee(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

export async function clickBar(page: Page, label: string): Promise<void> {
  await page.locator(`[data-spinth-action-bar] button[aria-label="${label}"]`).click();
  await page.waitForTimeout(300); // 事务 + 观察者（锚定线重路由）沉降
}

/** shift 加选点击：mouse.click 的 modifiers 在本环境（channel:chrome）不达 DOM
 *  事件（dom pointerdown shiftKey=false 实测），必须物理键盘 down/up 包夹。 */
export async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

/** 建三块错位矩形（x/y 双轴错开、间隙不等）并框选 */
export async function createAndSelectThree(page: Page): Promise<RectSnap[]> {
  await createRect(page, 450, 300); // world ≈ (390,216,120,80)
  await createRect(page, 700, 380); // world ≈ (640,296,120,80)
  await createRect(page, 980, 460); // world ≈ (920,376,120,80)
  await marquee(page, 340, 160, 1120, 560);
  const p = await probe(page);
  expect(p.selectedIds).toHaveLength(3);
  return shapesOf(p);
}
