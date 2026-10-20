/**
 * 产品身份常量单一源（docs/20 §5.3）：项目文件层（generator 字段）等 core
 * 内部模块需要版本号——若从 index.ts import 会形成模块环，故独立成文件，
 * index.ts 只 re-export，公共面不变。
 */

export const SPINTH_NAME = 'spinth';
/** Batch 2 · 版本对齐（2026-10-18 审查 2.2-6）：Phase 0-4 已完成（AGENTS 自述）
 *  ——此前 0.2.0/Phase1 是项目早期快照从未更新 */
export const SPINTH_VERSION = '0.3.0';
export type Phase = 0 | 1 | 2 | 3 | 4;
export const CURRENT_PHASE: Phase = 4;
