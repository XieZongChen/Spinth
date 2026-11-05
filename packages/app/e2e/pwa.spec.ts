import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { contrastRatio } from './helpers/a11yE2e';
import { minTarget, boxWithin, setRootFontSize } from './helpers/layoutE2e';
import { modelCount, placeText, ready } from './helpers/projectFileE2e';

/**
 * PWA 专项（specs/pwa §11.2，project=pwa）：子路径生产构建 + vite preview 的
 * 真实 Pages 形态。P5/P6 用 execSync 真重建（SPINTH_BUILD_TAG 变更产物），
 * 不 mock SW——mock 只能证明 mock 自洽（D15）。
 * 本文件测试串行同 worker（默认文件内顺序执行）：两次重建不可并发。
 */

const BASE = '/spinth/';

function docIdOf(tag: string): string {
  return `e2e-pwa-${tag}-${Date.now()}`;
}

async function openPreview(page: Page, docId: string): Promise<void> {
  // &e2e=1：挂生产只读探针（src/e2eProbe.ts），ready/modelCount 等 helper 可用
  await page.goto(`${BASE}?doc=${docId}&e2e=1`);
  await ready(page);
}

/** 矩形落件（'r' + 单击）：一个撤销单元——文字建件+输入是两个单元，
 * 撤销断言用矩形流（specs/pwa P2）。 */
async function placeRect(page: Page): Promise<void> {
  await page.keyboard.press('r');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 480, y: 300 } });
  await page.waitForTimeout(150);
}

async function waitControlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });
}

/** 等待 registration 进入 waiting——横幅缺席断言必须以此为前提才不平凡（§17.4 P2-5）。
 *
 * 隐含约束（§17.4 第二轮 P2-3）：waiting 之所以停留，是因为同 scope 还有旧
 * 客户端开着（P6 里是 tab A）——最后一个旧客户端消失时浏览器会自动激活
 * waiting，届时本轮询会超时。调整用例顺序/关闭标签前先想清楚这条依赖。 */
async function waitWaiting(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      { timeout: 10_000 },
    )
    .toBe(true);
}

function rebuild(tag: string): void {
  execSync('pnpm --filter @spinth/app build', {
    cwd: process.cwd(), // playwright 从仓库根启动（pnpm test:e2e / npx playwright test）
    // SPINTH_E2E=1：重建也要带只读探针，否则 P5/P6 重载后 helper 失效（§17.4 P2-4）
    env: {
      ...process.env,
      SPINTH_BASE: '/spinth/',
      SPINTH_BUILD_TAG: tag,
      SPINTH_E2E: '1',
    },
    stdio: 'pipe',
  });
}

test('P1 首装即受控：scope=子路径、manifest link 带 base', async ({ page }) => {
  await openPreview(page, docIdOf('p1'));
  await waitControlled(page);
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.scope,
  );
  expect(scope).toBe('http://localhost:5198/spinth/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toContain('/spinth/manifest.webmanifest');
});

test('P2 离线冷启动：可开、可编辑、可撤销、再刷新数据仍在、latin 字体不回退', async ({ page }) => {
  const docId = docIdOf('p2');
  await openPreview(page, docId);
  await waitControlled(page);

  await page.context().setOffline(true);
  await page.reload();
  await ready(page);

  // 可编辑 + 可撤销：矩形是一个撤销单元（文字建件+输入是两个）
  await placeRect(page);
  await expect.poll(async () => modelCount(page)).toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => modelCount(page)).toBe(0);
  await placeText(page, '离线恢复');
  await expect.poll(async () => modelCount(page)).toBe(1);

  await page.reload(); // 再刷新：数据仍在
  await ready(page);
  await expect.poll(async () => modelCount(page)).toBe(1);

  // D16：latin 子集已预缓存——离线首屏字体与在线一致，不回退系统字体
  expect(await page.evaluate(() => document.fonts.check('16px "Nunito Variable"'))).toBe(true);

  await page.context().setOffline(false);
  await page.evaluate((id) => indexedDB.deleteDatabase(`spinth-doc:${id}`), docId);
});

