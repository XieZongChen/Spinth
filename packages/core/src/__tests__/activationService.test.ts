// @vitest-environment jsdom
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Point } from 'pixi.js';
import { ActivationService } from '../widgets/sequence/activationService';

/**
 * 激活条创建手势（specs/sequence-diagram §7.1，批次 3）：轴上按下、纵向拖。
 * 夹具生命线 l1：头框 y 100…136、轴 x = 300、轴段 y 136…656。命中桩只在轴带内
 * 返回件——头框与轴旁空白都不命中（生产由 LifelineVm.hitTestPoint 同口径给出）。
 */

const AXIS = { x: 300, top: 136, bottom: 656 };
const HOST_GEOM = { rect: { x: 240, y: 100, width: 120, height: 600 }, rotation: 0 };

function makeHarness(opts: { editable?: boolean; shapeOnAxis?: boolean } = {}) {
  const calls: string[] = [];
  const added: Array<Record<string, unknown>> = [];
  const model = {
    updateRect: vi.fn((r: Record<string, unknown>) => calls.push(`rect:${r.height}`)),
  };
  const viewport = {
    registerGlobalEventListener: vi.fn(),
    vpScale$: new BehaviorSubject(1),
    editable$: new BehaviorSubject(opts.editable ?? true),
    setCursorMode: vi.fn(() => calls.push('cursor')),
  };
  const engine = {
    add: vi.fn((d: Record<string, unknown>) => {
      added.push(d);
      calls.push('add');
      return {};
    }),
    getModelById: () => model,
    genInitialOrder: () => 'a0',
  };
  const history = { stopCapturing: vi.fn(() => calls.push('stop')) };
  const selector = { setSelected: vi.fn(() => calls.push('select')) };
  const lifeline = {
    id: 'l1',
    type: 'LIFELINE',
    getAxisAnchor: () => AXIS,
    getHostGeom: () => HOST_GEOM,
  };
  const shape = { id: 's1', type: 'SHAPE', getHostGeom: () => HOST_GEOM };
  const vmEngine = {
    getVmById: (id: string) => (id === 'l1' ? lifeline : id === 's1' ? shape : undefined),
    getVmByPoint: (p: Point) => {
      const onAxis = Math.abs(p.x - AXIS.x) <= 6 && p.y >= AXIS.top && p.y <= AXIS.bottom;
      return onAxis ? [opts.shapeOnAxis ? shape : lifeline] : [];
    },
    getVmsInRect: () => [],
  };
  const line = { reattach: vi.fn(() => calls.push('reattach')) };
  const svc = new ActivationService(
    viewport as never,
    engine as never,
    history as never,
    selector as never,
    vmEngine as never,
    line,
  );
  return { svc, handlers: svc.handlers, added, model, calls, viewport, history, selector, line };
}

const at = (x: number, y: number) => ({ world: new Point(x, y) }) as never;

