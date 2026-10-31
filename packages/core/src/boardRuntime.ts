import type { BoardSDK } from './app';
import type { BoardPublicApi } from './boardPublicApi';

/**
 * 内部实例注册表（specs/runtime-narrowing §3.4）：以投影对象为键的 WeakMap——
 * 不在投影上留 symbol/隐藏属性（`Reflect.ownKeys` 不可见），投影被回收后条目
 * 随之释放；多实例（StrictMode 双挂载、测试多画布）天然隔离。
 * 不导出到包入口；仅 DEV 调试入口（boardDevTools）读取。
 */
const runtimes = new WeakMap<BoardPublicApi, BoardSDK>();

export function registerBoardRuntime(board: BoardPublicApi, sdk: BoardSDK): void {
  runtimes.set(board, sdk);
}

export function getBoardRuntime(board: BoardPublicApi): BoardSDK | undefined {
  return runtimes.get(board);
}
