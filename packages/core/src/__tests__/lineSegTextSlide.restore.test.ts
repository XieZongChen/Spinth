// @vitest-environment jsdom
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { LineSegTextSlide } from '../widgets/line/lineSegTextSlide';
import { effectivePath } from '../widgets/line/lineMath';
import type { LineVm } from '../widgets/line/lineVm';

/**
 * 拐点微移（<4px）松手回提交态（specs/flowchart-closeout 返工）：
 * cornerDragMove 对微移也 previewRoute——up 恢复分支必须显式 previewRoute
 * (提交态) 拉回线身，否则线停在预览位与数据分离（手势期零写、无
 * onStateChanged 广播来纠正）。
 */

const PTS: Array<[number, number]> = [
  [0, 0],
  [0, 200],
  [400, 200],
  [400, 0],
  [500, 0],
];

function makeSlide() {
  const state = {
    points: PTS.map((p) => [p[0]!, p[1]!] as [number, number]),
    lineType: 'ELBOWED',
    text: '<p>字</p>',
    textRatio: 0.5,
  };
  const previewCalls: Array<Array<{ x: number; y: number }>> = [];
  const previewRatioCalls: number[] = [];
  const vm = {
    id: 'L1',
    type: 'LINE',
    state,
    previewRoute: (pts: Array<{ x: number; y: number }>) =>
      previewCalls.push(pts.map((p) => ({ ...p }))),
    previewTextRatio: (ratio: number) => previewRatioCalls.push(ratio),
    hitTestText: () => true,
  } as unknown as LineVm;
  const updates: unknown[] = [];
  const viewport = {
    clientToWorld: (cx: number, cy: number) => ({ x: cx, y: cy }),
    worldToClient: (x: number, y: number) => ({ x, y }),
    vpScale$: new BehaviorSubject(1),
  };
  const slide = new LineSegTextSlide(
    viewport as never,
    { getModelById: () => ({ update: (p: unknown) => updates.push(p) }) } as never,
    { getVmById: () => vm } as never,
    { stopCapturing: () => {} } as never,
    { hideSegmentHandles: () => {}, showSegmentHandles: () => {} } as never,
  );
  return { slide, previewCalls, previewRatioCalls, updates, state };
}

/** jsdom 无 PointerEvent 构造器——MouseEvent 携 clientX/Y、type 对齐即可送达 */
const fire = (type: string, x: number, y: number): void => {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
};

describe('拐点微移 <4px 松手：线身回提交态', () => {
  it('微移预览后松手 → 最后一次 previewRoute = 提交态路径，零模型写', () => {
    const { slide, previewCalls, updates, state } = makeSlide();
    expect(slide.maybeCornerDragGrab('L1', { x: 400, y: 200 })).toBe(true);

    // 微移 2.2px：线身被 previewRoute 推到微移位（旧缺陷：此后无广播纠正）
    fire('pointermove', 402, 201);
    expect(previewCalls.length).toBe(1);
    expect(previewCalls[0]![2]).toEqual({ x: 402, y: 201 });

    // 总位移 <4px → 恢复分支：显式拉回提交态、零写入
    fire('pointerup', 402, 201);
    expect(updates).toHaveLength(0);
    const restored = previewCalls.at(-1)!;
    const committed = effectivePath(
      state.points.map((p) => ({ x: p[0], y: p[1] })),
      'ELBOWED',
    );
    expect(restored).toEqual(committed);
  });
});

describe('段滑移微移 <4px 松手：线身回提交态（二轮返工同款）', () => {
  it('微移预览后松手 → 最后一次 previewRoute = 提交态路径，零模型写', () => {
    const { slide, previewCalls, updates, state } = makeSlide();
    // 主线身段 (0,200)-(400,200) 中点附近按下（线身任意点即拖）
    expect(slide.maybeSegmentSlideGrab('L1', { x: 200, y: 200 }, false)).toBe(true);
    fire('pointermove', 200, 202); // 微移 2px（段法向 y）→ previewRoute(微移)
    expect(previewCalls.length).toBe(1);
    fire('pointerup', 200, 202); // 总位移 <4px → 恢复分支
    expect(updates).toHaveLength(0);
    const restored = previewCalls.at(-1)!;
    const committed = effectivePath(
      state.points.map((p) => ({ x: p[0], y: p[1] })),
      'ELBOWED',
    );
    expect(restored).toEqual(committed);
  });
});

describe('文字滑移微移 <4px 松手：文字回提交态 ratio（二轮返工同款）', () => {
  it('微移预览后松手 → 最后一次 previewTextRatio = 提交态 0.5，零模型写', () => {
    const { slide, previewRatioCalls, updates } = makeSlide();
    expect(slide.maybeTextSlideGrab('L1', { x: 200, y: 200 })).toBe(true);
    fire('pointermove', 202, 201); // 微移 → ratio 预览
    expect(previewRatioCalls.length).toBe(1);
    expect(previewRatioCalls[0]).not.toBe(0.5); // 确实动过
    fire('pointerup', 202, 201); // <4px → 恢复分支
    expect(updates).toHaveLength(0);
    expect(previewRatioCalls.at(-1)).toBe(0.5); // 显式拉回提交态
  });
});
