import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { contrastRatio } from './helpers/a11yE2e';

/**
 * 对比度护栏（批次 A · A1，spec §5.3）：WCAG 2.2 AA。
 * 断言一律读取浏览器计算样式（CSSOM）——令牌配对读
 * getComputedStyle(documentElement).getPropertyValue()，元素配对读元素
 * color/backgroundColor；测试里不持有任何颜色字面量（防「改令牌 + 改常量」
 * 自洽地绿）。深色主题直接切 documentElement 的 data-theme，CSS 变量即时
 * 生效，无需 reload。
 */

interface TokenPair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

/** 语义配对全集：文字 4.5:1；焦点环/图形（accent/danger 本体）3:1 */
const TOKEN_PAIRS: TokenPair[] = [
  { name: 'text-1 / canvas', fg: '--spinth-text-1', bg: '--spinth-canvas', min: 4.5 },
  { name: 'text-2 / surface', fg: '--spinth-text-2', bg: '--spinth-surface', min: 4.5 },
  { name: 'text-3 / canvas', fg: '--spinth-text-3', bg: '--spinth-canvas', min: 4.5 },
  { name: 'text-3 / surface', fg: '--spinth-text-3', bg: '--spinth-surface', min: 4.5 },
  { name: 'text-3 / surface-hover', fg: '--spinth-text-3', bg: '--spinth-surface-hover', min: 4.5 },
  { name: 'danger-ink / canvas', fg: '--spinth-danger-ink', bg: '--spinth-canvas', min: 4.5 },
  { name: 'danger-ink / surface', fg: '--spinth-danger-ink', bg: '--spinth-surface', min: 4.5 },
  {
    name: 'danger-ink / danger-soft',
    fg: '--spinth-danger-ink',
    bg: '--spinth-danger-soft',
    min: 4.5,
  },
  { name: 'warning / warning-soft', fg: '--spinth-warning', bg: '--spinth-warning-soft', min: 4.5 },
  {
    name: 'on-accent / accent-fill',
    fg: '--spinth-on-accent',
    bg: '--spinth-accent-fill',
    min: 4.5,
  },
  {
    name: 'on-accent / accent-fill-hover',
    fg: '--spinth-on-accent',
    bg: '--spinth-accent-fill-hover',
    min: 4.5,
  },
  { name: 'accent / canvas（图形）', fg: '--spinth-accent', bg: '--spinth-canvas', min: 3 },
  { name: 'danger / surface（图形）', fg: '--spinth-danger', bg: '--spinth-surface', min: 3 },
];

