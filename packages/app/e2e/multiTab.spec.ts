import { expect, test, type Page } from '@playwright/test';
import { cleanupDoc, modelCount, persisted, ready } from './helpers/projectFileE2e';

/**
 * 多标签单写者 + 只读跟随（docs/21）：同一 BrowserContext 两个 page 共享
 * Web Locks（S0 探针已验证：占用时 ifAvailable=false、释放后可获取）。
 * 角色从 data-spinth-tab-role 观察；数据断言走 __spinth 探针（docs/15 §3）。
 * ?assetMaint=0：维护链是并行页面下的 IO 压力源（DEV 本就默认关，显式表达意图）。
 */

async function tabRole(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('[data-spinth-tab-role]')?.getAttribute('data-spinth-tab-role') ?? '',
  );
}

async function waitRole(page: Page, role: string): Promise<void> {
  await page.waitForFunction(
    (r) =>
      document.querySelector('[data-spinth-tab-role]')?.getAttribute('data-spinth-tab-role') === r,
    role,
    { timeout: 20_000 },
  );
}

/** R 工具拖拽创建矩形（smoke.spec 同款路径；leader/solo 页专用） */
async function createShapeByDrag(page: Page): Promise<void> {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.mouse.down();
  await page.mouse.move(660, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => modelCount(page), { timeout: 5_000 }).toBeGreaterThan(0);
}

test('双标签同文档：先到 leader、后到 follower（徽标/提示条/写面禁用/拖拽 no-op）', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-dual-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // 只读徽标 + 提示条（follower 专属）
  await expect(pageB.locator('[data-spinth-readonly-pill]')).toBeVisible();
  await expect(pageB.locator('[data-spinth-readonly-pill]')).toHaveAttribute(
    'title',
    '此画布为只读——另一标签正在编辑',
  );
  await expect(pageB.locator('[data-spinth-readonly-notice]')).toBeVisible();

  // 写工具 disabled；视图工具（cursor/hand）可用
  const toolbar = pageB.getByRole('toolbar', { name: '画板工具' });
  await expect(toolbar.getByRole('button', { name: /\(R\)$/ })).toBeDisabled();
  await expect(toolbar.getByTitle('抓手 (H / 空格)')).toBeEnabled();
  await expect(toolbar.getByTitle('抓手 (H / 空格)')).not.toBeDisabled();

  // follower 按 R（非白名单快捷键被闸门拦）+ 拖拽 + undo：modelCount 纹丝不动
  const before = await modelCount(pageB);
  await pageB.keyboard.press('r');
  const canvas = pageB.locator('canvas').first();
  await canvas.hover({ position: { x: 500, y: 300 } });
  await pageB.mouse.down();
  await pageB.mouse.move(660, 420, { steps: 8 });
  await pageB.mouse.up();
  await pageB.keyboard.press('ControlOrMeta+z');
  expect(await modelCount(pageB)).toBe(before);

  // A 仍是 leader（B 的排队申请不影响持锁者）
  expect(await tabRole(page)).toBe('leader');
});

test('接管：关闭 leader → follower 自动刷新接管，内容为最后落盘状态', async ({ page, context }) => {
  const docId = `e2e-mt-takeover-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // A 建控件并等落盘（B 接管后读到的就是这个状态）
  await createShapeByDrag(page);
  await persisted(page);
  const created = await modelCount(page);

  // 关 A（pagehide 让锁）→ B 排队授予 → 300ms → 整页刷新。
  // waitForEvent('load') 先注册再关页，避免 reload 已发生再等的竞态
  const nextLoad = pageB.waitForEvent('load', { timeout: 20_000 });
  await page.close();
  await nextLoad;
  await waitRole(pageB, 'leader');
  await ready(pageB);

  // 提示条消失；A 最后创建的控件可见
  await expect(pageB.locator('[data-spinth-readonly-notice]')).toHaveCount(0);
  await expect.poll(() => modelCount(pageB), { timeout: 5_000 }).toBe(created);
});

test('只读不写盘：A 建控件后 B 保持打开时的快照', async ({ page, context }) => {
  const docId = `e2e-mt-nosync-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  // B 先打开（快照 = 空文档）
  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');
  expect(await modelCount(pageB)).toBe(0);
  // 只读空文档不出「R 拖出矩形…」引导——引导全是写指令，只读不可执行
  await expect(pageB.getByText('空画布')).toHaveCount(0);
  await expect(page.getByText('空画布')).toBeVisible(); // 写者侧正常显示（区分验证）

  // A 建件落盘后，B 无实时同步也不落盘——modelCount 不涨
  await createShapeByDrag(page);
  await persisted(page);
  expect(await modelCount(page)).toBeGreaterThan(0);
  expect(await modelCount(pageB)).toBe(0);
});

