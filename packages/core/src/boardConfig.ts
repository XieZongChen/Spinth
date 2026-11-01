/**
 * BoardSDK 配置契约（specs/api-surface §3.1 Step 5）——自 app.ts 迁出，
 * 避免门面文件背配置类型。消费方：BoardSDK.initialize / boardComposition /
 * @spinth/react（经 index.ts re-export）。
 */
export interface IBoardConfig {
  docId: string;
  /** Phase 3 接入；空 = 本地模式 */
  wsUrl?: string;
  userName?: string;
  editable?: boolean;
  /** 启动资产维护链（存量迁移 + GC，默认开）。DEV/测试环境建议关——
   *  GC 全库扫描（indexedDB.databases() × 每 doc 盘上重建）在并行页面下
   *  是 IO 压力源，E2E 仅专项用例显式开启 */
  assetMaintenance?: boolean;
  /** 宿主浮层（项目菜单/存储面板…）开着：与右键菜单同源并入快捷键闸门
   *  （specs/a11y-closeout §13.5-1）。默认不提供 = 只有右键菜单生效 */
  isUiModalOpen?: () => boolean;
}
