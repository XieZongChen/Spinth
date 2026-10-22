import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 脑图全链路 E2E（2026-09 首批为用户实测反馈回归：工具栏不创建只进工具态/
 * 幽灵根跟随鼠标/按下点建根；后续扩至 docs/11 §9 布局规格、4.9 节点级选中
 * 五例、IME 首键竞态、拖出成图等，见各 test 名）。
 * 断言用 `__spinth.__debug` 数据探针（docs/14：截图会撒谎，探针优先）。
 */

interface Probe {
  modelCount: number;
  renderCount: number;
  selectedIds: string[];
  mindFocus: {
    nodeId: string;
    isRoot: boolean;
    worldRect: { x: number; y: number; width: number; height: number };
  } | null;
  mindNodes: Array<{
    id: string;
    text: string;
    worldRect: { x: number; y: number; width: number; height: number };
  }>;
  dropPreview: { x: number; y: number; width: number; height: number } | null;
  selectionFrame: { x: number; y: number; width: number; height: number } | null;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    return {
      modelCount: d.modelCount,
      renderCount: d.renderCount,
      selectedIds: d.selectedIds,
      mindFocus: d.mindFocus,
      mindNodes: d.mindNodes,
      dropPreview: d.dropPreview,
      selectionFrame: d.selectionFrame,
    };
  });
}

/** 幽灵位置/透明度（transform 解析：matrix3d 取 12/13，matrix 取 4/5）。
 *  断言现身必须用 opacity 数值——Playwright 对 opacity:0 也判 visible。 */
