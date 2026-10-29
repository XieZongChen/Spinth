import { describe, expect, it } from 'vitest';
import { insetRectOf, shapeHeightFromTextHeight } from '../widgets/shape/shapeVm';

/** 图形内文字（docs/17 §6）：内接矩形数学（形状变体全覆盖） */

describe('insetRectOf 文字内接矩形（四型数学，既有设计 shapeTextCompute 行为）', () => {
  it('rect/round-rect：四边 padding', () => {
    expect(insetRectOf('rect', 120, 80)).toEqual({ x: 15, y: 15, width: 90, height: 50 });
    expect(insetRectOf('round-rect', 120, 80)).toEqual(insetRectOf('rect', 120, 80));
  });

  it('ellipse：内接矩形 w/√2 × h/√2 居中', () => {
    const r = insetRectOf('ellipse', 100, 100);
    expect(r.width).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(r.height).toBeCloseTo(100 / Math.SQRT2, 6);
    // 居中：x = (w - iw)/2
    expect(r.x).toBeCloseTo((100 - 100 / Math.SQRT2) / 2, 6);
  });

  it('diamond：半宽高中心箱', () => {
    expect(insetRectOf('diamond', 120, 80)).toEqual({ x: 30, y: 20, width: 60, height: 40 });
  });

  it('窄形状下限保护：maxWidth 至少 1（不产生非正宽）', () => {
    expect(insetRectOf('rect', 20, 80).width).toBeGreaterThanOrEqual(1);
  });
});

describe('triangle-up（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：下半中心箱 {w/4, h/2, w/2, h/2}', () => {
    expect(insetRectOf('triangle-up', 120, 80)).toEqual({ x: 30, y: 40, width: 60, height: 40 });
  });

  it('撑高公式 = textH×2（下半箱 h/2 ≥ textH 反解）', () => {
    expect(shapeHeightFromTextHeight('triangle-up', 60)).toBe(120);
  });
});

describe('triangle-down（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：上半中心箱 {w/4, 0, w/2, h/2}；撑高 textH×2', () => {
    expect(insetRectOf('triangle-down', 120, 80)).toEqual({ x: 30, y: 0, width: 60, height: 40 });
    expect(shapeHeightFromTextHeight('triangle-down', 60)).toBe(120);
  });
});

describe('parallelogram-right（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：{0.21w, 0.1h, 0.6w, 0.8h}；撑高 textH×1.25', () => {
    const r = insetRectOf('parallelogram-right', 200, 100);
    expect(r.x).toBeCloseTo(42, 6);
    expect(r.y).toBeCloseTo(10, 6);
    expect(r.width).toBeCloseTo(120, 6);
    expect(r.height).toBeCloseTo(80, 6);
    expect(shapeHeightFromTextHeight('parallelogram-right', 80)).toBe(100);
  });
});

describe('parallelogram-left（12 型扩展 docs/04 §8.2）', () => {
  it('内接与公式与 right 同款（镜像只影响绘制，内接箱对称）', () => {
    expect(insetRectOf('parallelogram-left', 200, 100)).toEqual(
      insetRectOf('parallelogram-right', 200, 100),
    );
    expect(shapeHeightFromTextHeight('parallelogram-left', 80)).toBe(100);
  });
});

describe('eng-database 圆柱（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：两椭圆头之间（大形状 e=54 饱和；小形状 h×0.3 钳制）', () => {
    const big = insetRectOf('eng-database', 200, 300); // 300×0.3=90 > 54 → e=54
    expect(big).toEqual({ x: 15, y: 69, width: 170, height: 162 });
    const small = insetRectOf('eng-database', 120, 80); // 80×0.3=24 → e=24
    expect(small).toEqual({ x: 15, y: 39, width: 90, height: 2 });
  });

  it('撑高公式 = textH+108+30（两头 54 + 上下 padding）', () => {
    expect(shapeHeightFromTextHeight('eng-database', 60)).toBe(198);
  });
});

describe('eng-queue 滚筒（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：两端之间矩形身（端宽钳制同步；y=20 视觉边距）', () => {
    const r = insetRectOf('eng-queue', 200, 100); // 200×0.3=60 > 54 → e=54
    expect(r).toEqual({ x: 69, y: 20, width: 62, height: 60 });
    const small = insetRectOf('eng-queue', 120, 80); // 120×0.3=36 → e=36
    expect(small).toEqual({ x: 51, y: 20, width: 18, height: 40 });
  });

  it('撑高公式 = textH+40（纵向只有视觉边距）', () => {
    expect(shapeHeightFromTextHeight('eng-queue', 60)).toBe(100);
  });
});

