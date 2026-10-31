import { describe, expect, it } from 'vitest';
import { BoardSDK } from '../app';
import { createBoard } from '../createBoard';
import { getBoardRuntime } from '../boardRuntime';
import type { BoardPublicApi } from '../boardPublicApi';

/**
 * 内部实例注册表护栏（specs/runtime-narrowing §6.1）：createBoard 注册后可查回
 * 内部 BoardSDK；未注册对象 undefined；多实例互不串（WeakMap 按投影键隔离）。
 */
describe('boardRuntime 内部注册表', () => {
  it('createBoard 注册后可查回内部 BoardSDK 实例', () => {
    const board = createBoard();
    const sdk = getBoardRuntime(board);
    expect(sdk).toBeInstanceOf(BoardSDK);
    expect(sdk?.initialized).toBe(false); // 未初始化的内部实例
  });

  it('未注册对象查回 undefined', () => {
    expect(getBoardRuntime({} as BoardPublicApi)).toBeUndefined();
  });

  it('两个 board 互不串（多实例隔离）', () => {
    const a = createBoard();
    const b = createBoard();
    expect(getBoardRuntime(a)).not.toBe(getBoardRuntime(b));
    expect(getBoardRuntime(a)).toBe(getBoardRuntime(a));
  });
});
