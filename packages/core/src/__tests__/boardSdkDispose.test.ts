// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BoardSDK } from '../app';

/**
 * Batch 1 · 1.13/1.16：命令层只读守卫 + dispose 幂等（Board.tsx StrictMode
 * 双挂载双调 dispose 的真实场景）。桩法照 boardSdkCursorMode 先例。
 */
describe('BoardSDK 命令层守卫与 dispose 幂等', () => {
  it('1.13 editable=false：写命令 no-op（引擎/服务零触碰）', () => {
    const sdk = new BoardSDK();
    const w = sdk as unknown as Record<string, unknown>;
    const undo = vi.fn();
    const removeSelected = vi.fn();
    const apply = vi.fn();
    w.viewport = { editable$: { value: false } };
    w.history = { undo, redo: vi.fn() };
    w.selector = { removeSelected };
    w.layer = { apply };
    w.mindService = { isNodeFocused: () => false };
    sdk.undo();
    sdk.redo();
    sdk.removeSelected();
    sdk.bringToFront();
    sdk.mindAddChild();
    expect(undo).not.toHaveBeenCalled();
    expect(removeSelected).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('1.16 dispose 二次调用不崩（StrictMode 双挂载）', () => {
    const sdk = new BoardSDK();
    const w = sdk as unknown as Record<string, unknown>;
    const editingExit = vi.fn();
    w.editingService = { exitActive: editingExit, dispose: vi.fn() };
    w.keyboard = { dispose: vi.fn() };
    w.clipboard = { dispose: vi.fn() };
    w.layer = { dispose: vi.fn() };
    w.registry = { dispose: vi.fn() };
    sdk.dispose();
    expect(editingExit).toHaveBeenCalledTimes(1);
    expect(() => sdk.dispose()).not.toThrow(); // 幂等
    expect(editingExit).toHaveBeenCalledTimes(1); // 二次不再执行
  });
});
