/**
 * 文本测量引擎（docs/07 §5）——纯逻辑、可单测。
 *
 * 输入：段落 span 结构（TipTap HTML 经 htmlToDoc 解析——span 带 bold/italic/
 * underline/color marks，docs/17 §4 刀 1/2）；断行按字素流 span 感知（粗体与
 * 斜体宽度参与判定——italic 字形宽度 ≠ normal）。
 * 输出：视图模型树（Doc → Paragraph → Line → Span，带 rect 坐标），
 * 由 DocDisplay（docDisplay.ts）消费产出 PIXI 显示树——本模块不产 DisplayObject。
 */

export interface ITextStyleProps {
  fontFamily: string;
  fontSize: number;
  lineHeight: number; // 倍数（1.5 = 1.5×fontSize）
  color: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ISpanInput {
  text: string;
  /** 行内字重覆盖（marks：粗体段加宽度量） */
  bold?: boolean;
  /** 行内斜体覆盖（marks：italic 字形宽度 ≠ normal——参与宽度量，docs/07 §5） */
  italic?: boolean;
  /** 行内下划线覆盖（marks：不影响度量，仅渲染手绘消费） */
  underline?: boolean;
  /** 行内颜色覆盖（marks：不影响度量，仅渲染消费） */
  color?: string;
}

export interface IParagraphInput {
  spans: ISpanInput[];
  align?: 'left' | 'center' | 'right';
}

export interface IDocInput {
  paragraphs: IParagraphInput[];
  maxWidth: number;
  /** Batch 1 · 1.30：死参数收敛——measureDoc 从不读此字段（垂直裁剪由渲染层
   *  mask/height 控制，shapeVm 的注释也自认「autoHeight 首版不做」）。保留
   *  字段但标注 Pending：调用方（shapeVm/stickyVm）传值无害；真做溢出省略号
   *  时实现它（docs/07 §5 挂账），避免现在删字段破坏 3 处调用点 */
  overflow?: 'visible' | 'hidden'; // Pending：未实现（见 docs/07 §5）
  style: ITextStyleProps;
}

export interface ISpanView {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** 行内颜色覆盖（marks：缺省回落 doc 级 color） */
  color?: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface ILineView {
  spans: ISpanView[];
  y: number;
  height: number;
}

export interface IParagraphView {
  lines: ILineView[];
  y: number;
  height: number;
}

export interface IDocView {
  paragraphs: IParagraphView[];
  width: number;
  height: number;
  /** overflow hidden 时被截断的文本（渲染省略号用） */
  ellipsis: boolean;
}

/** 度量器接口：由环境注入（浏览器 canvas measureText；测试注入 mock） */
export interface IMeasurer {
  measure(text: string, style: ITextStyleProps): number;
}

/** 模块级共享实例（只有 ctx + 测量缓存池）；canvas/context 创建有成本，
 * 文本编辑每次节流落库都新建 measurer 是浪费（外部审查揪出） */
let sharedMeasurer: IMeasurer | null = null;

/** 缓存键文本上限：超长文本（整段正文）重复率低、键内存高，不缓存 */
const MEASURE_CACHE_TEXT_MAX = 128;
/** 条目上限 2000（docs/16 4.8⑦ 定案容量：断行前缀试探的工作集规模 + 内存可控） */
const MEASURE_CACHE_MAX = 2000;

/** 测量缓存池（docs/16 §5）：Map 插入序 LRU——断行前缀试探同子串重复率高 */
export class LruMeasureCache {
  private readonly map = new Map<string, number>();

  constructor(private readonly max = MEASURE_CACHE_MAX) {}

  key(text: string, style: ITextStyleProps): string | null {
    if (text.length > MEASURE_CACHE_TEXT_MAX) return null;
    // italic 改变字形宽度必须进键（漏改 = 同字素命中旧 normal 宽度，断行错位）
    return `${style.bold ? 'b' : 'n'}${style.italic ? 'i' : 'n'}|${style.fontSize}|${style.fontFamily}|${text}`;
  }

