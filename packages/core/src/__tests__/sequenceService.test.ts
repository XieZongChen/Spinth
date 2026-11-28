// @vitest-environment jsdom
import { BehaviorSubject, skip } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Point } from 'pixi.js';
import { SequenceService } from '../widgets/sequence/sequenceService';
import { LifelineService } from '../widgets/sequence/lifelineService';
import { MESSAGE_RETURN_POLICY } from '../widgets/line/lineAxisAnchor';
import { BoardCommands } from '../boardCommands';
import type { IBoardCommandHost } from '../boardHost';
import type { IPointerEventInfo, IPointerHandlers } from '../types';

/**
 * 时序图工具编排（specs/sequence-diagram §7.1，批次 1）：'sequence' 是多图元
 * 工具——一个 CursorMode 只能注册一组处理器，SequenceService 是唯一注册者，
 * 事件到达时按当前图元种类转发到该图元自己的服务（生命线服务不注册）。
 */

const HANDLER_KEYS = [
  'onPointerDown',
  'onPointerMove',
  'onPointerUp',
  'onPointerUpOutside',
  'onPointerCancel',
  'onRightClick',
] as const satisfies ReadonlyArray<keyof IPointerHandlers>;

const evt = (x: number): IPointerEventInfo =>
  ({ world: new Point(x, 0), screen: new Point(x, 0), shiftKey: false, metaKey: false }) as never;
const evtAt = (x: number, y: number): IPointerEventInfo =>
  ({ world: new Point(x, y), screen: new Point(x, y), shiftKey: false, metaKey: false }) as never;

