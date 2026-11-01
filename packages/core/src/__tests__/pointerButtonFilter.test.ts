import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { Point, type Container } from 'pixi.js';
import { ViewportPointerInput } from '../platform/viewport/viewportPointerInput';
import type { CursorMode } from '../types';

/**
 * 指针主键过滤真值表（specs/a11y-closeout §13.5-7）：down/up/upoutside 上
 * `button != null && button !== 0` 拦截、touch/pen 缺省 button（pixi 归一路径）
 * 放行、rightdown 独立通道不受过滤影响。node 环境 stage/canvas/window 全桩化
 * （同 pointerReplay.test.ts），事件经 bind() 注册的 handler 注入（生产同路径）。
 * 注入事件不带 pointerId——dispatch 的 pointerId 抢占层只对带 id 的事件生效，
 * 缺省注入让 button 过滤成为被测的唯一变量。
 */

type Handler = ReturnType<typeof vi.fn>;

interface Handlers {
  down: Handler;
  move: Handler;
  up: Handler;
  upOutside: Handler;
  right: Handler;
  send: (
    event: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerupoutside' | 'rightdown',
    button?: number,
  ) => void;
  dispose: () => void;
}

function createHandlers(): Handlers {
  const stageHandlers = new Map<string, (e: Record<string, unknown>) => void>();
  const stage = {
    eventMode: '',
    hitArea: null,
    on: (event: string, handler: (e: Record<string, unknown>) => void) =>
      void stageHandlers.set(event, handler),
    off: vi.fn(),
  };
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const input = new ViewportPointerInput({
    stage: stage as unknown as Container,
    canvas: canvas as unknown as HTMLCanvasElement,
    toWorld: (p) => new Point(p.x, p.y),
    cursorMode$: new BehaviorSubject<CursorMode>('cursor'),
    editable$: new BehaviorSubject<boolean>(true),
    curPos$: new BehaviorSubject<{ x: number; y: number } | null>(null),
    isEditBlocked: () => false,
  });
  const handlers = {
    down: vi.fn(),
    move: vi.fn(),
    up: vi.fn(),
    upOutside: vi.fn(),
    right: vi.fn(),
  };
  input.register('cursor', {
    onPointerDown: handlers.down,
    onPointerMove: handlers.move,
    onPointerUp: handlers.up,
    onPointerUpOutside: handlers.upOutside,
    onRightClick: handlers.right,
  });
  input.bind();
  // button 不传 = 字段缺席（touch/pen 归一形态）；传 0/2 = 显式主/次键
  const make = (button?: number): Record<string, unknown> => ({
    global: new Point(100, 100),
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...(button !== undefined ? { button } : {}),
  });
  let disposed = false;
  return {
    ...handlers,
    send: (event, button) => {
      if (disposed) throw new Error('harness already disposed');
      void stageHandlers.get(event)!(make(button));
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        input.dispose();
      }
    },
  } satisfies Handlers;
}

describe('指针主键过滤（specs/a11y-closeout §13.5-7 真值表）', () => {
  let h: Handlers & { dispose: () => void };
  beforeEach(() => {
    h = createHandlers();
  });
  afterEach(() => {
    h.dispose();
  });

  it('pointerdown 缺省 button（touch/pen 归一）→ 放行 onPointerDown', () => {
    h.send('pointerdown');
    expect(h.down, '缺省 button 不得误挡（touch/pen）').toHaveBeenCalledTimes(1);
  });

  it('pointerdown button=0（主键）→ 放行', () => {
    h.send('pointerdown', 0);
    expect(h.down, '主键 down 应进 handlers').toHaveBeenCalledTimes(1);
  });

  it('pointerdown button=2（次键）→ 拦截，且不走 onRightClick', () => {
    h.send('pointerdown', 2);
    expect(h.down, '次键 down 不应进模式 handlers').not.toHaveBeenCalled();
    expect(h.right, '次键 down 不是右键点击通道').not.toHaveBeenCalled();
  });

  it('pointerup button=2 → 拦截', () => {
    h.send('pointerup', 2);
    expect(h.up, '次键 up 不应进模式 handlers').not.toHaveBeenCalled();
  });

  it('pointerupoutside button=2 → 拦截', () => {
    h.send('pointerupoutside', 2);
    expect(h.upOutside, '次键 upoutside 不应进模式 handlers').not.toHaveBeenCalled();
  });

  it('pointermove button=2 → 照常（过滤只管 down/up/upoutside）', () => {
    h.send('pointermove', 2);
    expect(h.move, 'move 不做主键过滤').toHaveBeenCalledTimes(1);
  });

  it('rightdown → onRightClick 独立通道调用 1 次', () => {
    h.send('rightdown');
    expect(h.right, 'rightdown 应走右键通道').toHaveBeenCalledTimes(1);
    expect(h.down, 'rightdown 不应再进 down handlers').not.toHaveBeenCalled();
  });
});
