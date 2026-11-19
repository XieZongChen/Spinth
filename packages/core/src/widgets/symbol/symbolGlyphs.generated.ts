// 本文件由 scripts/build-symbol-glyphs.mjs 自动生成——勿手改；改动 assets 后
// 跑 `pnpm symbols:build` 重新生成（`pnpm symbols:check` 校验一致性）。
// currentColor 已归一为纯白 #ffffff——PIXI tint 是逐通道乘法，白是唯一能
// 让 tint 呈现目标色的乘法基色（specs/symbol-widget §4.4 及其勘误记录）。
export const SYMBOL_GLYPHS = {
  'net-router': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="13"/><line x1="24" y1="24" x2="24" y2="16"/><line x1="24" y1="24" x2="24" y2="32"/><line x1="24" y1="24" x2="16" y2="24"/><line x1="24" y1="24" x2="32" y2="24"/><polyline points="21.2,18.8 24,15.4 26.8,18.8"/><polyline points="21.2,29.2 24,32.6 26.8,29.2"/><polyline points="18.8,21.2 15.4,24 18.8,26.8"/><polyline points="29.2,21.2 32.6,24 29.2,26.8"/></g></svg>',
} as const;

/** 符号种类 id（specs/symbol-widget §4.1）：新增符号 = 加 SVG + 重跑生成脚本 */
export type SymbolKind = keyof typeof SYMBOL_GLYPHS;

export const SYMBOL_KINDS: readonly SymbolKind[] = Object.keys(SYMBOL_GLYPHS) as readonly SymbolKind[];
