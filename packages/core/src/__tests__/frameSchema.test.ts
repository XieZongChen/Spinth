import { describe, expect, it } from 'vitest';
import {
  FrameSchema,
  ImageSchema,
  LineSchema,
  PenSchema,
  ShapeSchema,
  StickySchema,
  SymbolSchema,
  TextSchema,
} from '../types/widget';

/**
 * 容器 schema 单测（specs/container-frame §2.1/§2.2）：FRAME 缺省与 optional
 * 语义（旧文档零迁移）、parentId 字段在自由七类的存在性（不存在 ≠ undefined 值键）。
 */

describe('FrameSchema', () => {
  it('最小输入：title/color/borderStyle 落缺省，optional 字段无键（不是 undefined 值键）', () => {
    const parsed = FrameSchema.parse({ id: 'f1', type: 'FRAME', zOrder: 'a0' });
    expect(parsed.title).toBe('');
    expect(parsed.color).toBe('#ffffff');
    expect(parsed.borderStyle).toBe('solid');
    expect('fill' in parsed).toBe(false);
    expect('borderColor' in parsed).toBe(false);
    expect('borderWidth' in parsed).toBe(false);
    expect('headerSide' in parsed).toBe(false);
    expect('titleColor' in parsed).toBe(false);
  });

  it('显式值透传：headerSide left / fill none / 虚线边框', () => {
    const parsed = FrameSchema.parse({
      id: 'f1',
      type: 'FRAME',
      zOrder: 'a0',
      title: '审批',
      color: '#0f172a',
      fill: 'none',
      borderColor: '#94a3b8',
      borderWidth: 2,
      borderStyle: 'dashed',
      headerSide: 'left',
      titleColor: '#ededf2',
    });
    expect(parsed).toMatchObject({
      title: '审批',
      color: '#0f172a',
      fill: 'none',
      borderColor: '#94a3b8',
      borderWidth: 2,
      borderStyle: 'dashed',
      headerSide: 'left',
      titleColor: '#ededf2',
    });
  });

  it('headerSide 只认 top/left；borderStyle 只认三值；type 字面量锁', () => {
    expect(
      FrameSchema.safeParse({ id: 'f1', type: 'FRAME', zOrder: 'a0', headerSide: 'right' }).success,
    ).toBe(false);
    expect(
      FrameSchema.safeParse({ id: 'f1', type: 'FRAME', zOrder: 'a0', borderStyle: 'dotted' })
        .success,
    ).toBe(false);
    expect(FrameSchema.safeParse({ id: 'f1', type: 'SHAPE', zOrder: 'a0' }).success).toBe(false);
  });

  it('FRAME 自身不带 parentId/groupId（单层容器不归属、不编组）', () => {
    const parsed = FrameSchema.parse({
      id: 'f1',
      type: 'FRAME',
      zOrder: 'a0',
      parentId: 'f0',
      groupId: 'g1',
    });
    expect('parentId' in parsed).toBe(false);
    expect('groupId' in parsed).toBe(false);
  });
});

describe('ParentIdField（specs/container-frame §2.2 七类 spread）', () => {
  const FREE_SEVEN = [
    ['SHAPE', ShapeSchema],
    ['TEXT', TextSchema],
    ['LINE', LineSchema],
    ['PEN', PenSchema],
    ['STICKY', StickySchema],
    ['IMAGE', ImageSchema],
    ['SYMBOL', SymbolSchema],
  ] as const;

  it('自由七类可写 parentId；缺输入时无键（旧文档零迁移）', () => {
    for (const [type, schema] of FREE_SEVEN) {
      const base = { id: 'w1', zOrder: 'a0' } as Record<string, unknown>;
      if (type === 'SHAPE') {
        base.shapeType = 'rect';
        base.text = '';
      }
      if (type === 'TEXT') base.text = '<p></p>';
      if (type === 'LINE') {
        base.points = [
          [0, 0],
          [10, 10],
        ];
      }
      if (type === 'PEN') {
        base.points = [
          [0, 0],
          [1, 1],
        ];
      }
      if (type === 'STICKY') base.text = '';
      if (type === 'IMAGE') base.src = '';
      const without = schema.parse({ ...base, type });
      expect('parentId' in without).toBe(false);
      const withParent = schema.parse({ ...base, type, parentId: 'f1' });
      expect((withParent as { parentId?: string }).parentId).toBe('f1');
    }
  });
});
