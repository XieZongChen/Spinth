import { describe, expect, it } from 'vitest';
import {
  measureDoc,
  LruMeasureCache,
  type IMeasurer,
  type ITextStyleProps,
} from '../platform/textEngine/measure';

/** 等宽 mock 度量器：每字符 10px（grapheme 级），便于精确断言 */
const mono: IMeasurer = {
  measure: (text) => text.length * 10,
};

const style: ITextStyleProps = {
  fontFamily: 'sans-serif',
  fontSize: 20,
  lineHeight: 1.5,
  color: '#333',
};

describe('measureDoc 断行（docs/07 §5）', () => {
  it('单行放得下：不换行，高度 = 1 行', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'hello' }] }], maxWidth: 100, style },
      { measurer: mono },
    );
    expect(view.paragraphs[0]!.lines).toHaveLength(1);
    expect(view.paragraphs[0]!.lines[0]!.spans[0]!.text).toBe('hello');
    expect(view.height).toBe(30); // 20 × 1.5
  });

  it('lineHeight per-实例：行高倍数直接进垂直布局（高度/行盒/段步进，批 lineHeight 落地）', () => {
    const lh: ITextStyleProps = { ...style, lineHeight: 1.8 };
    const view = measureDoc(
      // 两段各 1 行：高度 = 2 行 × (20 × 1.8)，段 y 步进 = 行高
      {
        paragraphs: [{ spans: [{ text: 'aa' }] }, { spans: [{ text: 'bb' }] }],
        maxWidth: 100,
        style: lh,
      },
      { measurer: mono },
    );
    expect(view.height).toBe(72); // 2 × 36
    expect(view.paragraphs[0]!.lines[0]!.spans[0]!.rect.height).toBe(36);
    expect(view.paragraphs[1]!.y).toBe(36);
  });

  it('break-word：空格分词换行，词不拆', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'aaa bbb ccc' }] }], maxWidth: 80, style }, // 每行 8 字符
      { measurer: mono, wordBreak: 'break-word' },
    );
    const texts = view.paragraphs[0]!.lines.map((l) => l.spans[0]!.text);
    expect(texts).toEqual(['aaa bbb', 'ccc']);
  });

  it('break-word：超宽单词按字素拆', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'abcdefghijkl' }] }], maxWidth: 50, style }, // 每行 5 字符
      { measurer: mono, wordBreak: 'break-word' },
    );
    const texts = view.paragraphs[0]!.lines.map((l) => l.spans[0]!.text);
    expect(texts).toEqual(['abcde', 'fghij', 'kl']);
  });

  it('break-all：CJK 逐字素断行', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: '一二三四五' }] }], maxWidth: 40, style }, // 每行 4 字素
      { measurer: mono, wordBreak: 'break-all' },
    );
    const texts = view.paragraphs[0]!.lines.map((l) => l.spans[0]!.text);
    expect(texts).toEqual(['一二三四', '五']);
  });

  it('行尾空白被去除（不占宽度）', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'ab   ' }] }], maxWidth: 100, style },
      { measurer: mono },
    );
    const span = view.paragraphs[0]!.lines[0]!.spans[0]!;
    expect(span.text).toBe('ab');
    expect(span.rect.width).toBe(20); // 不是 50
  });

  it('空文本：一行空行', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: '' }] }], maxWidth: 100, style },
      { measurer: mono },
    );
    expect(view.paragraphs[0]!.lines).toHaveLength(1);
    expect(view.height).toBe(30);
  });

  it('多段落高度累加', () => {
    const view = measureDoc(
      {
        paragraphs: [
          { spans: [{ text: 'aaaa' }] }, // 1 行
          { spans: [{ text: '' }] }, // 1 行
          { spans: [{ text: 'aaaaaaaaaaaaaaaaaaaa' }] }, // 2 行（宽 100/字符 10）
        ],
        maxWidth: 100,
        style,
      },
      { measurer: mono },
    );
    expect(view.paragraphs).toHaveLength(3);
    expect(view.paragraphs[2]!.lines).toHaveLength(2);
    expect(view.height).toBe(4 * 30);
    // 第二段 y 起点在第一段之后
    expect(view.paragraphs[1]!.y).toBe(30);
    expect(view.paragraphs[2]!.y).toBe(60);
  });
});

