import { describe, expect, it } from 'vitest';
import {
  insetRectOf,
  resolveShapeTextStyle,
  shapeHeightFromTextHeight,
  SHAPE_TEXT_FONT_SIZE,
  SHAPE_LINE_HEIGHT,
  SHAPE_TEXT_COLOR,
  SHAPE_TEXT_PADDING,
} from '../widgets/shape/shapeVm';

/** 图形内文字（docs/17 §6）：撑高公式 + 排版解析（override → 图形常量默认） */

describe('shapeHeightFromTextHeight 撑高公式（docs/17 §6 autoHeight，2026-10-10 四点拍板）', () => {
  it('rect/round-rect = textH + 2×padding（textH 60 → 90）', () => {
    expect(shapeHeightFromTextHeight('rect', 60)).toBe(90);
    expect(shapeHeightFromTextHeight('round-rect', 60)).toBe(90);
  });

  it('ellipse = textH×√2（与 insetRectOf 的 h/√2 内接反解单源；弃既有设计保守 ×2）', () => {
    expect(shapeHeightFromTextHeight('ellipse', 60)).toBeCloseTo(60 * Math.SQRT2, 2);
    expect(shapeHeightFromTextHeight('ellipse', 60)).toBeLessThan(120); // ×2 口径会到 120
  });

  it('diamond = textH×2（半高箱 h/2 ≥ textH 反解，两口径等价）', () => {
    expect(shapeHeightFromTextHeight('diamond', 60)).toBe(120);
  });

  it('公式自洽：撑出的高度其内接高恰好容纳文字（四型逐型验证）', () => {
    const textH = 60;
    for (const t of [
      'rect',
      'round-rect',
      'ellipse',
      'diamond',
      'triangle-up',
      'triangle-down',
      'parallelogram-right',
      'parallelogram-left',
      'eng-database',
      'eng-queue',
      'eng-file',
      'eng-folder',
      'stadium',
      'document',
      'hexagon',
      'predefined-process',
      'trapezoid-up',
      'trapezoid-down',
      'delay',
      'off-page',
    ] as const) {
      const h = shapeHeightFromTextHeight(t, textH);
      expect(insetRectOf(t, 200, h).height).toBeGreaterThanOrEqual(textH - 0.01);
    }
  });
});

describe('resolveShapeTextStyle（override → 图形常量默认）', () => {
  it('无 override 全默认（16/1.5/#333，不主题化）', () => {
    expect(resolveShapeTextStyle({})).toEqual({
      fontFamily: 'sans-serif',
      fontSize: SHAPE_TEXT_FONT_SIZE,
      lineHeight: SHAPE_LINE_HEIGHT,
      color: SHAPE_TEXT_COLOR,
    });
  });

  it('override 优先', () => {
    expect(resolveShapeTextStyle({ fontSize: 24, textColor: '#fff', lineHeight: 2 })).toMatchObject(
      {
        fontSize: 24,
        color: '#fff',
        lineHeight: 2,
      },
    );
  });

  it('padding 常量语义：rect 内缩 = w - 2×15', () => {
    const r = insetRectOf('rect', 100, 100);
    expect(r.width).toBe(100 - SHAPE_TEXT_PADDING * 2);
  });
});
