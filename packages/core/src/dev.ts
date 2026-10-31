/**
 * `@spinth/core/dev` 子路径入口（specs/runtime-narrowing §3.5）：只 re-export
 * DEV 调试工具，不进包入口（index.ts），不是公共 API、不承诺 semver。
 * 唯一消费方是 react Board.tsx 的 DEV 动态 import；生产构建整个分支被 DCE，
 * 产物扫描（scripts/check-debug-bundle.mjs）兜底零残留。
 */
export { attachBoardDebug, createBoardDebugApi, BOARD_DEBUG_ENTRY } from './boardDevTools';
export type {
  BoardDebugBag,
  BoardDebugSnapshot,
  IBoardDebugApi,
  IBoardDebugEscapes,
} from './boardDevTools';
