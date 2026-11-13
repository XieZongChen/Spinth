/**
 * WCAG 对比度纯函数（specs/flowchart-closeout §16 护栏）：黑填充等深色底上的
 * 默认文字对比度保障、色板可达性测试共用。只收 hex 字符串（core 数据面无
 * rgb() 形态；E2E 侧 a11yE2e.ts 另有 DOM 色值解析版，两处口径同为 WCAG sRGB）。
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** WCAG 相对亮度（sRGB，0~1） */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 对比度比值（1~21，两位小数）。向下取整：4.496 不能被进位成 4.50 越过阈值 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
