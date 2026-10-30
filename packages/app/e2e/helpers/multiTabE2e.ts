import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { modelCount } from './projectFileE2e';

/**
 * 多标签单写者 + 只读跟随（docs/21）：同一 BrowserContext 两个 page 共享
 * Web Locks（S0 探针已验证：占用时 ifAvailable=false、释放后可获取）。
 * 角色从 data-spinth-tab-role 观察；数据断言走 __spinth 探针（docs/15 §3）。
 * ?assetMaint=0：维护链是并行页面下的 IO 压力源（DEV 本就默认关，显式表达意图）。
 */

export async function tabRole(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('[data-spinth-tab-role]')?.getAttribute('data-spinth-tab-role') ?? '',
  );
}

export async function waitRole(page: Page, role: string): Promise<void> {
  await page.waitForFunction(
    (r) =>
      document.querySelector('[data-spinth-tab-role]')?.getAttribute('data-spinth-tab-role') === r,
    role,
    { timeout: 20_000 },
  );
}

/** R 工具拖拽创建矩形（smoke.spec 同款路径；leader/solo 页专用） */
export async function createShapeByDrag(page: Page): Promise<void> {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page), { timeout: 5_000 }).toBeGreaterThan(0);
}
