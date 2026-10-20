/**
 * 主题管理（docs/12 §5）：data-theme 属性切换 :root 语义令牌实现整站换肤。
 *
 * 首绘由 index.html 的内联脚本预置 data-theme（防暗色用户白屏闪烁），
 * 本模块只在 React 侧对齐状态；持久化仅发生在用户显式切换时（initTheme 不回写）。
 * 画布底色与点阵均由 DOM 层承载（canvas 透明 + DotGrid 吃 --spinth-grid），
 * 换肤即 CSS 令牌切换，无需向 core 同步颜色。
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'spinth.theme';
/** 系统主题变更广播（无保存偏好时跟随系统；App 侧监听以同步切换按钮图标） */
export const THEME_CHANGE_EVENT = 'spinth:theme-change';

function resolveInitial(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 读取当前主题（index.html 内联脚本已预置 dataset；此处兜底补设） */
export function initTheme(): Theme {
  if (
    document.documentElement.dataset.theme !== 'dark' &&
    document.documentElement.dataset.theme !== 'light'
  ) {
    document.documentElement.dataset.theme = resolveInitial();
  }
  const theme = document.documentElement.dataset.theme as Theme;
  // 幂等重应用一次：同步 <meta theme-color>（HTML 里的静态值只在浅色时碰巧正确）
  applyTheme(theme, { persist: false });
  // 无保存偏好时跟随系统主题变化（有保存值则尊重用户选择，不自动跟随）
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== 'dark' && saved !== 'light') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const next: Theme = e.matches ? 'dark' : 'light';
      applyTheme(next, { persist: false });
      window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: next }));
    });
  }
  return theme;
}

/** 应用主题到 DOM（persist=false 时不回写 localStorage——系统跟随不是用户意图） */
export function applyTheme(theme: Theme, opts: { persist?: boolean } = {}): void {
  const persist = opts.persist ?? true;
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(STORAGE_KEY, theme);
  // 浏览器 chrome（地址栏等）色跟随画布底色令牌
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue('--spinth-canvas')
    .trim();
  if (canvas) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas);
  }
}

export function toggleTheme(theme: Theme): Theme {
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  applyTheme(next, { persist: true });
  return next;
}
