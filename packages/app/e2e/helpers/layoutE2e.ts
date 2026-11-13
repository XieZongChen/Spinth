import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 390px 布局矩阵公共助手（批次 A · A3，spec §7.2）。
 * 断言一律用 data-spinth-* 稳定标记定位，不用 Tailwind class 选择器；
 * 坐标从 canvas boundingBox / __spinth 探针推导，不手写视口常量。
 */

export const MOBILE = { width: 390, height: 844 } as const;

/** 320×640：WCAG 1.4.10 Reflow 断言面（specs/a11y-closeout §7.2） */
export const COMPACT = { width: 320, height: 640 } as const;

/** 720×450：1440×900 页面缩放 200% 的等价视口（WCAG 1.4.4 代理，§3.2） */
export const ZOOM_200 = { width: 720, height: 450 } as const;

/** 顶栏高度（h-11，M1 会实测断言） */
export const HEADER_H = 44;

/** 两帧 rAF：样式注入 / 视口变化后等布局与绘制收敛 */
export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** 打开画布并等几何稳定：synced + 字体就绪 + 两帧 rAF（布局/字体抖动收敛） */
export async function openBoard(page: Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await twoFrames(page);
}

/**
 * 断言 locator 四边在视口（或给定的 pad 内），容差 0.5px（亚像素取整）。
 * boundingBox 为 null 直接抛带 selector 的错（元素未渲染/不可见是硬失败）。
 */
export async function boxWithin(
  locator: Locator,
  viewport: { width: number; height: number },
  pad = 0,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`boundingBox 为 null（未渲染/不可见）：${locator}`);
  const name = String(locator);
  expect(box.x, `${name} 左缘越界（x=${box.x} < ${pad}）`).toBeGreaterThanOrEqual(pad - 0.5);
  expect(box.y, `${name} 顶边越界（y=${box.y} < ${pad}）`).toBeGreaterThanOrEqual(pad - 0.5);
  expect(
    box.x + box.width,
    `${name} 右缘越界（${box.x + box.width} > ${viewport.width - pad}）`,
  ).toBeLessThanOrEqual(viewport.width - pad + 0.5);
  expect(
    box.y + box.height,
    `${name} 底边越界（${box.y + box.height} > ${viewport.height - pad}）`,
  ).toBeLessThanOrEqual(viewport.height - pad + 0.5);
  return box;
}

