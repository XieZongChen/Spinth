import type { IBoardConfig } from './boardConfig';
import type { BoardSDK } from './app';

/**
 * 装配阶段 2：数据恢复（specs/split-large-files §4.9 顺序契约步骤 3）。
 * db attach → onModelCreated$ → vmEngine.addWidget 进 widgetLayer，widgetLayer
 * 是同步字段，此时尚未挂 stage 也安全。
 */
export async function attachData(sdk: BoardSDK, config: IBoardConfig): Promise<void> {
  await sdk.engine!.initialize({
    docId: config.docId,
    wsUrl: config.wsUrl,
    userName: config.userName,
    // 只读标签连磁盘写入一起拒绝（docs/21 §4）——editable 从第一帧起就是终值
    writeEnabled: config.editable !== false,
  });
}