test('P3 离线另一文档：shell 键归一化，?doc= 不同值都能开', async ({ page }) => {
  const first = docIdOf('p3a');
  await openPreview(page, first);
  await waitControlled(page);

  await page.context().setOffline(true);
  const second = docIdOf('p3b');
  await page.goto(`${BASE}?doc=${second}&e2e=1`);
  await ready(page);
  await expect.poll(async () => modelCount(page)).toBe(0); // 新文档空画布可编辑
  await page.context().setOffline(false);
  for (const id of [first, second]) {
    await page.evaluate((d) => indexedDB.deleteDatabase(`spinth-doc:${d}`), id);
  }
});

test('P4 无策略破坏：CSP violation 为 0、console 无 SW 报错', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', () => {
      (window as unknown as { __cspViolations?: number }).__cspViolations =
        ((window as unknown as { __cspViolations?: number }).__cspViolations ?? 0) + 1;
    });
  });
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const docId = docIdOf('p4');
  await openPreview(page, docId);
  await waitControlled(page);
  await page.context().setOffline(true);
  await page.reload();
  await ready(page);
  await page.context().setOffline(false);

  expect(
    await page.evaluate(
      () => (window as unknown as { __cspViolations?: number }).__cspViolations ?? 0,
    ),
  ).toBe(0);
  const swErrors = errors.filter((e) => /service ?worker|sw\.js/i.test(e));
  expect(swErrors).toEqual([]);
  // 无更新时横幅不出现（离线可用 ≠ 需要提示，§3 现状核对）
  await expect(page.locator('[data-spinth-pwa-banner]')).toHaveCount(0);
  await page.evaluate((id) => indexedDB.deleteDatabase(`spinth-doc:${id}`), docId);
});