/** 文档不横向滚动（documentElement 与 body 都不超内宽） */
export async function noDocHScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => ({
    de: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(over.de, `documentElement 横向溢出 ${over.de}px`).toBeLessThanOrEqual(0);
  expect(over.body, `body 横向溢出 ${over.body}px`).toBeLessThanOrEqual(0);
}

/** 矩形相交判定（工具坞 vs 缩放胶囊防重叠） */
export function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** WCAG 2.2 AA 2.5.8 触控目标下限 24×24（不要求 44——非本批口径） */
export async function minTarget(locator: Locator, min = 24): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`boundingBox 为 null：${locator}`);
  const name = String(locator);
  expect(box.width, `${name} 宽 ${box.width} < ${min}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box.height, `${name} 高 ${box.height} < ${min}`).toBeGreaterThanOrEqual(min - 0.5);
}

/**
 * 操作栏内容零溢出（specs/flowchart-closeout §12.4 返工）：容器只查四边不够
 * ——flex 单行下子项会挤出容器与视口（实测 390 下 scrollWidth 459 > 374，
 * 导出/删除钮整颗在视口外）。断言：scrollWidth ≤ clientWidth + 1（换行收纳
 * 生效、无隐性横滚）且每个直接子元素的右缘/下缘都在容器内。
 */
export async function barNoOverflow(
  bar: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  const m = await bar.evaluate((el: HTMLElement) => ({
    cw: el.clientWidth,
    sw: el.scrollWidth,
    kids: [...el.children].map((k) => {
      const r = (k as HTMLElement).getBoundingClientRect();
      return { right: r.right, bottom: r.bottom };
    }),
  }));
  expect(m.sw, `操作栏横向溢出（scrollWidth ${m.sw} > clientWidth ${m.cw}）`).toBeLessThanOrEqual(
    m.cw + 1,
  );
  for (const [i, k] of m.kids.entries()) {
    expect(
      k.right,
      `操作栏第 ${i} 个子元素右缘 ${k.right} 超出视口 ${viewport.width}`,
    ).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(
      k.bottom,
      `操作栏第 ${i} 个子元素底缘 ${k.bottom} 超出视口 ${viewport.height}`,
    ).toBeLessThanOrEqual(viewport.height + 0.5);
  }
}

/**
 * 注入安全区 inset（specs/a11y-closeout §7.4）：env() 不可伪造，但 app 壳把
 * env 包在 --spinth-safe-* 自定义属性里——覆盖这层变量即可在 CI 断言
 * 安全区行为（S1 用例的注入路径，不是只断言默认 0）。
 */
export async function applySafeArea(
  page: Page,
  inset: Partial<{ top: number; right: number; bottom: number; left: number }>,
): Promise<void> {
  const v = { top: 0, right: 0, bottom: 0, left: 0, ...inset };
  await page.addStyleTag({
    content: `:root {
      --spinth-safe-top: ${v.top}px !important;
      --spinth-safe-right: ${v.right}px !important;
      --spinth-safe-bottom: ${v.bottom}px !important;
      --spinth-safe-left: ${v.left}px !important;
    }`,
  });
}

/**
 * 断言叶子文本容器不裁字/不自滚动（scroll ≤ client + 1px 容差）。
 * 只用于「不应滚动」的面（顶栏标签/菜单项/面板行）；显式滚动容器
 * （工具坞/面板本体）排除在外，否则误红。
 */
export async function assertNoTextClip(locator: Locator): Promise<void> {
  const m = await locator.evaluate((n) => ({
    sw: n.scrollWidth,
    cw: n.clientWidth,
    sh: n.scrollHeight,
    ch: n.clientHeight,
  }));
  const name = String(locator);
  expect(m.sw, `${name} 横向裁字（scrollWidth ${m.sw} > clientWidth ${m.cw}）`).toBeLessThanOrEqual(
    m.cw + 1,
  );
  expect(
    m.sh,
    `${name} 纵向裁字（scrollHeight ${m.sh} > clientHeight ${m.ch}）`,
  ).toBeLessThanOrEqual(m.ch + 1);
}

/**
 * 注入根字号（WCAG 1.4.4 纯文本缩放代理，specs/rem-typography §6.2）：覆盖 html
 * font-size 后等两帧布局稳定。返回撤销函数——同一用例内恢复原根字号继续断言。
 * 注入只证明 rem 链路生效；浏览器「默认字号」设置路径另走人工验收（规格 §6.4）。
 */
export async function setRootFontSize(page: Page, px: number): Promise<() => Promise<void>> {
  const tag = await page.addStyleTag({ content: `html { font-size: ${px}px !important; }` });
  await twoFrames(page);
  return async () => {
    await tag.evaluate((n) => (n as HTMLStyleElement).remove());
    await twoFrames(page);
  };
}

/**
 * 断言行盒按 DOM 顺序互不重叠（后项 top ≥ 前项 bottom − 0.5px）——放大文本塞进定高行
 * 时行盒溢出、相邻行压叠的回归面。少于 2 行直接红：选择器失配不能假绿。
 */
export async function assertRowsDisjoint(rows: Locator): Promise<void> {
  const boxes = await rows.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }),
  );
  const name = String(rows);
  expect(boxes.length, `${name} 行数 ${boxes.length} < 2（选择器失配？）`).toBeGreaterThanOrEqual(
    2,
  );
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1]!;
    const cur = boxes[i]!;
    expect(
      cur.top,
      `${name} 第 ${i} 行压叠上一行（top ${cur.top} < 上一行 bottom ${prev.bottom}）`,
    ).toBeGreaterThanOrEqual(prev.bottom - 0.5);
  }
}
