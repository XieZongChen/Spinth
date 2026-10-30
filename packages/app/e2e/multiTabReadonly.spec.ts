/** 多标签只读面 E2E（docs/21 §4）：视图操作/右键/390/刷新/维护链/missing 图 */
import { expect, test, type Page } from '@playwright/test';
import { cleanupDoc, modelCount, persisted, ready } from './helpers/projectFileE2e';
import { waitRole, createShapeByDrag } from './helpers/multiTabE2e';

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
  await expect(menu.getByRole('menuitem', { name: '删除' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: '导出画布 PNG' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '粘贴' })).toBeDisabled();

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
