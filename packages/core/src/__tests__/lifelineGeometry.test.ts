import { describe, expect, it } from 'vitest';
import type { IRect } from '../common/geometry';
import {
  LIFELINE_ACTOR_HEAD_HEIGHT,
  LIFELINE_HEAD_HEIGHT,
  LIFELINE_LABEL_MIN_WIDTH,
  LIFELINE_MIN_HEIGHT,
  LIFELINE_MIN_WIDTH,
  constrainLifelineResize,
  lifelineAxisDashSegments,
  lifelineAxisHitHalf,
  lifelineAxisOf,
  lifelineHeadHeight,
  lifelineHeadRect,
  lifelineHitTest,
  lifelineHitTestRect,
  lifelineLabelRect,
  lifelineAxis,
  truncateLifelineLabel,
} from '../widgets/sequence/lifelineGeometry';

/** 默认尺寸的生命线：世界 (200,100,120,520)——轴 x = 260，轴段 y 136…620 */
const RECT: IRect = { x: 200, y: 100, width: 120, height: 520 };

describe('生命线几何：头区与轴', () => {
  it('头区高：box 36 / actor 72；数据缺省按 box', () => {
    expect(lifelineHeadHeight()).toBe(LIFELINE_HEAD_HEIGHT);
    expect(lifelineHeadHeight('box')).toBe(36);
    expect(lifelineHeadHeight('actor')).toBe(LIFELINE_ACTOR_HEAD_HEIGHT);
  });

  it('轴在水平中心，自头区底边到 bbox 底边', () => {
    expect(lifelineAxisOf(RECT)).toEqual({ x: 260, top: 136, bottom: 620 });
    expect(lifelineAxisOf(RECT, 'actor')).toEqual({ x: 260, top: 172, bottom: 620 });
  });

  it('退化不抛错：高度不足头区高 → 无轴（top ≥ bottom），头框就是整个 bbox', () => {
    const tiny: IRect = { x: 0, y: 0, width: 120, height: 20 };
    const axis = lifelineAxisOf(tiny);
    expect(axis.top).toBeGreaterThanOrEqual(axis.bottom);
    expect(lifelineAxisDashSegments(axis)).toEqual([]);
    expect(lifelineHeadRect(tiny).height).toBe(20);
  });

  it('高度下限保证轴长 ≥ 84（120 − 36）', () => {
    expect(LIFELINE_MIN_HEIGHT - LIFELINE_HEAD_HEIGHT).toBeGreaterThanOrEqual(84);
  });
});

describe('生命线几何：轴虚线分段', () => {
  it('[6, 6] 点划，末段不足一个实长照画', () => {
    expect(lifelineAxisDashSegments({ x: 0, top: 0, bottom: 20 })).toEqual([
      [0, 6],
      [12, 18],
    ]);
    expect(lifelineAxisDashSegments({ x: 0, top: 100, bottom: 105 })).toEqual([[100, 105]]);
  });

  it('零长轴返回空数组', () => {
    expect(lifelineAxisDashSegments({ x: 0, top: 10, bottom: 10 })).toEqual([]);
  });
});

describe('生命线几何：轴带命中半宽', () => {
  it('屏幕 6px 折算；下限 6、上限 24', () => {
    expect(lifelineAxisHitHalf(1)).toBe(6);
    expect(lifelineAxisHitHalf(4)).toBe(6); // 1.5 → 钳到 6
    expect(lifelineAxisHitHalf(0.5)).toBe(12);
    expect(lifelineAxisHitHalf(0.25)).toBe(24);
    expect(lifelineAxisHitHalf(0.1)).toBe(24); // 60 → 钳到 24
  });

  it('非法缩放（0 / NaN / 负数）按 1 处理，不产出 NaN / Infinity', () => {
    expect(lifelineAxisHitHalf(0)).toBe(6);
    expect(lifelineAxisHitHalf(Number.NaN)).toBe(6);
    expect(lifelineAxisHitHalf(-2)).toBe(6);
  });
});

