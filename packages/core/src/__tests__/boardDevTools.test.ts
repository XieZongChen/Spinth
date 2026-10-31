import { describe, expect, it } from 'vitest';
import { createBoard } from '../createBoard';
import { getBoardRuntime } from '../boardRuntime';
import type { BoardPublicApi } from '../boardPublicApi';
// 经 dev 子路径入口导入：覆盖 re-export（coverage 不豁免 dev.ts）
import { attachBoardDebug, BOARD_DEBUG_ENTRY, createBoardDebugApi } from '../dev';

/**
 * DEV 调试入口护栏（specs/runtime-narrowing §6.1）：零值快照、四个不可枚举
 * 逃生口读内部实例、单一入口形状、挂载/卸载按对象身份、未注册抛错、入口标记。
 */
describe('boardDevTools DEV 调试入口', () => {
  it('未初始化 board 的 __debug 为零值快照', () => {
    const api = createBoardDebugApi(createBoard());
    expect(api.__debug.modelCount).toBe(0);
    expect(api.__debug.vmStates).toEqual([]);
    expect(api.__debug.canvasCount).toBe(0);
    expect(api.__debug.defaultShapeType).toBe('rect');
  });

  it('四个逃生口读内部实例同引用（不可枚举）', () => {
    const board = createBoard();
    const sdk = getBoardRuntime(board)!;
    const fakeEngine = { tag: 'engine' };
    // viewport 桩需带 widgetLayer：快照聚合读 widgetLayer.children.length
    const fakeViewport = { tag: 'viewport', widgetLayer: { children: [] } };
    // assetStore 桩需带 debugLeases：快照聚合读租约表
    const fakeAssetStore = { tag: 'assetStore', debugLeases: () => ({}) };
    const fakeMaintenance = { migrated: 1, removed: 0, when: 0 };
    const w = sdk as unknown as Record<string, unknown>;
    w.engine = fakeEngine;
    w.viewport = fakeViewport;
    w.assetStore = fakeAssetStore;
    w.lastAssetMaintenance = fakeMaintenance;

    const bag = createBoardDebugApi(board).__debug as unknown as Record<string, unknown>;
    expect(bag.engine).toBe(fakeEngine);
    expect(bag.viewport).toBe(fakeViewport);
    expect(bag.assetStore).toBe(fakeAssetStore);
    expect(bag.lastAssetMaintenance).toBe(fakeMaintenance);
    for (const key of ['engine', 'viewport', 'assetStore', 'lastAssetMaintenance']) {
      expect(Object.keys(bag)).not.toContain(key);
    }
  });

  it('单一入口：Object.keys(api) 只有 __debug；携带不可枚举入口标记', () => {
    const api = createBoardDebugApi(createBoard());
    expect(Object.keys(api)).toEqual(['__debug']);
    expect(Object.getOwnPropertyDescriptor(api, BOARD_DEBUG_ENTRY)?.value).toBe(true);
  });

  it('attachBoardDebug 挂载/卸载按对象身份，不误删他 board', () => {
    const boardA = createBoard();
    const boardB = createBoard();
    const target: Record<string, unknown> = {};
    const detachA = attachBoardDebug(boardA, target);
    expect(target.__spinthDebug).toBeDefined();
    const detachB = attachBoardDebug(boardB, target); // 覆盖为 B
    detachA(); // A 的 detach 不得删除 B 的句柄
    expect(target.__spinthDebug).toBeDefined();
    detachB();
    expect(target.__spinthDebug).toBeUndefined();
  });

  it('未注册 board 抛 BOARD_DEBUG_RUNTIME_NOT_FOUND', () => {
    expect(() => attachBoardDebug({} as BoardPublicApi, {})).toThrow(
      'BOARD_DEBUG_RUNTIME_NOT_FOUND',
    );
  });
});
