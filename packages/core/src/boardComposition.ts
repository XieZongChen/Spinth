import type { IBoardConfig } from './boardConfig';
import type { BoardSDK } from './app';
import { assembleCore } from './boardAssemblyCore';
import { attachData } from './boardAssemblyData';
import { assembleProject } from './boardAssemblyProject';
import { assembleInteraction } from './boardAssemblyInteraction';
import { assembleTools } from './boardAssemblyTools';
import { scheduleMaintenance } from './boardMaintenanceSchedule';

/**
 * BoardSDK 组装体（Batch 2 · app.ts 三分批 B，2026-10-18）：原 initialize()
 * 275 行组装+接线整体迁出——时序注释原样保留（组装时序是语义：vmEngine 先于
 * engine.initialize 订阅、横切订阅先于恢复数据到达……见各段注释）。
 * sdk 即宿主门面（组装即字段赋值过程——批 B 以 friend 函数形式访问 private
 * 字段；非公开 API，BoardSDK.initialize 是唯一调用方）。
 *
 * 装配阶段拆分（specs/split-large-files §4.9）：各阶段本体在 boardAssembly*
 * 协作者文件，本函数只按**顺序契约**编排——步骤编号对应契约表，不可重排；
 * throwIfAborted 只在固定位置调用（步骤 2/4/7），helper 内不检查。
 */
export async function composeBoard(
  sdk: BoardSDK,
  config: IBoardConfig,
  root: HTMLElement,
  throwIfAborted: () => void,
): Promise<void> {
  // 1. 同步构造（vmEngine 先于 engine.initialize 订阅；横切订阅先于恢复数据）
  assembleCore(sdk);
  throwIfAborted();

  // 2. 数据恢复（db attach → onModelCreated$ → vmEngine.addWidget 进 widgetLayer，
  //    widgetLayer 是同步字段，此时尚未挂 stage 也安全）
  await attachData(sdk, config);
  throwIfAborted();

  // 5. 项目文件门面 + 存储状态服务
  assembleProject(sdk, config);

  // 6. 渲染就绪（widgetLayer 此时可能已有恢复的控件，首帧即完整）
  await sdk.viewport!.initialize(root, { editable: config.editable ?? true });
  throwIfAborted();
  // 8. renderer 就位：纹理服务接入快照生成（此前降级 Text 的 DocDisplay 此处重评）
  sdk.textRender!.attachRenderer(sdk.viewport!.renderer!);

  // 9. 交互服务（culling 先于恢复事件消费；lineService.initialize 后接 resizeMove）
  assembleInteraction(sdk);
  // 10. 工具与外围服务（contextMenu 先于 keyboard；mind 先于 awareness）
  assembleTools(sdk, config);

  // 11. initialized = true；所有服务已就位
  sdk.initialized = true;

  // 存储持久化申请（docs/02 §6.1）：浏览器在存储压力下可驱逐 IndexedDB
  // （Safari 尤甚）——启动 refresh 一次，未持久化才申请一次 persist；
  // 失败不抛、不阻塞初始化（此前是 fire-and-forget 丢弃返回值）
  void sdk.storageStatus!.initialize().catch(() => {});

  // 12. 资产维护链 idle 调度（只读/关闭维护不调度；双重闸门见 boardMaintenanceSchedule）
  scheduleMaintenance(sdk, config);
}
