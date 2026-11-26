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
    w.treeService = { isNodeFocused: () => false };
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

  it('容器服务在销毁序列内，且早于引擎销毁', () => {
    // FrameService 的 onModelCreated$ 订阅永不 complete——不入序列则引擎一直
    // 持有它；yDoc 两个监听也靠 dispose 摘，必须早于 engine.dispose()（文档销毁）
    const sdk = new BoardSDK();
    const w = sdk as unknown as Record<string, unknown>;
    const frameDispose = vi.fn();
    const engineDispose = vi.fn();
    w.registry = { dispose: vi.fn() };
    w.frame = { dispose: frameDispose };
    w.engine = { dispose: engineDispose };
    sdk.dispose();
    expect(frameDispose).toHaveBeenCalledTimes(1);
    expect(frameDispose.mock.invocationCallOrder[0]!).toBeLessThan(
      engineDispose.mock.invocationCallOrder[0]!,
    );
    sdk.dispose();
    expect(frameDispose).toHaveBeenCalledTimes(1); // 二次不再执行
  });

  it('时序图服务在销毁序列内（早于引擎），且二次 dispose 不重复', () => {
    const sdk = new BoardSDK();
    const w = sdk as unknown as Record<string, unknown>;
    const lifelineDispose = vi.fn();
    const sequenceDispose = vi.fn();
    const engineDispose = vi.fn();
    w.registry = { dispose: vi.fn() };
    w.lifeline = { dispose: lifelineDispose };
    w.sequence = { dispose: sequenceDispose };
    w.engine = { dispose: engineDispose };
    sdk.dispose();
    expect(lifelineDispose).toHaveBeenCalledTimes(1);
    expect(sequenceDispose).toHaveBeenCalledTimes(1);
    expect(lifelineDispose.mock.invocationCallOrder[0]!).toBeLessThan(
      engineDispose.mock.invocationCallOrder[0]!,
    );
    sdk.dispose();
    expect(lifelineDispose).toHaveBeenCalledTimes(1);
    expect(sequenceDispose).toHaveBeenCalledTimes(1);
  });
});
