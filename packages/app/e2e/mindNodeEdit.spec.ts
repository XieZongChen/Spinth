/** 脑图节点编辑会话 E2E：编辑器对齐/点两次进编辑/按下选中/IME 首键 */
import { expect, test } from '@playwright/test';
import { waitForSynced } from './helpers/boardE2e';
import { probe } from './helpers/mindProbeE2e';

test('脑图节点编辑器与画布节点逐像素对齐（页面坐标 = 画布局部 + 画布偏移）', async ({ page }) => {
  const docId = `e2e-mind-editor-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);

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

test('子节点：点一次出蓝框（框在本体）、再点一次进编辑（曾经两条都不通）', async ({ page }) => {
  const docId = `e2e-mind-child-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
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
  await waitForSynced(page);
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

test('中文输入法首键竞态：合成首键（keyCode 229）不污染文本，落字全量替换', async ({ page }) => {
  // 回归（2026-09-26 读码揪出）：macOS/Chrome 的合成首键 keydown 携带真实字符
  // 但 keyCode=229、isComposing 尚 false（先于 compositionstart）——旧代码把它
  // 当普通字符 replaceWith：拼音首字母立即落库并同步给协作者，取消合成原文被毁
  const docId = `e2e-mind-ime-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await waitForSynced(page);
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
