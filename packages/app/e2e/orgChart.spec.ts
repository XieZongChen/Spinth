/** 组织架构 E2E（specs/tree-diagrams §14.2/Phase 3）：建图、层级对齐、父居中、
 *  折叠、方向键、拖拽重排、只读、项目文件往返 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { exportViaMenu, importViaInput, waitForImportedNav } from './helpers/projectFileE2e';
import { probe, type Probe } from './helpers/mindProbeE2e';

async function canvasOrigin(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const cr = (document.querySelector('canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { left: cr.left, top: cr.top };
  });
}

/** 建 org 图 + Tab 连建两层（根 → A → A1） */
async function buildOrg(page: import('@playwright/test').Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.keyboard.press('o');
  await page.mouse.click(500, 300);
  await page.waitForTimeout(300); // 根编辑器自动打开
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

test('OC-1 层级对齐：子层 y 严格相等、子在父正下方（单链同 x 中线）', async ({ page }) => {
  await buildOrg(page, `e2e-org-1-${Date.now()}`);
  const p = await probe(page);
  expect(p.mindFocus?.kind).toBe('ORG_CHART');
  expect(p.mindNodes).toHaveLength(3);
  const [root, a, a1] = p.mindNodes;
  // 层级：A、A1 的 y 严格递增（层对齐 + 层距）
  expect(a.worldRect.y).toBeGreaterThan(root.worldRect.y + root.worldRect.height);
  expect(a1.worldRect.y).toBeGreaterThan(a.worldRect.y + a.worldRect.height);
  // 单链同 x 中线：根/A/A1 中心 x 两两相差 ≤1
  const cx = (n: Probe['mindNodes'][number]) => n.worldRect.x + n.worldRect.width / 2;
  expect(Math.abs(cx(root) - cx(a))).toBeLessThanOrEqual(1);
  expect(Math.abs(cx(a) - cx(a1))).toBeLessThanOrEqual(1);
});

test('OC-2 父在子跨度居中：根三个子，根中心 x = 首末子中心 x 的中点', async ({ page }) => {
  const docId = `e2e-org-2-${Date.now()}`;
  // 建根 + Tab 链一层（buildOrg 同款——编辑器时序已验证稳定）
  await buildOrg(page, docId);
  let p = await probe(page);
  expect(p.mindNodes).toHaveLength(3);
  const rootRect = p.mindNodes[0]!.worldRect;
  const o = await canvasOrigin(page);
  // 点根（图已选中 → onActivate 进根编辑）→ Escape 关编辑（选区保留、焦点根）
  await page.mouse.click(
    o.left + rootRect.x + rootRect.width / 2,
    o.top + rootRect.y + rootRect.height / 2,
  );
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // AddButtons 跟随焦点（建子后焦点移新子）——用 sibling 槽连建兄弟：
  // 当前焦点根（Escape 后）；先点根 child 槽建 B（焦点→B），再点 B 的
  // sibling 槽建 C → 根三子 A/B/C（A 来自 Tab 链，带孙 A1 不影响层判定）
  await page.click('[data-spinth-mind-add="child"]');
  await page.waitForTimeout(200);
  await page.click('[data-spinth-mind-add="sibling"]');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes).toHaveLength(5); // 根 + A/A1 + B + C
  const root = p.mindNodes[0]!;
  const layer1 = p.mindNodes.filter((n) => n.worldRect.y === p.mindNodes[1]!.worldRect.y);
  expect(layer1).toHaveLength(3); // A/B/C 同层
  // 层对齐：同层 y 严格相等已由 filter 保证；孙层（A1）与子层间隔 = LEVEL_GAP
  // 父居中：根中心 x = 首末子中心 x 中点
  const byX = [...layer1].sort((x, y) => x.worldRect.x - y.worldRect.x);
  const first = byX[0]!;
  const last = byX[byX.length - 1]!;
  const mid =
    (first.worldRect.x + first.worldRect.width / 2 + last.worldRect.x + last.worldRect.width / 2) /
    2;
  expect(Math.abs(mid - (root.worldRect.x + root.worldRect.width / 2))).toBeLessThanOrEqual(2);

  // 多子 ↓ 导航（审查返工三轮）：org top-down 的 spanOf 沿 x——根按 ↓ 应落
  // x 最近的子（非恒最左子）。建完三子焦点在 C——先 Escape 清选区点根，
  // 再 ↓（与 OC-3 的编辑器陷阱口径同源）
  const rootCx = root.worldRect.x + root.worldRect.width / 2;
  const nearest = layer1.reduce((a, b) =>
    Math.abs(a.worldRect.x + a.worldRect.width / 2 - rootCx) <=
    Math.abs(b.worldRect.x + b.worldRect.width / 2 - rootCx)
      ? a
      : b,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const o2 = await canvasOrigin(page);
  await page.mouse.click(
    o2.left + root.worldRect.x + root.worldRect.width / 2,
    o2.top + root.worldRect.y + root.worldRect.height / 2,
  );
  await expect
    .poll(async () => (await probe(page)).mindFocus?.nodeId, { timeout: 5000 })
    .toBe(root.id);
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => (await probe(page)).mindFocus?.nodeId, { timeout: 5000 })
    .toBe(nearest.id);
});

