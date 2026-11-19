// 本文件由 scripts/build-symbol-glyphs.mjs 自动生成——勿手改；改动 assets 后
// 跑 `pnpm symbols:build` 重新生成（`pnpm symbols:check` 校验一致性）。
// currentColor 已归一为纯白 #ffffff——PIXI tint 是逐通道乘法，白是唯一能
// 让 tint 呈现目标色的乘法基色（specs/symbol-widget §4.4 及其勘误记录）。
export const SYMBOL_GLYPHS = {
  'net-database': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14a12 5 0 1 0 24 0a12 5 0 1 0 -24 0"/><path d="M12 14v20"/><path d="M36 14v20"/><path d="M12 34a12 5 0 0 0 24 0"/><path d="M12 23a12 5 0 0 0 24 0"/></g></svg>',
  'net-router': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="13"/><path d="M24 19.5V15.8M21.5 18.4L24 15.2L26.5 18.4"/><path d="M24 28.5V32.2M21.5 29.6L24 32.8L26.5 29.6"/><path d="M19.5 24H15.8M18.4 21.5L15.2 24L18.4 26.5"/><path d="M28.5 24H32.2M29.6 21.5L32.8 24L29.6 26.5"/></g></svg>',
} as const;

/** 符号种类 id（specs/symbol-widget §4.1）：新增符号 = 加 SVG + 重跑生成脚本 */
export type SymbolKind = keyof typeof SYMBOL_GLYPHS;

export const SYMBOL_KINDS: readonly SymbolKind[] = Object.keys(SYMBOL_GLYPHS) as readonly SymbolKind[];
