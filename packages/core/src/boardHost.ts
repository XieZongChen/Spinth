/**
 * BoardSDK 宿主窄契约（specs/api-surface §3.3）：门面各协作模块（命令/流/
 * 查询/销毁/调试/项目门面）对宿主的依赖面——字段名即契约，组装前为 null、
 * 键始终存在。**本文件只允许 import type**：不得 import app.ts /
 * boardCommands.ts 的值，否则 app ↔ 模块出现值环（rollup 与单测共同兜底）。
 *
 * 字段必填但可空（`T | null`）而非 optional：组装前字段存在只是值为 null。
 * 测试桩只覆盖用到的字段时必须显式 `as unknown as IBoardCommandHost`——
 * 桩的不完整性可见，不伪装成合法契约。
 */
import type { IRect } from './common/geometry';
import type {
  IViewportService,
  IVmEngineService,
  IHistoryService,
  ISelectorService,
} from './types';
import type { DataEngineService } from './platform/dataEngine/dataEngineService';
import type { ServiceRegistry } from './platform/registry/serviceRegistry';
import type { ShapeService } from './widgets/shape/shapeService';
import type { RectEditorService } from './platform/rectEditor/rectEditorService';
import type { LayerService } from './platform/layer/layerService';
import type { RefLineService } from './platform/refLine/refLineService';
import type { KeyboardService } from './platform/keyboard/keyboardService';
import type { GroupService } from './platform/selector/groupService';
import type { TextService } from './widgets/text/textService';
import type { EditingService } from './platform/textEngine/editingService';
import type { LineService } from './widgets/line/lineService';
import type { PenService } from './widgets/pen/penService';
import type { EraserService } from './widgets/eraser/eraserService';
import type { StickyService } from './widgets/sticky/stickyService';
import type { MindService } from './widgets/mind/mindService';
import type { ContextMenuService } from './platform/contextMenu/contextMenuService';
import type { ClipboardService } from './platform/clipboard/clipboardService';
import type { CullingService } from './platform/spatial/cullingService';
import type { NetworkService } from './platform/network/networkService';
import type { StorageStatusService } from './platform/storage/storageStatusService';
import type { ProjectFileService } from './platform/projectFile/projectFileService';
import type { TextRenderService } from './platform/textEngine/textRenderService';
import type { SpatialIndex } from './platform/spatial/spatialIndex';
import type { AwarenessService } from './platform/awareness/awarenessService';
import type { AwarenessVm } from './platform/awareness/awarenessVm';
import type { ImageService } from './widgets/image/imageService';
import type { AssetStore } from './platform/dataEngine/assetStore';
import type { ImageTextureCache } from './widgets/image/imageTextureCache';

/** BoardSDK 的全部服务字段（组装前为 null；键始终存在） */
export interface IBoardServices {
  viewport: IViewportService | null;
  engine: DataEngineService | null;
  vmEngine: IVmEngineService | null;
  history: IHistoryService | null;
  selector: ISelectorService | null;
  shapeService: ShapeService | null;
  rectEditor: RectEditorService | null;
  refLine: RefLineService | null;
  layer: LayerService | null;
  group: GroupService | null;
  textService: TextService | null;
  editingService: EditingService | null;
  lineService: LineService | null;
  penService: PenService | null;
  eraserService: EraserService | null;
  stickyService: StickyService | null;
  mindService: MindService | null;
  contextMenu: ContextMenuService | null;
  keyboard: KeyboardService | null;
  clipboard: ClipboardService | null;
  culling: CullingService | null;
  network: NetworkService | null;
  storageStatus: StorageStatusService | null;
  projectFile: ProjectFileService | null;
  assetStore: AssetStore | null;
  imageTextures: ImageTextureCache | null;
  imageService: ImageService | null;
  textRender: TextRenderService | null;
  spatial: SpatialIndex | null;
  awareness: AwarenessService | null;
  awarenessVm: AwarenessVm | null;
}

/** 命令层宿主：服务字段 + 门面查询（导出 PNG 要复用选区包围盒语义） */
export interface IBoardCommandHost extends IBoardServices {
  getSelectionBounds(): IRect | null;
}

/** 输出流宿主：17 条流 getter 实际读取的服务面（defaultShapeType$ 读
 *  shapeService——会话级形状默认型流不在 viewport 上） */
export type IBoardStreamHost = Pick<
  IBoardServices,
  | 'viewport'
  | 'engine'
  | 'selector'
  | 'history'
  | 'contextMenu'
  | 'mindService'
  | 'network'
  | 'storageStatus'
  | 'shapeService'
>;

/** 拉取式查询宿主（getSelectionBounds/toScreenPoint/getMindAddButtons） */
export type IBoardQueryHost = Pick<
  IBoardServices,
  'viewport' | 'vmEngine' | 'selector' | 'mindService'
>;

/** ActionBar schema 宿主（多选分支读 group，单选分支读 vmEngine/engine） */
export type IActionBarHost = Pick<
  IBoardServices,
  'selector' | 'vmEngine' | 'engine' | 'group' | 'mindService'
>;

/** 销毁：服务字段 + 生命周期标志（顺序在 boardTeardown 内实现） */
export interface IBoardTeardownHost extends IBoardServices {
  registry: ServiceRegistry;
  initialized: boolean;
  disposed: boolean;
  cullingForgetSub: { unsubscribe(): void } | null;
}

/** 项目文件门面宿主（NOT_READY 守卫读 projectFile） */
export type IBoardProjectHost = Pick<IBoardServices, 'projectFile'>;

/** 调试探针适配器：只读服务 + 会话工具默认值（defaultToolOptions$ 的 .value） */
export interface IBoardDebugHost extends Pick<
  IBoardServices,
  | 'engine'
  | 'vmEngine'
  | 'selector'
  | 'rectEditor'
  | 'viewport'
  | 'textRender'
  | 'culling'
  | 'shapeService'
  | 'eraserService'
  | 'lineService'
  | 'refLine'
  | 'mindService'
  | 'awareness'
  | 'imageTextures'
  | 'assetStore'
> {
  defaultToolOptions$: { value: Record<string, Record<string, string>> };
}
