import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * 编组 Group E2E（docs/18，2026-10-17 四点拍板：成员挂 groupId 无容器、
 * 参考框选口径整组全入框、Alt+点击进组、仅自由元素）。
 *
 * 覆盖面：建组（ActionBar/快捷键双入口）→ 点击整组选中 → Alt 直选单体 →
 * shift 组原子切换 → 框选半组不选/全组入选 → 拖动整组 → 对齐组整体性 →
 * 解组（快捷键）→ undo 一步（键删除投影）→ 粘贴保组（新 groupId）→
 * 混入锚定线编组键禁用 → 自由线转锚定同事务脱组。
 *
 * 坐标纪律同 align.spec：断言走 __spinthDebug.__debug 探针；操作坐标从探针世界
 * 坐标 + canvas rect 反推；修饰键必须物理键盘 down/up 包夹。
 */

export interface IProbe {
  modelCount: number;
  selectedIds: string[];
  vmStates: Array<Record<string, unknown>>;
}

export async function probe(page: Page): Promise<IProbe> {
  return page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: IProbe } }).__spinthDebug.__debug;
    return {
      modelCount: d.modelCount,
      selectedIds: [...d.selectedIds],
      vmStates: d.vmStates,
    };
  });
}

export interface RectSnap {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
}

export function shapesOf(p: IProbe): RectSnap[] {
  return p.vmStates
    .filter((s) => s.type === 'SHAPE')
    .map((s) => ({
      id: String(s.id),
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
      groupId: s.groupId === undefined ? undefined : String(s.groupId),
    }))
    .sort((a, b) => a.x - b.x);
}

export function lineOf(p: IProbe): Record<string, unknown> | undefined {
  return p.vmStates.find((s) => s.type === 'LINE');
}

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
  await page.waitForTimeout(300);
}

/** 修饰键必须物理键盘包夹（mouse.click 的 modifiers 不达 DOM 事件，align.spec 同款教训） */
export async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

export async function altClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Alt');
  await page.mouse.click(x, y);
  await page.keyboard.up('Alt');
}

/** 世界 → 屏幕（初载 scale=1 无平移，align.spec 同款假设） */
export async function screenOf(
  page: Page,
  wx: number,
  wy: number,
): Promise<{ x: number; y: number }> {
  const cRect = await page.evaluate(() =>
    document.querySelector('canvas')!.getBoundingClientRect(),
  );
  return { x: wx + cRect.left, y: wy + cRect.top };
}

/** 建两块矩形并框选编组（ActionBar 入口），返回建组后快照 */
export async function createGroupedPair(
  page: Page,
): Promise<{ a: RectSnap; b: RectSnap; groupId: string }> {
  await createRect(page, 450, 300); // world ≈ (390,216,120,80)
  await createRect(page, 700, 400); // world ≈ (640,316,120,80)
  await marquee(page, 340, 160, 820, 480);
  await clickBar(page, '编组');
  const p = await probe(page);
  const [a, b] = shapesOf(p);
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(a!.groupId).toBeTruthy();
  expect(b!.groupId).toBe(a!.groupId);
  return { a: a!, b: b!, groupId: a!.groupId! };
}
