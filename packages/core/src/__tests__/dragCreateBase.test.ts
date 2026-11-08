import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { Point } from 'pixi.js';
import { ShapeService } from '../widgets/shape/shapeService';

/**
 * DragCreateServiceBase 指针状态机（docs/04 §2）——经 ShapeService 驱动：
 * 单击与拖拽画图的分界 = 10 屏幕 px（与 docs/05 §4.1 起拖阻尼同值）；
 * 低于分界一律按单击（默认尺寸、以按下点为中心、工具保持、不选中）。
 * 捕获 handlers 的桩写法照 penService.test 先例。
 */

type Handler = (e: { world: Point }) => void;

function makeHarness(scale = 1) {
  const handlers: Record<string, Handler | undefined> = {};
  const added: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  const model = { updateRect: vi.fn() };
  const viewport = {
    registerGlobalEventListener: (_m: string, h: Record<string, Handler>) =>
      Object.assign(handlers, h),
    vpScale$: new BehaviorSubject(scale),
    setCursorMode: vi.fn(),
  };
  const engine = {
    add: vi.fn((w: (typeof added)[number]) => {
      added.push(w);
      return { id: w.id };
    }),
    getModelById: vi.fn(() => model),
    genInitialOrder: () => 'a0',
  };
  const history = { stopCapturing: vi.fn() };
  const selector = { setSelected: vi.fn() };
  const svc = new ShapeService(
    viewport as never,
    engine as never,
    history as never,
    selector as never,
  );
  svc.initialize();
  return { handlers, added, model, viewport, history, selector };
}

const at = (x: number, y: number): { world: Point } => ({ world: new Point(x, y) });

describe('拖拽创建基类：单击与拖拽画图的分界（10 屏幕 px）', () => {
  it('单击滑移 8px：不建草稿，按单击落默认 120×80，以按下点为中心、工具保持、不选中', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 200));
    h.handlers.onPointerMove!(at(308, 200)); // 滑移 8px < 10
    expect(h.added).toHaveLength(0); // 未建草稿
    h.handlers.onPointerUp!(at(308, 200));
    expect(h.added).toHaveLength(1);
    // 以按下点 (300,200) 为中心——不是松手点 (308,200)
    expect(h.added[0]).toMatchObject({ x: 240, y: 160, width: 120, height: 80 });
    expect(h.history.stopCapturing).toHaveBeenCalledTimes(1);
    expect(h.selector.setSelected).not.toHaveBeenCalled();
    expect(h.viewport.setCursorMode).not.toHaveBeenCalled();
  });

  it('位移达到 10px 建草稿并跟手；松手选中新件并回选择工具', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 200));
    h.handlers.onPointerMove!(at(310, 200)); // 恰 10px（边界 >=）
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({ x: 300, y: 200, width: 10, height: 8 }); // 最小边 8
    h.handlers.onPointerMove!(at(420, 280));
    expect(h.model.updateRect).toHaveBeenLastCalledWith({ x: 300, y: 200, width: 120, height: 80 });
    h.handlers.onPointerUp!(at(420, 280));
    expect(h.added).toHaveLength(1); // 松手不再另建
    expect(h.selector.setSelected).toHaveBeenCalledWith([h.added[0]!.id]);
    expect(h.viewport.setCursorMode).toHaveBeenCalledWith('cursor');
    expect(h.history.stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('分界按屏幕口径：zoom 4x 下世界 2.25（屏幕 9px）不建草稿，世界 2.5（屏幕 10px）建', () => {
    const h = makeHarness(4);
    h.handlers.onPointerDown!(at(0, 0));
    h.handlers.onPointerMove!(at(2.25, 0));
    expect(h.added).toHaveLength(0);
    h.handlers.onPointerMove!(at(2.5, 0));
    expect(h.added).toHaveLength(1);
  });
});