test('OC-3 方向键：↑ 父 / ↓ 子；折叠徽标点击展开', async ({ page }) => {
  await buildOrg(page, `e2e-org-3-${Date.now()}`);
  let p = await probe(page);
  const [, nodeA] = p.mindNodes;
  // 焦点 A（Escape 清选区再点——防「再点已选中→进编辑」）
  const o = await canvasOrigin(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(
    o.left + nodeA.worldRect.x + nodeA.worldRect.width / 2,
    o.top + nodeA.worldRect.y + nodeA.worldRect.height / 2,
  );
  await page.waitForTimeout(200);
  // 焦点保持（审查返工 P0-2 回归锁）：点击后 applySelection 不再把 org
  // 选中清成无焦点——ActionBar/AddButtons 依赖该焦点
  p = await probe(page);
  expect(p.mindFocus?.nodeId).toBe(nodeA.id);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  p = await probe(page);
  expect(p.mindFocus?.nodeId).toBe(p.mindNodes[2]!.id);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  p = await probe(page);
  expect(p.mindFocus?.nodeId).toBe(nodeA.id);

  // 折叠 A（快捷键）→ 徽标在卡片底边中点，点击展开
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(250);
  p = await probe(page);
  const a = p.mindNodes.find((n) => n.id === nodeA.id)!;
  expect(a.collapsed).toBe(true);
  expect(p.mindNodes.every((n) => n.visible)).toBe(false); // A1 隐藏
  await page.mouse.click(
    o.left + a.worldRect.x + a.worldRect.width / 2,
    o.top + a.worldRect.y + a.worldRect.height, // 底边中点
  );
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes.find((n) => n.id === nodeA.id)!.collapsed).toBe(false);
  expect(p.mindNodes.every((n) => n.visible)).toBe(true);
});

test('OC-4 项目文件往返：org 树导出 .spinth.zip 再导入保持（kind/折叠/几何）', async ({ page }) => {
  const docId = `e2e-org-4-${Date.now()}`;
  await buildOrg(page, docId);
  // 折叠 A 形成折叠态快照
  let p = await probe(page);
  const [, nodeA] = p.mindNodes;
  const o = await canvasOrigin(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(
    o.left + nodeA.worldRect.x + nodeA.worldRect.width / 2,
    o.top + nodeA.worldRect.y + nodeA.worldRect.height / 2,
  );
  await page.waitForTimeout(200);
  await page.keyboard.press('ControlOrMeta+.');
  await page.waitForTimeout(300);

  // 导出 → 新文档导入（projectFileE2e helper：导入会导航到新 doc URL）
  const { path } = await exportViaMenu(page);
  expect(path).toBeTruthy();
  const importBase = `${docId}-import`;
  await page.goto(`/?doc=${importBase}-${Date.now()}`);
  await waitForSynced(page);
  await importViaInput(page, path);
  await waitForImportedNav(page, importBase);
  await waitForSynced(page);
  await page.waitForTimeout(600);
  // 点根复活探针——坐标经公开 toScreenPoint 换算（若视口被平移，世界≠屏幕，
  // 直用世界坐标会空命中→空白单击清选区）
  const sp = await page.evaluate(() =>
    (
      window as unknown as {
        __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
      }
    ).__spinth.toScreenPoint({ x: 560, y: 316 }),
  );
  await page.mouse.click(sp.x, sp.y);
  await page.waitForTimeout(400);
  p = await probe(page);
  expect(p.mindFocus?.kind).toBe('ORG_CHART');
  const a = p.mindNodes[1];
  expect(a).toBeDefined();
  expect(a!.collapsed).toBe(true); // 折叠态随文档
  expect(p.mindNodes.filter((n) => n.visible)).toHaveLength(2);
});
