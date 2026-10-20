/**
 * HTML → 纯文本降级（自 widgets/text/textVm.ts 收单源，2026-10-06 编辑会话批 1：
 * EditingService 判空文本与渲染降级共用——platform 层不得反向 import widgets）。
 */

/** 解析缓存（docs/16 ⑧，docs/07 §9 债 1）：几何变化触发的重渲染 text 不变，
 *  DOMParser 解析重复率极高——LRU 上限 500。 */
const PLAIN_CACHE_MAX = 500;
const plainCache = new Map<string, string>();

/** Phase 2 文本模型为段落文本，样式 marks 后续接入（docs/17 §7 范围红线） */
export function htmlToPlainText(html: string): string {
  const hit = plainCache.get(html);
  if (hit !== undefined) return hit;
  const out =
    typeof DOMParser === 'undefined'
      ? html
      : (() => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ');
        })();
  plainCache.set(html, out);
  if (plainCache.size > PLAIN_CACHE_MAX) {
    const oldest = plainCache.keys().next();
    if (!oldest.done) plainCache.delete(oldest.value);
  }
  return out;
}