async function ghostPos(
  page: Page,
  mode: string,
): Promise<{ x: number; y: number; opacity: string }> {
  return page.locator(`[data-spinth-tool-ghost="${mode}"]`).evaluate((el) => {
    const cs = getComputedStyle(el);
    const nums = cs.transform.match(/[-\d.]+/g)?.map(Number) ?? [];
    return { x: nums[12] ?? nums[4] ?? 0, y: nums[13] ?? nums[5] ?? 0, opacity: cs.opacity };
  });
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

test('脑图工具：选中不创建、幽灵示意跟随、悬停已有图隐藏、按下点建图', async ({ page }) => {
  const docId = `e2e-mind-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  const ghostBox = () => page.locator('[data-spinth-tool-ghost="mind"]');
  // 1) 点工具本身：不建图，幽灵 DOM 出现
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.move(500, 260);
  await page.waitForTimeout(150);
  let p = await probe(page);
  expect(p.modelCount).toBe(0);
  await expect(ghostBox()).toBeVisible();

  // 2) 跟随鼠标（ref 直写 transform，两次移动位置都要变）
  const tx = async () => {
    const m = await ghostBox().evaluate((el) => getComputedStyle(el).transform);
    const nums = m.match(/[-\d.]+/g)?.map(Number) ?? [];
    return { x: nums[12] ?? nums[4] ?? 0, y: nums[13] ?? nums[5] ?? 0 };
  };
  await page.mouse.move(620, 320);
  await page.waitForTimeout(120);
  const a = await tx();
  await page.mouse.move(760, 380);
  await page.waitForTimeout(120);
  const b = await tx();
  expect(b.x - a.x).toBeGreaterThan(100);
  expect(b.y - a.y).toBeGreaterThan(30);

  // 3) 画布按下 → 在按下点建图（数量 +1）
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  p = await probe(page);
  expect(p.modelCount).toBe(1);
  await page.keyboard.press('Escape');

  // 4) 重新激活 mind 工具：悬停根节点本体 → 幽灵隐藏；移开恢复
  await page.getByRole('button', { name: /脑图/ }).click();
  const rootC = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            vmPositions: Array<{ x: number; y: number }>;
            vmStates: Array<Record<string, unknown>>;
          };
        };
      }
    ).__spinth.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const pos = d.vmPositions[0]!;
    const w = Number(d.vmStates[0]?.width ?? 100);
    const h = Number(d.vmStates[0]?.height ?? 40);
    return { x: pos.x + w / 2 + c.left, y: pos.y + h / 2 + c.top };
  });
  await page.mouse.move(rootC.x, rootC.y);
  await page.waitForTimeout(200);
  await expect(ghostBox()).toBeHidden();
  await page.mouse.move(rootC.x + 600, rootC.y + 300);
  await page.waitForTimeout(200);
  await expect(ghostBox()).toBeVisible();
});

test('可创建工具统一幽灵：矩形工具激活即跟随（脑图同款 DOM）', async ({ page }) => {
  const docId = `e2e-ghost-shape-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(150);
  await expect(page.locator('[data-spinth-tool-ghost="shape"]')).toBeVisible();
  // cursor/hand 工具无幽灵
  await page.getByRole('button', { name: /选择/ }).click();
  await page.waitForTimeout(120);
  await expect(page.locator('[data-spinth-tool-ghost]')).toHaveCount(0);
});

test('程序化切工具（指针静止）：幽灵立即按指针位置就位（不必等 move）', async ({ page }) => {
  const docId = `e2e-ghost-programmatic-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  // 指针先进入画布（组件常驻记录位置），随后只程序化切工具、不再动鼠标
  await page.mouse.move(500, 300);
  await page.evaluate(() => {
    (
      window as unknown as { __spinth: { setCursorMode: (m: string) => void } }
    ).__spinth.setCursorMode('shape');
  });
  const pos = await ghostPos(page, 'shape');
  expect(pos.opacity).toBe('0.6');
  expect(Math.abs(pos.x - (500 + 14))).toBeLessThanOrEqual(2);
  expect(Math.abs(pos.y - (300 + 14))).toBeLessThanOrEqual(2);
});

test('画布元素被替换后幽灵自恢复（rect 缓存失检兜底）', async ({ page }) => {
  const docId = `e2e-ghost-requery-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
  // 模拟 Board 重挂：旧 canvas 摘除、几何**不同**的新 canvas 补位
  // （若仍用旧 rect 判界内，(150,100) 会被误判在界内）
  await page.evaluate(() => {
    const stage = document.querySelector('#stage-container')!;
    stage.querySelector('canvas')?.remove();
    const c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;top:200px;left:100px;width:50%;height:50%;';
    stage.appendChild(c);
  });
  await page.mouse.move(150, 100);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0'); // 旧 rect 会误判 0.6
  await page.mouse.move(640, 360);
  await page.waitForTimeout(120);
  const pos = await ghostPos(page, 'shape');
  expect(pos.opacity).toBe('0.6');
  expect(Math.abs(pos.x - (640 + 14))).toBeLessThanOrEqual(2);
  expect(Math.abs(pos.y - (360 + 14))).toBeLessThanOrEqual(2);
});

test('幽灵 rect 失效通道①：scroll 捕获重读（transform 缩画布——不触发 RO/resize）', async ({
  page,
}) => {
  const docId = `e2e-ghost-scroll-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
  // scaleY(0.5) 只改 getBoundingClientRect 的可视几何、不改布局盒——RO/resize
  // 都不触发，rect 失效只能来自合成 scroll 事件（通道隔离）
  await page.evaluate(() => {
    const c = document.querySelector('#stage-container canvas') as HTMLElement;
    c.style.transformOrigin = 'top';
    c.style.transform = 'scaleY(0.5)';
    window.dispatchEvent(new Event('scroll'));
  });
  await page.mouse.move(500, 700);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0'); // 旧 rect（bottom≈900）会误判界内
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6'); // 新 rect（bottom≈472）内恢复
});

test('幽灵 rect 失效通道②：ResizeObserver（CSS 改尺寸——无 scroll/resize 事件）', async ({
  page,
}) => {
  const docId = `e2e-ghost-ro-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
  // 改 CSS 高度改变布局盒 → RO 触发（不派发 scroll/resize，元素也未替换）
  await page.evaluate(() => {
    (document.querySelector('#stage-container canvas') as HTMLElement).style.height = '50%';
  });
  await page.waitForTimeout(200); // RO 回调在下一渲染帧前
  await page.mouse.move(500, 700);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0'); // 旧 rect（bottom≈900）会误判界内
  await page.mouse.move(500, 300);
  await page.waitForTimeout(120);
  expect((await ghostPos(page, 'shape')).opacity).toBe('0.6');
});

test('幽灵 coalesced 空列表回退 + 指针从未移动时不现身', async ({ page }) => {
  const docId = `e2e-ghost-coalesced-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  // 指针从未移动（常驻记录为 null）：程序化切工具保持隐藏、不报错
  await page.evaluate(() => {
    (
      window as unknown as { __spinth: { setCursorMode: (m: string) => void } }
    ).__spinth.setCursorMode('shape');
  });
  expect((await ghostPos(page, 'shape')).opacity).toBe('0');
  // 合成 pointermove 无合并采样（Chrome 中 getCoalescedEvents() 返回 []）
  // → 走 last = e 回退分支（Safari 旧版兼容路径），位置取事件坐标本身
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 400 }));
  });
  const pos = await ghostPos(page, 'shape');
  expect(pos.opacity).toBe('0.6');
  expect(Math.abs(pos.x - (700 + 14))).toBeLessThanOrEqual(2);
  expect(Math.abs(pos.y - (400 + 14))).toBeLessThanOrEqual(2);
});

test('脑图节点编辑器与画布节点逐像素对齐（页面坐标 = 画布局部 + 画布偏移）', async ({ page }) => {
  const docId = `e2e-mind-editor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 建图后自动进入根节点编辑（既有设计 addMindMap → select → pointerup 激活）
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(420, 320);
  await page.waitForTimeout(250);

  const geo = await page.evaluate(() => {
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const d = (
      window as unknown as {
        __spinth: { __debug: { vmPositions: Array<{ x: number; y: number }> } };
      }
    ).__spinth.__debug;
    if (!ta || !canvas) return null;
    const taRect = ta.getBoundingClientRect();
    const cRect = canvas.getBoundingClientRect();
    return {
      taTop: taRect.top,
      taLeft: taRect.left,
      canvasTop: cRect.top,
      canvasLeft: cRect.left,
      map: d.vmPositions[0]!,
    };
  });
  expect(geo).not.toBeNull();
  // 曾经漏了画布页面偏移 → 编辑器整体上移顶栏高度（截图里表现为"节点出现两份文字"）
  expect(Math.abs(geo!.taTop - (geo!.canvasTop + geo!.map.y))).toBeLessThanOrEqual(2);
  expect(Math.abs(geo!.taLeft - (geo!.canvasLeft + geo!.map.x))).toBeLessThanOrEqual(2);
});

test('浮动 UI 跟随焦点节点：＋ 按钮贴节点两侧、删除按钮在节点正上方', async ({ page }) => {
  const docId = `e2e-mind-affordance-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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
  await ready(page);
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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

test('子节点：点一次出蓝框（框在本体）、再点一次进编辑（曾经两条都不通）', async ({ page }) => {
  const docId = `e2e-mind-child-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab'); // 建子节点
  await page.waitForTimeout(250);
  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const n = d.mindNodes.find((x) => x.text !== '中心主题')!;
    return {
      canvas: { left: c.left, top: c.top },
      node: n.worldRect,
      center: {
        x: n.worldRect.x + n.worldRect.width / 2 + c.left,
        y: n.worldRect.y + n.worldRect.height / 2 + c.top,
      },
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 点一次：焦点落子节点，选区框必须画在**该节点本体**（既有设计点 MIND_NODE 都框本体）
  await page.mouse.click(geo.center.x, geo.center.y);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    return {
      focus: d.mindFocus,
      frame: d.selectionFrame,
      ta: document.querySelectorAll('body > textarea').length,
    };
  });
  expect(after.focus?.isRoot).toBe(false);
  expect(after.ta).toBe(0); // 第一次点击只选中
  expect(after.frame).not.toBeNull();
  expect(Math.abs(after.frame!.x - geo.node.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.frame!.y - geo.node.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.frame!.width - geo.node.width)).toBeLessThanOrEqual(2);

  // 再点一次：进编辑（此前脑图拖拽分支直接 return，子节点永远进不了编辑态）
  await page.mouse.click(geo.center.x, geo.center.y);
  await page.waitForTimeout(300);
  const edit = await page.evaluate(() => {
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return ta ? { rect: ta.getBoundingClientRect().toJSON(), canvasTop: c.top } : null;
  });
  expect(edit).not.toBeNull();
  expect(Math.abs(edit!.rect.top - (edit!.canvasTop + geo.node.y))).toBeLessThanOrEqual(2);
});

