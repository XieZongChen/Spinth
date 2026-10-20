import { expect, test, type Page } from '@playwright/test';

/**
 * 剪贴板与右键菜单 E2E（docs/15 留白盘点补齐；docs/09 §1/§2）。
 *
 * 通道边界：copy/cut/paste 用合成 ClipboardEvent + DataTransfer 驱动——断言的是
 * spinth 自有的管线（快照序列化、换 id、连线引用修正、相对布局、单事务、右键
 * 菜单命令）；「物理按键 → 浏览器剪贴板事件」的映射是 Chromium 原生行为，
 * 不在本套护栏范围。
 *
 * 功能留白：仅剩鼠标落点跟踪（粘贴落点恒为视口中心）。纯文本粘贴建 TEXT
 * 已于 2026-10-09 销账（用例见文末）。
 */

interface IProbe {
  modelCount: number;
  selectedIds: string[];
  vmStates: Array<Record<string, unknown>>;
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

async function probe(page: Page): Promise<IProbe> {
  return page.evaluate(() => {
    const d = (window as unknown as { __spinth: { __debug: IProbe } }).__spinth.__debug;
    return { modelCount: d.modelCount, selectedIds: [...d.selectedIds], vmStates: d.vmStates };
  });
}

interface RectSnap {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 按世界 x 排序的矩形快照（vmStates 过滤 RECT） */
function rectsOf(p: IProbe): RectSnap[] {
  return p.vmStates
    .filter((s) => s.type === 'SHAPE')
    .map((s) => ({
      id: String(s.id),
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
    }))
    .sort((a, b) => a.x - b.x);
}

/** 建两个错位的矩形并框选（覆盖 R 工具创建即回 cursor 的口径） */
async function createAndSelectTwoRects(page: Page): Promise<RectSnap[]> {
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(480, 360, { steps: 3 });
  await page.mouse.up();
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(680, 460, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.mouse.move(360, 260);
  await page.mouse.down();
  await page.mouse.move(700, 480, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const p = await probe(page);
  expect(p.selectedIds).toHaveLength(2);
  return rectsOf(p);
}

/** 合成剪贴板事件（DataTransfer 直通——spinth 管线断言用） */
async function fireClipboard(
  page: Page,
  kind: 'copy' | 'cut' | 'paste',
  plain?: string,
): Promise<string> {
  return page.evaluate(
    ({ kind, plain }) => {
      const dt = new DataTransfer();
      if (plain !== undefined) dt.setData('text/plain', plain);
      document.dispatchEvent(
        new ClipboardEvent(kind, { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      return dt.getData('text/plain');
    },
    { kind, plain },
  );
}

test('复制→粘贴：快照结构、换 id、相对布局保持、落视口中心、单事务撤销', async ({ page }) => {
  const docId = `e2e-clip-copy-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  const old = await createAndSelectTwoRects(page);

  // 复制：快照 = 选中集（id 对应、几何完整）
  const plain = await fireClipboard(page, 'copy');
  const snaps = JSON.parse(plain) as Array<{
    data: { id: string; type: string; x: number; y: number };
  }>;
  expect(snaps).toHaveLength(2);
  expect(snaps.map((s) => s.data.id).sort()).toEqual([...old.map((r) => r.id)].sort());

  // 粘贴：数量 +2、全部换新 id、相对布局保持、锚点落到视口中心（pasteTarget）
  await fireClipboard(page, 'paste', plain);
  await page.waitForTimeout(200);
  const after = await probe(page);
  expect(after.modelCount).toBe(4);
  const now = rectsOf(after);
  expect(now).toHaveLength(4);
  const newIds = after.selectedIds; // 粘贴件自动重选
  expect(newIds).toHaveLength(2);
  expect(newIds.every((id) => !old.some((r) => r.id === id))).toBe(true);
  const oldDx = old[1]!.x - old[0]!.x;
  const newDx = now.filter((r) => newIds.includes(r.id)).sort((a, b) => a.x - b.x);
  const pair = now.filter((r) => newIds.includes(r.id)).sort((a, b) => a.x - b.x);
  expect(pair[1]!.x - pair[0]!.x).toBeCloseTo(oldDx, 0);
  // 同一整体位移（相对布局保持）
  const dx = pair[0]!.x - old[0]!.x;
  const dy = pair[0]!.y - old[0]!.y;
  expect(Math.abs(pair[1]!.x - old[1]!.x - dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(pair[1]!.y - old[1]!.y - dy)).toBeLessThanOrEqual(2);
  expect(dx === 0 && dy === 0).toBe(false); // 确实搬到了视口中心而非原地
  void newDx;

  // 单事务：一次 undo 撤销整批粘贴
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  expect((await probe(page)).modelCount).toBe(2);
});

test('剪切：原控件移除 + 粘贴以新 id 恢复', async ({ page }) => {
  const docId = `e2e-clip-cut-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.mouse.click(460, 340); // 选中
  await page.waitForTimeout(150);
  const before = await probe(page);
  expect(before.selectedIds).toHaveLength(1);
  const oldId = before.selectedIds[0]!;

  const cutPlain = await fireClipboard(page, 'cut'); // dt 回读（handler 写入的指纹）
  await page.waitForTimeout(150);
  const cut = await probe(page);
  expect(cut.modelCount).toBe(0); // 原件移除
  expect(cut.selectedIds).toHaveLength(0);

  await fireClipboard(page, 'paste', cutPlain); // 1.12：粘贴须携带同源 plain（指纹校验）
  await page.waitForTimeout(150);
  const after = await probe(page);
  expect(after.modelCount).toBe(1);
  expect(after.selectedIds[0]).not.toBe(oldId); // 换 id 恢复
});

test('连线引用修正：同批复制的矩形 → 粘贴线指向新 id；批外引用解绑', async ({ page }) => {
  const docId = `e2e-clip-line-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 3 });
  await page.mouse.up();
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(820, 380, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  // 连线 A→B
  await page.getByRole('button', { name: /连线/ }).click();
  await page.mouse.move(460, 340);
  await page.mouse.down();
  await page.mouse.move(760, 340, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  // 框选三件
  await page.getByRole('button', { name: /选择/ }).click();
  await page.mouse.move(380, 260);
  await page.mouse.down();
  await page.mouse.move(840, 420, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const before = await probe(page);
  expect(before.selectedIds).toHaveLength(3);
  const oldRectIds = before.vmStates.filter((s) => s.type === 'SHAPE').map((s) => String(s.id));
  const oldLine = before.vmStates.find((s) => s.type === 'LINE') as {
    id: string;
    startNodeId: string;
    endNodeId: string;
  };

  const cpPlain = await fireClipboard(page, 'copy');
  await fireClipboard(page, 'paste', cpPlain); // 1.12：同源 plain 过指纹
  await page.waitForTimeout(200);
  const after = await probe(page);
  expect(after.modelCount).toBe(6);
  const newRectIds = after.vmStates
    .filter((s) => s.type === 'SHAPE')
    .map((s) => String(s.id))
    .filter((id) => !oldRectIds.includes(id));
  expect(newRectIds).toHaveLength(2);
  const lines = after.vmStates.filter((s) => s.type === 'LINE') as Array<{
    id: string;
    startNodeId: string;
    endNodeId: string;
  }>;
  expect(lines).toHaveLength(2);
  const pastedLine = lines.find((l) => l.id !== oldLine.id)!;
  // 同批修正：指向粘贴后的新矩形；原线引用原矩形不动
  expect(newRectIds).toContain(pastedLine.startNodeId);
  expect(newRectIds).toContain(pastedLine.endNodeId);
  expect(pastedLine.startNodeId).not.toBe(pastedLine.endNodeId);
  expect(oldLine.startNodeId).toBe(oldRectIds[0]);
});

test('右键菜单：元素菜单就地选中、粘贴守卫（无缓冲禁用）、复制→粘贴生效、Escape 关闭、删除', async ({
  page,
}) => {
  const docId = `e2e-ctx-menu-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);
  await page.getByRole('button', { name: /矩形/ }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const menu = page.locator('[data-spinth-context-menu]');

  // 右键元素：就地选中 + 元素菜单（未复制过 → 粘贴项禁用的守卫口径）
  await page.mouse.click(460, 340, { button: 'right' });
  await expect(menu).toBeVisible();
  expect(await probe(page).then((p) => p.selectedIds)).toHaveLength(1);
  await expect(menu.getByRole('button', { name: '粘贴' })).toBeDisabled();

  // 复制 → 菜单关 → 空白右键出画布菜单 → 粘贴已启用 → 点击 = pasteAtCenter
  await menu.getByRole('button', { name: '复制' }).click();
  await expect(menu).toHaveCount(0);
  await page.mouse.click(900, 500, { button: 'right' }); // 空白处
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '粘贴' })).toBeEnabled();
  await menu.getByRole('button', { name: '粘贴' }).click();
  await page.waitForTimeout(200);
  expect((await probe(page)).modelCount).toBe(2); // 粘贴件落视口中心

  // Escape 关闭
  await page.mouse.click(460, 340, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // 右键删除：菜单删除按钮走 removeSelected
  await page.mouse.click(460, 340, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '删除' }).click();
  await page.waitForTimeout(150);
  expect((await probe(page)).modelCount).toBe(1); // 两件删一件（右键就地单选语义）
});

test('纯文本粘贴生成 TEXT（docs/09 留白销账）：转义换行落库 + 选中 + undo 删', async ({ page }) => {
  const docId = `e2e-paste-text-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 非 JSON 纯文本（含标签字符 + 换行）→ 建 TEXT
  await fireClipboard(page, 'paste', '第一行<b>粗</b>\n第二行');
  await expect.poll(async () => (await probe(page)).modelCount, { timeout: 5_000 }).toBe(1);
  const st = await probe(page);
  const text = String(st.vmStates.find((v) => String(v.type) === 'TEXT')?.text ?? '');
  expect(text).toContain('第一行&lt;b&gt;粗&lt;/b&gt;<br>第二行'); // 转义 + \n→<br>
  expect(st.selectedIds).toHaveLength(1); // 粘贴后选中

  // undo 一步删除（单事务）
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await probe(page)).modelCount, { timeout: 5_000 }).toBe(0);
});

test('P0-1 输入态守卫：编辑器内 Cmd+A/Cmd+X 是文字剪切——不删控件、退出落库完整', async ({
  page,
}) => {
  const docId = `e2e-clip-guard-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // TEXT 工具创建即进编辑（textEdit.spec 同款）
  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 600, y: 300 } });
  const editor = page.locator('#spinth-text-layer [contenteditable="true"]');
  await expect(editor).toHaveCSS('opacity', '1');
  await page.keyboard.insertText('HELLO');
  await page.waitForTimeout(400); // 34ms 节流落库沉降

  // 编辑器内全选 + 剪切：原生文字操作。修复前 cut 事件被 document 级
  // handleCopy 劫走（无输入态守卫）→ removeByIds 删掉整件（modelCount 0）
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+x');
  await page.waitForTimeout(300);
  expect((await probe(page)).modelCount).toBe(1);

  // headless 下原生剪贴板写盘不保证——重选全量输入兜底后退出，
  // 关键断言：件不删 + 内容完整落库（delete-widget 只对真空文本生效）
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('HELLO');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const st = await probe(page);
  expect(st.modelCount).toBe(1);
  expect(String(st.vmStates.find((v) => String(v.type) === 'TEXT')?.text ?? '')).toContain('HELLO');
});

test('1.12 内部 buffer 随系统剪贴板覆盖失效：复制 A → 外部 plain=B → 粘出 B（不粘 A）', async ({
  page,
}) => {
  const docId = `e2e-buf-stale-${Date.now()}`;
  await page.goto(`/?doc=${docId}`);
  await ready(page);

  // 画布复制 A（矩形）
  await page.keyboard.press('r');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(460, 340, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const plainA = await fireClipboard(page, 'copy');
  expect(plainA).toContain('"type":"SHAPE"');
  await expect.poll(async () => (await probe(page)).modelCount, { timeout: 5_000 }).toBe(1);

  // 外部来源覆盖剪贴板（模拟切出应用复制了文本 B）
  await fireClipboard(page, 'paste', '外部文本B');
  await expect.poll(async () => (await probe(page)).modelCount, { timeout: 5_000 }).toBe(2);
  const p1 = await probe(page);
  const types = p1.vmStates.map((v) => String(v.type));
  expect(types).toContain('TEXT'); // 粘出 B（纯文本建 TEXT）——修复前粘出 A 的矩形副本
  expect(types).not.toContain('LINE');
  expect(String(p1.vmStates.find((v) => v.type === 'TEXT')?.text ?? '')).toContain('外部文本B');

  // 画布内自复制自粘贴不受指纹影响（buffer 与系统剪贴板一致 → 快照通道优先）
  await page.mouse.click(430, 320); // 重新选中矩形（粘贴后选区在 TEXT 上）
  await page.waitForTimeout(200);
  expect((await probe(page)).selectedIds).toHaveLength(1);
  const plainA2 = await fireClipboard(page, 'copy');
  await fireClipboard(page, 'paste', plainA2);
  await expect.poll(async () => (await probe(page)).modelCount, { timeout: 5_000 }).toBe(3);
});
