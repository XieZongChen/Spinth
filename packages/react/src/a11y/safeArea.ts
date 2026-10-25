/**
 * 安全区 inset 读取（specs/a11y-closeout §7.4）：经 index.css 的
 * --spinth-safe-* 自定义属性包一层 env()——E2E 无法伪造 env()，但可以
 * page.addStyleTag 覆盖这层变量，从而在 CI 里真实断言安全区行为。
 * 任何解析失败一律 0：默认桌面 0 时布局与无安全区完全一致（M1 护栏），
 * 「只在 env 有值时才正确」的写法会 CI 绿、真机红。
 */
export interface ISafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** px 字符串 → 数值；空/非 px 单位/非法 → 0（纯函数，单测面） */
export function parseInsetPx(v: string | null | undefined): number {
  if (!v) return 0;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? Number(m[1]!) : 0;
}

const ZERO: ISafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 读根元素四向安全区（无 DOM 环境/未定义变量 → 全 0） */
export function readSafeInsets(): ISafeInsets {
  if (typeof document === 'undefined') return ZERO;
  const cs = getComputedStyle(document.documentElement);
  return {
    top: parseInsetPx(cs.getPropertyValue('--spinth-safe-top')),
    right: parseInsetPx(cs.getPropertyValue('--spinth-safe-right')),
    bottom: parseInsetPx(cs.getPropertyValue('--spinth-safe-bottom')),
    left: parseInsetPx(cs.getPropertyValue('--spinth-safe-left')),
  };
}
