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
  // 工具主题色对 soft 底（批次 B W2）：TONE_ACTIVE 八组——flyout 选中项含
  // 纯文本（字号/线宽数字），统一按文字 4.5:1 定值（1.4.3 与 1.4.11 双合规）；
  // 'ink' 组即 TONE_ACTIVE.ink（surface-active 底）。修前实测（浅色本体色）：
  // hand 2.42 / shape 2.93 / text 3.80 / line 2.31 / pen 2.67 / sticky 1.90 /
  // mind 3.06——七组全红，故 soft 底前景一律换 -ink（本体色留给画布图形）
  {
    name: '工具 ink 组 text-1 / surface-active',
    fg: '--spinth-text-1',
    bg: '--spinth-surface-active',
    min: 4.5,
  },
  {
    name: 'tool-hand-ink / hand-soft',
    fg: '--spinth-tool-hand-ink',
    bg: '--spinth-tool-hand-soft',
    min: 4.5,
  },
  {
    name: 'tool-shape-ink / shape-soft',
    fg: '--spinth-tool-shape-ink',
    bg: '--spinth-tool-shape-soft',
    min: 4.5,
  },
  {
    name: 'tool-text-ink / text-soft',
    fg: '--spinth-tool-text-ink',
    bg: '--spinth-tool-text-soft',
    min: 4.5,
  },
  {
    name: 'tool-line-ink / line-soft',
    fg: '--spinth-tool-line-ink',
    bg: '--spinth-tool-line-soft',
    min: 4.5,
  },
  {
    name: 'tool-pen-ink / pen-soft',
    fg: '--spinth-tool-pen-ink',
    bg: '--spinth-tool-pen-soft',
    min: 4.5,
  },
  {
    name: 'tool-sticky-ink / sticky-soft',
    fg: '--spinth-tool-sticky-ink',
    bg: '--spinth-tool-sticky-soft',
    min: 4.5,
  },
  {
    name: 'tool-mind-ink / mind-soft',
    fg: '--spinth-tool-mind-ink',
    bg: '--spinth-tool-mind-soft',
    min: 4.5,
  },
];

/** 对比度断言只关心**终值**：全局禁用过渡/动画，读计算样式即得终态。此前靠
 *  固定 250ms 等待是结构性脆弱——复审实测 1s transition 在本环境约 700ms 才
 *  起跳，等待窗口内会读到「浅色起始帧 + 深色底」混色（dark 2.31 假红）或
 *  半透明插值（alpha 断言面直接抛错） */
async function disableTransitions(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
}

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
  await disableTransitions(page);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  // transition 已禁用（openBoard/disableTransitions）——切主题即时到终值；
  // 50ms 只让变量重算落帧，不再等动画
  await page.waitForTimeout(50);
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
      // W2 元素面（批次 B）：激活工具钮与 flyout 选中项的前景即 TONE_ACTIVE 的
      // text-* 类——令牌对只能证明色值，元素面证明类名真的接上了
      const flyout = page.locator('[data-spinth-tool-flyout]');
      await expect(flyout).toBeVisible();
      // transition 已全局禁用（openBoard 注入）——即时读终值
      await assertElementPairs(page, theme === 'light' ? '浅色' : '深色', [
        {
          label: '激活工具按钮（工具主题色 / soft 底）',
          selector: '[data-spinth-toolbar] button[aria-pressed="true"]',
          min: 4.5,
        },
        {
          label: 'flyout 选中项（工具主题色 / soft 底）',
          selector: '[data-spinth-tool-flyout] [role="menuitemradio"][aria-checked="true"]',
          min: 4.5,
        },
      ]);
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

test.describe('错误态（批次 A · A2：IndexedDB 不可用 → ErrorState）', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}：role=alert + 焦点落标题 + 390 无横滚 + 对比度`, async ({ page }) => {
      // D6：注入生产路径真实失败源——indexedDB getter 抛错 → openDb reject →
      // composeBoard reject → Board catch → initError；不加生产测试钩子
      await page.addInitScript(() => {
        Object.defineProperty(window, 'indexedDB', {
          configurable: true,
          get(): never {
            throw new DOMException('IndexedDB blocked (e2e)', 'InvalidStateError');
          },
        });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/?doc=e2e-a11y-err-${theme}-${Date.now()}`);
      await disableTransitions(page);

      const state = page.locator('[data-spinth-error-state]');
      await expect(state).toBeVisible({ timeout: 20_000 });
      await expect(state).toHaveAttribute('role', 'alert');
      // 标题挂载即聚焦（D5：读屏先读标题）
      await expect(page.getByRole('heading', { name: '画布初始化失败' })).toBeFocused();
      await expect(page.locator('[data-spinth-error-detail]')).toContainText('IndexedDB blocked');
      await expect(page.getByText('正在恢复画布…')).toHaveCount(0);

      // 390×844：错误卡四边在视口内 + 文档不横向滚动
      const box = await state.boundingBox();
      expect(box, 'error-state boundingBox').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-0.5);
      expect(box!.y).toBeGreaterThanOrEqual(-0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );

      // 颜色断言（两主题各跑；深色切 data-theme 即时生效，DOM 计算样式）
      await setTheme(page, theme);
      await assertElementPairs(page, theme === 'light' ? '浅色' : '深色', [
        {
          label: '错误态标题 text-danger-ink / canvas',
          selector: '[data-spinth-error-heading]',
          bgSelector: '[data-spinth-error-state]',
          min: 4.5,
        },
        {
          label: '错误态主按钮 text-on-accent / accent-fill',
          selector: '[data-spinth-error-state] button',
          min: 4.5,
        },
      ]);
    });
  }
});