describe('measureDoc 对齐（docs/07 §5 fitTextAlign）', () => {
  const doc = (align: 'left' | 'center' | 'right') =>
    measureDoc(
      { paragraphs: [{ spans: [{ text: 'ab' }], align }], maxWidth: 100, style },
      { measurer: mono },
    );

  it('left：x = 0', () => {
    expect(doc('left').paragraphs[0]!.lines[0]!.spans[0]!.rect.x).toBe(0);
  });
  it('center：x = (maxWidth - width) / 2', () => {
    expect(doc('center').paragraphs[0]!.lines[0]!.spans[0]!.rect.x).toBe(40);
  });
  it('right：x = maxWidth - width', () => {
    expect(doc('right').paragraphs[0]!.lines[0]!.spans[0]!.rect.x).toBe(80);
  });
});

describe('断行幂等与换行位置正确性（docs/14 规则 3 精神）', () => {
  it('同输入重复测量结果一致', () => {
    const input = {
      paragraphs: [{ spans: [{ text: 'the quick brown fox jumps' }] }],
      maxWidth: 70,
      style,
    };
    const a = measureDoc(input, { measurer: mono });
    const b = measureDoc(input, { measurer: mono });
    expect(a).toEqual(b);
  });

  it('每行都不超 maxWidth（含超宽单词拆分场景）', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'aaaa bbbbbbbbbbbb cc' }] }], maxWidth: 60, style },
      { measurer: mono, wordBreak: 'break-word' },
    );
    for (const line of view.paragraphs[0]!.lines) {
      expect(line.spans[0]!.rect.width).toBeLessThanOrEqual(60);
    }
  });
});

describe('LruMeasureCache 测量缓存池（docs/16 §5）', () => {
  it('同键命中 + LRU 提升淘汰最旧', () => {
    const cache = new LruMeasureCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1); // a 提升为最近使用
    cache.set('d', 4); // 超上限 → 淘汰最旧（b）
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1); // a 未被淘汰
    expect(cache.size).toBe(3);
  });

  it('超长文本不建键（key 返回 null 不入缓存）', () => {
    const cache = new LruMeasureCache();
    const style = {
      fontSize: 14,
      lineHeight: 1.5,
      color: '#000',
      fontFamily: 'sans-serif',
      bold: false,
    };
    expect(cache.key('x'.repeat(129), style)).toBeNull();
    expect(cache.key('短文本', style)).toContain('短文本');
  });

  it('样式参与键（同文本不同字号不串值）', () => {
    const cache = new LruMeasureCache();
    const s14 = {
      fontSize: 14,
      lineHeight: 1.5,
      color: '#000',
      fontFamily: 'sans-serif',
      bold: false,
    };
    const s28 = {
      fontSize: 28,
      lineHeight: 1.5,
      color: '#000',
      fontFamily: 'sans-serif',
      bold: false,
    };
    expect(cache.key('ab', s14)).not.toBe(cache.key('ab', s28));
  });
});

