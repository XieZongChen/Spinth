/** 脑图节点选中态 E2E（4.9）：浮动 UI/落点预置/点根/删除/Tab/ActionBar/框选 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/mindProbeE2e';

test('浮动 UI 跟随焦点节点：＋ 按钮贴节点两侧、删除按钮在节点正上方', async ({ page }) => {
  const docId = `e2e-mind-affordance-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(430, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 退出根编辑，回到选中态
  await page.mouse.click(440, 310); // 选中根（焦点回根）
  await page.waitForTimeout(250);

  const geo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const cr = canvas.getBoundingClientRect();
    const right = document.querySelector('[title="添加右侧子主题"]') as HTMLElement | null;
    const left = document.querySelector('[title="添加左侧子主题"]') as HTMLElement | null;
    const bar = document.querySelector('[data-spinth-action-bar]') as HTMLElement | null;
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    return {
      canvas: { left: cr.left, top: cr.top },
      focus: d.mindFocus,
      right: right?.getBoundingClientRect().toJSON() ?? null,
      left: left?.getBoundingClientRect().toJSON() ?? null,
      bar: bar?.getBoundingClientRect().toJSON() ?? null,
    };
  });
  expect(geo.focus?.isRoot).toBe(true);
  const node = geo.focus!.worldRect;
  const nodeLeft = geo.canvas.left + node.x;
  const nodeRight = geo.canvas.left + node.x + node.width;
  const nodeTop = geo.canvas.top + node.y;
  const nodeCenterX = (nodeLeft + nodeRight) / 2;

  // ＋ 按钮贴在**焦点节点本体**两侧（既有设计 mindAddBtn 定位）——不许飞到整棵树两端
  expect(geo.right).not.toBeNull();
  expect(geo.left).not.toBeNull();
  expect(geo.right!.left - nodeRight).toBeGreaterThanOrEqual(4);
  expect(geo.right!.left - nodeRight).toBeLessThanOrEqual(12);
  expect(nodeLeft - (geo.left!.left + geo.left!.width)).toBeGreaterThanOrEqual(4);
  expect(nodeLeft - (geo.left!.left + geo.left!.width)).toBeLessThanOrEqual(12);

  // 删除按钮所在浮动栏：水平中心对齐节点，且位于节点上方
  expect(geo.bar).not.toBeNull();
  expect(Math.abs(geo.bar!.left + geo.bar!.width / 2 - nodeCenterX)).toBeLessThanOrEqual(24);
  expect(geo.bar!.bottom).toBeLessThanOrEqual(nodeTop);
});

test('拖拽落点预置块落在被悬停的那一侧，且拖拽中隐藏浮动层', async ({ page }) => {
  const docId = `e2e-mind-drop-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  // 根下建一左一右两个分支（每次先回到根）
  const addChild = async (side: '添加左侧子主题' | '添加右侧子主题'): Promise<void> => {
    await page.mouse.click(610, 330);
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: side }).click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  };
  await addChild('添加左侧子主题');
  await addChild('添加右侧子主题');
  await page.mouse.click(610, 330);
  await page.waitForTimeout(250);

  const geo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    return { canvas: { left: canvas.left, top: canvas.top }, nodes: d.mindNodes };
  });
  const root = geo.nodes.find((n) => n.text === '中心主题')!;
  const leftNode = geo.nodes.find((n) => n.worldRect.x < root.worldRect.x)!;
  const rightNode = geo.nodes.find((n) => n.worldRect.x > root.worldRect.x)!;
  const center = (r: { x: number; y: number; width: number; height: number }) => ({
    x: r.x + r.width / 2 + geo.canvas.left,
    y: r.y + r.height / 2 + geo.canvas.top,
  });

  // 拖右分支，悬停到**左分支**上：预置块必须在根节点左侧（曾因 asSibling 不带
  // 侧向而一律按 right 画 → 用户看到「预置节点乱飘」）
  const from = center(rightNode.worldRect);
  const to = center(leftNode.worldRect);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(200);

  const mid = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    return {
      preview: d.dropPreview,
      actionBar: document.querySelector('[data-spinth-action-bar]') !== null,
      addButtons: document.querySelector('[title="添加右侧子主题"]') !== null,
      canvasLeft: canvas.left,
    };
  });
  expect(mid.preview).not.toBeNull();
  expect(mid.preview!.x + mid.preview!.width).toBeLessThanOrEqual(
    geo.canvas.left + root.worldRect.x,
  );
  expect(mid.actionBar).toBe(false); // 拖拽中隐藏浮动层（docs/12 §3）
  expect(mid.addButtons).toBe(false);
  await page.mouse.up();
});

test('4.9 点根 = 整图选中：框在根本体、整体拖动、Delete 删整图', async ({ page }) => {
  const docId = `e2e-mind-rootsel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 建一个右子，用于断言「整体」移动
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 取消选中——否则点根 = 「再点已选中 → 进编辑」
  await page.waitForTimeout(150);
  await page.mouse.click(610, 330); // 纯选中根：整图选中 + 焦点根（回 cursor）
  await page.waitForTimeout(250);

  const p1 = await probe(page);
  expect(p1.selectedIds).toHaveLength(1);
  expect(p1.mindFocus?.isRoot).toBe(true);
  const root1 = p1.mindNodes.find((n) => n.text === '中心主题')!;
  const child1 = p1.mindNodes.find((n) => n !== root1)!;
  // 选区框画在根本体（既有设计 getNodeBounds 语义），不是整树包围盒
  const frame = p1.selectionFrame;
  expect(frame).not.toBeNull();
  expect(Math.abs(frame!.x - root1.worldRect.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(frame!.y - root1.worldRect.y)).toBeLessThanOrEqual(2);

  // 拖根本体 = 整图平移（根/子同位移，子不可单独移动）
  await page.mouse.move(610, 330);
  await page.mouse.down();
  await page.mouse.move(720, 380, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const p2 = await probe(page);
  const root2 = p2.mindNodes.find((n) => n.text === '中心主题')!;
  const child2 = p2.mindNodes.find((n) => n !== root2)!;
  const dx = root2.worldRect.x - root1.worldRect.x;
  const dy = root2.worldRect.y - root1.worldRect.y;
  expect(dx).toBeGreaterThan(50);
  expect(Math.abs(child2.worldRect.x - child1.worldRect.x - dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(child2.worldRect.y - child1.worldRect.y - dy)).toBeLessThanOrEqual(2);

  // Delete = 删根 = 删整图
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(250);
  expect((await probe(page)).modelCount).toBe(0);
});

test('4.9 子节点 Delete：删节点、焦点转同侧后兄弟（既有设计规则）', async ({ page }) => {
  const docId = `e2e-mind-nodedel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 子1（「子节点 1」）
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 取消选中（焦点清，探针暂不可用）
  await page.waitForTimeout(150);
  await page.mouse.click(610, 330); // 选中根 + 焦点根（探针复活，取子节点真实坐标）
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab'); // 子2（根第二分支「子节点 2」）
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 取消选中
  await page.waitForTimeout(150);
  await page.mouse.click(610, 330); // 再选中根（探针复活）
  await page.waitForTimeout(200);

  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes.find((n) => n.text === '中心主题')!;
    const kids = d.mindNodes
      .filter((n) => n !== root)
      .sort((p, q) => p.worldRect.y - q.worldRect.y);
    const top = kids[0]!;
    return {
      topC: {
        x: top.worldRect.x + top.worldRect.width / 2 + c.left,
        y: top.worldRect.y + top.worldRect.height / 2 + c.top,
      },
      belowId: kids[1]!.id,
    };
  });
  await page.keyboard.press('Escape'); // 取消选中——否则点子 = 「再点已选中 → 进编辑」
  await page.waitForTimeout(150);
  await page.mouse.click(geo.topC.x, geo.topC.y); // 纯选中上面的子
  await page.waitForTimeout(250);
  await page.keyboard.press('Backspace'); // 删除 → 焦点落同侧后兄弟（下面的子）
  await page.waitForTimeout(250);
  const p = await probe(page);
  expect(p.mindNodes).toHaveLength(2); // 根 + 下面的子
  expect(p.mindFocus?.nodeId).toBe(geo.belowId);
  expect(p.mindFocus?.isRoot).toBe(false);
});

test('4.9 Tab/Enter 作用于选中子节点：建子 / 建同级（焦点与选中合一）', async ({ page }) => {
  const docId = `e2e-mind-keys-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 子1（默认文案恒「子节点 1」，文本不可作身份）
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 取消选中
  await page.waitForTimeout(150);
  await page.mouse.click(610, 330); // 选中根（探针复活）
  await page.waitForTimeout(200);
  // 记下子1 身份与屏幕坐标
  const c1 = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes.find((n) => n.text === '中心主题')!;
    const n = d.mindNodes.find((x) => x !== root)!;
    return {
      id: n.id,
      cx: n.worldRect.x + n.worldRect.width / 2 + c.left,
      cy: n.worldRect.y + n.worldRect.height / 2 + c.top,
      x: n.worldRect.x,
      y: n.worldRect.y,
    };
  });
  await page.keyboard.press('Escape'); // 取消选中——点子1 才是纯选中
  await page.waitForTimeout(150);

  // 点子1（纯选中）→ Tab = 建它的子（更深层，x 更大）
  await page.mouse.click(c1.cx, c1.cy);
  await page.waitForTimeout(250);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  let p = await probe(page);
  expect(p.mindNodes).toHaveLength(3);
  expect(p.mindFocus?.nodeId).not.toBe(c1.id);
  expect(p.mindFocus!.worldRect.x).toBeGreaterThan(c1.x);

  // 回到子1（先 Escape 取消选中）→ Enter = 建同级（根第二分支：同列 x、不同行 y）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(c1.cx, c1.cy);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindNodes).toHaveLength(4);
  expect(p.mindFocus?.nodeId).not.toBe(c1.id);
  expect(Math.abs(p.mindFocus!.worldRect.x - c1.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(p.mindFocus!.worldRect.y - c1.y)).toBeGreaterThan(2);
});

test('4.9 ActionBar 按节点出操作：删除按钮只删焦点节点', async ({ page }) => {
  const docId = `e2e-mind-abdel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 子1
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 取消选中
  await page.waitForTimeout(150);
  await page.mouse.click(610, 330); // 选中根（探针复活）
  await page.waitForTimeout(200);
  const c1 = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes.find((n) => n.text === '中心主题')!;
    const n = d.mindNodes.find((x) => x !== root)!;
    return {
      cx: n.worldRect.x + n.worldRect.width / 2 + c.left,
      cy: n.worldRect.y + n.worldRect.height / 2 + c.top,
    };
  });
  await page.keyboard.press('Escape'); // 取消选中
  await page.waitForTimeout(150);
  await page.mouse.click(c1.cx, c1.cy); // 纯选中子1
  await page.waitForTimeout(300);
  await expect(page.locator('[data-spinth-action-bar]')).toBeVisible();
  await page.locator('[data-spinth-action-bar] button[aria-label="删除"]').click();
  await page.waitForTimeout(250);
  const p = await probe(page);
  expect(p.modelCount).toBe(1); // 图还在
  expect(p.mindNodes).toHaveLength(1); // 只剩根
  expect(p.mindNodes[0]!.text).toBe('中心主题');
});

test('4.9 框选：命中子节点 = 节点级选中、框中根本体 = 整图', async ({ page }) => {
  const docId = `e2e-mind-marquee-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 右子
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // 取消选中
  await page.waitForTimeout(150);
  await page.mouse.click(610, 330); // 选中根（回 cursor 模式；纯选中不进编辑；探针复活）
  await page.waitForTimeout(250);

  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinthDebug: { __debug: Probe } }).__spinthDebug.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes.find((n) => n.text === '中心主题')!;
    const child = d.mindNodes.find((n) => n !== root)!;
    const toScreen = (r: { x: number; y: number; width: number; height: number }) => ({
      left: r.x + c.left,
      top: r.y + c.top,
      right: r.x + r.width + c.left,
      bottom: r.y + r.height + c.top,
    });
    return {
      rootId: root.id,
      childId: child.id,
      root: toScreen(root.worldRect),
      child: toScreen(child.worldRect),
    };
  });

  // 框只罩住右子（起点在子框外侧空隙，不触根本体）
  await page.mouse.move(geo.child.left - 4, geo.child.top - 4);
  await page.mouse.down();
  await page.mouse.move(geo.child.right + 4, geo.child.bottom + 4, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  let p = await probe(page);
  expect(p.selectedIds).toHaveLength(1);
  expect(p.mindFocus?.nodeId).toBe(geo.childId); // 节点级选中
  expect(p.mindFocus?.isRoot).toBe(false);
  // 框在子节点本体（selectionFrame 与 worldRect 同为世界坐标）
  const childWorld = p.mindNodes.find((n) => n.id === geo.childId)!.worldRect;
  expect(Math.abs(p.selectionFrame!.y - childWorld.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(p.selectionFrame!.width - childWorld.width)).toBeLessThanOrEqual(2);

  // 框中根本体 → 整图（焦点回根）
  await page.mouse.move(geo.root.left - 4, geo.root.top - 4);
  await page.mouse.down();
  await page.mouse.move(geo.root.right + 4, geo.root.bottom + 4, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  p = await probe(page);
  expect(p.mindFocus?.nodeId).toBe(geo.rootId);
  expect(p.mindFocus?.isRoot).toBe(true);
});
