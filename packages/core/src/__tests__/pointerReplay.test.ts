import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { Point, type Container } from 'pixi.js';
import { ViewportPointerInput } from '../platform/viewport/viewportPointerInput';
import type { CursorMode, IPointerEventInfo } from '../types';

/**
 * 输入层重放（specs/edge-auto-scroll §7.3 T21-T26）：dispatch 闸门语义与
 * lastMove 快照。node 环境无 window/rAF——stage/canvas/window 全部桩化，
 * move 事件经 bind() 注册到 stage 的 pointermove handler 注入（与生产同路径）。
 */

interface Harness {
  input: ViewportPointerInput;
  moves: IPointerEventInfo[];
  /** 视口平移模拟：world = screen − offset（scale 1；offset.x 变化即 panBy） */
  offset: { x: number; y: number };
  editable$: BehaviorSubject<boolean>;
  cursorMode$: BehaviorSubject<CursorMode>;
  sendMove: (x: number, y: number, pointerId?: number) => void;
  sendDown: (x: number, y: number, pointerId?: number) => void;
}

function createHarness(): Harness {
  const moves: IPointerEventInfo[] = [];
  const offset = { x: 0, y: 0 };
  const editable$ = new BehaviorSubject<boolean>(true);
  const cursorMode$ = new BehaviorSubject<CursorMode>('cursor');
  const curPos$ = new BehaviorSubject<{ x: number; y: number } | null>(null);
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
    toWorld: (p) => new Point(p.x - offset.x, p.y - offset.y),
    cursorMode$,
    editable$,
    curPos$,
    isEditBlocked: () => false,
  });
  input.register('cursor', {
    onPointerDown: vi.fn(),
    onPointerMove: (e) => void moves.push(e),
  });
  input.bind();
  const make = (x: number, y: number, pointerId?: number) => ({
    global: new Point(x, y),
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...(pointerId !== undefined ? { pointerId } : {}),
  });
  return {
    input,
    moves,
    offset,
    editable$,
    cursorMode$,
    sendDown: (x, y, pointerId) => void stageHandlers.get('pointerdown')!(make(x, y, pointerId)),
    sendMove: (x, y, pointerId) => void stageHandlers.get('pointermove')!(make(x, y, pointerId)),
  };
}

describe('viewportPointerInput 重放（specs/edge-auto-scroll T21-T26）', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
  });
  afterEach(() => {
    h.input.dispose();
    vi.unstubAllGlobals();
  });

  it('T21 一次 move 后重放 → handler 收到同一 screen，world 按当前视口重算', () => {
    h.sendDown(300, 300, 1);
    h.sendMove(300, 300, 1);
    expect(h.moves).toHaveLength(1);
    // 视口已平移（world 源头变化）——重放必须现算而非复用旧 world
    h.offset.x = 40;
    h.offset.y = -10;
    expect(h.input.replayLastMove()).toBe(true);
    expect(h.moves).toHaveLength(2);
    expect(h.moves[1]!.screen.x).toBe(300);
    expect(h.moves[1]!.screen.y).toBe(300);
    expect(h.moves[1]!.world.x).toBe(300 - 40);
    expect(h.moves[1]!.world.y).toBe(300 + 10);
  });

  it('T22 视口平移 Δ 后重放 → world 位移 = −Δ/scale（§3.6 等式）', () => {
    h.sendMove(500, 500);
    const world0 = h.moves[0]!.world.x;
    const delta = 120; // 模拟 panBy(120, 0)：position + 120 → world − 120/scale
    h.offset.x += delta;
    h.input.replayLastMove();
    expect(h.moves[1]!.world.x).toBe(world0 - delta / 1);
  });

  it('T23 无 move 记录 → 返回 false 且不调 handler', () => {
    expect(h.input.replayLastMove()).toBe(false);
    expect(h.moves).toHaveLength(0);
  });

  it('T24 editable$ = false → 重放返回 false（闸门生效）', () => {
    h.sendMove(200, 200);
    expect(h.moves).toHaveLength(1);
    h.editable$.next(false);
    expect(h.input.replayLastMove()).toBe(false);
    expect(h.moves).toHaveLength(1); // handler 未再被调
  });

  it('T25 当前模式未注册 handler → 重放返回 false', () => {
    h.sendMove(200, 200);
    h.cursorMode$.next('hand'); // 无 handlers 注册的模式
    expect(h.input.replayLastMove()).toBe(false);
    expect(h.moves).toHaveLength(1);
  });

  it('T26 被闸门拦下的 move 不进入 lastMove 快照', () => {
    h.editable$.next(false);
    h.sendMove(200, 200); // 被编辑守卫拦下
    expect(h.moves).toHaveLength(0);
    h.editable$.next(true); // 恢复可编辑后重放——不得重放被拦下的那次
    expect(h.input.replayLastMove()).toBe(false);
    expect(h.moves).toHaveLength(0);
  });
});
