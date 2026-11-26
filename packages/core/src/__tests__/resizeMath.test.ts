/** 比例锁缩放数学（图片手柄缩放按住 Shift，docs/05 §4.4）：lockAspectRect 与
 *  resizeRotatedRect 的 ratio 尾参。纯函数，无宿主 */
import { describe, expect, it } from 'vitest';
import type { IRect } from '../common/geometry';
import {
  lockAspectRect,
  planResize,
  RESIZE_MIN_SIZE,
  resizeRect,
  resizeRotatedRect,
  type IResizeConstrain,
  type IResizeSnaps,
} from '../platform/rectEditor/resizeMath';
import { rotatePointAround } from '../platform/rectEditor/rotateMath';

const START: IRect = { x: 100, y: 100, width: 200, height: 100 }; // 2:1
const RATIO = 2;

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

function expectRatio(rect: IRect, ratio: number): void {
  expect(rect.height).toBeGreaterThan(0);
  expect(round(rect.width / rect.height)).toBe(round(ratio));
}

/** 矩形某角的世界位（角名 = 方位），用于对侧角锚定断言 */
function cornerOf(rect: IRect, corner: 'nw' | 'ne' | 'sw' | 'se'): { x: number; y: number } {
  return {
    x: corner.includes('w') ? rect.x : rect.x + rect.width,
    y: corner.includes('n') ? rect.y : rect.y + rect.height,
  };
}

describe('lockAspectRect 角柄：主轴保留自由缩放输出，另一轴按比例派生，对侧角锚定', () => {
  it('se：宽的相对变化更大 → 宽为主轴，高度 = 宽 / 比例；nw 角不动', () => {
    // 自由缩放得 300×130（宽 +50%、高 +30%）→ 高按比例应为 150
    const next = lockAspectRect(START, 'se', { x: 100, y: 100, width: 300, height: 130 }, RATIO);
    expect(next).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(cornerOf(next, 'nw')).toEqual(cornerOf(START, 'nw'));
  });

  it('nw：se 角（右下）不动，左上随派生尺寸外移', () => {
    // 自由缩放 280×130（宽 +40%、高 +30%）→ 宽为主轴，高 140 → y = 200 − 140 = 60
    const next = lockAspectRect(START, 'nw', { x: 20, y: 70, width: 280, height: 130 }, RATIO);
    expect(next).toEqual({ x: 20, y: 60, width: 280, height: 140 });
    expect(cornerOf(next, 'se')).toEqual(cornerOf(START, 'se'));
  });

  it('ne：高的相对变化更大 → 高为主轴，宽 = 高 × 比例；sw 角不动', () => {
    // 自由缩放 300×180（宽 +50%、高 +80%）→ 高为主轴，宽 360
    const next = lockAspectRect(START, 'ne', { x: 100, y: 20, width: 300, height: 180 }, RATIO);
    expect(next).toEqual({ x: 100, y: 20, width: 360, height: 180 });
    expect(cornerOf(next, 'sw')).toEqual(cornerOf(START, 'sw'));
  });

  it('sw：高为主轴时宽向左生长，ne 角不动', () => {
    // 自由缩放 240×170（宽 +20%、高 +70%）→ 高为主轴，宽 340 → x = 300 − 340 = −40
    const next = lockAspectRect(START, 'sw', { x: 60, y: 100, width: 240, height: 170 }, RATIO);
    expect(next).toEqual({ x: -40, y: 100, width: 340, height: 170 });
    expect(cornerOf(next, 'ne')).toEqual(cornerOf(START, 'ne'));
  });

  it('相对变化量相等（等比缩放）→ 宽为主轴，输出即输入（幂等）', () => {
    const scaled: IRect = { x: 100, y: 100, width: 300, height: 150 };
    expect(lockAspectRect(START, 'se', scaled, RATIO)).toEqual(scaled);
    // nw 柄：右下角 (300,200) 不动
    const shrunk: IRect = { x: 200, y: 150, width: 100, height: 50 };
    expect(lockAspectRect(START, 'nw', shrunk, RATIO)).toEqual(shrunk);
  });

  it('缩小：主轴小于起点时同样按比例收缩', () => {
    // se 自由缩到 100×80（宽 −50%、高 −20%）→ 宽为主轴 → 高 50
    const next = lockAspectRect(START, 'se', { x: 100, y: 100, width: 100, height: 80 }, RATIO);
    expect(next).toEqual({ x: 100, y: 100, width: 100, height: 50 });
  });
});

