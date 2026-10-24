import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 390px 布局矩阵公共助手（批次 A · A3，spec §7.2）。
 * 断言一律用 data-spinth-* 稳定标记定位，不用 Tailwind class 选择器；
 * 坐标从 canvas boundingBox / __spinth 探针推导，不手写视口常量。
 */

export const MOBILE = { width: 390, height: 844 } as const;

/** 顶栏高度（h-11，M1 会实测断言） */
export const HEADER_H = 44;

/** 打开画布并等几何稳定：synced + 字体就绪 + 两帧 rAF（布局/字体抖动收敛） */
export async function openBoard(page: Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * 断言 locator 四边在视口（或给定的 pad 内），容差 0.5px（亚像素取整）。
 * boundingBox 为 null 直接抛带 selector 的错（元素未渲染/不可见是硬失败）。
 */
export async function boxWithin(
  locator: Locator,
  viewport: { width: number; height: number },
  pad = 0,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`boundingBox 为 null（未渲染/不可见）：${locator}`);
  const name = String(locator);
  expect(box.x, `${name} 左缘越界（x=${box.x} < ${pad}）`).toBeGreaterThanOrEqual(pad - 0.5);
  expect(box.y, `${name} 顶边越界（y=${box.y} < ${pad}）`).toBeGreaterThanOrEqual(pad - 0.5);
  expect(
    box.x + box.width,
    `${name} 右缘越界（${box.x + box.width} > ${viewport.width - pad}）`,
  ).toBeLessThanOrEqual(viewport.width - pad + 0.5);
  expect(
    box.y + box.height,
    `${name} 底边越界（${box.y + box.height} > ${viewport.height - pad}）`,
  ).toBeLessThanOrEqual(viewport.height - pad + 0.5);
  return box;
}

/** 文档不横向滚动（documentElement 与 body 都不超内宽） */
export async function noDocHScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => ({
    de: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(over.de, `documentElement 横向溢出 ${over.de}px`).toBeLessThanOrEqual(0);
  expect(over.body, `body 横向溢出 ${over.body}px`).toBeLessThanOrEqual(0);
}

/** 矩形相交判定（工具坞 vs 缩放胶囊防重叠） */
export function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** WCAG 2.2 AA 2.5.8 触控目标下限 24×24（不要求 44——非本批口径） */
export async function minTarget(locator: Locator, min = 24): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`boundingBox 为 null：${locator}`);
  const name = String(locator);
  expect(box.width, `${name} 宽 ${box.width} < ${min}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box.height, `${name} 高 ${box.height} < ${min}`).toBeGreaterThanOrEqual(min - 0.5);
}
