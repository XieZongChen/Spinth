import { describe, expect, it } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';

/** fractional indexing zOrder（docs/04 §5，验收 1.12） */
describe('fractional indexing zOrder', () => {
  it('生成的 key 字典序正确插入任意两层之间', () => {
    const a = generateKeyBetween(null, null);
    const c = generateKeyBetween(a, null);
    const b = generateKeyBetween(a, c);
    expect(a < b && b < c).toBe(true);
  });

  it('追加顶层：新 key 大于现存最大', () => {
    let max: string | null = null;
    for (let i = 0; i < 5; i++) {
      max = generateKeyBetween(max, null);
    }
    const current = max as string;
    const next = generateKeyBetween(current, null);
    expect(next > current).toBe(true);
  });

  it('模拟 widgetLayer 排序：children 按字典序 = 层级序', () => {
    const keys = ['a0', 'a1', 'a0V', 'a01'];
    const sorted = [...keys].sort((x, y) => (x < y ? -1 : 1));
    expect(sorted).toEqual(['a0', 'a01', 'a0V', 'a1']);
  });
});
