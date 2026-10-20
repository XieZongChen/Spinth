/** 字段级浅层 diff——partial patch 语义：只比较 next 中出现的字段
 *  （docs/14 规则 2：diff 会随 onStateChanged$ 广播并入队合并，
 *  若为 prev 独有字段填 undefined，合并时会毒化先前入队的字段）。 */
export function deepDiff(prev: object, next: object): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const k of Object.keys(next)) {
    const a = (prev as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    if (!Object.is(a, b)) {
      diff[k] = b;
    }
  }
  return diff;
}
