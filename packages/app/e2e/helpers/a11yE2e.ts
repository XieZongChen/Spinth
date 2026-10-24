/**
 * WCAG 2.2 对比度纯函数（批次 A · D7：不引第三方库）。
 *
 * 解析两种来源的颜色串：
 * - CSS 自定义属性经 `getPropertyValue` 返回原样 token（#rgb / #rrggbb）；
 * - 元素 `color` / `backgroundColor` 计算值返回 `rgb(r, g, b)` / `rgba(r, g, b, a)`
 *   （Chrome 的逗号格式）。
 * alpha 通道不支持——当前所有断言面都是不透明色，遇到带 alpha 的颜色直接
 * 抛错红测（不静默近似，也不猜合成底色）。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseColor(input: string): Rgb {
  const s = input.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
      };
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    throw new Error(`不支持的 hex 颜色：${input}`);
  }
  const c = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (c) {
    if (c[4] !== undefined && c[4] !== '1') {
      throw new Error(`不支持 alpha 颜色（断言面必须不透明）：${input}`);
    }
    return { r: Number(c[1]), g: Number(c[2]), b: Number(c[3]) };
  }
  throw new Error(`不支持的颜色格式：${input}`);
}

/** WCAG 相对亮度（sRGB，0~1） */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 对比度比值（1~21，两位小数）。向下取整：4.496 不能被进位成 4.50 越过阈值 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(parseColor(fg));
  const l2 = relativeLuminance(parseColor(bg));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
