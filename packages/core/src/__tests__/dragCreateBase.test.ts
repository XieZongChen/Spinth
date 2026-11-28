import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { Point } from 'pixi.js';
import type { CursorMode, IPointerEventInfo, IPointerHandlers } from '../types';
import type { IRect } from '../common/geometry';
import { DragCreateServiceBase } from '../widgets/base/dragCreateServiceBase';
import { ShapeService } from '../widgets/shape/shapeService';
import { StickyService } from '../widgets/sticky/stickyService';

/**
 * DragCreateServiceBase 指针状态机（docs/04 §2）——经 ShapeService / StickyService
 * 驱动：shape 单击与拖拽画图的分界 = 10 屏幕 px（与 docs/05 §4.1 起拖阻尼同值）；
 * sticky 覆写为两轴各 ≥ 24 屏幕 px。低于分界一律按单击（默认尺寸、以按下点为
 * 中心、工具保持、不选中——shape/sticky 一致）。
 * 捕获 handlers 的桩写法照 penService.test 先例。
 */

type Handler = (e: { world: Point }) => void;

/**
 * 钩子最小子类（specs/sequence-diagram §7.1，批次 3 前置重构）：基类把「按下门禁 /
 * 单击矩形 / 草稿矩形 / 落库后收尾」留成 protected 方法，缺省实现 = 既有行为。
 * 这里全部覆写并把调用序记进 calls，与 history.stopCapturing 的相对顺序可断言。
 */
class GatedService extends DragCreateServiceBase {
  readonly calls: string[] = [];
  allowPress = false;
  click: IRect | null = { x: 5, y: 100, width: 10, height: 80 };
  protected readonly scope: CursorMode = 'sequence';
  protected readonly defaultSize = { width: 10, height: 80 };
  protected override readonly minDraftSize = { width: 10, height: 16 };

  /** 门禁：不调 super = start 保持 null */
  protected override onPointerDown(e: IPointerEventInfo): void {
    if (this.allowPress) super.onPointerDown(e);
  }

  protected override clickRect(): IRect | null {
    return this.click;
  }

  /** 草稿：下拉不足 16 不建（每帧继续询问） */
  protected override draftRect(_dx: number, dy: number): IRect | null {
    return dy < 16 ? null : { x: 5, y: 100, width: 10, height: dy };
  }

  protected override afterCreate(id: string): void {
    this.calls.push(`after:${id}`);
  }

  protected createWidget(): string {
    const id = `n${this.calls.length}`;
    this.calls.push(`create:${id}`);
    return id;
  }
}

type CreateServiceCtor = typeof ShapeService | typeof StickyService | typeof GatedService;

