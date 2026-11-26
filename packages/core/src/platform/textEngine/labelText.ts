import { graphemes, type IMeasurer, type ITextStyleProps } from './measure';

/**
 * 单行标签的清洗与截断（specs/sequence-diagram §3.1）：SYMBOL 标签、FRAME 标题、
 * LIFELINE 标签共用。落点在 platform/textEngine——两个函数都依赖文字测量；
 * `common/` 按目录约定不依赖 platform / widgets（common/README.md）。
 * 纯函数，单测直测。
 */

/**
 * 落库清洗：连续空白（含换行、制表）折成一个空格 → trim → 截 maxChars 字素。
 * 字素级截断：emoji / 组合序列不拆成半个代理对。
 */
export function clampSingleLineLabel(raw: string, maxChars: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const gs = [...graphemes(collapsed)];
  return gs.length <= maxChars ? collapsed : gs.slice(0, maxChars).join('');
}

/**
 * 单行截断：超出可用宽时按字素二分找最长前缀 + '…'（前缀宽度单调）；连省略号
 * 都放下的极端窄宽返回 '…'（由调用方的最小宽度兜底）。measure 注入——canvas
 * 测宽单源在调用方组装，本函数不关心样式。textEngine 的 overflow:'hidden' 未实现
 * （measure.ts Pending，docs/07 §5），单行文字靠它在渲染前截短。
 */
export function truncateWithEllipsis(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (text.length === 0 || measure(text) <= maxWidth) return text;
  const gs = [...graphemes(text)];
  const ellipsis = '…';
  // 二分最大前缀 k：width(前 k 字素 + …) ≤ maxWidth
  let lo = 0;
  let hi = gs.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(gs.slice(0, mid).join('') + ellipsis) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return gs.slice(0, lo).join('') + ellipsis;
}

/** truncateWithEllipsis 的「样式 + 测量器」形态：测量调用固定带同一文字样式 */
export function truncateLabelToWidth(
  label: string,
  maxWidth: number,
  style: ITextStyleProps,
  measurer: IMeasurer,
): string {
  return truncateWithEllipsis(label, maxWidth, (s) => measurer.measure(s, style));
}
