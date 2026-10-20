import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 冒烟链路（docs/15 §3）：刷新进入 → 工具创建控件 → 拖拽移动 → undo 复位 → 刷新恢复。
 * 断言全部基于 `window.__spinth.__debug`（dev 调试句柄）——视觉断言的辅助手段见
 * docs/14 调试方法论（截图会撒谎，数据探针优先）。
 */

interface VmState {
  id: string;
  type: string;
  x: number;
  y: number;
}

async function debug(page: Page): Promise<{ modelCount: number; vms: VmState[] }> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __spinth?: { __debug: unknown } }).__spinth;
    const d = handle?.__debug as
      | { modelCount: number; vmStates: Array<{ id: string; type: string; x: number; y: number }> }
      | undefined;
    if (!d) throw new Error('__spinth 调试句柄未就绪（dev 模式才注入）');
    return {
      modelCount: d.modelCount,
      vms: d.vmStates.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y })),
    };
  });
}

async function waitBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

test('创建 → 拖拽 → undo → 刷新恢复', async ({ page }) => {
  const docId = `e2e-smoke-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitBoardReady(page);

  // 1) R 工具拖拽创建矩形（拖出 160×120），工具自动回选择态并选中
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await debug(page)).modelCount, { timeout: 5_000 }).toBe(1);
  let state = await debug(page);
  expect(state.vms[0]!.type).toBe('SHAPE');
  const createdX = state.vms[0]!.x;

  // 2) cursor 模式拖动该矩形 +140/+60（吸附可能微调，断言位移幅度）。
  //    toScreen 是 canvas 局部坐标，page.mouse 用页坐标——必须补顶栏 44px，
  //    否则落点偏进选中态 ActionBar 浮层区域被其拦截（2尾-3 落地后实测揪出）
  const center = await page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: { __debug: { vmPositions: Array<{ x: number; y: number }> } };
      }
    ).__spinth;
    const vpi = (
      w as unknown as {
        viewport: {
          viewportInstance: { toScreen(x: number, y: number): { x: number; y: number } };
        };
      }
    ).viewport.viewportInstance;
    const p = w.__debug.vmPositions[0]!;
    const s = vpi.toScreen(p.x + 80, p.y + 60);
    return { x: Math.round(s.x), y: Math.round(s.y + 44) };
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 140, center.y + 60, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await debug(page)).vms[0]!.x, { timeout: 5_000 })
    .toBeGreaterThan(createdX + 100);

  // 3) undo → 应回到创建时的位置（拖拽 = 一步撤销；undo 恢复精确原值）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await debug(page)).vms[0]!.x, { timeout: 5_000 }).toBe(createdX);

  // 4) 刷新 → IndexedDB 恢复同一控件（刷新恢复链路）
  await page.reload();
  await waitBoardReady(page);
  state = await debug(page);
  expect(state.modelCount).toBe(1);
  expect(state.vms[0]!.type).toBe('SHAPE');
  expect(state.vms[0]!.x).toBe(createdX);
});

test('1.14 初始化失败出口：IndexedDB 不可用 → 失败卡 + 重试（不再卡「正在恢复画布」）', async ({
  page,
}) => {
  const docId = `e2e-init-fail-${Date.now()}`;
  await page.addInitScript(() => {
    // 模拟存储禁用：indexedDB 访问即抛（私密模式极端/策略封禁等价）
    Object.defineProperty(window, 'indexedDB', {
      get(): never {
        throw new Error('IDB blocked by policy');
      },
      configurable: true,
    });
  });
  await page.goto(`/?doc=${docId}`);
  await expect(page.getByText('画布初始化失败')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  // 旧代码此场景永远停在「正在恢复画布…」（新用例天然区分新旧）
  await expect(page.getByText('正在恢复画布…')).toHaveCount(0);
});

test('1.22 只读态 UI：updateEditable(false) → 顶栏「只读」徽标 + 写工具禁用', async ({ page }) => {
  const docId = `e2e-readonly-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.getByText('只读')).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as unknown as { __spinth: { updateEditable(v: boolean): void } }
    ).__spinth.updateEditable(false),
  );
  await expect(page.getByTitle('此画布为只读——编辑命令已禁用')).toBeVisible();
  await expect(page.getByRole('button', { name: /矩形/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /选择/ })).toBeEnabled(); // 读类工具不受限
});

test('1.23 空态引导与文档操作：空画布提示现身/建件即隐 + 新建画布换 doc', async ({ page }) => {
  const docId = `e2e-empty-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.getByText('空画布')).toBeVisible();
  // 建首件 → 引导即隐
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 400, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(500, 380, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText('空画布')).toHaveCount(0);
  // 新建画布：URL 换新 doc 且空态再现
  await page.getByRole('button', { name: '新建画布' }).click();
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.getByText('空画布')).toBeVisible();
  expect(page.url()).not.toContain(docId);
});

test('单机启动：wsState=off、无 wsProvider、无外部网络请求', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      external.push(req.url());
    }
  });

  await page.goto(`/?doc=e2e-offline-start-${Date.now()}`);
  await waitBoardReady(page);

  const state = await page.evaluate(() => {
    const w = window as unknown as {
      __spinth: {
        wsState$: { getValue(): string };
        engine: { wsProvider: unknown };
      };
    };
    return {
      wsState: w.__spinth.wsState$.getValue(),
      wsProvider: w.__spinth.engine.wsProvider,
    };
  });
  expect(state.wsState).toBe('off');
  expect(state.wsProvider).toBeNull();
  expect(external).toEqual([]);

  // 品牌图标来自 public/，顶栏实际加载成功（不是 404 占位）
  const logo = page.locator('header img[src="/spinth-logo.png"]');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(500);
});
