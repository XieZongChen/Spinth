import {
  ASSET_MAINTENANCE_DELAY_MS,
  runAssetMaintenance,
} from './platform/dataEngine/assetMigration';
import type { IBoardConfig } from './boardConfig';
import type { BoardSDK } from './app';

/**
 * 装配阶段 12：资产维护链 idle 调度（specs/split-large-files §4.9 顺序契约步骤 12）。
 * 启动 idle 一轮——存量 dataURL 迁移（无条件，幂等）→ 有迁移则 compactNow（旧
 * dataURL 从盘上历史真正消失）→ GC（仅单机态 + 四重安全：undo 栈非空跳过 /
 * 会话启动基线宽限 / 删前重采 refs / Web Locks 单写者——详见 assetGc/第三轮
 * 审查处置批）。DEV/测试可关（config.assetMaintenance）——GC 全库扫描在并行
 * 页面下是 IO 压力源（E2E 曾因此 pagehide 落盘竞态偶红），专项用例显式开启。
 * idle 调度（第三轮审查：固定 3s 定时器撞上启动后的用户交互）+ catch 记错
 * （曾静默吞——维护失败不可诊断）。只读标签不跑维护链（docs/21 §4）：调度
 * 与执行前双重断言 editable。
 */
export function scheduleMaintenance(sdk: BoardSDK, config: IBoardConfig): void {
  if (config.assetMaintenance !== false && config.editable !== false) {
    const runMaintenance = (): void => {
      const engine = sdk.engine;
      if (sdk.disposed || !engine) return;
      // 双重闸门（docs/21 §4）：与调度条件同源，防未来直接调用绕过调度判定
      if (config.editable === false || config.assetMaintenance === false) return;
      void runAssetMaintenance(sdk, engine, config.docId).catch((err) => {
        console.error('[spinth:asset] 启动维护链失败', err);
      });
    };
    const ric = (
      globalThis as unknown as {
        requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(runMaintenance, { timeout: ASSET_MAINTENANCE_DELAY_MS });
    } else {
      setTimeout(runMaintenance, ASSET_MAINTENANCE_DELAY_MS);
    }
  }
}
