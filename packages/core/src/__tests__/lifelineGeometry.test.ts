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

describe('生命线几何：缩放整形（宽度以轴对称、下限 60×120）', () => {
  const start: IRect = { x: 200, y: 100, width: 120, height: 520 }; // 轴 x = 260

  it('限内：原样通过（只重算 x，轴 x 不动）', () => {
    expect(constrainLifelineResize(start, { x: 200, y: 100, width: 200, height: 600 })).toEqual({
      x: 160,
      y: 100,
      width: 200,
      height: 600,
    });
  });

  it('宽度以轴为对称轴：拖 east 手柄得到的 next 被整形为轴两侧各半', () => {
    const next = constrainLifelineResize(start, { x: 200, y: 100, width: 170, height: 520 });
    expect(next.x + next.width / 2).toBeCloseTo(260, 9);
    expect(next.width).toBe(170);
  });

  it('宽度钳到 60', () => {
    expect(constrainLifelineResize(start, { x: 200, y: 100, width: 20, height: 520 }).width).toBe(
      LIFELINE_MIN_WIDTH,
    );
  });

  it('高度钳到 120：south 手柄锚顶边、north 手柄锚底边', () => {
    expect(constrainLifelineResize(start, { x: 200, y: 100, width: 120, height: 30 })).toEqual({
      x: 200,
      y: 100,
      width: 120,
      height: LIFELINE_MIN_HEIGHT,
    });
    expect(constrainLifelineResize(start, { x: 200, y: 590, width: 120, height: 30 })).toEqual({
      x: 200,
      y: 500, // 底边 620 − 120
      width: 120,
      height: LIFELINE_MIN_HEIGHT,
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