describe('lockAspectRect 边柄：自己那条边为主轴，对边固定，另一轴保持起点边', () => {
  it('e：宽取输出、高派生；左边与上边不动', () => {
    const next = lockAspectRect(START, 'e', { x: 100, y: 100, width: 320, height: 100 }, RATIO);
    expect(next).toEqual({ x: 100, y: 100, width: 320, height: 160 });
  });

  it('w：右边不动，宽取输出', () => {
    const next = lockAspectRect(START, 'w', { x: 20, y: 100, width: 280, height: 100 }, RATIO);
    expect(next).toEqual({ x: 20, y: 100, width: 280, height: 140 });
  });

  it('s：高取输出、宽派生；上边与左边不动', () => {
    const next = lockAspectRect(START, 's', { x: 100, y: 100, width: 200, height: 150 }, RATIO);
    expect(next).toEqual({ x: 100, y: 100, width: 300, height: 150 });
  });

  it('n：下边不动，高取输出', () => {
    const next = lockAspectRect(START, 'n', { x: 100, y: 30, width: 200, height: 170 }, RATIO);
    expect(next).toEqual({ x: 100, y: 30, width: 340, height: 170 });
  });
});

describe('lockAspectRect 最小尺寸与入参守卫', () => {
  it('派生轴不足最小尺寸 → 两轴等比放大到都满足（比例优先于指针）', () => {
    // 100×8（比例 12.5）向内拖到自由缩放的最小 8×8：高派生 0.64 < 8 → 放大 12.5 倍
    const start: IRect = { x: 0, y: 0, width: 100, height: 8 };
    const next = lockAspectRect(start, 'se', { x: 0, y: 0, width: 8, height: 8 }, 12.5);
    expect(next).toEqual({ x: 0, y: 0, width: 100, height: 8 });
    expect(next.width).toBeGreaterThanOrEqual(RESIZE_MIN_SIZE);
    expect(next.height).toBeGreaterThanOrEqual(RESIZE_MIN_SIZE);
    expectRatio(next, 12.5);
  });

  it('主轴已是最小尺寸且派生轴够大 → 只做比例派生', () => {
    const start: IRect = { x: 0, y: 0, width: 8, height: 100 };
    const next = lockAspectRect(start, 'se', { x: 0, y: 0, width: 8, height: 8 }, 0.08);
    expect(next).toEqual({ x: 0, y: 0, width: 8, height: 100 });
  });

  it('非正 / 非有限比例：原样返回', () => {
    const free: IRect = { x: 100, y: 100, width: 260, height: 160 };
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lockAspectRect(START, 'se', free, bad)).toBe(free);
    }
  });
});

describe('resizeRotatedRect 的 ratio 尾参', () => {
  const world = { x: 400, y: 240 };

  it('不传 ratio：与 resizeRect 全等（现状不变）', () => {
    expect(resizeRotatedRect(START, 'se', world, 0)).toEqual(
      resizeRect(START, 'se', world, RESIZE_MIN_SIZE),
    );
  });

  it('θ=0 + ratio：等于 resizeRect 之后再比例锁', () => {
    const free = resizeRect(START, 'se', world);
    expect(resizeRotatedRect(START, 'se', world, 0, RESIZE_MIN_SIZE, RATIO)).toEqual(
      lockAspectRect(START, 'se', free, RATIO),
    );
  });

  it('旋转态 + ratio：比例保持，且起点对侧角的世界位不动', () => {
    const theta = Math.PI / 4;
    const c0 = { x: START.x + START.width / 2, y: START.y + START.height / 2 };
    const anchorBefore = rotatePointAround(cornerOf(START, 'nw'), c0, theta);

    const next = resizeRotatedRect(START, 'se', world, theta, RESIZE_MIN_SIZE, RATIO);
    expectRatio(next, RATIO);
    const c1 = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    const anchorAfter = rotatePointAround(cornerOf(next, 'nw'), c1, theta);
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 9);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 9);
  });

  it('旋转态不传 ratio：自由缩放，比例不保持（对照）', () => {
    const next = resizeRotatedRect(START, 'se', world, Math.PI / 4);
    expect(round(next.width / next.height)).not.toBe(round(RATIO));
  });
});

