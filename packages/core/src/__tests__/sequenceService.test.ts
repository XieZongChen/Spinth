// @vitest-environment jsdom
import { BehaviorSubject, skip } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Point } from 'pixi.js';
import { SequenceService } from '../widgets/sequence/sequenceService';
import { LifelineService } from '../widgets/sequence/lifelineService';
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
    const svc = new SequenceService(viewport as never, lifeline);
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
    h.svc.setKind('message'); // 批次 2 才有——当前忽略
    h.svc.setKind('lifeline'); // 同值
    expect(h.svc.currentKind).toBe('lifeline');
    expect(emissions).toEqual([]);
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