test('不同文档并行：两个标签都 leader', async ({ page, context }) => {
  await page.goto(`/?doc=e2e-mt-x-${Date.now()}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=e2e-mt-y-${Date.now()}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'leader');
});

test('无 Web Locks 降级 solo：可写、无提示条', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', {
      value: undefined,
      configurable: true,
    });
  });
  const p = await ctx.newPage();
  await p.goto(`/?doc=e2e-mt-solo-${Date.now()}&assetMaint=0`);
  await waitRole(p, 'solo');
  await ready(p);
  await expect(p.locator('[data-spinth-readonly-notice]')).toHaveCount(0);
  await expect(p.locator('[data-spinth-readonly-pill]')).toHaveCount(0);
  // solo 可写：创建控件成功
  await createShapeByDrag(p);
  await persisted(p);
  await ctx.close();
});

test('只读视图操作：抓手平移 + 快捷键缩放可用（白名单放行）', async ({ page, context }) => {
  const docId = `e2e-mt-view-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // 抓手拖动平移：世界中心跟随变化
  await pageB.getByRole('toolbar', { name: '画板工具' }).getByTitle('抓手 (H / 空格)').click();
  const centerOf = () =>
    pageB.evaluate(() => {
      const vp = (
        window as unknown as {
          __spinth: { viewport: { viewportInstance: { center: { x: number; y: number } } } };
        }
      ).__spinth.viewport.viewportInstance;
      return { x: vp.center.x, y: vp.center.y };
    });
  const centerBefore = await centerOf();
  const canvas = pageB.locator('canvas').first();
  await canvas.hover({ position: { x: 700, y: 450 } });
  await pageB.mouse.down();
  await pageB.mouse.move(560, 370, { steps: 8 });
  await pageB.mouse.up();
  const centerAfter = await centerOf();
  expect(
    Math.abs(centerAfter.x - centerBefore.x) + Math.abs(centerAfter.y - centerBefore.y),
  ).toBeGreaterThan(20);

  // 缩放快捷键在 allowInReadonly 白名单（docs/09）：Ctrl+= 放行
  const scaleOf = () =>
    pageB.evaluate(
      () =>
        (window as unknown as { __spinth: { vpScale$: { value: number } } }).__spinth.vpScale$
          .value,
    );
  await pageB.keyboard.down('Control');
  await pageB.keyboard.press('=');
  await pageB.keyboard.up('Control');
  await expect.poll(scaleOf, { timeout: 5_000 }).toBeGreaterThan(1);
  // 平移/缩放不产生写（modelCount 仍 0）
  expect(await modelCount(pageB)).toBe(0);
});

test('follower 右键：不建选区、无操作栏、菜单只读降级（画布菜单 + 粘贴禁用）', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-ctx-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  // leader 建件落盘（拖拽矩形：世界 500,300 → 660,420，中心 580,360）
  await createShapeByDrag(page);
  await persisted(page);

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');
  await expect.poll(() => modelCount(pageB), { timeout: 5_000 }).toBe(1);

  // follower 右键元素中心（世界→client 精确换算，docs/15 §3）
  const at = await pageB.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          viewport: { worldToClient(p: { x: number; y: number }): { x: number; y: number } };
        };
      }
    ).__spinth;
    return w.viewport.worldToClient({ x: 580, y: 360 });
  });
  await pageB.mouse.click(at.x, at.y, { button: 'right' });

  // 只读：右键不建选区（docs/21 §4 只读禁止选择）→ ActionBar 不出现
  await expect
    .poll(() =>
      pageB.evaluate(() => {
        const w = window as unknown as { __spinth: { selected$: { getValue(): string[] } } };
        return w.__spinth.selected$.getValue().length;
      }),
    )
    .toBe(0);
  await expect(pageB.locator('[data-spinth-action-bar]')).toHaveCount(0);

  // 菜单降级为画布菜单：无元素项（删除），读操作保留（导出 PNG），粘贴禁用
  const menu = pageB.locator('[data-spinth-context-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '删除' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: '导出画布 PNG' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '粘贴' })).toBeDisabled();

  // 关菜单后文档纹丝不动
  await pageB.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await modelCount(pageB)).toBe(1);

  await cleanupDoc(page, docId);
  await cleanupDoc(pageB, docId);
});

test('390px：提示条在视口内、顶栏 44px、无横向滚动、「知道了」可关闭', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-390-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.setViewportSize({ width: 390, height: 844 });
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  const notice = pageB.locator('[data-spinth-readonly-notice]');
  await expect(notice).toBeVisible();
  const box = (await notice.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(44); // 不遮顶栏
  // 顶栏 44px、无横向滚动
  const header = await pageB.locator('header').boundingBox();
  expect(header?.height).toBe(44);
  await expect
    .poll(() => pageB.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);

  // 「知道了」仅会话内关闭
  await notice.getByRole('button', { name: '知道了' }).click();
  await expect(notice).toHaveCount(0);
  // 顶栏徽标仍说明原因（关闭提示条后的常驻说明面）
  await expect(pageB.locator('[data-spinth-readonly-pill]')).toBeVisible();
});

