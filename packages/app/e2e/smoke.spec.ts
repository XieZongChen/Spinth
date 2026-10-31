import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { persisted } from './helpers/projectFileE2e';

/**
 * 冒烟链路（docs/15 §3）：刷新进入 → 工具创建控件 → 拖拽移动 → undo 复位 → 刷新恢复。
 * 断言全部基于 `window.__spinthDebug.__debug`（dev 调试句柄）——视觉断言的辅助手段见
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
    const handle = (window as unknown as { __spinthDebug?: { __debug: unknown } }).__spinthDebug;
    const d = handle?.__debug as
      | { modelCount: number; vmStates: Array<{ id: string; type: string; x: number; y: number }> }
      | undefined;
    if (!d) throw new Error('__spinthDebug 调试句柄未就绪（dev 模式才注入）');
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
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmPositions: Array<{ x: number; y: number }>;
            viewport: {
              viewportInstance: { toScreen(x: number, y: number): { x: number; y: number } };
            };
          };
        };
      }
    ).__spinthDebug.__debug;
    const p = d.vmPositions[0]!;
    const s = d.viewport.viewportInstance.toScreen(p.x + 80, p.y + 60);
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

  // 4) 刷新 → IndexedDB 恢复同一控件（刷新恢复链路）。
  //    先等落盘：undo 也是一次写入，100ms 写聚合窗口内 reload 会丢最后一帧
  //    （曾因启动新增存储状态异步工作放大此窗口而 flaky，复审 #4）
  await persisted(page);
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

test('1.22 只读态 UI：updateEditable(false) → 徽标 + 写面禁用 + 运行时降级收口', async ({
  page,
}) => {
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

  // 前置可写状态：建矩形（世界 500,300 → 660,420，中心 580,360）→ 切回选择 → 点击选中
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await debug(page)).modelCount).toBe(1);
  await page.getByTitle('选择 (V)').click();
  const at = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            viewport: { worldToClient(p: { x: number; y: number }): { x: number; y: number } };
          };
        };
      }
    ).__spinthDebug.__debug;
    return d.viewport.worldToClient({ x: 580, y: 360 });
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('[data-spinth-action-bar]')).toHaveCount(1); // 选中 → 操作栏可见
  await expect(page.getByTitle('撤销 (Cmd+Z)')).toBeEnabled();

  // 运行时降级：徽标 + 语义收口（选区清空/工具回 cursor）+ 呈现收口（操作栏/三键）
  await page.evaluate(() =>
    (
      window as unknown as { __spinth: { updateEditable(v: boolean): void } }
    ).__spinth.updateEditable(false),
  );
  await expect(page.getByTitle('此画布为只读——编辑命令已禁用')).toBeVisible();
  await expect(page.locator('[data-spinth-action-bar]')).toHaveCount(0); // 降级清选区 → 操作栏消失
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as unknown as { __spinth: { selected$: { getValue(): string[] } } };
        return w.__spinth.selected$.getValue().length;
      }),
    )
    .toBe(0);
  await expect(page.getByTitle('撤销 (Cmd+Z)')).toBeDisabled();
  await expect(page.getByTitle('重做 (Shift+Cmd+Z)')).toBeDisabled();
  await expect(page.getByTitle('删除选中 (Delete)')).toBeDisabled();
  await expect(page.getByRole('button', { name: /矩形/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /选择/ })).toBeEnabled(); // 读类工具不受限

  // 降级序列的工具复位（D4 ②）：可写 → 切到写工具（shape）→ 再降级 → 工具落回 cursor
  // （这里验证的是 updateEditable 的复位，不是 setCursorMode 钳制——钳制另有下面的直调断言）
  await page.evaluate(() =>
    (
      window as unknown as { __spinth: { updateEditable(v: boolean): void } }
    ).__spinth.updateEditable(true),
  );
  await page.keyboard.press('r');
  await page.evaluate(() =>
    (
      window as unknown as { __spinth: { updateEditable(v: boolean): void } }
    ).__spinth.updateEditable(false),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('cursor');
  await expect(page.getByTitle('此画布为只读——编辑命令已禁用')).toBeVisible();

  // 真钳制路径（D5）：只读态宿主直接调写工具 → 仍被钳回 cursor
  // （去掉钳制后此处会停在 pen——与上一条可区分的回归锁）
  await page.evaluate(() => {
    (window as unknown as { __spinth: { setCursorMode(m: string): void } }).__spinth.setCursorMode(
      'pen',
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __spinth: { cursorMode$: { getValue(): string } } }
        ).__spinth.cursorMode$.getValue(),
      ),
    )
    .toBe('cursor');
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
    const pub = window as unknown as { __spinth: { wsState$: { getValue(): string } } };
    const dbg = window as unknown as {
      __spinthDebug: { __debug: { engine: { wsProvider: unknown } } };
    };
    return {
      wsState: pub.__spinth.wsState$.getValue(),
      wsProvider: dbg.__spinthDebug.__debug.engine.wsProvider,
    };
  });
  expect(state.wsState).toBe('off');
  expect(state.wsProvider).toBeNull();
  expect(external).toEqual([]);

  // 品牌图标来自 public/（裁掉透明留白的 mark），顶栏实际加载成功（不是 404 占位）
  const logo = page.locator('header img[src="/spinth-mark.png"]');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(169);
});

test('单机断网不变量（批次 A · A4）：断网仍可创建/撤销/落盘，无阻断提示', async ({
  context,
  page,
}) => {
  const docId = `e2e-offline-edit-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitBoardReady(page);

  // 物理断网（模拟的不是 ws 断连）：先断言前置条件成立，避免测了个寂寞
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  // 单机 blockOnOffline=false → editBlocked 恒 false：断网仍可创建 + 撤销
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await debug(page)).modelCount, { timeout: 5_000 }).toBe(1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await debug(page)).modelCount, { timeout: 5_000 }).toBe(0);

  // 撤销也是一次写入：断网下照样落盘（IndexedDB 与网络无关）
  await persisted(page);

  // 阻断提示与只读降级都不可达（OfflineBar 仅协同宿主；readonly pill 与断网无关）
  await expect(page.locator('[data-spinth-offline-bar]')).toHaveCount(0);
  await expect(page.locator('[data-spinth-readonly-pill]')).toHaveCount(0);

  // 不在断网时 reload：dev 不注册 SW（specs/pwa D2），断网刷新测的是网络不是产品
  await context.setOffline(false);
  await page.evaluate((id) => indexedDB.deleteDatabase(`spinth-doc:${id}`), docId);
});

test('S7 dev 不注册 Service Worker', async ({ page }) => {
  // specs/pwa D2/D6：SW 注册仅生产构建；dev 下 HMR / React refresh 不受影响
  const docId = `e2e-sm-devsw-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await expect
    .poll(
      async () =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      {
        timeout: 5_000,
      },
    )
    .toBe(0);
});