describe('生命线几何：点命中 = 头框 ∪ 轴带', () => {
  const hit = (x: number, y: number) => lifelineHitTest({ x, y }, RECT, undefined, 6);

  it('头框：整条宽都命中（含远离轴的左右两端）', () => {
    expect(hit(260, 118)).toBe(true);
    expect(hit(205, 118)).toBe(true);
    expect(hit(315, 118)).toBe(true);
  });

  it('轴带：|p.x − 轴 x| ≤ half 命中；带内贴边算命中', () => {
    expect(hit(260, 400)).toBe(true);
    expect(hit(266, 400)).toBe(true);
    expect(hit(254, 400)).toBe(true);
  });

  it('轴旁空白（bbox 内、轴带外）不命中；头区与轴段之外不命中', () => {
    expect(hit(230, 400)).toBe(false);
    expect(hit(268, 400)).toBe(false);
    expect(hit(260, 630)).toBe(false); // bbox 之下
    expect(hit(260, 80)).toBe(false); // bbox 之上
  });

  it('退化（无轴）：只剩头框可命中', () => {
    const tiny: IRect = { x: 0, y: 0, width: 120, height: 20 };
    expect(lifelineHitTest({ x: 60, y: 10 }, tiny, undefined, 6)).toBe(true);
    expect(lifelineHitTest({ x: 60, y: 30 }, tiny, undefined, 6)).toBe(false);
  });
});

describe('生命线几何：框选命中（不用整 bbox）', () => {
  const r = (x: number, y: number, w: number, h: number): IRect => ({ x, y, width: w, height: h });

  it('只碰头旁空白也算（头框横跨整条宽）', () => {
    expect(lifelineHitTestRect(r(205, 105, 10, 10), RECT, undefined, 6)).toBe(true);
  });

  it('擦过轴带入选；只碰轴旁空白不入选', () => {
    expect(lifelineHitTestRect(r(240, 300, 30, 40), RECT, undefined, 6)).toBe(true);
    expect(lifelineHitTestRect(r(210, 300, 30, 40), RECT, undefined, 6)).toBe(false);
  });

  it('完全在 bbox 外不入选；无轴时轴带不参与', () => {
    expect(lifelineHitTestRect(r(400, 300, 50, 50), RECT, undefined, 6)).toBe(false);
    const tiny: IRect = { x: 0, y: 0, width: 120, height: 20 };
    expect(lifelineHitTestRect(r(50, 25, 20, 20), tiny, undefined, 6)).toBe(false);
  });
});

describe('生命线几何：标签区', () => {
  it('box：头框内缩左右 8，占头区高 36', () => {
    expect(lifelineLabelRect(120)).toEqual({ x: 8, y: 0, width: 104, height: 36 });
  });

  it('actor：标签带在小人下方（头区高 72 的下 36）', () => {
    expect(lifelineLabelRect(120, 'actor')).toEqual({ x: 8, y: 36, width: 104, height: 36 });
  });

  it('窄到放不下内边距时宽度不为负', () => {
    expect(lifelineLabelRect(10).width).toBe(0);
  });
});