function makeHarness(scale = 1, Ctor: CreateServiceCtor = ShapeService) {
  const handlers: Record<string, Handler | undefined> = {};
  /** initialize() 交给 registerGlobalEventListener 的原对象（身份断言用） */
  let registered: Record<string, Handler> | undefined;
  const added: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  const model = { updateRect: vi.fn() };
  const viewport = {
    registerGlobalEventListener: (_m: string, h: Record<string, Handler>) => {
      registered = h;
      Object.assign(handlers, h);
    },
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
  const svc = new Ctor(viewport as never, engine as never, history as never, selector as never);
  svc.initialize();
  return { handlers, registered, added, model, engine, viewport, history, selector, svc };
}

const at = (x: number, y: number): { world: Point } => ({ world: new Point(x, y) });

/** 基类焊死的五个指针成员（IPointerHandlers 的 onRightClick 不在创建流里） */
const HANDLER_KEYS: ReadonlyArray<keyof IPointerHandlers> = [
  'onPointerCancel',
  'onPointerDown',
  'onPointerMove',
  'onPointerUp',
  'onPointerUpOutside',
];

describe('拖拽创建基类：处理器对象是只读属性 handlers', () => {
  it('initialize() 注册的就是 handlers——同一引用，五个成员齐全（多图元工具转发用）', () => {
    const h = makeHarness();
    expect(h.registered).toBe(h.svc.handlers);
    for (const key of HANDLER_KEYS) {
      expect(typeof h.svc.handlers[key], key).toBe('function');
    }
  });
});

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

describe('拖拽创建基类：便签（两轴各 ≥ 24 屏幕 px 门控，单击语义与 shape 一致）', () => {
  it('便签带滑移单击：单轴未达 24px 不建草稿，按单击落默认 180×180、以按下点为中心', () => {
    const h = makeHarness(1, StickyService);
    h.handlers.onPointerDown!(at(300, 200));
    h.handlers.onPointerMove!(at(320, 205)); // dx 20 / dy 5：两轴未同时达 24
    expect(h.added).toHaveLength(0);
    h.handlers.onPointerUp!(at(320, 205));
    expect(h.added).toHaveLength(1);
    // 以按下点 (300,200) 为中心——松手点居中会是 (230,115)
    expect(h.added[0]).toMatchObject({ x: 210, y: 110, width: 180, height: 180 });
    expect(h.selector.setSelected).not.toHaveBeenCalled();
    expect(h.viewport.setCursorMode).not.toHaveBeenCalled();
  });

  it('便签门控锁：40×10 不建草稿（须两轴同时达到），24×24 建草稿', () => {
    const h = makeHarness(1, StickyService);
    h.handlers.onPointerDown!(at(0, 0));
    h.handlers.onPointerMove!(at(40, 10));
    expect(h.added).toHaveLength(0);
    h.handlers.onPointerMove!(at(24, 24));
    expect(h.added).toHaveLength(1);
  });
});

/** 钩子用例的公共驱动：calls 里同时记 history.stopCapturing（'stop'）的调用序 */
function makeGated(scale = 1) {
  const h = makeHarness(scale, GatedService);
  const svc = h.svc as GatedService;
  h.history.stopCapturing.mockImplementation(() => svc.calls.push('stop'));
  return { ...h, svc };
}

describe('拖拽创建基类：零行为钩子（按下门禁 / 单击矩形 / 草稿矩形 / 落库后收尾）', () => {
  it('按下门禁：子类不调 super → move / up 全部空转，不建件、不切撤销边界', () => {
    const h = makeGated();
    h.handlers.onPointerDown!(at(300, 200));
    h.handlers.onPointerMove!(at(300, 260));
    h.handlers.onPointerUp!(at(300, 260));
    expect(h.svc.calls).toEqual([]);
    expect(h.history.stopCapturing).not.toHaveBeenCalled();
    expect(h.selector.setSelected).not.toHaveBeenCalled();
  });

  it('clickRect 返回 null：单击不落件，也不 stopCapturing', () => {
    const h = makeGated();
    h.svc.allowPress = true;
    h.svc.click = null;
    h.handlers.onPointerDown!(at(300, 200));
    h.handlers.onPointerUp!(at(300, 200));
    expect(h.svc.calls).toEqual([]);
    // 手势已复位：再次按下（这次给矩形）照常落件
    h.svc.click = { x: 5, y: 200, width: 10, height: 80 };
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerUp!(at(300, 300));
    expect(h.svc.calls).toEqual(['create:n0', 'after:n0', 'stop']);
  });

  it('draftRect 返回 null：本帧不建草稿并继续逐帧询问；非 null 才建、跟手、收尾', () => {
    const h = makeGated();
    h.svc.allowPress = true;
    h.handlers.onPointerDown!(at(300, 100));
    h.handlers.onPointerMove!(at(300, 110)); // 10px 过阈值但下拉 < 16
    expect(h.svc.calls).toEqual([]);
    h.handlers.onPointerMove!(at(300, 130));
    expect(h.svc.calls).toEqual(['create:n0']);
    expect(h.engine.getModelById).not.toHaveBeenCalled(); // 创建帧无需跟手写
    h.handlers.onPointerMove!(at(300, 150));
    expect(h.model.updateRect).toHaveBeenLastCalledWith({ x: 5, y: 100, width: 10, height: 50 });
    h.handlers.onPointerUp!(at(300, 150));
    expect(h.svc.calls).toEqual(['create:n0', 'after:n0', 'stop']);
    expect(h.selector.setSelected).toHaveBeenCalledWith(['n0']);
    expect(h.viewport.setCursorMode).toHaveBeenCalledWith('cursor');
  });

  it('收尾钩子在 stopCapturing 之前、选区与模式切换之前（钩子里的重路由并入同一步撤销）', () => {
    const h = makeGated();
    h.svc.allowPress = true;
    h.selector.setSelected.mockImplementation(() => h.svc.calls.push('select'));
    h.viewport.setCursorMode.mockImplementation(() => h.svc.calls.push('cursor'));
    h.handlers.onPointerDown!(at(300, 100));
    h.handlers.onPointerMove!(at(300, 150));
    h.handlers.onPointerUp!(at(300, 150));
    expect(h.svc.calls).toEqual(['create:n0', 'after:n0', 'stop', 'select', 'cursor']);
  });

  it('取消：子类经 super 复位会话状态——取消后的 up 不落件', () => {
    const h = makeGated();
    h.svc.allowPress = true;
    h.handlers.onPointerDown!(at(300, 100));
    h.handlers.onPointerCancel!({ world: new Point(300, 100) } as never);
    h.handlers.onPointerUp!(at(300, 100));
    expect(h.svc.calls).toEqual([]);
  });
});