describe('SequenceService：转发与种类记忆', () => {
  function makeHarness() {
    const registered = new Map<string, IPointerHandlers>();
    const viewport = {
      registerGlobalEventListener: vi.fn((mode: string, h: IPointerHandlers) => {
        registered.set(mode, h);
      }),
    };
    const seen: Array<[string, IPointerEventInfo]> = [];
    const lifelineHandlers: IPointerHandlers = {
      onPointerDown: (e) => seen.push(['down', e]),
      onPointerMove: (e) => seen.push(['move', e]),
      onPointerUp: (e) => seen.push(['up', e]),
      onPointerUpOutside: (e) => seen.push(['upOutside', e]),
      onPointerCancel: (e) => seen.push(['cancel', e]),
    };
    const lifeline = { handlers: lifelineHandlers } as unknown as LifelineService;
    const svc = new SequenceService(viewport as never, {} as never, lifeline);
    return { svc, registered, viewport, seen, lifelineHandlers };
  }

  it("initialize 只注册 'sequence' 一次，注册对象就是 handlers（同一引用）", () => {
    const h = makeHarness();
    h.svc.initialize();
    expect(h.viewport.registerGlobalEventListener).toHaveBeenCalledTimes(1);
    expect(h.viewport.registerGlobalEventListener).toHaveBeenCalledWith('sequence', h.svc.handlers);
    expect(h.registered.get('sequence')).toBe(h.svc.handlers);
    expect(h.registered.size).toBe(1);
  });

  it('五个指针成员逐个转发到生命线服务，事件对象原样透传', () => {
    const h = makeHarness();
    const r = h.registered.size; // 未 initialize 也能直接驱动 handlers（转发逻辑不依赖注册）
    expect(r).toBe(0);
    const down = evt(1);
    const move = evt(2);
    const up = evt(3);
    const outside = evt(4);
    const cancel = evt(5);
    h.svc.handlers.onPointerDown?.(down);
    h.svc.handlers.onPointerMove?.(move);
    h.svc.handlers.onPointerUp?.(up);
    h.svc.handlers.onPointerUpOutside?.(outside);
    h.svc.handlers.onPointerCancel?.(cancel);
    expect(h.seen).toEqual([
      ['down', down],
      ['move', move],
      ['up', up],
      ['upOutside', outside],
      ['cancel', cancel],
    ]);
  });

  it('五个指针成员恒有定义（转发目标缺成员时是 no-op，不抛错）', () => {
    const bare = { handlers: {} };
    const svc = new SequenceService(
      { registerGlobalEventListener: vi.fn() } as never,
      {} as never,
      bare as never,
    );
    for (const k of HANDLER_KEYS) expect(typeof svc.handlers[k], k).toBe('function');
    const e = evt(9);
    expect(() => {
      svc.handlers.onPointerDown?.(e);
      svc.handlers.onPointerMove?.(e);
      svc.handlers.onPointerUp?.(e);
      svc.handlers.onPointerUpOutside?.(e);
      svc.handlers.onPointerCancel?.(e);
    }).not.toThrow();
  });

  it('种类记忆：合法值切换并发射；同值 / 未知值忽略（档位外取值不污染会话）', () => {
    const h = makeHarness();
    const emissions: string[] = [];
    // BehaviorSubject 订阅即发当前值——只记其后的切换
    h.svc.kind$.pipe(skip(1)).subscribe((k) => emissions.push(k));
    expect(h.svc.currentKind).toBe('lifeline'); // 缺省
    h.svc.setKind('message'); // 不是合法种类 id（消息种类是 message-sync 等）——忽略
    h.svc.setKind('lifeline'); // 同值
    expect(h.svc.currentKind).toBe('lifeline');
    expect(emissions).toEqual([]);
  });

  it('消息种类：指针成员转发到 lineService.drawHandlers，并按种类给拉线策略（仅时序图工具激活时）', () => {
    const seen: number[] = [];
    const drawHandlers: IPointerHandlers = {
      onPointerDown: (e) => seen.push(e.world.x),
      onPointerUp: (e) => seen.push(e.world.x + 100),
    };
    const lifeline = { handlers: { onPointerDown: () => seen.push(-1) } };
    const line = { drawHandlers, drawPolicyProbe: null as (() => unknown) | null };
    const cursorMode$ = new BehaviorSubject('line');
    const svc = new SequenceService(
      { registerGlobalEventListener: vi.fn(), cursorMode$ } as never,
      {} as never,
      lifeline as never,
      line as never,
    );
    expect(typeof line.drawPolicyProbe).toBe('function');
    const probe = line.drawPolicyProbe as () => unknown;
    // 生命线种类：无策略，指针仍走生命线服务
    expect(probe()).toBeUndefined();
    svc.handlers.onPointerDown?.(evt(1));
    expect(seen).toEqual([-1]);
    // 切到消息种类：通用连线工具（'line' 模式）激活时不给策略——同一组 drawHandlers
    // 不能被时序图的预设劫持
    svc.setKind('message-return');
    expect(probe()).toBeUndefined();
    cursorMode$.next('sequence');
    expect(probe()).toEqual(MESSAGE_RETURN_POLICY);
    svc.handlers.onPointerDown?.(evt(2));
    svc.handlers.onPointerUp?.(evt(3));
    expect(seen).toEqual([-1, 2, 103]);
    // 切回生命线：转发回去、策略清空
    svc.setKind('lifeline');
    expect(probe()).toBeUndefined();
    svc.handlers.onPointerDown?.(evt(4));
    expect(seen).toEqual([-1, 2, 103, -1]);
  });

  it('line 未组装（桩环境）：消息种类转发为 no-op，不抛错', () => {
    const lifeline = { handlers: { onPointerDown: vi.fn() } };
    const svc = new SequenceService(
      {
        registerGlobalEventListener: vi.fn(),
        cursorMode$: new BehaviorSubject('sequence'),
      } as never,
      {} as never,
      lifeline as never,
    );
    svc.setKind('message-sync');
    for (const k of HANDLER_KEYS) expect(() => svc.handlers[k]?.(evt(9))).not.toThrow();
    expect(lifeline.handlers.onPointerDown).not.toHaveBeenCalled();
  });

  it('axisOf（ISequenceLookup，§9.4）：轴宿主返回其轴；普通件 / vm 缺失返回 null', () => {
    const axis = { x: 260, top: 136, bottom: 620 };
    const vms: Record<string, object> = {
      l1: { getAxisAnchor: () => axis },
      s1: {},
    };
    const svc = new SequenceService(
      { registerGlobalEventListener: vi.fn() } as never,
      { getVmById: (id: string) => vms[id] } as never,
      { handlers: {} } as never,
    );
    expect(svc.axisOf('l1')).toEqual(axis);
    expect(svc.axisOf('s1')).toBeNull();
    expect(svc.axisOf('missing')).toBeNull();
  });

  it('barsOf：本批恒空（激活条属批次 3），且每次返回新数组', () => {
    const h = makeHarness();
    expect(h.svc.barsOf('l1')).toEqual([]);
    expect(h.svc.barsOf('l1')).not.toBe(h.svc.barsOf('l1'));
  });

  it('激活条种类：注入 tools 时转发到激活条手势（不走生命线、无拉线策略）', () => {
    const seen: string[] = [];
    const added: Array<Record<string, unknown>> = [];
    const AXIS = { x: 300, top: 136, bottom: 656 };
    const lifelineVm = {
      id: 'l1',
      type: 'LIFELINE',
      getAxisAnchor: () => AXIS,
      getHostGeom: () => ({ rect: { x: 240, y: 100, width: 120, height: 600 }, rotation: 0 }),
    };
    const lifeline = { handlers: { onPointerDown: () => seen.push('lifeline') } };
    const line = {
      drawHandlers: { onPointerDown: () => seen.push('line') },
      drawPolicyProbe: null as (() => unknown) | null,
      reattach: vi.fn(),
    };
    const svc = new SequenceService(
      {
        registerGlobalEventListener: vi.fn(),
        vpScale$: new BehaviorSubject(1),
        cursorMode$: new BehaviorSubject('sequence'),
        editable$: new BehaviorSubject(true),
        setCursorMode: vi.fn(),
      } as never,
      {
        getVmById: (id: string) => (id === 'l1' ? lifelineVm : undefined),
        getVmByPoint: (p: Point) => (Math.abs(p.x - AXIS.x) <= 6 ? [lifelineVm] : []),
        getVmsInRect: () => [],
      } as never,
      lifeline as never,
      line as never,
      {
        engine: {
          add: vi.fn((d: Record<string, unknown>) => {
            added.push(d);
            return {};
          }),
          getModelById: () => ({ updateRect: vi.fn() }),
          genInitialOrder: () => 'a0',
        },
        history: { stopCapturing: vi.fn() },
        selector: { setSelected: vi.fn() },
      } as never,
    );
    svc.setKind('activation');
    expect(line.drawPolicyProbe!()).toBeUndefined(); // 激活条不是拉线图元
    svc.handlers.onPointerDown?.(evtAt(300, 300));
    svc.handlers.onPointerUp?.(evtAt(300, 300));
    expect(seen).toEqual([]);
    expect(added).toEqual([
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
    expect(line.reattach).toHaveBeenCalledWith('l1', lifelineVm.getHostGeom());
  });

  it('激活条种类未注入 tools（桩环境）：转发为 no-op，不抛错', () => {
    const lifeline = { handlers: { onPointerDown: vi.fn() } };
    const svc = new SequenceService(
      { registerGlobalEventListener: vi.fn() } as never,
      {} as never,
      lifeline as never,
    );
    svc.setKind('activation');
    expect(svc.currentKind).toBe('activation');
    for (const k of HANDLER_KEYS) expect(() => svc.handlers[k]?.(evtAt(300, 300))).not.toThrow();
    expect(lifeline.handlers.onPointerDown).not.toHaveBeenCalled();
  });

  it('命令通道：setDefaultToolOption(sequence, kind) → SequenceService.setKind', () => {
    const setKind = vi.fn();
    const ctx = { sequence: { setKind } } as unknown as IBoardCommandHost;
    new BoardCommands(ctx).setDefaultToolOption('sequence', 'kind', 'lifeline');
    expect(setKind).toHaveBeenCalledTimes(1);
    expect(setKind).toHaveBeenCalledWith('lifeline');
  });
});

describe('LifelineService：不自行注册、创建与标签编辑入口', () => {
  const DATA = {
    id: 'l1',
    type: 'LIFELINE',
    zOrder: 'a0',
    label: '',
    x: 100,
    y: 50,
    width: 120,
    height: 520,
  };

  function makeLifeline(editing: unknown = null, withModel = false) {
    const register = vi.fn();
    const added: Array<Record<string, unknown>> = [];
    const engine = {
      add: vi.fn((d: Record<string, unknown>) => {
        added.push(d);
        return {};
      }),
      genInitialOrder: () => 'a0',
      getModelById: () => (withModel ? { toJSON: () => DATA, update: vi.fn() } : undefined),
    };
    const viewport = {
      registerGlobalEventListener: register,
      vpScale$: new BehaviorSubject(1),
      editable$: new BehaviorSubject(true),
    };
    const svc = new LifelineService(
      viewport as never,
      engine as never,
      {
        getVmById: () => ({ id: 'l1', type: 'LIFELINE', setLabelEditing: vi.fn() }),
      } as never,
      {} as never,
      { stopCapturing: vi.fn() } as never,
      editing as never,
    );
    return { svc, register, added, engine, viewport };
  }

  it('initialize 抛错：生命线服务不注册指针处理器（由 SequenceService 转发）', () => {
    const h = makeLifeline();
    expect(() => h.svc.initialize()).toThrow(/SequenceService/);
    expect(h.register).not.toHaveBeenCalled();
  });

  it('创建：一次 add 写 { type:LIFELINE, label:"", zOrder, rect }（样式缺省走 schema）', () => {
    const h = makeLifeline();
    const create = (
      h.svc as unknown as { createWidget: (x: number, y: number, w: number, h: number) => string }
    ).createWidget.bind(h.svc); // 方法提取须绑 this（生产调用恒经实例）
    const id = create(200, 100, 120, 520);
    expect(id).toMatch(/^[\da-z]{12}$/);
    expect(h.added).toEqual([
      { id, type: 'LIFELINE', zOrder: 'a0', label: '', x: 200, y: 100, width: 120, height: 520 },
    ]);
  });

  it('默认尺寸 120×520、草稿下限 60×120（与几何常量同源）', () => {
    const h = makeLifeline();
    const w = h.svc as unknown as {
      defaultSize: { width: number; height: number };
      minDraftSize: { width: number; height: number };
    };
    expect(w.defaultSize).toEqual({ width: 120, height: 520 });
    expect(w.minDraftSize).toEqual({ width: 60, height: 120 });
  });

  it('enterLabelEdit 委托标签编辑协作者：editing 未组装拒绝；组装后按头框判据', () => {
    const none = makeLifeline();
    expect(none.svc.enterLabelEdit('l1')).toBe(false);
    expect(none.svc.editingLabelId).toBeNull();

    const begun: string[] = [];
    const editing = {
      begin: (d: { widgetId: string }) => begun.push(d.widgetId),
      exitActive: vi.fn(),
    };
    const h = makeLifeline(editing, true);
    expect(h.svc.enterLabelEdit('l1', { x: 105, y: 60 })).toBe(true); // 头框内
    expect(begun).toEqual(['l1']);
    expect(h.svc.editingLabelId).toBe('l1');
    expect(h.svc.enterLabelEdit('l1', { x: 160, y: 300 })).toBe(false); // 点轴不算
    expect(begun).toHaveLength(1);
  });
});