describe('stadium 起止胶囊（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让半端帽；撑高 textH+30', () => {
    expect(insetRectOf('stadium', 120, 80)).toEqual({ x: 20, y: 15, width: 80, height: 50 });
    expect(shapeHeightFromTextHeight('stadium', 60)).toBe(90);
  });
});

describe('document 文档（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：底部让波浪 c；撑高 textH+48（波 18 + padding 30）', () => {
    expect(insetRectOf('document', 120, 80)).toEqual({ x: 15, y: 15, width: 90, height: 38 }); // c=min(18,12)=12 → 80-30-12
    expect(shapeHeightFromTextHeight('document', 60)).toBe(108);
  });
});

describe('hexagon 六边形（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让斜宽 c；撑高 textH+30', () => {
    expect(insetRectOf('hexagon', 120, 80)).toEqual({ x: 30, y: 15, width: 60, height: 50 }); // c=min(30,40)=30
    expect(shapeHeightFromTextHeight('hexagon', 60)).toBe(90);
  });
});

describe('predefined-process 子过程（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让双竖线带 d；撑高 textH+30', () => {
    expect(insetRectOf('predefined-process', 120, 80)).toEqual({
      x: 27,
      y: 15,
      width: 66,
      height: 50,
    }); // d=min(12,12)=12
    expect(shapeHeightFromTextHeight('predefined-process', 60)).toBe(90);
  });
});

describe('trapezoid-down 下梯形（流程图八型 docs/04 §8.2）', () => {
  it('内接与公式与上梯形同款（镜像只影响绘制）；撑高 textH+30', () => {
    expect(insetRectOf('trapezoid-down', 120, 80)).toEqual(insetRectOf('trapezoid-up', 120, 80));
    expect(shapeHeightFromTextHeight('trapezoid-down', 60)).toBe(90);
  });
});

describe('delay 延迟 D 形（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：右侧让弧侵食 h/4；撑高 textH+30', () => {
    expect(insetRectOf('delay', 120, 80)).toEqual({ x: 15, y: 15, width: 70, height: 50 }); // 120-30-80/4
    expect(shapeHeightFromTextHeight('delay', 60)).toBe(90);
  });

  it('侵蚀钳半宽：极端扁高下 inset 收敛不再无界收窄（32 轮 🟠-1）', () => {
    // 无钳制时 h=500 → 侵食 125 → 宽 120-30-125=-35（钳 1px 细条，正反馈发散）
    const half = (120 - 30) / 2; // 45
    expect(insetRectOf('delay', 120, 500).width).toBeCloseTo(half, 6);
    expect(insetRectOf('delay', 120, 1000).width).toBeCloseTo(half, 6); // 两轮 reflow 后稳定
    expect(insetRectOf('delay', 60, 240).width).toBeCloseTo(15, 6); // 小形状：min(60,15)=15
  });
});

describe('off-page 页连接（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：底部让尖区 c；撑高 textH+65（35+30）', () => {
    expect(insetRectOf('off-page', 120, 80)).toEqual({ x: 15, y: 15, width: 90, height: 22 }); // c=min(28,35)=28 → 80-30-28
    expect(shapeHeightFromTextHeight('off-page', 60)).toBe(125);
  });
});

describe('trapezoid-up 上梯形（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让半腰 c/2；撑高 textH+30', () => {
    expect(insetRectOf('trapezoid-up', 120, 80)).toEqual({ x: 27, y: 15, width: 66, height: 50 }); // c=min(24,40)=24 → x=15+12
    expect(shapeHeightFromTextHeight('trapezoid-up', 60)).toBe(90);
  });
});

describe('eng-file 缺角页（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：折角下方矩形（f 钳制同步）；撑高 textH+50+30', () => {
    const r = insetRectOf('eng-file', 200, 150); // 200×0.3=60 > 50 → f=50
    expect(r).toEqual({ x: 15, y: 65, width: 170, height: 70 });
    const small = insetRectOf('eng-file', 120, 80); // 120×0.3=36 → f=36
    expect(small).toEqual({ x: 15, y: 51, width: 90, height: 14 });
    expect(shapeHeightFromTextHeight('eng-file', 60)).toBe(140);
  });
});

describe('eng-folder 文件夹（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：标签页下方矩形（t 钳制同步）；撑高 textH+40+30', () => {
    const r = insetRectOf('eng-folder', 200, 160); // 160×0.25=40 → t=40（恰饱和）
    expect(r).toEqual({ x: 15, y: 55, width: 170, height: 90 });
    const small = insetRectOf('eng-folder', 120, 80); // 80×0.25=20 → t=20
    expect(small).toEqual({ x: 15, y: 35, width: 90, height: 30 });
    expect(shapeHeightFromTextHeight('eng-folder', 60)).toBe(130);
  });
});
