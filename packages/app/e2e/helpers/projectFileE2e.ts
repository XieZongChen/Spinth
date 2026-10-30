import { expect, type Page } from '@playwright/test';

/**
 * 项目文件 E2E 公共助手：
 * 探针轮询对导航间隙做空安全；导入导航先等 URL 提交再等 synced。
 */

/** 1×1 PNG（image.spec 同款） */
export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export type Debug = {
  modelCount: number;
  vmStates: Array<Record<string, unknown>>;
  /** 纹理缓存探针（同图一份纹理断言；idle=true 为保活空闲条目）；导航间隙由调用方判空 */
  imageTextures: {
    entries: Array<{ key: string; refs: number; uid: number; idle: boolean }>;
    pending: number;
    keepAlive: { count: number; bytes: number };
  };
  /** 资产 objectURL 租约（id → 计数） */
  assetLeases: Record<string, number>;
};

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

/** 页面调试快照；导航间隙（__spinth 未挂/换页中）返回 null——poll 兜底重试 */
export async function debug(page: Page): Promise<Debug | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __spinth?: { __debug: Debug } };
    if (!w.__spinth) return null;
    return {
      modelCount: w.__spinth.__debug.modelCount,
      vmStates: w.__spinth.__debug.vmStates,
      imageTextures: w.__spinth.__debug.imageTextures,
      assetLeases: w.__spinth.__debug.assetLeases,
    };
  });
}

/** modelCount 轮询值（null → -1，让 expect.poll 继续重试直到新页面就绪） */
export async function modelCount(page: Page): Promise<number> {
  return (await debug(page))?.modelCount ?? -1;
}

/** 图片真渲染轮询（hasSprite） */
export async function anyImageSprite(page: Page): Promise<boolean> {
  return (
    (await debug(page))?.vmStates.some((v) => v.type === 'IMAGE' && v.hasSprite === true) ?? false
  );
}

/** 当前画布 widget 类型集合（排序后比对；导航间隙返回空表由 poll 重试） */
export async function widgetTypes(page: Page): Promise<string[]> {
  const d = await debug(page);
  return (d?.vmStates.map((v) => String(v.type)) ?? []).sort();
}

/** TEXT 控件文本内容（textEdit.spec 同源探针；未就绪返回空串由 poll 重试） */
export async function textContent(page: Page): Promise<string> {
  const d = await debug(page);
  return String(d?.vmStates.find((v) => v.type === 'TEXT')?.text ?? '');
}

/** 把首个 IMAGE 的 src 改为外链 URL（P1-2 外链 warning 用例的现场注入） */
export async function setFirstImageExternal(page: Page, url: string): Promise<void> {
  await page.evaluate((u) => {
    const w = window as unknown as {
      __spinth: {
        engine: {
          yWidgets: {
            toArray(): Array<{ get(k: string): unknown; set(k: string, v: string): void }>;
          };
        };
      };
    };
    const img = w.__spinth.engine.yWidgets.toArray().find((m) => m.get('type') === 'IMAGE');
    img?.set('src', u);
  }, url);
}

export async function persisted(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __spinth: { engine: { persistState$: { getValue(): string } } };
            }
          ).__spinth.engine.persistState$.getValue(),
        ),
      { timeout: 5_000 },
    )
    .toBe('saved');
}

/** 尾部加盐的唯一 PNG bytes（防跨 doc 内容寻址共享） */
export async function uniquePngBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate((base) => {
    const bin = atob(base);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, Date.now() % 0xffffffff);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, PNG_B64);
  return Buffer.from(b64, 'base64');
}

/** 页面内粘贴 PNG（image.spec 同款合成 ClipboardEvent） */
export async function pastePng(page: Page, bytes: Buffer): Promise<void> {
  await page.evaluate((u8) => {
    const dt = new DataTransfer();
    dt.items.add(new File([u8], 'x.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, new Uint8Array(bytes));
}

/** 画布中央拖出一个控件（快捷键 + 鼠标拖拽；页坐标 +44 顶栏） */
export async function dragWidget(page: Page, key: string, dx = 120): Promise<void> {
  await page.keyboard.press(key);
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(200 + dx, 300 + 90, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** 放置一个带内容的 TEXT（t + 单击进编辑 + 输入 + Esc 落库，textEdit.spec 同款） */
export async function placeText(page: Page, content: string): Promise<void> {
  await page.keyboard.press('t');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 400, y: 260 } });
  await page.keyboard.type(content);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

/** 菜单导出：返回下载文件名与保存路径 */
export async function exportViaMenu(page: Page): Promise<{ fileName: string; path: string }> {
  await page.getByRole('button', { name: '项目' }).click();
  await expect(page.locator('[data-spinth-project-menu-panel]')).toBeVisible();
  const dlPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('menuitem', { name: /导出项目/ }).click();
  const download = await dlPromise;
  const fileName = download.suggestedFilename();
  const path = `/tmp/${fileName}`;
  await download.saveAs(path);
  return { fileName, path };
}

export async function importViaInput(page: Page, path: string): Promise<void> {
  await page.setInputFiles('input[data-spinth-project-import]', path);
}

/**
 * 导入成功后的导航等待：必须先等 URL 真正切走（location.assign 提交），
 * 再等新页 synced——只等 synced 会在旧页上立刻通过，随后的 goto/断言与
 * 在途导航相撞（net::ERR_ABORTED，偶红源）。返回新 docId。
 */
export async function waitForImportedNav(page: Page, previousDocId: string): Promise<string> {
  await page.waitForURL(
    (url) => {
      const doc = url.searchParams.get('doc');
      return !!doc && doc !== previousDocId;
    },
    { timeout: 20_000 },
  );
  const docId = new URL(page.url()).searchParams.get('doc') ?? '';
  expect(docId).not.toBe('');
  await ready(page);
  return docId;
}

/** e2e 卫生：清理本例产生的文档库 */
export async function cleanupDoc(page: Page, docId: string): Promise<void> {
  await page.evaluate((id) => {
    void indexedDB.deleteDatabase(`spinth-doc:${id}`);
  }, docId);
}