test('按下瞬间选中框即落点击节点（编辑器 blur 不抢焦点回归）', async ({ page }) => {
  // 回归（2026-09-22 用户实测）：点击子节点时按下瞬间选中态闪现在根节点、
  // 松手才落到子节点——根因是建图后根的编辑器仍开着，pointerdown 后 textarea
  // blur → exitNodeEdit(true) 无条件把焦点写回被编辑的根，覆盖 focusNode 刚设的子节点
  const docId = `e2e-press-frame-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(600, 320);
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // 先点根（建图后编辑器场景下根可能仍在编辑态——正是触发路径）
  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes[0]!;
    const child = d.mindNodes.find((x) => x.text !== '中心主题')!;
    return {
      rootC: {
        x: root.worldRect.x + root.worldRect.width / 2 + c.left,
        y: root.worldRect.y + root.worldRect.height / 2 + c.top,
      },
      childC: {
        x: child.worldRect.x + child.worldRect.width / 2 + c.left,
        y: child.worldRect.y + child.worldRect.height / 2 + c.top,
      },
      childRect: child.worldRect,
    };
  });
  await page.mouse.click(geo.rootC.x, geo.rootC.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // 确保任何编辑器退出路径都被走过
  await page.waitForTimeout(150);

  await page.mouse.move(geo.childC.x, geo.childC.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const during = await page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    return { focusIsRoot: d.mindFocus?.isRoot, frame: d.selectionFrame };
  });
  // 按下瞬间：焦点已是子节点、框画在子节点本体（曾闪现在根）
  expect(during.focusIsRoot).toBe(false);
  expect(during.frame).toBeTruthy();
  expect(Math.abs(during.frame!.x - geo.childRect.x)).toBeLessThan(2);
  expect(Math.abs(during.frame!.y - geo.childRect.y)).toBeLessThan(2);
  await page.mouse.up();
});

test('docs/11 §9：Tab 连建 10 层布局收敛稳定；undo 10 次逐步回退', async ({ page }) => {
  const docId = `e2e-mind-chain-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250); // 根编辑器自动打开

  // 编辑态 Tab = 建子并继续编辑新节点（既有设计连建方式）——连按 10 层
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  const snap = (): Promise<Array<{ cx: number; x: number; y: number }>> =>
    page.evaluate(() => {
      const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
      return d.mindNodes
        .map((n) => ({
          cx: n.worldRect.y + n.worldRect.height / 2,
          x: n.worldRect.x,
          y: n.worldRect.y,
        }))
        .sort((a, b) => a.x - b.x);
    });

  // 收敛：单链全在右侧——各节点垂直居中于同一水平线（单子节点居中）、x 严格递增
  const nodes = await snap();
  expect(nodes).toHaveLength(11);
  for (const n of nodes) expect(Math.abs(n.cx - nodes[0]!.cx)).toBeLessThanOrEqual(1);
  for (let i = 1; i < nodes.length; i++) expect(nodes[i]!.x).toBeGreaterThan(nodes[i - 1]!.x);
  // 无跳动：静止后两次采样逐节点一致
  await page.waitForTimeout(300);
  expect(await snap()).toEqual(nodes);

  // undo 10 次：addChild 每步 stopCapturing → 每次恰好回退一层，11 → 1
  const count = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug.mindNodes.length,
    );
  for (let i = 10; i >= 1; i--) {
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(120);
    expect(await count()).toBe(i);
  }
});