  get(key: string): number | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v); // 提升为最近使用
    }
    return v;
  }

  set(key: string, width: number): void {
    this.map.set(key, width);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

export function createCanvasMeasurer(): IMeasurer {
  if (sharedMeasurer) return sharedMeasurer;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d') ?? null;
  const cache = new LruMeasureCache();
  sharedMeasurer = {
    measure(text, style) {
      if (!ctx) return text.length * style.fontSize * 0.6; // 无 canvas 环境粗估
      const key = cache.key(text, style);
      if (key) {
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
      }
      ctx.font = `${style.bold ? 'bold ' : ''}${style.italic ? 'italic ' : ''}${style.fontSize}px ${style.fontFamily}`;
      const width = ctx.measureText(text).width;
      if (key) cache.set(key, width);
      return width;
    },
  };
  return sharedMeasurer;
}

/**
 * 断行策略（docs/07 §5）：
 * - breakAll：逐字素断行（中文/URL/长串场景，grapheme 级）
 * - breakWord：空格分词 + 词内超宽时按字素拆（英文自然断行）
 * 既有设计用 grapheme-splitter + linebreak 库；spinth 以 Intl.Segmenter（字素）
 * 与空白分词实现同语义（现代浏览器内建，无新增依赖）。
 */
export type WordBreak = 'break-all' | 'break-word';

function* graphemes(text: string): Generator<string> {
  const seg =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  if (seg) {
    for (const s of seg.segment(text)) yield s.segment;
  } else {
    for (const ch of text) yield ch; // 降级：BMP 内正确，代理对拆开（可接受）
  }
}

/**
 * 样式化字素（marks 断行单元，docs/17 §4 marks 渲染刀 1）：span 输入展平为
 * 带样式归属的字素流——粗体/斜体宽度不同会改变断行位置（旧版整行统一主样式
 * 度量，粗体行溢出 maxWidth 数像素），断行必须 span 感知。underline 不影响
 * 宽度但随字素流透传（归并判等含它，否则被并入相邻 span 丢失）。
 */
interface IStyledGlyph {
  g: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
}

function flattenSpans(spans: ISpanInput[]): IStyledGlyph[] {
  const out: IStyledGlyph[] = [];
  for (const s of spans) {
    for (const g of graphemes(s.text)) {
      out.push({
        g,
        bold: s.bold ?? false,
        italic: s.italic ?? false,
        underline: s.underline ?? false,
        color: s.color,
      });
    }
  }
  return out;
}

/** 单段断行：样式化字素流 → 行数组（每行 = 字素数组；旧 wrapParagraph 的
 *  break-all / break-word 语义逐条平移——空白自成词、行首剥空白、超宽拆字素） */
function wrapGlyphs(
  glyphs: IStyledGlyph[],
  maxWidth: number,
  measurer: IMeasurer,
  style: ITextStyleProps,
  mode: WordBreak,
): IStyledGlyph[][] {
  if (glyphs.length === 0) return [[]];
  const widthOf = (gs: IStyledGlyph[]): number => {
    let w = 0;
    for (const x of gs) w += measurer.measure(x.g, { ...style, bold: x.bold, italic: x.italic });
    return w;
  };
  if (mode === 'break-all') {
    const lines: IStyledGlyph[][] = [];
    let line: IStyledGlyph[] = [];
    for (const g of glyphs) {
      if (line.length > 0 && widthOf([...line, g]) > maxWidth) {
        lines.push(line);
        line = /\s/.test(g.g) ? [] : [g];
      } else {
        line.push(g);
      }
    }
    if (line.length) lines.push(line);
    return lines;
  }
  // break-word：词为单位放置（空白串自成词、非空白连续成词）
  const words: IStyledGlyph[][] = [];
  let cur: IStyledGlyph[] = [];
  for (const g of glyphs) {
    const sp = /\s/.test(g.g);
    const curSp = cur.length > 0 && /\s/.test(cur[0]!.g);
    if (cur.length > 0 && sp !== curSp) {
      words.push(cur);
      cur = [];
    }
    cur.push(g);
  }
  if (cur.length) words.push(cur);
  const lines: IStyledGlyph[][] = [];
  let line: IStyledGlyph[] = [];
  for (const word of words) {
    const candidate = [...line, ...word];
    if (widthOf(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line.length) {
      lines.push(line);
      line = [];
    }
    // 行首：剥掉词首空白（换行后不产生行首空格）
    let start = 0;
    while (start < word.length && /\s/.test(word[start]!.g)) start++;
    const bare = word.slice(start);
    if (bare.length === 0) continue;
    if (widthOf(bare) <= maxWidth) {
      line = bare;
      continue;
    }
    // 超宽单词按字素拆
    let piece: IStyledGlyph[] = [];
    for (const g of word) {
      if (piece.length > 0 && widthOf([...piece, g]) > maxWidth) {
        lines.push(piece);
        piece = [g];
      } else {
        piece.push(g);
      }
    }
    line = piece;
  }
  if (line.length) lines.push(line);
  return lines;
}

export interface IMeasureOptions {
  measurer: IMeasurer;
  /** 断行模式，默认 break-word */
  wordBreak?: WordBreak;
}

/** 行内字素合并：相邻同 (bold, italic, underline, color) 归并为 span（宽度按各自样式累加） */
function mergeRowSpans(
  row: IStyledGlyph[],
  lineH: number,
  style: ITextStyleProps,
  measurer: IMeasurer,
): ISpanView[] {
  const out: ISpanView[] = [];
  let x = 0;
  let i = 0;
  while (i < row.length) {
    const j = i;
    while (
      i < row.length &&
      row[i]!.bold === row[j]!.bold &&
      row[i]!.italic === row[j]!.italic &&
      row[i]!.underline === row[j]!.underline &&
      row[i]!.color === row[j]!.color
    ) {
      i++;
    }
    const seg = row.slice(j, i);
    const width = seg.reduce(
      (w, s) => w + measurer.measure(s.g, { ...style, bold: s.bold, italic: s.italic }),
      0,
    );
    out.push({
      text: seg.map((s) => s.g).join(''),
      bold: row[j]!.bold,
      italic: row[j]!.italic,
      underline: row[j]!.underline,
      color: row[j]!.color,
      rect: { x, y: 0, width, height: lineH },
    });
    x += width;
  }
  return out;
}

/** 文档级测量：段落 → 行 → span（含行内 marks 切分、对齐与 overflow 截断） */
export function measureDoc(input: IDocInput, options: IMeasureOptions): IDocView {
  const { measurer, wordBreak = 'break-word' } = options;
  const { style, maxWidth } = input;
  const lineH = style.fontSize * style.lineHeight;
  const paragraphs: IParagraphView[] = [];
  let y = 0;

  for (const para of input.paragraphs) {
    const lines = wrapGlyphs(flattenSpans(para.spans), maxWidth, measurer, style, wordBreak);

    const lineViews: ILineView[] = lines.map((row, i) => {
      // 行尾空白 trim（渲染不显、宽度不计——与旧版 trimmed 同语义）
      while (row.length > 0 && /\s/.test(row[row.length - 1]!.g)) row.pop();
      const spans = mergeRowSpans(row, lineH, style, measurer);
      const rowWidth = spans.reduce((w, s) => w + s.rect.width, 0);
      const align = para.align ?? 'left';
      const x0 =
        align === 'left' ? 0 : align === 'center' ? (maxWidth - rowWidth) / 2 : maxWidth - rowWidth;
      const y0 = y + i * lineH;
      for (const s of spans) {
        s.rect.x += x0;
        s.rect.y = y0;
      }
      return { spans, y: y0, height: lineH };
    });
    const paraHeight = lineViews.length * lineH;
    paragraphs.push({ lines: lineViews, y, height: paraHeight });
    y += paraHeight;
  }
  return { paragraphs, width: maxWidth, height: y, ellipsis: false };
}
