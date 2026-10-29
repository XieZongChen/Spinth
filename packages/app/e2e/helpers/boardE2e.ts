import type { Page } from '@playwright/test';

/** E2E 公共板级 helper（specs/split-large-files §5.3）：
 *  waitForSynced 保留各 spec 原 `ready` 的等待语义（__spinth.docState$ === 'synced'），
 *  不改用 layoutE2e.openBoard（后者多等字体/双 rAF，会改变时序）。 */

export async function waitForSynced(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

/** 打开（或新建）一个 E2E 文档并等待就绪——spec 内 `page.goto(?doc=…)` + ready 的合写 */
export async function openBoardDoc(page: Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
}
