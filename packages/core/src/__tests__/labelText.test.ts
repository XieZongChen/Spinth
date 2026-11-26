import { describe, expect, it } from 'vitest';
import {
  clampSingleLineLabel,
  truncateLabelToWidth,
  truncateWithEllipsis,
} from '../platform/textEngine/labelText';
import { clampSymbolLabel, SYMBOL_LABEL_MAX_CHARS } from '../widgets/symbol/symbolGeometry';
import { truncateTitle } from '../widgets/frame/frameGeometry';
import { graphemes, type ITextStyleProps, type IMeasurer } from '../platform/textEngine/measure';

/**
 * 单行标签清洗与截断（platform/textEngine/labelText）：SYMBOL / FRAME / LIFELINE
 * 共用。上提前的逐值行为由 symbolGeometry.test / frameGeometry.test 既有用例锁定
 * （它们经薄包装继续走同一实现）；本文件锁新入口的参数化与两处包装的等价性。
 */

/** 等宽 10px 测量器（frameGeometry.test 同款口径） */
const measure10 = (s: string): number => [...graphemes(s)].length * 10;
const STYLE: ITextStyleProps = {
  fontFamily: 'sans-serif',
  fontSize: 10,
  lineHeight: 1,
  color: '#333333',
};

describe('clampSingleLineLabel：落库清洗', () => {
  it('连续空白（含换行、制表）折成一个空格 + trim', () => {
    expect(clampSingleLineLabel('  核心\n\n交换机  A ', 64)).toBe('核心 交换机 A');
    expect(clampSingleLineLabel('a\tb', 64)).toBe('a b');
  });

  it('maxChars 参数化：按字素截断，emoji / 组合序列不拆；上限内原样', () => {
    expect(clampSingleLineLabel('abcdef', 3)).toBe('abc');
    expect(clampSingleLineLabel('abcdef', 6)).toBe('abcdef');
    expect(clampSingleLineLabel('abcdef', 10)).toBe('abcdef');
    expect(clampSingleLineLabel('', 64)).toBe('');
    const emoji = '👍'.repeat(10);
    expect([...graphemes(clampSingleLineLabel(emoji, 4))]).toHaveLength(4);
    // 家庭组合 emoji（多个码点 = 1 个字素）
    expect(clampSingleLineLabel('👨‍👩‍👧👨‍👩‍👧', 1)).toBe('👨‍👩‍👧');
  });

  it('SYMBOL 口径入口等价：clampSymbolLabel = 上限 SYMBOL_LABEL_MAX_CHARS', () => {
    const raw = '  a \n b  ';
    expect(clampSymbolLabel(raw)).toBe(clampSingleLineLabel(raw, SYMBOL_LABEL_MAX_CHARS));
    expect(clampSymbolLabel('x'.repeat(SYMBOL_LABEL_MAX_CHARS + 5))).toHaveLength(
      SYMBOL_LABEL_MAX_CHARS,
    );
  });
});

describe('truncateWithEllipsis：单行截断（measure 注入）', () => {
  it('整段放得下原样返回；空串原样返回', () => {
    expect(truncateWithEllipsis('abcdefghij', 100, measure10)).toBe('abcdefghij');
    expect(truncateWithEllipsis('', 10, measure10)).toBe('');
  });

  it('超宽按字素二分取最长前缀 + 省略号', () => {
    expect(truncateWithEllipsis('abcdefghij', 55, measure10)).toBe('abcd…'); // 4 字 + … = 50
    expect(truncateWithEllipsis('abcdefghij', 45, measure10)).toBe('abc…');
  });

  it('连省略号都放不下：返回省略号（调用方的最小宽度兜底）', () => {
    expect(truncateWithEllipsis('AB', 5, measure10)).toBe('…');
  });

  it('字素级：emoji 按字素计，不按 UTF-16 码元', () => {
    expect(truncateWithEllipsis('👍👍👍', 25, measure10)).toBe('👍…');
    expect(truncateWithEllipsis('👨‍👩‍👧X👨‍👩‍👧', 20, measure10)).toBe('👨‍👩‍👧…');
  });
});

describe('truncateLabelToWidth：样式 + 测量器形态', () => {
  it('每次测量都带同一文字样式，结果与手写 measure 回调一致', () => {
    const seen: Array<[string, ITextStyleProps]> = [];
    const spy: IMeasurer = {
      measure: (s, style) => {
        seen.push([s, style]);
        return measure10(s);
      },
    };
    expect(truncateLabelToWidth('abcdefghij', 55, STYLE, spy)).toBe('abcd…');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([, style]) => style === STYLE)).toBe(true);
  });
});

describe('FRAME 口径入口等价', () => {
  it('truncateTitle 就是 truncateWithEllipsis（同一函数引用）', () => {
    expect(truncateTitle).toBe(truncateWithEllipsis);
    expect(truncateTitle('跨职能审批流程', 30, measure10)).toBe('跨职…');
  });
});
