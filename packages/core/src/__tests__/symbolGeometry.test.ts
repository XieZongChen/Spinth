import { describe, expect, it } from 'vitest';
import {
  clampSymbolLabel,
  containFitGlyph,
  symbolGlyphAnchor,
  symbolGlyphRect,
  symbolLabelRect,
  SYMBOL_DEFAULT_HEIGHT,
  SYMBOL_DEFAULT_WIDTH,
  SYMBOL_LABEL_BAND,
  SYMBOL_LABEL_GAP,
  truncateLabelToWidth,
} from '../widgets/symbol/symbolGeometry';
import { graphemes, type IMeasurer, type ITextStyleProps } from '../platform/textEngine/measure';

/**
 * 符号几何单测（specs/symbol-widget §3）：两段几何派生、contain 适配、
 * 图形区四边锚点（标签带不参与）、单行截断与落库清洗。
 */

/** 等宽 mock 度量器：每字素 10px（measure.test 同款口径） */
const monoMeasurer: IMeasurer = {
  measure: (text: string) => [...graphemes(text)].length * 10,
};
const STYLE: ITextStyleProps = {
  fontFamily: 'sans-serif',
  fontSize: 16,
  lineHeight: 1.5,
  color: '#333333',
};

describe('两段几何（§3.2）', () => {
  it('默认 100×126：图形区 100×100 铺满，标签带 24 贴底，间距 2', () => {
    expect(SYMBOL_DEFAULT_WIDTH).toBe(100);
    expect(SYMBOL_DEFAULT_HEIGHT).toBe(126);
    const glyph = symbolGlyphRect(100, 126);
    expect(glyph).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    const label = symbolLabelRect(100, 126);
    expect(label).toEqual({ x: 0, y: 102, width: 100, height: 24 });
    expect(SYMBOL_LABEL_BAND + SYMBOL_LABEL_GAP).toBe(26);
  });

  it('高度 26：图形区高度归零（不画图标仅标签）；高度 24 标签带贴顶', () => {
    expect(symbolGlyphRect(100, 26).height).toBe(0);
    expect(symbolLabelRect(100, 26)).toEqual({ x: 0, y: 2, width: 100, height: 24 });
    // h=24：图形区负值钳 0，标签带从顶开始且高恰 24
    expect(symbolGlyphRect(100, 24)).toEqual({ x: 0, y: 0, width: 100, height: 0 });
    expect(symbolLabelRect(100, 24)).toEqual({ x: 0, y: 0, width: 100, height: 24 });
  });

  it('高度 <24：标签带被压扁（渲染侧不画标签）', () => {
    expect(symbolLabelRect(100, 20)).toEqual({ x: 0, y: 0, width: 100, height: 20 });
  });
});

describe('contain 适配（§3.2）', () => {
  it('正方形图形区：整区铺满', () => {
    expect(containFitGlyph({ x: 0, y: 0, width: 96, height: 96 })).toEqual({
      x: 0,
      y: 0,
      scale: 2,
    });
  });

  it('宽 > 高：上下留白改为左右留白，等比不拉伸', () => {
    // 96 宽 48 高：s = min(2, 1) = 1，水平居中留白 24/侧
    expect(containFitGlyph({ x: 0, y: 0, width: 96, height: 48 })).toEqual({
      x: 24,
      y: 0,
      scale: 1,
    });
    // 48 宽 96 高：垂直居中留白
    expect(containFitGlyph({ x: 0, y: 0, width: 48, height: 96 })).toEqual({
      x: 0,
      y: 24,
      scale: 1,
    });
  });

  it('带偏移的图形区：留白相对图形区原点计算', () => {
    expect(containFitGlyph({ x: 10, y: 20, width: 48, height: 48 })).toEqual({
      x: 10,
      y: 20,
      scale: 1,
    });
  });
});

