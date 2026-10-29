import { createDocFromSnapshot } from './platform/dataEngine/dbProvider';
import { ProjectFileService } from './platform/projectFile/projectFileService';
import {
  StorageStatusService,
  createBrowserStorageManager,
} from './platform/storage/storageStatusService';
import { SPINTH_VERSION } from './version';
import type { IBoardConfig } from './boardConfig';
import type { BoardSDK } from './app';

/**
 * 装配阶段 5：项目文件门面 + 存储状态（specs/split-large-files §4.9 顺序契约步骤 5）。
 */
export function assembleProject(sdk: BoardSDK, config: IBoardConfig): void {
  // 项目文件门面（docs/20 §5.2）：组合根构造注入（禁全局单例）。getDoc 闭包按
  // docState 判就绪；flushCurrentDoc 包装 persistState 检查——flush 后仍 failed
  // 即 reject，导入层记 CURRENT_DOC_FLUSH_FAILED warning（§5.5）
  sdk.projectFile = new ProjectFileService({
    getDoc: () => {
      const engine = sdk.engine;
      if (!engine || engine.docState$.value !== 'synced') return null;
      return { yDoc: engine.yDoc, yWidgets: engine.yWidgets, docId: config.docId };
    },
    assetStore: sdk.assetStore!,
    appVersion: SPINTH_VERSION,
    createDoc: createDocFromSnapshot,
    flushCurrentDoc: async () => {
      await sdk.engine!.flushLocalWrites();
      if (sdk.engine!.persistState$.value === 'failed') {
        throw new Error('当前文档落盘失败（persistState=failed）');
      }
    },
  });

  // 存储状态服务（docs/02 §6.1）：持久化授权 + 站点配额可见化；无
  // navigator.storage 的环境降级为 unsupported，不影响画布保存
  sdk.storageStatus = new StorageStatusService(createBrowserStorageManager());
}
