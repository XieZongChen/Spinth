import { describe, expect, it } from 'vitest';
import { darkenHex } from '../common/color';
import { resolveShapeStyle } from '../widgets/shape/shapeStyle';

/** 形状样式解析单源（specs/flowchart-closeout §4.2）：缺省 = 旧行为逐字节等价 */

describe('resolveShapeStyle 缺省（老文档零迁移）', () => {
  it('无新字段：边框色 = darkenHex(color,0.25)、宽 1、恒填充、实线', () => {
    const s = resolveShapeStyle({ color: '#e8f0fb', borderStyle: 'solid' });
    expect(s).toEqual({
      fill: true,
      fillColor: 0xe8f0fb,
      strokeColor: darkenHex('#e8f0fb', 0.25),
      strokeWidth: 1,
      dashed: false,
    });
  });

  it('borderStyle dashed → dashed（宽/色仍独立可配）', () => {
    const s = resolveShapeStyle({
      color: '#e8f0fb',
      borderStyle: 'dashed',
      borderWidth: 4,
      borderColor: '#dc2626',
    });
    expect(s.dashed).toBe(true);
    expect(s.strokeWidth).toBe(4);
    expect(s.strokeColor).toBe(0xdc2626);
  });
});

describe('resolveShapeStyle 白底黑框组合（G-01/G-02）', () => {
  it('fill none → 只描边；borderColor 固定不随填充色变化', () => {
    const s = resolveShapeStyle({
      color: '#ffffff',
      borderStyle: 'solid',
      borderColor: '#000000',
      borderWidth: 2,
      fill: 'none',
    });
    expect(s.fill).toBe(false);
    expect(s.fillColor).toBe(0xffffff);
    expect(s.strokeColor).toBe(0x000000);
    expect(s.strokeWidth).toBe(2);
  });
});
