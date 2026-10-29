import { HistoryService } from './platform/history/historyService';
import { SelectorService } from './platform/selector/selectorService';
import { RectEditorService } from './platform/rectEditor/rectEditorService';
import { RefLineService } from './platform/refLine/refLineService';
import { LayerService } from './platform/layer/layerService';
import { GroupService } from './platform/selector/groupService';
import { ShapeService } from './widgets/shape/shapeService';
import { TextService } from './widgets/text/textService';
import { EditingService } from './platform/textEngine/editingService';
import { LineService } from './widgets/line/lineService';
import { CullingService } from './platform/spatial/cullingService';
import type { BoardSDK } from './app';

/**
 * 装配阶段 9：交互服务（specs/split-large-files §4.9 顺序契约步骤 9，
 * 原位置 181–299）。culling 先于恢复事件消费；lineService.initialize 后接
 * resizeMove$ 订阅——顺序不可重排。
 */
export function assembleInteraction(sdk: BoardSDK): void {
  // 交互服务（refLine 与 selector 相互依赖，getter 解环）
  // 视口 culling（docs/16 §1）：vpBounds/数据/创建变化 → renderable 翻转
  // （装配晚于 IndexedDB 恢复，initialize 内立即全量一次）
  sdk.culling = new CullingService(sdk.viewport!, sdk.vmEngine!, sdk.spatial!, [
    sdk.widgetsChanged$,
    sdk.vmEngine!.onVmCreated$,
  ]);
  sdk.culling.initialize();
  // 已删件出册（Batch 1 · 1.26）：culled 集合死 id 清理（BoardSDK 无 Disposable
  // 基类——dispose() 里显式退订）
  sdk.cullingForgetSub = sdk.engine!.onModelRemoved$.subscribe((ids) => sdk.culling?.forget(ids));
  // 删除也是「文档集合变化」（P0 修复）：widgetsChanged$ 此前只在状态更新时
  // 广播——删件后空态引导不回（bridge 的 modelCount 镜像停在旧值）、ActionBar
  // schema 缓存不失效。invalidate 面统统一走本流
  sdk.engine!.onModelRemoved$.subscribe(() => sdk.widgetsChanged$.next());
  sdk.history = new HistoryService(sdk.engine!);
  sdk.history.initialize();
  sdk.refLine = new RefLineService(sdk.viewport!, sdk.vmEngine!, () => sdk.selector!, sdk.engine!);
  sdk.selector = new SelectorService(
    sdk.viewport!,
    sdk.vmEngine!,
    sdk.engine!,
    sdk.history!,
    () => sdk.refLine!,
    () => sdk.group!,
  );
  // 编组（docs/18）：选择聚合层服务——点击扩展/框选口径/建组解组命令
  sdk.group = new GroupService(sdk.engine!, sdk.vmEngine!, sdk.selector!, sdk.history!);
  sdk.refLine.initialize();
  sdk.selector.initialize();
  sdk.shapeService = new ShapeService(sdk.viewport!, sdk.engine!, sdk.history!, sdk.selector!);
  sdk.shapeService.initialize();
  // 工具默认参数聚合流（docs/04 §2 工具默认参数节）：各 service 流 → 单表
  // （react 单字段镜像 + Toolbar 按 mode 查表——避免 per-tool ×N 样板）
  sdk.shapeService.defaultShapeType$.subscribe((v) => sdk.syncToolOption('shape', 'type', v));
  sdk.rectEditor = new RectEditorService(
    sdk.viewport!,
    sdk.vmEngine!,
    sdk.selector!,
    sdk.engine!,
    sdk.history!,
    sdk.refLine!,
  );
  sdk.rectEditor.initialize();
  sdk.layer = new LayerService(sdk.engine!, sdk.vmEngine!, sdk.selector!, sdk.history!);
  // 统一编辑会话（docs/17 批 1：TEXT/STICKY 先接入；LINE 批 2、mind 批 3）
  sdk.editingService = new EditingService(sdk.viewport!, sdk.engine!, sdk.selector!, sdk.history!);
  sdk.textService = new TextService(
    sdk.viewport!,
    sdk.engine!,
    sdk.vmEngine!,
    sdk.selector!,
    sdk.history!,
    sdk.editingService!,
  );
  sdk.textService.initialize();
  sdk.textService.defaultFontSize$.subscribe((v) =>
    sdk.syncToolOption('text', 'fontSize', String(v)),
  );
  // 单击已选中的 TEXT/STICKY/SHAPE = 进入编辑（STICKY 共用 TEXT 编辑器——Vm 层
  // 三态协议早有约定、组合根漏接 STICKY 分支曾致便签双击无反应，2026-09-20 补；
  // SHAPE 同通道接入 2026-10-07 docs/17 §6）。
  // LINE **不走单击激活**（2026-09-30 用户拍板：双击连线才进文字编辑——
  // lineService.onLineDblClick 承接；线身单击是段滑移/胶囊手势，selector
  // 兜底激活分支曾把单击转发进编辑，这里删除该转发）
  sdk.selector.onActivate = (id, type, world) => {
    if (type === 'TEXT' || type === 'STICKY' || type === 'SHAPE') sdk.textService?.enterEdit(id);
    // 脑图：再点一次已选中 → 按点击位置命中节点进节点编辑（既有设计同款）
    else if (type === 'MIND_MAP' && world) sdk.mindService?.enterNodeEditAt(id, world);
  };
  sdk.lineService = new LineService(
    sdk.viewport!,
    sdk.engine!,
    sdk.vmEngine!,
    sdk.selector!,
    sdk.history!,
    sdk.editingService!,
  );
  sdk.lineService.defaultLineType$.subscribe((v) => sdk.syncToolOption('line', 'type', v));
  sdk.lineService.defaultStrokeWidth$.subscribe((v) =>
    sdk.syncToolOption('line', 'width', String(v)),
  );
  sdk.lineService.quickAddShapeTypeProbe = () => sdk.shapeService?.defaultShapeType ?? 'rect';
  // 连线手势下探（端点手柄抓取）+ 悬停抑制探针（缩放手势进行中）
  sdk.selector.lineGestureHook = (world) => sdk.lineService?.handleGestureDown(world) ?? false;
  // 拖拽松手的锚定线急切重路由（docs/05 §4.3）：此时 root 仍携带末帧预览位移
  // = 提交后位置，getBounds 直接可用（覆盖 MIND_MAP 宿主——线可锚定整图）；
  // 微任务相（onStateChanged$）的重复 reattach 被 samePoints 同值跳过拦下
  sdk.selector.onDragCommitted = (ids, dx, dy) => {
    if (dx === 0 && dy === 0) return;
    for (const id of ids) {
      const vm = sdk.vmEngine?.getVmById(id);
      if (!vm || vm.type === 'LINE') continue; // 线自身不触发（防自环）
      sdk.lineService?.reattach(id, vm.getHostGeom());
    }
  };
  // 缩放松手的锚定线急切重路由（docs/05 §4.4）：next = commitResize 落库的
  // 目标矩形，与微任务相 reattach 将算出的 bounds 同源；reattach 对无锚定
  // 线的类型（PEN 等）天然 no-op
  sdk.rectEditor.onResizeCommitted = (id, next) => {
    const vm = sdk.vmEngine?.getVmById(id);
    // next = 落库目标局部矩形（rectEditor 语义）；θ 取宿主 state（docs/05 §8）
    sdk.lineService?.reattach(id, { rect: next, rotation: vm?.getRotation() ?? 0 });
  };
  // 旋转手势（docs/05 §8）：拖拽中锚定线实时跟随（用户拍板 2026-10-15——
  // previewFollow 对 root.rotation 预览敏感）；松手急切重路由并同撤销项
  sdk.rectEditor.onRotatePreview = () => sdk.lineService?.previewFollow();
  sdk.rectEditor.onRotateCommitted = (id, theta) => {
    const vm = sdk.vmEngine?.getVmById(id);
    if (!vm) return;
    // θ 用手势参数而非 vm.getRotation()——state 投影是微任务合批，transact
    // 内同步读是旧值（θ 读 0 → samePoints 跳过线写，真写滑到 stopCapturing
    // 之后的微任务相 → undo 裂项，E2E 实锤）；旋转不改 x/y，localRect 可读
    sdk.lineService?.reattach(id, { rect: vm.getLocalRect(), rotation: theta });
  };
  sdk.lineService.busyProbe = () => sdk.rectEditor?.isResizing ?? false;
  sdk.lineService.initialize();
  // 缩放手势期间四向连接点跟随（缩放期 onStateChanged$ 不发射——拖拽同款问题）
  sdk.rectEditor.resizeMove$.subscribe(() => sdk.lineService?.followQuickDots());
}