async function openBoard(page: Page, docId: string): Promise<void> {
  await page.goto(`/?doc=${docId}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spinth?: { docState$: { getValue(): string } } };
      return !!w.__spinth && w.__spinth.docState$.getValue() === 'synced';
    },
    undefined,
    { timeout: 20_000 },
  );
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  // 变量切换会触发组件的 transition-colors（150ms）——等动画走完再读计算样式，
  // 否则读到插值起始值（旧主题色）假红
  await page.waitForTimeout(250);
}

async function assertTokenPairs(page: Page, theme: '浅色' | '深色'): Promise<void> {
  const values = await page.evaluate(
    (names) => {
      const cs = getComputedStyle(document.documentElement);
      const out: Record<string, string> = {};
      for (const n of names) out[n] = cs.getPropertyValue(n).trim();
      return out;
    },
    [...new Set(TOKEN_PAIRS.flatMap((p) => [p.fg, p.bg]))],
  );
  for (const pair of TOKEN_PAIRS) {
    const fg = values[pair.fg];
    const bg = values[pair.bg];
    if (!fg || !bg) throw new Error(`令牌未解析：${pair.fg}=${fg ?? ''} ${pair.bg}=${bg ?? ''}`);
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `[${theme}] ${pair.name}：${fg} on ${bg} = ${ratio}，需 ≥${pair.min}`,
    ).toBeGreaterThanOrEqual(pair.min);
  }
}

interface ElementPair {
  label: string;
  /** 前景元素 selector（取其计算 color） */
  selector: string;
  /** 背景元素 selector（取其计算 backgroundColor）；缺省用前景元素自身 */
  bgSelector?: string;
  /** 可选：多元素命中时按包含文本过滤（querySelector 无 :has-text，需遍历） */
  text?: string;
  min: number;
}

async function assertElementPairs(
  page: Page,
  theme: '浅色' | '深色',
  pairs: ElementPair[],
): Promise<void> {
  for (const pair of pairs) {
    const { fg, bg } = await page.evaluate(
      ({ selector, bgSelector, text }) => {
        let el: Element | null;
        if (text) {
          el =
            [...document.querySelectorAll(selector)].find((n) =>
              (n.textContent ?? '').includes(text),
            ) ?? null;
        } else {
          el = document.querySelector(selector);
        }
        if (!el) throw new Error(`元素不存在：${selector}${text ? `（含文本「${text}」）` : ''}`);
        const bgEl = bgSelector ? document.querySelector(bgSelector) : el;
        if (!bgEl) throw new Error(`背景元素不存在：${bgSelector}`);
        return { fg: getComputedStyle(el).color, bg: getComputedStyle(bgEl).backgroundColor };
      },
      { selector: pair.selector, bgSelector: pair.bgSelector, text: pair.text },
    );
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `[${theme}] ${pair.label}（${pair.selector}）：${fg} on ${bg} = ${ratio}，需 ≥${pair.min}`,
    ).toBeGreaterThanOrEqual(pair.min);
  }
}

test.describe('令牌对比度矩阵', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}`, async ({ page }) => {
      await openBoard(page, `e2e-a11y-token-${theme}-${Date.now()}`);
      await setTheme(page, theme);
      await assertTokenPairs(page, theme === 'light' ? '浅色' : '深色');
    });
  }
});

test.describe('实际元素对比度（真实 DOM 计算样式）', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}`, async ({ page }) => {
      const docId = `e2e-a11y-el-${theme}-${Date.now()}`;
      await openBoard(page, docId);
      await setTheme(page, theme);

      // docId 胶囊：text-ink-3 on bg-surface-hover（旧值 4.46/3.93 的实锤面）
      // 工具坞未激活按钮：text-ink-2 on 工具坞 bg-surface
      await assertElementPairs(page, theme === 'light' ? '浅色' : '深色', [
        {
          label: 'docId 胶囊 text-ink-3 / surface-hover',
          selector: '[data-spinth-doc-id]',
          min: 4.5,
        },
        {
          label: '工具坞未激活按钮 text-ink-2 / surface',
          selector: '[role="toolbar"] button[aria-pressed="false"]',
          bgSelector: '[role="toolbar"]',
          min: 4.5,
        },
      ]);

      // 建矩形（拖出后保持选中），右键形状 → widget 菜单（删除项只在选区菜单里）
      await page.keyboard.press('r');
      const canvas = page.locator('canvas').first();
      await canvas.hover({ position: { x: 500, y: 300 } });
      await page.mouse.down();
      await page.mouse.move(600, 380, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      await page.mouse.click(550, 362, { button: 'right' });
      const menu = page.locator('[data-spinth-context-menu]');
      await expect(menu).toBeVisible();
      await assertElementPairs(page, theme === 'light' ? '浅色' : '深色', [
        {
          label: '右键菜单 kbd text-ink-3 / surface-hover',
          selector: '[data-spinth-context-menu] kbd',
          min: 4.5,
        },
        {
          label: '右键菜单删除项 text-danger-ink / surface',
          selector: '[data-spinth-context-menu] button',
          text: '删除',
          bgSelector: '[data-spinth-context-menu]',
          min: 4.5,
        },
      ]);
      await page.keyboard.press('Escape');
    });
  }
});