describe('measureDoc 行内 marks（docs/17 §4 marks 渲染刀 1）', () => {
  it('行内 bold 切分：同段混合样式按 (bold,color) 归并为多个 span，宽度按各自样式累加', () => {
    // 粗体 20px、常规 10px/字：总宽 = 3×20 + 5×10 = 110（≤ 120 单行）
    const boldMono: IMeasurer = {
      measure: (text, s) => text.length * (s.bold ? 20 : 10),
    };
    const view = measureDoc(
      {
        paragraphs: [{ spans: [{ text: 'aaa', bold: true }, { text: 'bbbbb' }] }],
        maxWidth: 120,
        style,
      },
      { measurer: boldMono },
    );
    const line = view.paragraphs[0]!.lines[0]!;
    expect(line.spans).toHaveLength(2);
    expect(line.spans[0]).toMatchObject({ text: 'aaa', bold: true });
    expect(line.spans[1]).toMatchObject({ text: 'bbbbb', bold: false });
    expect(line.spans[0]!.rect.x).toBe(0);
    expect(line.spans[0]!.rect.width).toBe(60);
    expect(line.spans[1]!.rect.x).toBe(60);
    expect(line.spans[1]!.rect.width).toBe(50);
  });

  it('相邻同样式合并：中间无样式边界的多 span 输入归并为单 span', () => {
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'ab' }, { text: 'cd' }] }], maxWidth: 400, style },
      { measurer: mono },
    );
    expect(view.paragraphs[0]!.lines[0]!.spans).toHaveLength(1);
    expect(view.paragraphs[0]!.lines[0]!.spans[0]!.text).toBe('abcd');
  });

  it('marks 跨行拆分：断行处 span 被切开，两行各自成 span', () => {
    const view = measureDoc(
      {
        // 12 字全粗体？否——前 7 常规后 5 粗体，maxWidth 60 = 6 字/行 → 两行：
        // 行 1 = abcdef（常规），行 2 = g（常规）+ hijkl（粗）
        paragraphs: [{ spans: [{ text: 'abcdefg' }, { text: 'hijkl', bold: true }] }],
        maxWidth: 60,
        style,
      },
      { measurer: mono },
    );
    const lines = view.paragraphs[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.spans.map((s) => s.text)).toEqual(['abcdef']);
    expect(lines[1]!.spans.map((s) => s.text)).toEqual(['g', 'hijkl']);
    expect(lines[1]!.spans[1]!.bold).toBe(true);
  });

  it('color 不参与宽度：同文本不同 color 断行位置不变，color 透传 span 视图', () => {
    const view = measureDoc(
      {
        paragraphs: [{ spans: [{ text: 'aaa', color: '#ff0000' }, { text: 'bbb' }] }],
        maxWidth: 60,
        style,
      },
      { measurer: mono },
    );
    const line = view.paragraphs[0]!.lines[0]!;
    expect(line.spans).toHaveLength(2);
    expect(line.spans[0]!.color).toBe('#ff0000');
    expect(line.spans[1]!.color).toBeUndefined();
    expect(line.spans.reduce((w, s) => w + s.rect.width, 0)).toBe(60);
  });

  it('italic 参与宽度与断行（2026-10-10）：斜体字素更宽改变断行位置，(italic) 切分 span', () => {
    // 斜体 15px、常规 10px/字：8 字 maxWidth 96 —— 全斜 8×15=120 超宽 → 6 字斜体（90）+ 换行 2 字
    const italicMono: IMeasurer = {
      measure: (text, s) => text.length * (s.italic ? 15 : 10),
    };
    const view = measureDoc(
      { paragraphs: [{ spans: [{ text: 'aaaaaaaa', italic: true }] }], maxWidth: 96, style },
      { measurer: italicMono },
    );
    const lines = view.paragraphs[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.spans[0]!.text).toBe('aaaaaa');
    expect(lines[0]!.spans[0]!.italic).toBe(true);
    expect(lines[0]!.spans[0]!.rect.width).toBe(90);
    expect(lines[1]!.spans[0]!.text).toBe('aa');
    // 混合切分：斜体段与常规段各自成 span，宽度按各自样式累加
    const mixed = measureDoc(
      {
        paragraphs: [{ spans: [{ text: 'aa', italic: true }, { text: 'bb' }] }],
        maxWidth: 400,
        style,
      },
      { measurer: italicMono },
    );
    const mline = mixed.paragraphs[0]!.lines[0]!;
    expect(mline.spans).toHaveLength(2);
    expect(mline.spans[0]).toMatchObject({ text: 'aa', italic: true });
    expect(mline.spans[1]).toMatchObject({ text: 'bb', italic: false });
    expect(mline.spans[0]!.rect.width).toBe(30);
    expect(mline.spans[1]!.rect.width).toBe(20);
  });

  it('缓存键含 italic 位：同文本 normal/italic 不串值（漏改进键 = 命中旧宽度的隐晦 bug）', () => {
    const cache = new LruMeasureCache();
    const italicStyle: ITextStyleProps = { ...style, italic: true };
    expect(cache.key('ab', style)).not.toBe(cache.key('ab', italicStyle));
    // 真实度量器隔离验证：先量 normal 再量 italic，italic 不命中 normal 缓存
    const measurer = (() => {
      let font = '';
      return {
        measure: (text: string, s: ITextStyleProps): number => {
          font = `${s.bold ? 'bold ' : ''}${s.italic ? 'italic ' : ''}${s.fontSize}px`;
          return font.includes('italic') ? text.length * 15 : text.length * 10;
        },
      } as IMeasurer;
    })();
    expect(measurer.measure('ab', style)).toBe(20);
    expect(measurer.measure('ab', italicStyle)).toBe(30);
  });

  it('underline 零宽度仅透传：不影响断行，span 视图携带且不与相邻无样式归并', () => {
    const view = measureDoc(
      {
        paragraphs: [{ spans: [{ text: 'aa', underline: true }, { text: 'bb' }] }],
        maxWidth: 400,
        style,
      },
      { measurer: mono },
    );
    const line = view.paragraphs[0]!.lines[0]!;
    expect(line.spans).toHaveLength(2); // underline 进判等：不并入相邻无样式 span
    expect(line.spans[0]).toMatchObject({ text: 'aa', underline: true });
    expect(line.spans[1]).toMatchObject({ text: 'bb', underline: false });
    expect(line.spans.reduce((w, s) => w + s.rect.width, 0)).toBe(40); // 宽度同常规
  });
});
