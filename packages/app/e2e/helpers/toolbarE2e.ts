import type { Page } from '@playwright/test';
import {} from '@playwright/test';

/**
 * 工具坞常驻二级菜单 E2E（docs/12 §4 Toolbar 行，2026-10-11 形状四型首例）。
 *
 * 语义：面板可见性 = 工具激活的纯派生状态（激活现身 / 切走隐藏 / 点选切默认型
 * 面板保持）。本文件也是**首例工具坞 UI 点击基建**（此前 E2E 全走快捷键）。
 * 断言纪律：数据走 __spinth.__debug 探针（defaultShapeType/vmStates/cursorMode$），
 * UI 走 aria（toolbar role / menuitemradio / aria-checked）。
 */

/** 控件中心（世界 → 屏幕：canvas 顶栏 44px） */
export async function centerOf(page: Page, type: string): Promise<{ x: number; y: number }> {
  return page.evaluate((t) => {
    const s = (
      window as unknown as { __spinth: { __debug: { vmStates: Array<Record<string, number>> } } }
    ).__spinth.__debug.vmStates.find((v) => String(v.type) === t)!;
    return { x: s.x + s.width / 2, y: s.y + s.height / 2 + 44 };
  }, type);
}

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}
