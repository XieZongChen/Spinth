import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BoardSDK } from '../app';

/**
 * 回归（2026-09 Phase 4 审查实测）：app.setCursorMode 无条件 setSelected([])
 * ——工具栏重复点击「选择」把选区抹掉，脑图 Tab/Enter 依赖「MIND_MAP 在选区中」
 * 静默失效。守卫：同模式切换不清选区，换工具才清。
 */
describe('BoardSDK.setCursorMode 选区保持语义', () => {
  function makeSdk(mode: string) {
    const sdk = new BoardSDK();
    const cleared: string[][] = [];
    const viewport = {
      cursorMode$: new BehaviorSubject(mode),
      // 只读钳制读 editable$——桩对齐 IViewportService 形状（缺省会误判只读）
      editable$: new BehaviorSubject(true),
      setCursorMode: vi.fn((m: string) => viewport.cursorMode$.next(m)),
    };
    const selector = {
      setSelected: vi.fn((ids: string[]) => cleared.push(ids)),
      selected$: new BehaviorSubject<string[]>(['w1']),
    };
    (sdk as unknown as Record<string, unknown>).viewport = viewport;
    (sdk as unknown as Record<string, unknown>).selector = selector;
    return { sdk, viewport, selector };
  }

  it('同模式切换（cursor→cursor）不清选区——工具栏重复点击选择工具不再丢选中', () => {
    const { sdk, selector } = makeSdk('cursor');
    sdk.setCursorMode('cursor');
    expect(selector.setSelected).not.toHaveBeenCalled();
  });

  it('换工具切换（cursor→shape）仍清选区——工具语义切换丢弃选中上下文', () => {
    const { sdk, selector } = makeSdk('cursor');
    sdk.setCursorMode('shape');
    expect(selector.setSelected).toHaveBeenCalledWith([]);
  });
});
