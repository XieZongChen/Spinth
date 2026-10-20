// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToDoc } from '../platform/textEngine/htmlDoc';

/** TipTap HTML → 段落 span 解析（docs/17 §4 marks 渲染刀 2） */

describe('htmlToDoc（marks 解析）', () => {
  it('纯文本段落：<p> 无 marks → 单 span 无样式', () => {
    expect(htmlToDoc('<p>hello</p>')).toEqual([{ spans: [{ text: 'hello' }] }]);
  });

  it('多段落：每个 <p> 独立段', () => {
    const doc = htmlToDoc('<p>aa</p><p>bb</p>');
    expect(doc).toHaveLength(2);
    expect(doc[0]!.spans[0]!.text).toBe('aa');
    expect(doc[1]!.spans[0]!.text).toBe('bb');
  });

  it('bold mark：<strong>/<b> 内文本带 bold，段内混合切多 span', () => {
    const doc = htmlToDoc('<p>前<strong>中粗</strong>后</p>');
    expect(doc[0]!.spans).toEqual([{ text: '前' }, { text: '中粗', bold: true }, { text: '后' }]);
    expect(htmlToDoc('<p><b>粗</b></p>')[0]!.spans).toEqual([{ text: '粗', bold: true }]);
  });

  it('color mark：<span style="color"> 带色（hex 被 DOM 规范化为 rgb 形式）；嵌套继承（色套粗叠加）', () => {
    const doc = htmlToDoc(
      '<p><span style="color: #ff0000">红字<strong>红粗</strong></span>普通</p>',
    );
    expect(doc[0]!.spans).toEqual([
      { text: '红字', color: 'rgb(255, 0, 0)' },
      { text: '红粗', bold: true, color: 'rgb(255, 0, 0)' },
      { text: '普通' },
    ]);
  });

  it('<br> 硬换行切段（Shift+Enter），样式上下文延续到新段', () => {
    const doc = htmlToDoc('<p>a<strong>b<br>c</strong></p>');
    expect(doc).toHaveLength(2);
    expect(doc[0]!.spans).toEqual([{ text: 'a' }, { text: 'b', bold: true }]);
    expect(doc[1]!.spans).toEqual([{ text: 'c', bold: true }]);
  });

  it('空段落：<p></p> → 空 spans 段（measure 空段一行语义）', () => {
    expect(htmlToDoc('<p></p>')).toEqual([{ spans: [] }]);
  });

  it('非 TipTap 结构（裸文本）降级单段', () => {
    expect(htmlToDoc('裸文本')).toEqual([{ spans: [{ text: '裸文本' }] }]);
  });

  it('缓存命中：同 html 返回同一引用（只读共享）', () => {
    const a = htmlToDoc('<p>缓存</p>');
    const b = htmlToDoc('<p>缓存</p>');
    expect(a).toBe(b);
  });

  it('italic mark：<em>/<i> 内文本带 italic（2026-10-10 补齐，此前静默降级）', () => {
    const doc = htmlToDoc('<p>前<em>中斜</em>后</p>');
    expect(doc[0]!.spans).toEqual([{ text: '前' }, { text: '中斜', italic: true }, { text: '后' }]);
    expect(htmlToDoc('<p><i>斜</i></p>')[0]!.spans).toEqual([{ text: '斜', italic: true }]);
  });

  it('underline mark：<u> 内文本带 underline', () => {
    const doc = htmlToDoc('<p><u>下划线</u>普通</p>');
    expect(doc[0]!.spans).toEqual([{ text: '下划线', underline: true }, { text: '普通' }]);
  });

  it('嵌套叠加：粗+斜+下划线+色 叠在同一 span（全部条件带键）', () => {
    const doc = htmlToDoc(
      '<p><span style="color: #0000ff"><strong><em><u>四合一</u></em></strong></span></p>',
    );
    expect(doc[0]!.spans).toEqual([
      { text: '四合一', bold: true, italic: true, underline: true, color: 'rgb(0, 0, 255)' },
    ]);
  });

  it('<br> 延续：斜体上下文跨硬换行保持', () => {
    const doc = htmlToDoc('<p>a<em>b<br>c</em></p>');
    expect(doc).toHaveLength(2);
    expect(doc[0]!.spans).toEqual([{ text: 'a' }, { text: 'b', italic: true }]);
    expect(doc[1]!.spans).toEqual([{ text: 'c', italic: true }]);
  });
});