test('docs/11 §9：长文本 360px 上限自动换行；根增高子树联动重排', async ({ page }) => {
  const docId = `e2e-mind-wrap-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 建右子（短根下的初始位置；可能带开编辑器）
  await page.waitForTimeout(250);

  const rects = (): Promise<{
    root: { x: number; y: number; width: number; height: number };
    child: { x: number; y: number };
  }> =>
    page.evaluate(() => {
      const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
      // 根的文案会被长文本替换——以「子节点 1」（首个子节点恒名）锚定子节点
      const child = d.mindNodes.find((n) => n.text === '子节点 1')!;
      const root = d.mindNodes.find((n) => n !== child)!;
      return { root: root.worldRect, child: { x: child.worldRect.x, y: child.worldRect.y } };
    });
  const before = await rects();

  // 点根一次：关掉可能开着的子编辑器（textarea blur）+ 选中根；再点一次进编辑。
  // 注意不能 Escape 代替——选中态（非编辑态）按 Escape 会清焦点
  const c = await page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const child = d.mindNodes.find((n) => n.text === '子节点 1')!;
    const root = d.mindNodes.find((n) => n !== child)!;
    return { x: root.worldRect.x + 20 + canvas.left, y: root.worldRect.y + 15 + canvas.top };
  });
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(250);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelectorAll('body > textarea').length)).toBe(1);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('长文本换行验收联动重排'.repeat(10)); // 120 字
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // 落库退出
  await page.waitForTimeout(250);

  const after = await rects();
  // 换行上限：120 字 × 18px ≈ 2160px 不换行会远超——总宽恒 ≤ 360（含 padding）
  expect(after.root.width).toBeLessThanOrEqual(362);
  expect(after.root.width).toBeGreaterThan(200); // 确实铺到换行宽度（不是被压窄）
  expect(after.root.height).toBeGreaterThan(before.root.height + 20); // 多行
  // 联动重排：根变高 → 右子被推下移，且仍在根本体右侧（无重叠）
  expect(after.child.y).toBeGreaterThan(before.child.y);
  expect(after.child.x).toBeGreaterThanOrEqual(after.root.x + after.root.width - 2);
});

test('docs/11 §9：拖节点到空白处成新图——原树正确移除、新图落在松手点', async ({ page }) => {
  const docId = `e2e-mind-dragout-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab'); // 建右子（可能带开编辑器）
  await page.waitForTimeout(250);

  const geo = await page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    const root = d.mindNodes.find((n) => n.text === '中心主题')!;
    const child = d.mindNodes.find((n) => n !== root)!;
    const center = (r: { x: number; y: number; width: number; height: number }) => ({
      x: r.x + r.width / 2 + c.left,
      y: r.y + r.height / 2 + c.top,
    });
    return { rootC: center(root.worldRect), childC: center(child.worldRect) };
  });
  // 若子编辑器开着，先点根关掉（textarea 挡指针，直接拖会被它吃掉 pointerdown）；
  // 不能用 Escape——选中态（非编辑态）按 Escape 会清焦点
  await page.mouse.click(geo.rootC.x, geo.rootC.y);
  await page.waitForTimeout(250);

  // 拖子节点到右下空白（沿途无节点，DropArea 不命中 → 成新图）
  await page.mouse.move(geo.childC.x, geo.childC.y);
  await page.mouse.down();
  await page.mouse.move(980, 720, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 新图生成：焦点自动落新图根（= 被拖节点），位置 = 松手点（所见即所得）
  const p1 = await probe(page);
  expect(p1.modelCount).toBe(2);
  expect(p1.mindNodes).toHaveLength(1);
  expect(p1.mindNodes[0]!.text).toBe('子节点 1');
  expect(Math.abs(p1.mindNodes[0]!.worldRect.x - 980)).toBeLessThanOrEqual(3);
  expect(Math.abs(p1.mindNodes[0]!.worldRect.y - (720 - 44))).toBeLessThanOrEqual(3);

  // 原树正确移除：只剩根
  await page.mouse.click(geo.rootC.x, geo.rootC.y);
  await page.waitForTimeout(250);
  const p2 = await probe(page);
  expect(p2.modelCount).toBe(2);
  expect(p2.mindNodes).toHaveLength(1);
  expect(p2.mindNodes[0]!.text).toBe('中心主题');
});

