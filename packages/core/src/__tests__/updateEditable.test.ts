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
    // 闸门翻转也进序数组：锁死「先翻闸门、再清选区」（③→④ 顺序本身是语义）
    viewport.editable$.subscribe((v) => order.push(`editable:${v}`));
    const ctx = {
      viewport,
      editingService: { exitActive: vi.fn(() => order.push('exitActive')) },
      selector: {
        selected$: new BehaviorSubject<string[]>(['w1']),
        setSelected: vi.fn(() => order.push('setSelected')),
      },
      rectEditor: { cancelGesture: vi.fn(() => order.push('rectCancel')) },
      contextMenu: { close: vi.fn(() => order.push('menuClose')) },
      engine: { setWriteEnabled: vi.fn((v: boolean) => order.push(`write:${v}`)) },
    };
    return { commands: new BoardCommands(ctx), order, ...ctx };
  }

  it('写工具（pen）在途：exitActive → rectCancel → setCursorMode(cursor) → 翻闸门 → setSelected → menuClose → write:false，且不额外 cancel', () => {
    const t = makeCtx('pen');
    t.order.length = 0; // 清掉 BehaviorSubject 订阅时的初始发射
    t.commands.updateEditable(false);
    expect(t.order).toEqual([
      'exitActive',
      'rectCancel',
      'setCursorMode:cursor',
      'editable:false',
      'setSelected',
      'menuClose',
      'write:false',
    ]);
    expect(t.viewport.dispatchGestureCancel).not.toHaveBeenCalled(); // 不双 cancel
    expect(t.viewport.editable$.value).toBe(false);
    expect(t.viewport.cursorMode$.value).toBe('cursor');
  });

  it('cursor 在途：rectCancel → dispatchGestureCancel(cursor)，不调 setCursorMode', () => {
    const t = makeCtx('cursor');
    t.order.length = 0;
    t.commands.updateEditable(false);
    expect(t.order).toEqual([
      'exitActive',
      'rectCancel',
      'cancel:cursor',
      'editable:false',
      'setSelected',
      'menuClose',
      'write:false',
    ]);
    expect(t.viewport.setCursorMode).not.toHaveBeenCalled();
  });

  it('hand 在途：dispatchGestureCancel(hand)', () => {
    const t = makeCtx('hand');
    t.order.length = 0;
    t.commands.updateEditable(false);
    expect(t.order).toEqual([
      'exitActive',
      'rectCancel',
      'cancel:hand',
      'editable:false',
      'setSelected',
      'menuClose',
      'write:false',
    ]);
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

  it('切回可写：只翻闸门 + 恢复写，不触碰选区/工具/编辑会话/菜单', () => {
    const t = makeCtx('pen');
    t.commands.updateEditable(false);
    t.order.length = 0;
    t.commands.updateEditable(true);
    expect(t.order).toEqual(['editable:true', 'write:true']);
    expect(t.viewport.editable$.value).toBe(true);
    expect(t.viewport.cursorMode$.value).toBe('cursor'); // 不恢复写工具
    expect(t.contextMenu.close).toHaveBeenCalledTimes(1); // 仅降级那次关，切回不再动
  });
});

describe('BoardCommands.setCursorMode 只读钳制', () => {
  function makeCtx(editable: boolean, withViewport = true) {
    const viewport = withViewport
      ? {
          cursorMode$: new BehaviorSubject<CursorMode>('cursor'),
          editable$: new BehaviorSubject<boolean>(editable),
          setCursorMode: vi.fn(),
          dispatchGestureCancel: vi.fn(),
        }
      : undefined;
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
    expect(t.viewport!.setCursorMode).toHaveBeenCalledWith('cursor');
  });

  it('只读 + hand（视图工具）→ 原样放行', () => {
    const t = makeCtx(false);
    t.commands.setCursorMode('hand');
    expect(t.viewport!.setCursorMode).toHaveBeenCalledWith('hand');
  });

  it('可写 + pen → 原样放行（既有语义不变）', () => {
    const t = makeCtx(true);
    t.commands.setCursorMode('pen');
    expect(t.viewport!.setCursorMode).toHaveBeenCalledWith('pen');
  });

  it('只读钳制落为 cursor 时：同模式（当前已 cursor）不清选区', () => {
    const t = makeCtx(false);
    t.commands.setCursorMode('pen'); // 钳制后 target=cursor 与当前同
    expect(t.selector.setSelected).not.toHaveBeenCalled();
  });

  it('无 viewport（未组装/桩）：不钳制不崩，未知当前模式按既有语义保守清选区', () => {
    const t = makeCtx(true, false);
    expect(() => t.commands.setCursorMode('pen')).not.toThrow();
    // vp?.cursorMode$.value === undefined ≠ target → 清选区（与改动前行为一致：
    // 未知模式保守清；钳制本身无 viewport 时无可观察面，关键是不误判只读）
    expect(t.selector.setSelected).toHaveBeenCalledWith([]);
  });
});
