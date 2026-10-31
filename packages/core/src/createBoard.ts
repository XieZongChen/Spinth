import { BoardSDK } from './app';
import { projectBoardPublicApi, type BoardPublicApi } from './boardPublicApi';
import { registerBoardRuntime } from './boardRuntime';

/**
 * 唯一公开构造入口（specs/runtime-narrowing §3.4）：内部 new BoardSDK →
 * 运行时投影（65 成员冻结面）→ 注册内部实例。宿主只拿得到 BoardPublicApi，
 * internal 服务字段不可枚举、不可读、不可调用；DEV 调试入口经注册表反查
 * 内部实例（@spinth/core/dev，不进包入口）。
 */
export function createBoard(): BoardPublicApi {
  const sdk = new BoardSDK();
  const board = projectBoardPublicApi(sdk);
  registerBoardRuntime(board, sdk);
  return board;
}