test('P5 更新流程：真重建 → 横幅 → 点击恰好刷新一次（含横幅 a11y）', async ({ page }) => {
  test.setTimeout(150_000);
  const docId = docIdOf('p5');
  await openPreview(page, docId);
  await waitControlled(page);
  const banner = page.locator('[data-spinth-pwa-banner]');
  await expect(banner).toHaveCount(0);

  const tag = `pwa-p5-${Date.now()}`;
  rebuild(tag);
  await page.evaluate(async () => void (await navigator.serviceWorker.getRegistration())?.update());
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toHaveAttribute('role', 'status');
  await expect(banner).toContainText('新版本可用');

  // 横幅 a11y（specs/pwa §10；banner 只在本环境出现，断言收口在此）
  const refresh = banner.getByRole('button', { name: '刷新' });
  const later = banner.getByRole('button', { name: '稍后' });

  // 铬件闸门（specs/a11y-closeout §13.5-10，生产 preview 无调试探针 → DOM 信号）：
  // 焦点在横幅按钮上时 Delete 是铬件内按键，不得落到画布删选中（空画布提示
  // = modelCount 0 的可见信号）；焦点回 stage 后恢复正常删除（不过度拦截）。
  // 建件用拖拽（同 a11yKeyboard.drawShape）——单击落件不产生选中，Delete 对
  // 空选中是 no-op，静默断言会假绿
  await page.keyboard.press('r');
  await page.mouse.move(400, 250);
  await page.mouse.down();
  await page.mouse.move(520, 330, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  // 选中信号用 toolbar 删除按钮（disabled ⟺ 空选中）——e2e 探针公开子集无 selected$
  const delBtn = page.getByRole('button', { name: '删除选中 (Delete)' });
  await expect(delBtn, '前置：拖拽建件后应有选中（否则静默断言无意义）').toBeEnabled();
  await expect(page.locator('[data-spinth-empty-hint]')).toHaveCount(0);
  await later.focus(); // focus 而非 click——click 会触发 dismiss
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  expect(
    await page.locator('[data-spinth-empty-hint]').count(),
    '焦点在横幅按钮上按 Delete 不应删除画布元素',
  ).toBe(0);
  await page.locator('#stage-container').focus();
  await page.keyboard.press('Delete');
  await expect
    .poll(() => page.locator('[data-spinth-empty-hint]').count(), { timeout: 3000 })
    .toBeGreaterThan(0);
  await minTarget(refresh);
  await minTarget(later);
  const colors = await page.evaluate(() => {
    const el = document.querySelector('[data-spinth-pwa-banner]')!;
    const span = el.querySelector('span')!;
    const button = el.querySelector('button')!;
    const elStyle = getComputedStyle(el);
    const spanStyle = getComputedStyle(span);
    const btnStyle = getComputedStyle(button);
    return {
      textFg: spanStyle.color,
      textBg: elStyle.backgroundColor,
      btnFg: btnStyle.color,
      btnBg: btnStyle.backgroundColor,
    };
  });
  expect(contrastRatio(colors.textFg, colors.textBg)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.btnFg, colors.btnBg)).toBeGreaterThanOrEqual(4.5);

  // 字号单位（specs/rem-typography §6.2；横幅主配置不可达，断言同样收口在此）：
  // 1x 与迁移前逐像素一致（12px、继承行高 1.5），根字号 32px 时同步 ×2 且仍在视口
  const bannerTypo = (): Promise<{ fontSize: string; lineHeight: string }> =>
    banner.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    });
  expect(await bannerTypo()).toEqual({ fontSize: '12px', lineHeight: '18px' });
  const restoreRootFont = await setRootFontSize(page, 32);
  expect(await bannerTypo()).toEqual({ fontSize: '24px', lineHeight: '36px' });
  await boxWithin(banner, page.viewportSize()!, 8);
  await restoreRootFont();

  // 390px：按钮触控目标 44px、横幅不溢出（§10）
  await page.setViewportSize({ width: 390, height: 844 });
  await minTarget(refresh, 44);
  await minTarget(later, 44);
  await boxWithin(banner, { width: 390, height: 844 }, 8);

  const oldSrc = await page.locator('script[type="module"]').first().getAttribute('src');
  await refresh.click();
  // 点击方恰好刷新一次：新版本生效（build tag + module src 哈希变化）
  await expect
    .poll(() => page.locator('#root > div').getAttribute('data-spinth-build'), { timeout: 20_000 })
    .toBe(tag);
  const newSrc = await page.locator('script[type="module"]').first().getAttribute('src');
  expect(newSrc).not.toBe(oldSrc);
  await page.evaluate((id) => indexedDB.deleteDatabase(`spinth-doc:${id}`), docId);
});