test('中文输入法首键竞态：合成首键（keyCode 229）不污染文本，落字全量替换', async ({ page }) => {
  // 回归（2026-09-26 读码揪出）：macOS/Chrome 的合成首键 keydown 携带真实字符
  // 但 keyCode=229、isComposing 尚 false（先于 compositionstart）——旧代码把它
  // 当普通字符 replaceWith：拼音首字母立即落库并同步给协作者，取消合成原文被毁
  const docId = `e2e-mind-ime-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /脑图/ }).click();
  await page.mouse.click(500, 300);
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.mouse.click(510, 310); // mind 模式点根 → 选中 + 回 cursor（键入通道前置条件）
  await page.waitForTimeout(250);

  // ① 合成 IME 首键（macOS 特征：key=真实字符 + keyCode 229）→ 进编辑+全选，文本零污染
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', keyCode: 229, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(150);
  const step1 = await page.evaluate(() => {
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    if (!ta) return null;
    (ta as unknown as { __imeMarker: boolean }).__imeMarker = true; // 记号：后续验证未重建
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
    return {
      value: ta.value,
      selLen: ta.selectionEnd - ta.selectionStart,
      nodeText: d.mindNodes[0]!.text,
    };
  });
  expect(step1).not.toBeNull();
  expect(step1!.value).toBe('中心主题'); // 未被 'n' 污染
  expect(step1!.selLen).toBeGreaterThan(0); // 已全选
  expect(step1!.nodeText).toBe('中心主题'); // 模型零污染（不落库不同步）

  // ② compositionstart 重入：编辑器不得销毁重建（会撕掉正在合成的 IME 会话）
  await page.evaluate(() => {
    window.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  });
  const sameEditor = await page.evaluate(() => {
    const ta = document.querySelector('body > textarea') as HTMLTextAreaElement | null;
    return !!ta && (ta as unknown as { __imeMarker?: boolean }).__imeMarker === true;
  });
  expect(sameEditor).toBe(true);

  // ③ 真实输入管线提交（CDP insertText = IME 提交路径）→ 全量替换 → Enter 落库
  const client = await page.context().newCDPSession(page);
  await client.send('Input.insertText', { text: '你好' });
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const p = await probe(page);
  expect(p.mindNodes[0]!.text).toBe('你好');
});

test('4.9 点根 = 整图选中：框在根本体、整体拖动、Delete 删整图', async ({ page }) => {
  const docId = `e2e-mind-rootsel-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
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
  await ready(page);
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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
  await ready(page);
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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
  await ready(page);
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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
  await ready(page);
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
    const d = (window as unknown as { __spinth: { __debug: Probe } }).__spinth.__debug;
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