describe('生命线几何：缩放整形（被拖边跟手、宽度以轴对称、下限 60×120）', () => {
  const start: IRect = { x: 200, y: 100, width: 120, height: 520 }; // 轴 x = 260，底边 620
  /** 自由缩放的输出（resizeRect 口径）：e 手柄指针 px / w 手柄指针 px */
  const freeE = (px: number): IRect => ({ x: 200, y: 100, width: px - 200, height: 520 });
  const freeW = (px: number): IRect => ({ x: px, y: 100, width: 320 - px, height: 520 });

  it('e 手柄：右边 = 指针，宽度 = 2 × 边到轴的距离；轴 x 不动', () => {
    expect(constrainLifelineResize(start, freeE(380), 'e')).toEqual({
      x: 140,
      y: 100,
      width: 240,
      height: 520,
    });
  });

  it('w 手柄：左边 = 指针，与 e 手柄镜像同解', () => {
    expect(constrainLifelineResize(start, freeW(140), 'w')).toEqual({
      x: 140,
      y: 100,
      width: 240,
      height: 520,
    });
  });

  it('吸附后：被拖边落在参考线上、对边镜像（整形保持被拖边——命中线如实）', () => {
    // e 手柄的东边被吸到 400（吸附输出的宽 = 400 − 200）：宽 = 2 × 140
    expect(constrainLifelineResize(start, freeE(400), 'e')).toEqual({
      x: 120,
      y: 100,
      width: 280,
      height: 520,
    });
  });

  it('网格量化把 x 重置成起点左边：整形只读被拖边，不受影响', () => {
    // quantizeResizeRect 的 e 输出形如 { x: start.x, 宽: 格点 − start.x }（格点 360）
    expect(
      constrainLifelineResize(start, { x: 200, y: 100, width: 160, height: 520 }, 'e'),
    ).toEqual({ x: 160, y: 100, width: 200, height: 520 });
  });

  it('宽度下限 60：指针贴过轴不翻面（被拖边停在轴外 30）', () => {
    expect(constrainLifelineResize(start, freeE(245), 'e')).toEqual({
      x: 230,
      y: 100,
      width: LIFELINE_MIN_WIDTH,
      height: 520,
    });
    // 越过轴 40：宽 80，右边缘像到轴另一侧（不翻面）
    expect(constrainLifelineResize(start, freeE(220), 'e')).toEqual({
      x: 220,
      y: 100,
      width: 80,
      height: 520,
    });
  });

  it('高度下限 120：s 手柄锚顶边、n 手柄锚底边', () => {
    expect(constrainLifelineResize(start, { x: 200, y: 100, width: 120, height: 30 }, 's')).toEqual(
      { x: 200, y: 100, width: 120, height: LIFELINE_MIN_HEIGHT },
    );
    expect(constrainLifelineResize(start, { x: 200, y: 590, width: 120, height: 30 }, 'n')).toEqual(
      { x: 200, y: 500, width: 120, height: LIFELINE_MIN_HEIGHT },
    );
  });

  it('单轴手柄不动另一轴；角柄两轴各读各的被拖边', () => {
    expect(
      constrainLifelineResize(start, { x: 200, y: 100, width: 120, height: 600 }, 's'),
    ).toEqual({ x: 200, y: 100, width: 120, height: 600 });
    expect(
      constrainLifelineResize(start, { x: 200, y: 100, width: 180, height: 600 }, 'se'),
    ).toEqual({ x: 140, y: 100, width: 240, height: 600 });
    expect(
      constrainLifelineResize(start, { x: 200, y: 60, width: 180, height: 560 }, 'ne'),
    ).toEqual({ x: 140, y: 60, width: 240, height: 560 });
  });
});

describe('生命线几何：轴锚定几何（§3.2）', () => {
  it('lifelineAxis：轴 = 头区底边到 bbox 底边；轴长 < 1 的退化件返回 null（按普通件处理）', () => {
    expect(lifelineAxis(RECT)).toEqual({ x: 260, top: 136, bottom: 620 });
    expect(lifelineAxis({ x: 200, y: 100, width: 120, height: 36.5 })).toBeNull();
    expect(lifelineAxis({ x: 200, y: 100, width: 120, height: 37 })).toEqual({
      x: 260,
      top: 136,
      bottom: 137,
    });
    expect(lifelineAxis({ x: 200, y: 100, width: 120, height: 200 }, 'actor')).toEqual({
      x: 260,
      top: 172,
      bottom: 300,
    });
  });
});

describe('生命线几何：标签渲染截断', () => {
  it('宽度不足 24 时标签为空（头框放不下字）', () => {
    expect(truncateLifelineLabel('用户', LIFELINE_LABEL_MIN_WIDTH - 1)).toBe('');
  });

  it('放得下原样返回；超宽逐字素截断加省略号（数据不变，只影响渲染）', () => {
    expect(truncateLifelineLabel('用户', 120)).toBe('用户');
    const long = 'abcdefghijklmnop';
    const out = truncateLifelineLabel(long, 120);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(long.length + 1);
    expect(truncateLifelineLabel('', 120)).toBe('');
  });
});