describe('ActivationService：轴上创建', () => {
  it('单击：x 归中到轴、顶 = 按下高度、向下 80、创建数据带 lifelineId；工具保持', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerUp!(at(300, 300));
    expect(h.added).toEqual([
      {
        id: expect.stringMatching(/^[\da-z]{12}$/),
        type: 'ACTIVATION',
        zOrder: 'a0',
        x: 295,
        y: 300,
        width: 10,
        height: 80,
        lifelineId: 'l1',
      },
    ]);
    expect(h.selector.setSelected).not.toHaveBeenCalled();
    expect(h.viewport.setCursorMode).not.toHaveBeenCalled();
  });

  it('收尾顺序：落库 → 重路由宿主（条边让位）→ stopCapturing——同一步撤销', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerUp!(at(300, 300));
    expect(h.calls).toEqual(['add', 'reattach', 'stop']);
    expect(h.line.reattach).toHaveBeenCalledTimes(1);
    expect(h.line.reattach).toHaveBeenCalledWith('l1', HOST_GEOM);
  });

  it('拖拽：滑移不足 10px 不建草稿；过阈值建草稿并跟手；松手选中并回选择工具', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerMove!(at(300, 306)); // 6px < 10：仍按单击
    expect(h.added).toHaveLength(0);
    h.handlers.onPointerMove!(at(300, 310)); // 恰 10px：下拉 10 钳到下限 16
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({ x: 295, y: 300, width: 10, height: 16, lifelineId: 'l1' });
    h.handlers.onPointerMove!(at(340, 360)); // 横向偏移不影响 x 归中
    expect(h.model.updateRect).toHaveBeenLastCalledWith({ x: 295, y: 300, width: 10, height: 60 });
    h.handlers.onPointerUp!(at(340, 360));
    expect(h.added).toHaveLength(1); // 松手不再另建
    expect(h.calls).toEqual(['add', 'rect:60', 'reattach', 'stop', 'select', 'cursor']);
    expect(h.selector.setSelected).toHaveBeenCalledWith([expect.stringMatching(/^[\da-z]{12}$/)]);
    expect(h.viewport.setCursorMode).toHaveBeenCalledWith('cursor');
  });

  it('向上拖钳到下限 16、顶仍是按下高度；按下点贴轴底时底不出轴底', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerMove!(at(300, 250));
    h.handlers.onPointerUp!(at(300, 250));
    expect(h.added[0]).toMatchObject({ y: 300, height: 16 });

    const low = makeHarness();
    low.handlers.onPointerDown!(at(300, 616)); // 距轴底 40
    low.handlers.onPointerMove!(at(300, 716));
    low.handlers.onPointerUp!(at(300, 716));
    expect(low.added[0]).toMatchObject({ y: 616, height: 40 });
  });
});

describe('ActivationService：按下门禁（不建 = 零写入、不切撤销边界）', () => {
  const expectNothing = (h: ReturnType<typeof makeHarness>) => {
    expect(h.added).toEqual([]);
    expect(h.history.stopCapturing).not.toHaveBeenCalled();
    expect(h.line.reattach).not.toHaveBeenCalled();
    expect(h.viewport.setCursorMode).not.toHaveBeenCalled();
  };

  it('点头框 / 轴旁空白：不建', () => {
    const head = makeHarness();
    head.handlers.onPointerDown!(at(300, 118));
    head.handlers.onPointerUp!(at(300, 118));
    expectNothing(head);

    const blank = makeHarness();
    blank.handlers.onPointerDown!(at(380, 300));
    blank.handlers.onPointerMove!(at(380, 360));
    blank.handlers.onPointerUp!(at(380, 360));
    expectNothing(blank);
  });

  it('压在轴上的普通件：顶层命中的不是轴宿主，不建', () => {
    const h = makeHarness({ shapeOnAxis: true });
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerMove!(at(300, 360));
    h.handlers.onPointerUp!(at(300, 360));
    expectNothing(h);
  });

  it('按下点距轴底不足 16：单击与拖拽都不建（两条钳制不可同时满足）', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 650));
    h.handlers.onPointerMove!(at(300, 700));
    h.handlers.onPointerMove!(at(300, 740));
    h.handlers.onPointerUp!(at(300, 740));
    expectNothing(h);
  });

  it('只读早退：不建', () => {
    const h = makeHarness({ editable: false });
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerUp!(at(300, 300));
    expectNothing(h);
  });

  it('取消：草稿手势中断后会话复位——随后的 up 不收尾，再次按下照常', () => {
    const h = makeHarness();
    h.handlers.onPointerDown!(at(300, 300));
    h.handlers.onPointerMove!(at(300, 360)); // 草稿已建（下拉 60）
    h.handlers.onPointerMove!(at(300, 380)); // 跟手到 80
    h.handlers.onPointerCancel!(at(300, 380));
    h.handlers.onPointerUp!(at(300, 380));
    expect(h.calls).toEqual(['add', 'rect:80']); // 取消后不重路由 / 不选中 / 不切工具
    h.handlers.onPointerDown!(at(300, 420));
    h.handlers.onPointerUp!(at(300, 420));
    expect(h.added[1]).toMatchObject({ x: 295, y: 420, height: 80, lifelineId: 'l1' });
  });

  it('initialize 抛错：不注册指针处理器（由 SequenceService 转发）', () => {
    const h = makeHarness();
    expect(() => h.svc.initialize()).toThrow(/SequenceService/);
    expect(h.viewport.registerGlobalEventListener).not.toHaveBeenCalled();
  });
});
