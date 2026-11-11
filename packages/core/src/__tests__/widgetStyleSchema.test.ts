import { describe, expect, it } from 'vitest';
import { LineSchema } from '../types';
import { ShapeSchema } from '../types/widget';

/**
 * 流程图样式批 schema 增量（specs/flowchart-closeout §11.1）：SHAPE 的
 * borderColor/borderWidth/fill 与 LINE 的 startPort/endPort 全部 optional 无
 * default——老文档零迁移（字段缺失 = 旧行为），消费侧 `?? 缺省` 单源在
 * shapeStyle.resolveShapeStyle / lineAnchorFollow 端口分配。
 */

describe('ShapeSchema 流程图样式字段（G-01/G-02）', () => {
  it('老文档（无新字段）parse 等价：三字段均 undefined，不改写数据', () => {
    const legacy = ShapeSchema.parse({
      id: 's1',
      type: 'SHAPE',
      zOrder: 'a',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
    });
    expect(legacy.borderColor).toBeUndefined();
    expect(legacy.borderWidth).toBeUndefined();
    expect(legacy.fill).toBeUndefined();
  });

  it('新字段显式写入可解析（白底黑框组合）', () => {
    const shape = ShapeSchema.parse({
      id: 's1',
      type: 'SHAPE',
      zOrder: 'a',
      color: '#ffffff',
      borderColor: '#000000',
      borderWidth: 2,
      fill: 'none',
    });
    expect(shape.borderColor).toBe('#000000');
    expect(shape.borderWidth).toBe(2);
    expect(shape.fill).toBe('none');
  });

  it('fill 只收 solid | none（越权值拒绝）', () => {
    expect(() =>
      ShapeSchema.parse({
        id: 's1',
        type: 'SHAPE',
        zOrder: 'a',
        fill: 'transparent',
      }),
    ).toThrow();
  });
});

describe('LineSchema 锚点沿边参数（G-03/G-05）', () => {
  it('老文档（无 port）parse 等价：两端口均 undefined', () => {
    const line = LineSchema.parse({
      id: 'l1',
      type: 'LINE',
      zOrder: 'a',
      points: [
        [0, 0],
        [10, 0],
      ],
    });
    expect(line.startPort).toBeUndefined();
    expect(line.endPort).toBeUndefined();
  });

  it('port 区间 [0,1]，越界拒绝（数据面防越权）', () => {
    const base = {
      id: 'l1',
      type: 'LINE' as const,
      zOrder: 'a',
      points: [
        [0, 0],
        [10, 0],
      ],
    };
    expect(LineSchema.parse({ ...base, startPort: 0, endPort: 1 })).toMatchObject({
      startPort: 0,
      endPort: 1,
    });
    expect(() => LineSchema.parse({ ...base, startPort: -0.1 })).toThrow();
    expect(() => LineSchema.parse({ ...base, endPort: 1.1 })).toThrow();
  });
});
