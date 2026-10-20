import { describe, expect, it } from 'vitest';
import {
  serializeToHtml,
  parseFromHtml,
  validateSnapshots,
  parsePastePayload,
  type IWidgetSnapshot,
} from '../platform/clipboard/clipboardData';

const snapshot: IWidgetSnapshot = {
  data: {
    id: 'abc123',
    type: 'SHAPE',
    zOrder: 'a0',
    shapeType: 'rect',
    color: '#e8f0fb',
    borderStyle: 'solid',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
  } as IWidgetSnapshot['data'],
  bounds: { x: 10, y: 20, width: 100, height: 50 },
};

describe('clipboardData（docs/09 §1）', () => {
  it('HTML 序列化→解析往返一致（含中文/Unicode）', () => {
    const snap: IWidgetSnapshot = {
      ...snapshot,
      data: { ...snapshot.data, color: '#fff', shapeType: 'round-rect' } as typeof snapshot.data,
    };
    const html = serializeToHtml([snap]);
    expect(html).toContain('data-spinth="');
    const parsed = parseFromHtml(html);
    expect(parsed).toEqual([snap]);
  });

  it('解析无标签 HTML 返回 null', () => {
    expect(parseFromHtml('<p>hello</p>')).toBeNull();
    expect(parseFromHtml('data-spinth="!!!"')).toBeNull(); // 非法 base64
  });

  it('validateSnapshots 拒绝垃圾数据', () => {
    expect(validateSnapshots(null)).toBeNull();
    expect(validateSnapshots([])).toBeNull();
    expect(validateSnapshots([{ foo: 1 }])).toBeNull();
    expect(
      validateSnapshots([
        { data: { id: 'x', type: 'SHAPE' }, bounds: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    ).toHaveLength(1);
  });

  it('粘贴优先级：私有 JSON > HTML 标签', () => {
    const json = JSON.stringify([snapshot]);
    const html = serializeToHtml([snapshot]);
    expect(parsePastePayload(json, html)).toEqual([snapshot]);
    expect(parsePastePayload(undefined, html)).toEqual([snapshot]);
    expect(parsePastePayload('not json', html)).toEqual([snapshot]);
    expect(parsePastePayload(undefined, undefined)).toBeNull();
  });
});
