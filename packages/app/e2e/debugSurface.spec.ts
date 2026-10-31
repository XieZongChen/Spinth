import { expect, test } from '@playwright/test';
import { openBoardDoc } from './helpers/boardE2e';

/**
 * 运行时公共面 / 调试面 E2E（specs/runtime-narrowing §6.2）：
 * `window.__spinth` 是 createBoard() 的冻结投影（65 成员 allowlist），
 * `window.__spinthDebug.__debug` 是 DEV 调试入口；内部字段在公开面
 * 不可枚举、不可读，写入抛 TypeError。
 */

test('公共面：65 成员、冻结、内部字段不可见不可写', async ({ page }) => {
  await openBoardDoc(page, `e2e-debug-surface-${Date.now()}`);
  const pub = await page.evaluate(() => {
    const w = window as unknown as { __spinth?: Record<string, unknown> };
    const api = w.__spinth;
    if (!api) return null;
    // defineProperty 在冻结对象上必抛 TypeError（不依赖严格模式——
    // evaluate 回调序列化后在页面上下文执行，模式不保证）
    let defineThrew = false;
    try {
      Object.defineProperty(api, 'viewport', { value: null });
    } catch {
      defineThrew = true;
    }
    return {
      keyCount: Object.keys(api).length,
      frozen: Object.isFrozen(api),
      viewport: api.viewport,
      viewportIn: 'viewport' in api,
      engine: api.engine,
      debug: api.__debug,
      initialized: api.initialized,
      defineThrew,
    };
  });
  expect(pub).not.toBeNull();
  expect(pub!.keyCount).toBe(65);
  expect(pub!.frozen).toBe(true);
  expect(pub!.viewport).toBeUndefined();
  expect(pub!.viewportIn).toBe(false);
  expect(pub!.engine).toBeUndefined();
  expect(pub!.debug).toBeUndefined();
  expect(pub!.initialized).toBeUndefined();
  // 严格模式 + 冻结投影 → 写入必须 TypeError
  expect(pub!.defineThrew).toBe(true);
});

test('公共面：方法绑定与身份稳定，命令生效', async ({ page }) => {
  await openBoardDoc(page, `e2e-debug-surface-cmd-${Date.now()}`);
  const res = await page.evaluate(() => {
    const w = window as unknown as {
      __spinth?: {
        undo: () => void;
        setCursorMode: (m: string) => void;
        cursorMode$: { getValue(): string };
      };
    };
    const api = w.__spinth;
    if (!api) return null;
    const before = api.cursorMode$.getValue();
    api.setCursorMode('shape');
    return {
      undoType: typeof api.undo,
      identityStable: api.undo === api.undo,
      before,
      after: api.cursorMode$.getValue(),
    };
  });
  expect(res).not.toBeNull();
  expect(res!.undoType).toBe('function');
  expect(res!.identityStable).toBe(true);
  expect(res!.before).toBe('cursor');
  expect(res!.after).toBe('shape');
});

test('调试面：__spinthDebug.__debug 快照与逃生口在位', async ({ page }) => {
  await openBoardDoc(page, `e2e-debug-surface-dbg-${Date.now()}`);
  const dbg = await page.evaluate(() => {
    const w = window as unknown as {
      __spinthDebug?: {
        __debug?: {
          modelCount: number;
          engine: unknown;
          assetStore: unknown;
          viewport: unknown;
        };
      };
    };
    const d = w.__spinthDebug?.__debug;
    if (!d) return null;
    return {
      modelCount: d.modelCount,
      engine: d.engine === null ? 'null' : typeof d.engine,
      assetStore: d.assetStore === null ? 'null' : typeof d.assetStore,
      viewport: d.viewport === null ? 'null' : typeof d.viewport,
    };
  });
  expect(dbg).not.toBeNull();
  expect(typeof dbg!.modelCount).toBe('number');
  // 初始化后内部服务已组装（逃生口读到实例而非 null）
  expect(dbg!.engine).toBe('object');
  expect(dbg!.assetStore).toBe('object');
  expect(dbg!.viewport).toBe('object');
});