test('follower 手动刷新：仍是 follower（leader 还在），内容更新为最新落盘', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-refresh-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  await createShapeByDrag(page);
  await persisted(page);

  // B 手动刷新：重新排队仍拿不到锁（A 持有）→ follower；快照更新看到 A 的控件
  await pageB.reload();
  await ready(pageB);
  await waitRole(pageB, 'follower');
  await expect.poll(() => modelCount(pageB), { timeout: 5_000 }).toBe(1);
});

test('只读标签不跑资产维护链：leader 跑过（assetMaint=1）、follower 从未跑', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-maint-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=1`);
  await ready(page);

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=1`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // leader 侧维护链跑过（idle 调度 3s + 迁移/GC 秒级）
  const maintOf = (p: Page) =>
    p.evaluate(() => {
      const w = window as unknown as {
        __spinth: { lastAssetMaintenance: { when: number } | null };
      };
      return w.__spinth.lastAssetMaintenance;
    });
  await expect.poll(() => maintOf(page), { timeout: 15_000 }).not.toBeNull();
  // follower 侧 app 传 assetMaintenance=false 且 composeBoard 双重闸门——从未跑
  expect(await maintOf(pageB)).toBeNull();
});

test('follower 双击 missing 图：允许重试（纯本地渲染），不报错不写文档', async ({
  page,
  context,
}) => {
  const docId = `e2e-mt-retry-${Date.now()}`;
  await page.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(page);
  await waitRole(page, 'leader');

  const pageB = await context.newPage();
  await pageB.goto(`/?doc=${docId}&assetMaint=0`);
  await ready(pageB);
  await waitRole(pageB, 'follower');

  // leader 建 missing 引用图（账本无此行）→ 落盘后 follower 刷新取快照
  await page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          engine: {
            transact(fn: () => void): void;
            genInitialOrder(): string;
            add(d: Record<string, unknown>): void;
          };
        };
      }
    ).__spinth;
    w.engine.transact(() => {
      w.engine.add({
        id: 'w-mt-missing',
        type: 'IMAGE',
        zOrder: w.engine.genInitialOrder(),
        src: `spinth-asset:${'c'.repeat(64)}`, // 账本无此行
        x: 400,
        y: 300,
        width: 60,
        height: 40,
      });
    });
  });
  await persisted(page);
  await pageB.reload();
  await ready(pageB);
  await waitRole(pageB, 'follower');
  await expect
    .poll(
      () =>
        pageB.evaluate(() => {
          const d = (
            window as unknown as {
              __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
            }
          ).__spinth.__debug;
          const img = d.vmStates.find((v) => v.type === 'IMAGE');
          return img === undefined ? '' : String((img.imageLoad as { state?: string })?.state);
        }),
      { timeout: 8_000 },
    )
    .toBe('missing');

  // follower 双击图中心（世界→client 精确换算）：retry 允许（重载仍
  // missing——行不存在），无页面错误、不写文档。acquires 探针证伪
  // 「双击真的触发了重试」（固定 sleep 不可证）
  const loadProbe = (): Promise<{ state: string; acquires: number }> =>
    pageB.evaluate(() => {
      const d = (
        window as unknown as {
          __spinth: { __debug: { vmStates: Array<Record<string, unknown>> } };
        }
      ).__spinth.__debug;
      const img = d.vmStates.find((v) => v.type === 'IMAGE');
      const l = img?.imageLoad as { state?: string; acquires?: number } | undefined;
      return { state: String(l?.state ?? ''), acquires: Number(l?.acquires ?? 0) };
    });
  await expect.poll(async () => (await loadProbe()).acquires, { timeout: 5_000 }).toBe(1);
  const errors: string[] = [];
  pageB.on('pageerror', (err) => errors.push(String(err)));
  const at = await pageB.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          viewport: { worldToClient(p: { x: number; y: number }): { x: number; y: number } };
        };
      }
    ).__spinth;
    return w.viewport.worldToClient({ x: 430, y: 320 });
  });
  await pageB.mouse.dblclick(at.x, at.y);
  await expect.poll(async () => (await loadProbe()).acquires, { timeout: 5_000 }).toBe(2); // 重试真实发起
  expect(errors).toEqual([]);
  await expect
    .poll(
      () =>
        pageB.evaluate(() => {
          const d = (
            window as unknown as {
              __spinth: {
                __debug: { modelCount: number; vmStates: Array<Record<string, unknown>> };
              };
            }
          ).__spinth.__debug;
          return { count: d.modelCount, img: d.vmStates.find((v) => v.type === 'IMAGE') };
        }),
      { timeout: 5_000 },
    )
    .toEqual(
      expect.objectContaining({
        count: 1,
        img: expect.objectContaining({ hasSprite: false }),
      }),
    );
  await cleanupDoc(page, docId);
  await cleanupDoc(pageB, docId);
});
