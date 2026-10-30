import type { Token } from './platform/registry/serviceRegistry';
import type { IBaseModel, IBaseWidgetVm } from './types';
import { Tokens } from './tokens';
import { WIDGET_RUNTIME } from './widgetRuntime';
import { ViewportService } from './platform/viewport/viewportService';
import { DataEngineService } from './platform/dataEngine/dataEngineService';
import { VmEngineService } from './platform/vmEngine/vmEngineService';
import { TextRenderService } from './platform/textEngine/textRenderService';
import { ImageVm } from './widgets/image/imageVm';
import { ImageTextureCache } from './widgets/image/imageTextureCache';
import { browserImageCodec } from './widgets/image/imageCodec';
import { SpatialIndex } from './platform/spatial/spatialIndex';
import { AssetStore, assetIdOf, isAssetSrc } from './platform/dataEngine/assetStore';
import type { BoardSDK } from './app';

/**
 * 装配阶段 1：同步构造（specs/split-large-files §4.9 顺序契约步骤 1）。
 * vmEngine 必须先于 engine.initialize 订阅，否则 IndexedDB/ws 恢复的数据事件
 * 在订阅前发出会被普通 Subject 丢失——刷新恢复失效。
 * 控件 Model/Vm 装配走注册表单循环：加新类型只需 WIDGET_REGISTRY（schema 域）
 * + widgetRuntime.ts 各加一项，此处零改动（specs/api-surface Step 7 三表合一，
 * 此前 token 表/工厂表/手工 register 链多点位重复登记）。
 */
export function assembleCore(sdk: BoardSDK): void {
  const modelTokens = new Map<string, Token<IBaseModel>>(
    Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.modelToken] as const),
  );
  const vmTokens = new Map<string, Token<IBaseWidgetVm>>(
    Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.vmToken] as const),
  );
  sdk.engine = new DataEngineService(sdk.registry, modelTokens);
  sdk.viewport = new ViewportService();
  // 资产层先于 engine.initialize 创建（P0 修复：onVmCreated$ 注入 resolver
  // 读的是 sdk.assetStore——初始化恢复的 IMAGE VM 创建于 engine.initialize
  // 期间，创建晚了全部错过注入 → 刷新后引用格式图永久灰框）
  sdk.assetStore = new AssetStore();
  // 纹理缓存先于 engine.initialize 创建（恢复期创建的 IMAGE VM 经
  //  onVmCreated$ 注入同一缓存——同图多实例共享一份纹理/一份 URL 计数）
  sdk.imageTextures = new ImageTextureCache(
    {
      open: async (src) => {
        if (!isAssetSrc(src)) return { url: src, release: () => {} };
        const id = assetIdOf(src);
        const url = await sdk.assetStore!.objectURL(id);
        return url ? { url, release: () => sdk.assetStore!.releaseObjectURL(id) } : null; // 资产行缺失 → missing 终态
      },
    },
    browserImageCodec,
    // pagehide 只清空闲条目（在租纹理被 sprite 引用，销毁会破 bfcache 恢复画面）；
    //  Node 环境（单测）无 window，传 null = 不监听
    { lifecycle: typeof window !== 'undefined' ? window : null },
  );
  // 纹理服务先于 engine.initialize 注册（IndexedDB 恢复即建 Vm，构造时 resolve；
  // renderer 此刻尚不存在，snapshot 降级 Text 模式，viewport.initialize 后 attach 重评）
  sdk.textRender = new TextRenderService(sdk.viewport);
  sdk.registry
    .registerSingleton(Tokens.DataProcessor, () => sdk.engine!.processor)
    .registerSingleton(Tokens.TextRender, () => sdk.textRender!);
  for (const entry of Object.values(WIDGET_RUNTIME)) {
    sdk.registry
      .register(entry.modelToken, entry.createModel)
      .register(entry.vmToken, entry.createVm);
  }

  sdk.vmEngine = new VmEngineService(
    sdk.engine,
    sdk.registry,
    vmTokens,
    sdk.viewport,
    (sdk.spatial = new SpatialIndex()),
  );
  sdk.vmEngine.initialize();
  // 控件数据变化横切订阅（widgetsChanged$ 广播 + 节点几何变化 → 连线 reattach）。
  // 必须先于 engine.initialize 订阅：onVmCreated$ 是普通 Subject，IndexedDB 恢复的
  // 控件在第 2 步就创建完——订阅晚了会全部漏掉（拖拽松手后 ActionBar 不恢复、
  // 恢复图形拖动连线不跟随，2026-09 用户实测揪出；与 vmEngine 先订同理）。
  // lineService 此时未建，可选链跳过（初始化完成后的变更才会触发 reattach）。
  sdk.vmEngine.onVmCreated$.subscribe((vm) => {
    // 同步注入先于首帧 render（render 在微任务批处理里）——晚了首帧拿不到
    //  端口，引用格式图永久占位。instanceof 直判（无循环依赖）取代旧双断言
    if (vm instanceof ImageVm && sdk.imageTextures) {
      vm.setImageTextures(sdk.imageTextures);
    }
    vm.onStateChanged$.subscribe(({ diff }) => {
      sdk.widgetsChanged$.next();
      if (vm.type === 'LINE') {
        // 线自身几何变化不触发 reattach（防自环）；但 lineType 切回
        // ELBOWED 要重路由（STRAIGHT 期间锚点可能已漂移，2026-09 实测揪出）
        if ('lineType' in diff) sdk.lineService?.rerouteLine(vm.id);
        return;
      }
      const geomChanged = ['x', 'y', 'width', 'height', 'rotation'].some((k) => k in diff);
      if (geomChanged) sdk.lineService?.reattach(vm.id, vm.getHostGeom());
    });
  });
  sdk.textRender.initialize();
}
