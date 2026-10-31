import { expect, test, type Page } from '@playwright/test';
import { cleanupDoc, dragWidget, modelCount, persisted, ready } from './helpers/projectFileE2e';

/**
 * 存储状态 E2E（docs/02 §6.1）：addInitScript 桩 navigator.storage，
 * 覆盖持久化授权/申请/配额压力/unsupported/390px/备份入口/保存失败入口。
 * 真实写路径（persistState 状态机）由 dbProvider 单测覆盖，此处只注入流值。
 */

/** navigator.storage 桩参数（JSON 序列化，经 addInitScript 注入） */
interface StorageStub {
  unsupported?: boolean;
  persistedValue?: boolean;
  throwPersisted?: boolean;
  persistValue?: boolean;
  persistThrows?: boolean;
  usage?: number;
  quota?: number;
  throwEstimate?: boolean;
}

async function stubStorage(page: Page, stub: StorageStub): Promise<void> {
  await page.addInitScript((s: StorageStub) => {
    const w = window as unknown as { __persistCalls?: number };
    w.__persistCalls = 0;
    if (s.unsupported) {
      Object.defineProperty(window.navigator, 'storage', {
        get(): undefined {
          return undefined;
        },
        configurable: true,
      });
      return;
    }
    const impl: Record<string, unknown> = {
      persisted: () =>
        s.throwPersisted
          ? Promise.reject(new Error('persisted boom'))
          : Promise.resolve(s.persistedValue ?? false),
      persist: () => {
        w.__persistCalls = (w.__persistCalls ?? 0) + 1;
        return s.persistThrows
          ? Promise.reject(new Error('persist boom'))
          : Promise.resolve(s.persistValue ?? false);
      },
      estimate: () =>
        s.throwEstimate
          ? Promise.reject(new Error('estimate boom'))
          : Promise.resolve({ usage: s.usage, quota: s.quota }),
    };
    Object.defineProperty(window.navigator, 'storage', { value: impl, configurable: true });
  }, stub);
}

async function persistCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __persistCalls?: number }).__persistCalls ?? 0,
  );
}

const MB = 1024 * 1024;

test('默认：未持久化 → 启动申请一次；面板显示未开启/50%；申请被拒有文案', async ({ page }) => {
  const docId = `e2e-st-default-${Date.now()}`;
  await stubStorage(page, {
    persistedValue: false,
    persistValue: false,
    usage: 50 * MB,
    quota: 100 * MB,
  });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 启动 initialize：refresh → 未持久化 → 申请恰好一次（A3/A5）
  await expect.poll(() => persistCalls(page)).toBe(1);
  await expect(page.locator('[data-spinth-storage-button]')).toHaveText(/已保存/);

  await page.locator('[data-spinth-storage-button]').click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused(); // 复审 #1：打开即焦点入面板（非顶栏按钮/body）
  await expect(panel.getByText('已开启（降低被浏览器清理的风险）')).toBeHidden();
  await expect(panel.getByText('未开启（空间不足时可能被浏览器清理）')).toBeVisible();
  await expect(panel.getByText('50 MB / 100 MB（50%）')).toBeVisible();

  // 用户手势申请：第二次调用；denied 文案到达（A5）
  await panel.locator('[data-spinth-storage-persist]').click();
  await expect(panel.getByText('浏览器未授予持久化；可稍后重试。')).toBeVisible();
  await expect.poll(() => persistCalls(page)).toBe(2);

  // 「关闭」按钮：面板收起且焦点回顶栏按钮（复审 #1）
  await panel.getByRole('button', { name: '关闭' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('[data-spinth-storage-button]')).toBeFocused();
  await cleanupDoc(page, docId);
});

test('已持久化：显示已开启，启动不申请，无申请入口', async ({ page }) => {
  const docId = `e2e-st-on-${Date.now()}`;
  await stubStorage(page, { persistedValue: true, usage: 10 * MB, quota: 100 * MB });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 等 initialize 的 refresh 落库（persisted=true 后不再申请）
  await page.locator('[data-spinth-storage-button]').click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('已开启（降低被浏览器清理的风险）')).toBeVisible();
  await expect(panel.locator('[data-spinth-storage-persist]')).toBeHidden();
  expect(await persistCalls(page)).toBe(0);
  await cleanupDoc(page, docId);
});

test('critical：96/100MB → 顶栏 aria-label 含空间不足、进度条 danger、面板红色提示', async ({
  page,
}) => {
  const docId = `e2e-st-crit-${Date.now()}`;
  await stubStorage(page, { persistedValue: true, usage: 96 * MB, quota: 100 * MB });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 启动 refresh 传播到顶栏镜像（toHaveAttribute 自带重试）
  const button = page.locator('[data-spinth-storage-button]');
  await expect(button).toHaveAttribute('aria-label', /空间不足/);

  await button.click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('alert').filter({ hasText: '空间不足' })).toBeVisible();
  const barClass = await panel.locator('[data-spinth-storage-bar] > div').getAttribute('class');
  expect(barClass).toContain('bg-danger');
  await cleanupDoc(page, docId);
});