test('P6 多标签不互踩：A 点刷新只 reload A，B 转已就绪且仍可编辑', async ({ page }) => {
  test.setTimeout(150_000);
  const docA = docIdOf('p6a');
  const docB = docIdOf('p6b');
  const context = page.context();
  const tabB = await context.newPage();

  await openPreview(page, docA);
  await openPreview(tabB, docB);
  await waitControlled(page);
  await waitControlled(tabB);

  // 预热 B 的文本编辑链路（tiptap 懒 chunk 提前加载，规避旧页面 chunk 缺口 D10）；
  // 文字两段撤销清回 0，保证后续 modelCount 断言从 0 起算
  await placeText(tabB, 'warm');
  await tabB.keyboard.press('ControlOrMeta+z');
  await tabB.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => modelCount(tabB)).toBe(0);

  // B 装导航哨兵：reload 会丢 window 状态
  await tabB.evaluate(() => {
    (window as unknown as Record<string, unknown>).__pwaSentinel = performance.now();
  });

  const tag = `pwa-p6-${Date.now()}`;
  rebuild(tag);
  await page.evaluate(async () => void (await navigator.serviceWorker.getRegistration())?.update());

  const bannerA = page.locator('[data-spinth-pwa-banner]');
  await expect(bannerA).toBeVisible({ timeout: 20_000 });
  await bannerA.getByRole('button', { name: '刷新' }).click();
  await expect
    .poll(() => page.locator('#root > div').getAttribute('data-spinth-build'), { timeout: 20_000 })
    .toBe(tag);

  // B 未重载（哨兵仍在）且仍可编辑；横幅转「已就绪」不自动刷新（D11）
  const sentinel = await tabB.evaluate(
    () => (window as unknown as Record<string, unknown>).__pwaSentinel,
  );
  expect(sentinel).toBeDefined();
  await placeText(tabB, 'still-editable');
  await expect.poll(async () => modelCount(tabB)).toBe(1);
  await expect(tabB.locator('[data-spinth-pwa-banner]')).toContainText('新版本已就绪', {
    timeout: 10_000,
  });

  // 「稍后」= 本会话不再提示（§10）。A 已激活后无 waiting——再真重建一次制造
  // 新 waiting，验证三点：点「稍后」即隐 / 跨 reload（同会话）仍隐 /
  // 清掉会话存储后重开仍会提示
  await tabB.locator('[data-spinth-pwa-banner]').getByRole('button', { name: '稍后' }).click();
  await expect(tabB.locator('[data-spinth-pwa-banner]')).toHaveCount(0);

  const tag3 = `pwa-p6b-${Date.now()}`;
  rebuild(tag3);
  await tabB.evaluate(async () => void (await navigator.serviceWorker.getRegistration())?.update());
  await waitWaiting(tabB); // waiting 已在场（dismissed 拦住横幅——缺席断言不平凡）
  await expect(tabB.locator('[data-spinth-pwa-banner]')).toHaveCount(0);
  await tabB.reload();
  await ready(tabB);
  await waitWaiting(tabB); // reload 后 registration 仍持 waiting，启动检查已能提示
  await expect(tabB.locator('[data-spinth-pwa-banner]')).toHaveCount(0); // 同会话仍隐
  await tabB.evaluate(() => sessionStorage.clear());
  await tabB.reload();
  await ready(tabB);
  await expect(tabB.locator('[data-spinth-pwa-banner]')).toBeVisible({ timeout: 10_000 });

  for (const p of [page, tabB]) {
    await p.evaluate(
      ([id]) => {
        indexedDB.deleteDatabase(`spinth-doc:${id}`);
      },
      [p === page ? docA : docB],
    );
  }
});

test('P7 正常流量零探针：无 ?e2e=1 时两个全局均不挂载且画布可编辑', async ({ page }) => {
  const docId = docIdOf('p7');
  // 不带 &e2e=1：生产只读探针按 URL 精确挂载（§17.4 P2-4），正常流量零暴露。
  // 就绪信号只能用 UI——此时 window.__spinth 本就不存在，不能拿探针当等待条件
  // （specs/runtime-narrowing §3.7 形状）。空态提示出现 = !loading && editable
  // && modelCount===0 三合一（角色已定 + docState synced + 画布可交互），先等它
  // 再按键/点击，防慢 CI 下输入被加载遮罩吞掉
  await page.goto(`${BASE}?doc=${docId}`);
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.locator('[data-spinth-empty-hint]')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('r');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 480, y: 300 } });
  // 建件成功 = 撤销键可用（画布真的在跑且可编辑）
  await expect(page.getByTitle('撤销 (Cmd+Z)')).toBeEnabled({ timeout: 10_000 });

  // DEV 双句柄生产剥离 + 只读探针未挂 → 两个全局都不得存在
  const probes = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return { spinth: w.__spinth, spinthDebug: w.__spinthDebug };
  });
  expect(probes.spinth).toBeUndefined();
  expect(probes.spinthDebug).toBeUndefined();

  await page.evaluate(
    ([id]) => {
      indexedDB.deleteDatabase(`spinth-doc:${id}`);
    },
    [docId],
  );
});