describe('planResize：缩放数学唯一出口 + 整形探针', () => {
  /** 生命线默认尺寸的起点（轴 x = 160） */
  const AXIS_START: IRect = { x: 100, y: 100, width: 120, height: 520 };
  const passthrough: IResizeSnaps = { apply: (_s, rect) => rect };
  /** 轴对称口径的整形（生命线）：被拖边保持不动，宽度 = 2 × 该边到起点轴的距离 */
  const axisSymmetric: IResizeConstrain = (start, next, dir) => {
    if (!dir.includes('e') && !dir.includes('w')) return next;
    const axisX = start.x + start.width / 2;
    const right = dir.includes('e') ? next.x + next.width : 2 * axisX - next.x;
    return {
      x: 2 * axisX - right,
      y: next.y,
      width: 2 * Math.abs(right - axisX),
      height: next.height,
    };
  };

  it('不传整形：θ=0 自由缩放后吸附（特征——既有控件路径不变）', () => {
    const world = { x: 250, y: 650 };
    expect(planResize(AXIS_START, 'se', world, 0, undefined, passthrough)).toEqual(
      resizeRect(AXIS_START, 'se', world),
    );
  });

  it('不传整形：比例锁 = 主轴吸附后按比例收敛（特征）', () => {
    // 自由 300×200：高的相对变化更大 → 高为主轴 → 宽 = 200 × 2
    expect(planResize(START, 'se', { x: 400, y: 300 }, 0, RATIO, passthrough)).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    });
  });

  it('末位整形：整形函数收到「吸附后」的矩形与手柄方向；返回值即落库矩形', () => {
    const snapped = { x: 100, y: 100, width: 145, height: 520 };
    const snaps: IResizeSnaps = { apply: () => snapped };
    const calls: Array<[IRect, string]> = [];
    const constrain: IResizeConstrain = (start, next, dir) => {
      void start;
      calls.push([next, dir]);
      return { ...next, x: 1 };
    };
    expect(planResize(AXIS_START, 'ne', { x: 230, y: 60 }, 0, undefined, snaps, constrain)).toEqual(
      { x: 1, y: 100, width: 145, height: 520 },
    );
    expect(calls).toEqual([[snapped, 'ne']]);
  });

  it('轴对称口径（生命线）：被拖边跟手 = 指针；w 手柄与 e 手柄镜像同解', () => {
    // 东边拖到 230：半宽 = 230 − 160 = 70 → 宽 140；轴 x = 160 不动
    expect(
      planResize(AXIS_START, 'e', { x: 230, y: 100 }, 0, undefined, passthrough, axisSymmetric),
    ).toEqual({ x: 90, y: 100, width: 140, height: 520 });
    // 西边拖到 90：半宽 = 160 − 90 = 70 → 同一个矩形
    expect(
      planResize(AXIS_START, 'w', { x: 90, y: 100 }, 0, undefined, passthrough, axisSymmetric),
    ).toEqual({ x: 90, y: 100, width: 140, height: 520 });
    // 不含横向的手柄不整形
    expect(
      planResize(AXIS_START, 's', { x: 260, y: 700 }, 0, undefined, passthrough, axisSymmetric),
    ).toEqual(resizeRect(AXIS_START, 's', { x: 260, y: 700 }));
  });

  it('轴对称口径 + 吸附：被拖边落在命中线上（整形读的是吸附后的被拖边）', () => {
    const guide = 240; // 命中线画在 240
    const snaps: IResizeSnaps = {
      apply: (_s, rect) => ({ ...rect, width: guide - rect.x }),
    };
    const out = planResize(AXIS_START, 'e', { x: 230, y: 100 }, 0, undefined, snaps, axisSymmetric);
    // 半宽 = 240 − 160 = 80 → 宽 160、x = 80：东边仍在命中线上，西边镜像
    expect(out).toEqual({ x: 80, y: 100, width: 160, height: 520 });
  });

  it('旋转态（θ ≠ 0）不调用整形——需要整形的控件都不可旋转', () => {
    let calls = 0;
    const spy: IResizeConstrain = (_s, next) => {
      calls += 1;
      return next;
    };
    const world = { x: 400, y: 240 };
    expect(planResize(START, 'se', world, Math.PI / 4, undefined, passthrough, spy)).toEqual(
      resizeRotatedRect(START, 'se', world, Math.PI / 4),
    );
    expect(calls).toBe(0);
  });
});