test('unsupported：面板显示不支持，画布仍能创建控件并保存', async ({ page }) => {
  const docId = `e2e-st-unsup-${Date.now()}`;
  await stubStorage(page, { unsupported: true });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  await page.locator('[data-spinth-storage-button]').click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('不支持', { exact: true })).toBeVisible();

  // 存储缺失不影响画布写路径（A4：降级不崩）
  await page.keyboard.press('Escape');
  await dragWidget(page, 'r');
  await expect.poll(() => modelCount(page)).toBe(1);
  await persisted(page);
  await cleanupDoc(page, docId);
});

test('390px：面板在视口内、顶栏 44px、无横向滚动、Escape 关闭并回焦', async ({ page }) => {
  const docId = `e2e-st-390-${Date.now()}`;
  await stubStorage(page, { persistedValue: false, usage: 50 * MB, quota: 100 * MB });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const headerBox = await page.locator('header').boundingBox();
  expect(headerBox?.height).toBe(44); // 不换行

  const button = page.locator('[data-spinth-storage-button]');
  await button.click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844); // maxHeight 兜底不越视口
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  await cleanupDoc(page, docId);
});

test('备份入口：面板「打开项目菜单」打开 ProjectMenu，Escape 逐层关闭', async ({ page }) => {
  const docId = `e2e-st-backup-${Date.now()}`;
  await stubStorage(page, { persistedValue: true, usage: 10 * MB, quota: 100 * MB });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  await page.locator('[data-spinth-storage-button]').click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-spinth-storage-backup]').click();

  // 面板关闭、菜单打开（D7：复用同一菜单，不复制导出/导入流程）
  await expect(panel).toBeHidden();
  const menu = page.locator('[data-spinth-project-menu-panel]');
  await expect(menu).toBeVisible();
  const exportItem = menu.getByRole('menuitem', { name: /导出项目/ });
  await expect(exportItem).toBeEnabled();
  // 复审 #1：外部入口打开后焦点移入首个菜单项（不在 body）
  await expect(exportItem).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: '项目' })).toBeFocused();
  await cleanupDoc(page, docId);
});

test('外部重开清旧错误：坏包错误 → 关闭 → 存储面板重开为干净菜单（复审 #2）', async ({ page }) => {
  const docId = `e2e-st-clear-${Date.now()}`;
  await stubStorage(page, { persistedValue: true, usage: 10 * MB, quota: 100 * MB });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 坏包 → 菜单内 role=alert 显示错误（FilePayload 直传，不落临时文件）
  const menu = page.locator('[data-spinth-project-menu-panel]');
  await page.getByRole('button', { name: '项目' }).click();
  await expect(menu).toBeVisible();
  await page.locator('[data-spinth-project-import]').setInputFiles({
    name: 'garbage.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('this is not a zip file'),
  });
  await expect(menu.getByRole('alert')).toContainText(/已损坏或不是 spinth 项目/);

  // Escape 关闭（关闭沿即清旧错误/导出提示）
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // 从存储面板「打开项目菜单」重开：无错误残留，焦点入首个菜单项
  await page.locator('[data-spinth-storage-button]').click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-spinth-storage-backup]').click();
  await expect(panel).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('alert')).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /导出项目/ })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await cleanupDoc(page, docId);
});

test('保存失败态：顶栏红色「保存失败」→ 面板「重试保存」可见可点', async ({ page }) => {
  const docId = `e2e-st-fail-${Date.now()}`;
  await stubStorage(page, { persistedValue: true, usage: 10 * MB, quota: 100 * MB });
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 注入 persistState=failed（真实状态机由 dbProvider 单测覆盖）——公开流不可
  // 写（投影只读），经调试逃生口拿内部 engine 的真实 Subject
  await page.evaluate(() => {
    const w = window as unknown as {
      __spinthDebug: {
        __debug: { engine: { persistState$: { next(v: 'saved' | 'saving' | 'failed'): void } } };
      };
    };
    w.__spinthDebug.__debug.engine.persistState$.next('failed');
  });
  const button = page.locator('[data-spinth-storage-button]');
  await expect(button).toHaveText(/保存失败/);

  await button.click();
  const panel = page.locator('[data-spinth-storage-panel]');
  await expect(panel).toBeVisible();
  const retry = panel.locator('[data-spinth-storage-retry]');
  await expect(retry).toBeVisible();
  await retry.click(); // 幂等重试不抛错
  await expect(retry).toBeVisible();
  await cleanupDoc(page, docId);
});
