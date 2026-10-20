// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from '../platform/textEngine/plainText';

/** htmlToPlainText（判空/降级通道）：marks 剥离 + 缓存 */

describe('htmlToPlainText（docs/17 判空/纯文本降级通道）', () => {
  it('marks 剥离：strong/span color 只剩文本；实体与 nbsp 归一', () => {
    expect(
      htmlToPlainText('<p>前<strong>粗</strong><span style="color: #f00">红</span>后</p>'),
    ).toBe('前粗红后');
    expect(htmlToPlainText('<p>a&nbsp;b</p>')).toBe('a b');
  });

  it('多段拼接与空值', () => {
    expect(htmlToPlainText('<p>一</p><p>二</p>')).toBe('一二');
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText('<p></p>')).toBe('');
  });

  it('缓存命中：同 html 返回同一引用（LRU 共享只读）', () => {
    expect(htmlToPlainText('<p>缓存探针</p>')).toBe(htmlToPlainText('<p>缓存探针</p>'));
  });
});