describe('图形区锚点（§3.4：标签带不参与）', () => {
  const rect = { x: 10, y: 20, width: 100, height: 126 };

  it('四边 t = 0 / 0.5 / 1 的坐标', () => {
    expect(symbolGlyphAnchor(rect, 'top', 0)).toEqual({ x: 10, y: 20 });
    expect(symbolGlyphAnchor(rect, 'top', 0.5)).toEqual({ x: 60, y: 20 });
    expect(symbolGlyphAnchor(rect, 'top', 1)).toEqual({ x: 110, y: 20 });
    expect(symbolGlyphAnchor(rect, 'bottom', 0)).toEqual({ x: 10, y: 120 });
    expect(symbolGlyphAnchor(rect, 'bottom', 0.5)).toEqual({ x: 60, y: 120 });
    expect(symbolGlyphAnchor(rect, 'bottom', 1)).toEqual({ x: 110, y: 120 });
    expect(symbolGlyphAnchor(rect, 'left', 0)).toEqual({ x: 10, y: 20 });
    expect(symbolGlyphAnchor(rect, 'left', 0.5)).toEqual({ x: 10, y: 70 });
    expect(symbolGlyphAnchor(rect, 'left', 1)).toEqual({ x: 10, y: 120 });
    expect(symbolGlyphAnchor(rect, 'right', 0.5)).toEqual({ x: 110, y: 70 });
  });

  it('bottom 落在图形区底边（y=120），不是 bbox 底（y=146）', () => {
    expect(symbolGlyphAnchor(rect, 'bottom', 0.5).y).toBe(120);
    expect(symbolGlyphAnchor(rect, 'bottom', 0.5).y).not.toBe(rect.y + rect.height);
  });

  it('高度退化（<26）：图形区底边钳到顶边，不进标签带', () => {
    const degenerate = { x: 0, y: 0, width: 100, height: 24 };
    expect(symbolGlyphAnchor(degenerate, 'bottom', 1)).toEqual({ x: 100, y: 0 });
    expect(symbolGlyphAnchor(degenerate, 'left', 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('单行截断（§5.4）', () => {
  it('整段放得下原样返回', () => {
    expect(truncateLabelToWidth('abcdefghij', 100, STYLE, monoMeasurer)).toBe('abcdefghij');
  });

  it('超宽逐字素截断 + 省略号（等宽 10px：宽 55 → 4 字 + …）', () => {
    expect(truncateLabelToWidth('abcdefghij', 55, STYLE, monoMeasurer)).toBe('abcd…');
    expect(truncateLabelToWidth('abcdefghij', 50, STYLE, monoMeasurer)).toBe('abcd…');
    expect(truncateLabelToWidth('abcdefghij', 45, STYLE, monoMeasurer)).toBe('abc…');
  });

  it('字素级：emoji 按字素计数不按 UTF-16 码元', () => {
    expect(truncateLabelToWidth('👍👍👍', 25, STYLE, monoMeasurer)).toBe('👍…');
  });

  it('空串原样返回', () => {
    expect(truncateLabelToWidth('', 10, STYLE, monoMeasurer)).toBe('');
  });
});

describe('落库清洗（§5.1）', () => {
  it('连续空白（含换行）折成一个空格 + trim', () => {
    expect(clampSymbolLabel('  核心\n\n交换机  A ')).toBe('核心 交换机 A');
    expect(clampSymbolLabel('a\tb')).toBe('a b');
  });

  it('截 64 字素（字素级，emoji 不拆代理对）', () => {
    expect(clampSymbolLabel('a'.repeat(65)).length).toBe(64);
    const emoji = '👍'.repeat(65);
    expect([...graphemes(clampSymbolLabel(emoji))].length).toBe(64);
  });

  it('64 以内原样（不再折叠已合规文本）', () => {
    expect(clampSymbolLabel('Web-01')).toBe('Web-01');
    expect(clampSymbolLabel('')).toBe('');
  });
});
