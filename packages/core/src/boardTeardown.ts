/**
 * BoardSDK 销毁序列唯一真源（specs/api-surface §3.6）——自 app.ts dispose()
 * 逐行照搬（顺序即语义：编辑会话先收口、纹理晚于 vmEngine、assetStore 最后关）。
 * 不允许「顺手整理」：diff 只允许文件位置变化，不允许行序变化；
 * boardSdkDispose.test 的幂等断言是护栏。
 */
import type { IBoardTeardownHost } from './boardHost';

export function disposeBoard(host: IBoardTeardownHost): void {
  // 幂等（Batch 1 · 1.16）：Board.tsx StrictMode 双挂载会双调 dispose——
  // disposed 标志一刀切（重复 dispose 各服务是未定义行为）
  if (host.disposed) return;
  host.disposed = true;
  // 编辑会话先收口（flush 尾字——先于服务拆序，避免 detach 依赖已拆组件）
  host.editingService?.exitActive();
  host.projectFile?.dispose();
  host.storageStatus?.dispose();
  host.keyboard?.dispose();
  host.clipboard?.dispose();
  host.layer?.dispose();
  host.shapeService?.dispose();
  host.culling?.dispose();
  host.network?.dispose();
  host.awarenessVm?.dispose();
  host.awareness?.dispose();
  host.textRender?.dispose();
  host.rectEditor?.dispose();
  host.refLine?.dispose();
  host.textService?.dispose();
  host.editingService?.dispose();
  host.lineService?.dispose();
  host.penService?.dispose();
  host.eraserService?.dispose();
  host.stickyService?.dispose();
  host.imageService?.dispose();
  host.mindService?.dispose();
  host.contextMenu?.dispose();
  host.edgeScroll?.dispose(); // 滚屏 rAF 先于其上报方 selector 停止
  host.selector?.dispose();
  host.history?.dispose();
  host.vmEngine?.dispose(); // 只退订（不逐 VM dispose）——缓存销毁必须自洽
  host.imageTextures?.dispose(); // 无条件销毁全部缓存纹理 + 归还 URL 租约
  host.assetStore?.close(); // 晚于纹理租约归还（revoke 配对完整；已核实
  //   projectFile/storageStatus/imageService 的 dispose 均不依赖本库仍打开）
  host.engine?.dispose();
  host.viewport?.dispose(); // 最后销毁 renderer
  host.gridSnap?.dispose(); // 视图偏好服务（BehaviorSubject 终结）
  host.registry.dispose();
  host.cullingForgetSub?.unsubscribe();
  host.gridSnapPersistSub?.unsubscribe();
  host.initialized = false;
}
