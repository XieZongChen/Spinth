import type { IParagraphInput, ISpanInput } from './measure';

/**
 * TipTap HTML → 段落 span 输入（docs/17 §4 marks 渲染刀 2）：
 * `<p>` 段落 / `<strong>`(含 `<b>`) → bold mark / `<em>`(含 `<i>`) → italic
 * mark / `<u>` → underline mark / `<span style="color:…">` → color mark
 * （嵌套继承叠加）/ `<br>` → 开新段（Shift+Enter 硬换行）。斜体/下划线
 * 2026-10-10 补齐（此前 StarterKit 的 Italic/Underline 能产出但画布静默降级）。
 * 与 htmlToPlainText 并存：判空/纯文本消费方继续用旧通道。
 * 解析缓存（LRU 500）同款——几何变化触发的重渲染 html 不变，重复率高；
 * **返回值为共享只读对象**（消费方不得改写，防缓存污染）。
 */

const DOC_CACHE_MAX = 500;
const docCache = new Map<string, IParagraphInput[]>();

/** 段内样式上下文（嵌套继承） */
interface IMarkCtx {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
}

/** 段落 walk：<br> 切段（样式上下文延续），文本节点按当前上下文成 span */
function splitParagraph(p: Node): IParagraphInput[] {
  const paras: IParagraphInput[] = [];
  let spans: ISpanInput[] = [];
  const walk = (node: Node, ctx: IMarkCtx): void => {
    if (node.nodeName === 'BR') {
      paras.push({ spans });
      spans = [];
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) {
        // 条件带键（marks 缺省不带——消费方 `??` 语义）
        const span: ISpanInput = { text };
        if (ctx.bold) span.bold = true;
        if (ctx.italic) span.italic = true;
        if (ctx.underline) span.underline = true;
        if (ctx.color) span.color = ctx.color;
        spans.push(span);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const next: IMarkCtx = { ...ctx };
    if (el.tagName === 'STRONG' || el.tagName === 'B') next.bold = true;
    if (el.tagName === 'EM' || el.tagName === 'I') next.italic = true;
    if (el.tagName === 'U') next.underline = true;
    if (el.style && el.style.color) next.color = el.style.color;
    for (const child of Array.from(el.childNodes)) walk(child, next);
  };
  walk(p, { bold: false, italic: false, underline: false });
  paras.push({ spans }); // 尾段
  return paras;
}

export function htmlToDoc(html: string): IParagraphInput[] {
  if (!html) return [{ spans: [] }];
  const hit = docCache.get(html);
  if (hit) {
    docCache.delete(html);
    docCache.set(html, hit); // LRU 提升
    return hit;
  }
  let out: IParagraphInput[];
  if (typeof DOMParser === 'undefined') {
    out = [{ spans: [{ text: html }] }]; // 无 DOM 环境（测试垫片）降级整段
  } else {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const paras = Array.from(doc.body.querySelectorAll('p'));
    out =
      paras.length === 0
        ? // 非 TipTap 结构（裸文本/遗留数据）：整体当一段
          [{ spans: [{ text: doc.body.textContent ?? '' }] }]
        : paras.flatMap((p) => splitParagraph(p));
  }
  docCache.set(html, out);
  if (docCache.size > DOC_CACHE_MAX) {
    const oldest = docCache.keys().next();
    if (!oldest.done) docCache.delete(oldest.value);
  }
  return out;
}
