import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CursorMode } from '../types';
import { BoardCommands } from '../boardCommands';

/**
 * 运行时只读降级序列（docs/21 §4）：exitActive → 手势收口（恰好一次）→
 * 翻闸门 → 清选区 → 拒写（最后——步骤①可能刚产生一次文本提交，必须先落）。
 * 切回可写只翻闸门 + 恢复写，不恢复工具/选区（无记忆）。
 */
describe('BoardCommands.updateEditable 降级序列', () => {
  function makeCtx(mode: CursorMode) {
    const order: string[] = [];
    const viewport = {
      cursorMode$: new BehaviorSubject<CursorMode>(mode),
      editable$: new BehaviorSubject<boolean>(true),
      setCursorMode: vi.fn((m: CursorMode) => {
        order.push(`setCursorMode:${m}`);
        viewport.cursorMode$.next(m);
      }),
      dispatchGestureCancel: vi.fn((m: CursorMode) => order.push(`cancel:${m}`)),
    };
    const ctx = {
      viewport,
      editingService: { exitActive: vi.fn(() => order.push('exitActive')) },
      selector: {
        selected$: new BehaviorSubject<string[]>(['w1']),
        setSelected: vi.fn(() => order.push('setSelected')),
      },
      engine: { setWriteEnabled: vi.fn((v: boolean) => order.push(`write:${v}`)) },
    };
    return { commands: new BoardCommands(ctx), order, ...ctx };
  }

  it('写工具（pen）在途：exitActive → setCursorMode(cursor) → setSelected → write:false，且不额外 cancel', () => {
    const t = makeCtx('pen');
    t.commands.updateEditable(false);
    expect(t.order).toEqual(['exitActive', 'setCursorMode:cursor', 'setSelected', 'write:false']);
    expect(t.viewport.dispatchGestureCancel).not.toHaveBeenCalled(); // 不双 cancel
    expect(t.viewport.editable$.value).toBe(false);
    expect(t.viewport.cursorMode$.value).toBe('cursor');
  });

  it('cursor 在途：dispatchGestureCancel(cursor)，不调 setCursorMode', () => {
    const t = makeCtx('cursor');
    t.commands.updateEditable(false);
    expect(t.order).toEqual(['exitActive', 'cancel:cursor', 'setSelected', 'write:false']);
    expect(t.viewport.setCursorMode).not.toHaveBeenCalled();
  });

  it('hand 在途：dispatchGestureCancel(hand)', () => {
    const t = makeCtx('hand');
    t.commands.updateEditable(false);
    expect(t.order).toEqual(['exitActive', 'cancel:hand', 'setSelected', 'write:false']);
  });

  it('连续两次降级：不抛、终态一致（editable=false、cursor 模式）', () => {
    const t = makeCtx('shape');
    expect(() => {
      t.commands.updateEditable(false);
      t.commands.updateEditable(false);
    }).not.toThrow();
    expect(t.viewport.editable$.value).toBe(false);
    expect(t.viewport.cursorMode$.value).toBe('cursor');
  });

  it('切回可写：只翻闸门 + 恢复写，不触碰选区/工具/编辑会话', () => {
    const t = makeCtx('pen');
    t.commands.updateEditable(false);
    t.order.length = 0;
    t.commands.updateEditable(true);
    expect(t.order).toEqual(['write:true']);
    expect(t.viewport.editable$.value).toBe(true);
    expect(t.viewport.cursorMode$.value).toBe('cursor'); // 不恢复写工具
  });
});

describe('BoardCommands.setCursorMode 只读钳制', () => {
  function makeCtx(editable: boolean) {
    const viewport = {
      cursorMode$: new BehaviorSubject<CursorMode>('cursor'),
      editable$: new BehaviorSubject<boolean>(editable),
      setCursorMode: vi.fn(),
      dispatchGestureCancel: vi.fn(),
    };
    const ctx = {
      viewport,
      selector: {
        selected$: new BehaviorSubject<string[]>(['w1']),
        setSelected: vi.fn(),
      },
    };
    return { commands: new BoardCommands(ctx), viewport, selector: ctx.selector };
  }

  it('只读 + 写工具（pen）→ 落为 cursor', () => {
    const t = makeCtx(false);
    t.commands.setCursorMode('pen');
    expect(t.viewport.setCursorMode).toHaveBeenCalledWith('cursor');
  });

  it('只读 + hand（视图工具）→ 原样放行', () => {
    const t = makeCtx(false);
    t.commands.setCursorMode('hand');
    expect(t.viewport.setCursorMode).toHaveBeenCalledWith('hand');
  });

  it('可写 + pen → 原样放行（既有语义不变）', () => {
    const t = makeCtx(true);
    t.commands.setCursorMode('pen');
    expect(t.viewport.setCursorMode).toHaveBeenCalledWith('pen');
  });

  it('只读钳制落为 cursor 时：同模式（当前已 cursor）不清选区', () => {
    const t = makeCtx(false);
    t.commands.setCursorMode('pen'); // 钳制后 target=cursor 与当前同
    expect(t.selector.setSelected).not.toHaveBeenCalled();
  });
});
