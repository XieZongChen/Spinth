import type { BoardSDK } from './app';
import type { BoardPublicApi } from './boardPublicApi';
import { getBoardRuntime } from './boardRuntime';
import { buildBoardDebugSnapshot } from './boardDebug';

/**
 * DEV 调试入口（specs/runtime-narrowing §3.5）：挂在 `window.__spinthDebug.__debug`
 * 一个对象上——快照字段照旧（boardDebug/debugSnapshot 适配器与聚合不变），额外
 * 四个逃生口（engine/viewport/assetStore/lastAssetMaintenance）以**不可枚举
 * getter** 挂同一对象：E2E 可读，`Object.keys` / `JSON.stringify` 仍只看到
 * 快照字段。不新增 E2E 专用 getter；确需新增时先改本表与 E2E helper，
 * 不允许直接暴露任意服务。
 *
 * 本模块只经 `@spinth/core/dev` 子路径入口进入（Board.tsx 的 DEV 动态
 * import），不进包入口；生产构建整个入口被 DCE。
 */

/** 产物扫描标记：只出现在 DEV 调试入口，生产/E2E 构建都必须为 0 */
export const BOARD_DEBUG_ENTRY = Symbol.for('spinth:core-dev-debug');

export type BoardDebugSnapshot = ReturnType<typeof buildBoardDebugSnapshot>;

/** 四类逃生口：只挂在 __debug 上，且不可枚举（Object.keys / JSON.stringify 不可见） */
export interface IBoardDebugEscapes {
  readonly engine: BoardSDK['engine'];
  readonly viewport: BoardSDK['viewport'];
  readonly assetStore: BoardSDK['assetStore'];
  readonly lastAssetMaintenance: BoardSDK['lastAssetMaintenance'];
}

export type BoardDebugBag = BoardDebugSnapshot & IBoardDebugEscapes;

export interface IBoardDebugApi {
  readonly __debug: BoardDebugBag;
}

function buildBoardDebugBag(sdk: BoardSDK): BoardDebugBag {
  const bag = buildBoardDebugSnapshot(sdk) as unknown as BoardDebugBag;
  Object.defineProperties(bag, {
    engine: { get: () => sdk.engine, enumerable: false, configurable: true },
    viewport: { get: () => sdk.viewport, enumerable: false, configurable: true },
    assetStore: { get: () => sdk.assetStore, enumerable: false, configurable: true },
    lastAssetMaintenance: {
      get: () => sdk.lastAssetMaintenance,
      enumerable: false,
      configurable: true,
    },
  });
  return bag;
}

export function createBoardDebugApi(board: BoardPublicApi): IBoardDebugApi {
  const sdk = getBoardRuntime(board);
  if (!sdk) {
    throw new Error('BOARD_DEBUG_RUNTIME_NOT_FOUND: 该实例不是 createBoard() 创建的');
  }
  const api: IBoardDebugApi = {
    get __debug() {
      return buildBoardDebugBag(sdk);
    },
  };
  // 入口标记不可枚举：产物扫描只认 spinth:core-dev-debug 字符串，因此
  // SPINTH_E2E 构建里同名的 __spinthDebug 只读探针不会误报「core 调试入口
  // 被打包」
  Object.defineProperty(api, BOARD_DEBUG_ENTRY, { value: true });
  return api;
}

/** 把调试 API 挂到 target（window）；返回按对象身份卸载的 detach */
export function attachBoardDebug(board: BoardPublicApi, target: object): () => void {
  const api = createBoardDebugApi(board);
  const slot = target as { __spinthDebug?: IBoardDebugApi };
  slot.__spinthDebug = api;
  return () => {
    if (slot.__spinthDebug === api) delete slot.__spinthDebug;
  };
}
