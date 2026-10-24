# 公共 API 收口与 P2 架构收口 — 技术设计

> 状态：**已实施完成**（§5 八步全部落地，每步独立提交：4f9fe65 规格入库 →
> eda5f20 Step1 宿主契约 → 824d2ad Step2 BoardOutputs → 383a5a9 Step3 ActionBar
> → 4cf2c72 Step4 命令三分 → 8a2bea9 Step5 app.ts 门面化（BoardFacade 兜底
> rung 2 生效，rung 1 未启用——rung 1 只省 ~15 行不达标且 §3.4 倾向写通道
> 留 app.ts）→ b7ea3f6 Step6 allowlist → 7eeebc7 Step7 WIDGET_RUNTIME →
> Step8 文档与实测数字）。
> 实施中确认的两处规格勘误：`IBoardStreamHost` 补 `shapeService`
> （defaultShapeType$ 读 shapeService）；§2.1 对 widget.ts L329 的「手写 union」
> 描述已过时（现状本就逐键引用注册表，Step 7 只换 Object.values 派生 + 加锁）。
> §4 的成员分类表是照抄级契约；本文属 `specs/` 过程文档：允许实施顺序、
> 验收记录与提交哈希；`docs/` 侧只写当前事实（§7.3 列了要改的段落）。

## 0. 一句话

把 `BoardSDK` 从「1026 行的类 + 46 个 Omit 键 + 三张手写注册表」收敛为：
显式宿主契约、单文件 < 400 的门面 + 若干纯职责模块、Pick allowlist + 编译期分类锁、
以及从 `WIDGET_REGISTRY` 派生的单源类型注册表。**对外行为零变化。**

## 1. 目标与非目标

### 1.1 目标（逐条可验收）

| ID  | 目标                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `BoardCommands` 去掉 `ctx: any`，改显式 `IBoardCommandHost`；删除该处 `eslint-disable`，core 源码零 `any`                               |
| G2  | `app.ts` 从 1026 行降到 < 400；输出流/兜底、ActionBar schema、查询、销毁、调试适配各自独立文件                                          |
| G3  | `BoardPublicApi` 由 `Omit<BoardSDK, 46>` 改 `Pick<BoardSDK, 成员表>`；新增成员未归类 → `pnpm typecheck` 红（不是静默公开）              |
| G4  | `WidgetDataUnion` 从 `WIDGET_REGISTRY` 派生；`WIDGET_TOKENS` + `WIDGET_FACTORIES` 合并为 `WIDGET_RUNTIME`；`types/` 不再 import widgets |
| G5  | 行为零变化：公开方法签名、rxjs 流语义、`dispose()` 顺序、E2E `window.__spinth` 句柄形状全部不变                                         |

### 1.2 非目标（本批明确不做）

- **运行时收窄**（`#private` / 不导出 internal 字段 / Proxy 门面）：破坏性版本变更，
  继续挂账；本批只做类型层 allowlist。
- 不改任何交互、渲染、数据格式、zod schema 字段与默认值。
- 不拆 `boardComposition.ts`（475 行）：装配时序本身是语义，本批只换装配数据源。
- 不动 `packages/react` / `packages/app` 的行为，只换类型引用。
- 不做 Linux 视觉基线、CI 阻塞、PWA、可访问性挂账（docs/13 其他批次）。
- 不引入「行数超限即 lint 红」的自动门禁（可作后续独立项）。

## 2. 现状证据

### 2.1 体量与问题

| 对象                                         | 现状                                                           | 问题                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/app.ts`                   | 1026 行；`BoardSDK` 类占 161–1026                              | 违反铁律 5；5 类职责混住（流/查询/schema/销毁/委托）                                                                                        |
| `packages/core/src/boardCommands.ts`         | 465 行；L51 `constructor(private ctx: any)` + L50 eslint 豁免  | core 唯一 `any` 逃逸；> 400 行                                                                                                              |
| `packages/core/src/index.ts`                 | L115–163 `Omit<BoardSDK, 46 keys>`                             | 反向默认：新增服务字段默认「公开」；且 `Omit` 对不存在的键静默放行——名单里的 `snapshotCompute` / `compactWorkerUsed` 早已不在类上，无人发现 |
| `packages/core/src/types/widget.ts`          | L329 手写 `z.discriminatedUnion` 数组 + L209 `WIDGET_REGISTRY` | 加一个控件要改两处                                                                                                                          |
| `packages/core/src/types/widgetFactories.ts` | 65 行，位于 `types/` 却 import 具体 Model/Vm                   | 分层倒置（types 反向依赖 widgets）+ 第二个注册源                                                                                            |
| `packages/core/src/tokens.ts`                | 53 行；14 个 widget token + `WIDGET_TOKENS` 映射               | 第三个注册源                                                                                                                                |
| `packages/core/src/boardComposition.ts`      | 475 行                                                         | 本批只改装配源，不拆结构                                                                                                                    |

### 2.2 依赖面（谁能被改坏）

- `packages/react/src/store/bridge.ts`：17 条流订阅 + `getActionBarSchema` / `getSelectionBounds` / `toScreenPoint` / `getMindAddButtons` 四个拉取式查询。
- `packages/react/src/store/commands.ts`：29 条命令薄转发（当前类型是 `BoardSDK`）。
- `packages/react/src/components/Board.tsx`：`new BoardSDK()` / `initialize` / `dispose` / `setTheme`；DEV 下把实例挂到 `window.__spinth`。
- E2E：`__spinth.__debug` 162 处、`engine` 9 处、`viewport` 5 处、`assetStore` 2 处、`lastAssetMaintenance` 4 处 →
  **DEV 调试句柄必须继续暴露内部字段**，不能改成 `BoardPublicApi`。
- core 单测桩：`boardSdkDispose.test.ts` / `boardSdkCursorMode.test.ts` / `alignCommand.test.ts` 直接给
  `sdk.viewport` 等字段塞桩 → 服务字段必须保持 public 可写（TypeScript 的 `private` 也会挡桩）。

### 2.3 不可破坏的工程约束

- `tsconfig.base.json`：`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
  `isolatedModules` + `useDefineForClassFields`。
  → 新增**类型导入必须 `import type`**；类字段初始化顺序 = 声明顺序。
- 铁律 3：本批不碰写路径；命令仍经 Model 写 Yjs。
- 铁律 4：依赖仍构造函数注入，不引入全局单例。
- `dispose()` 的销毁顺序逐条带语义注释（编辑会话先收口、纹理晚于 vmEngine、assetStore 最后关），抽取时必须**逐行保序**。
- 组装前兜底流的现状语义（早订阅者拿到 fallback 实例）是已知取舍，本批**不修正**。

## 3. 目标架构

### 3.1 文件布局

| 文件                                       | 状态 | 职责                                                                               |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------- |
| `src/app.ts`                               | 改   | 仅门面：服务字段、生命周期、查询/命令委托（目标 < 400）                            |
| `src/boardConfig.ts`                       | 新增 | `IBoardConfig`（从 app.ts 迁出，避免 app.ts 背配置类型）                           |
| `src/boardHost.ts`                         | 新增 | 宿主窄契约：`IBoardServices` 及按用途的 Pick 子集                                  |
| `src/boardStreams.ts`                      | 新增 | `BoardOutputs`：17 条输出流 + 组装前兜底的唯一持有者                               |
| `src/boardActionBar.ts`                    | 新增 | `buildActionBarSchema(host, participantCount)`（原 510–753 行主体）                |
| `src/actionBarOptions.ts`                  | 新增 | 调色板/选项常量 + `typoItems` 工厂（原 68–143 行）                                 |
| `src/boardQueries.ts`                      | 新增 | `getSelectionBounds` / `toScreenPoint` / `getMindAddButtons` 纯函数                |
| `src/boardTeardown.ts`                     | 新增 | `disposeBoard(host)`：销毁顺序唯一真源                                             |
| `src/boardDebug.ts`                        | 新增 | `buildBoardDebugSnapshot(host)`：`__debug` 适配器（`debugSnapshot.ts` 保持纯聚合） |
| `src/boardProject.ts`                      | 新增 | 项目文件门面：`exportProject` / `importProject` / NOT_READY 守卫                   |
| `src/boardPublicApi.ts`                    | 新增 | allowlist 成员表 + 分类编译锁 + `BoardPublicApi`                                   |
| `src/widgetRuntime.ts`                     | 新增 | Widget 三件套运行时注册表（tokens + 工厂单源）                                     |
| `src/boardCommands.ts`                     | 改   | 宿主契约类型化；几何/导出/样式命令拆出后 < 400                                     |
| `src/alignCommands.ts`                     | 新增 | 对齐/分布/微移 + 参与集解析 + 批量位移（原 219–439 行）                            |
| `src/exportCommand.ts`                     | 新增 | `exportPNG` + `canvasTokenColor`（原 253–297 行）                                  |
| `src/styleCommands.ts`                     | 新增 | `updateSelectedStyle`（原 app.ts 756–796 行）                                      |
| `src/types/widget.ts`                      | 改   | union 派生 + 类型锁                                                                |
| `src/types/widgetFactories.ts`             | 删除 | 并入 `widgetRuntime.ts`                                                            |
| `src/tokens.ts`                            | 改   | 只留服务 token；14 个 widget token 移入 runtime                                    |
| `src/boardComposition.ts`                  | 改   | 装配源换成 `WIDGET_RUNTIME`                                                        |
| `src/index.ts`                             | 改   | `BoardPublicApi` 改为从 `boardPublicApi.ts` re-export                              |
| `__tests__/helpers/createEngineForTest.ts` | 改   | 装配源换成 `WIDGET_RUNTIME`（只注册 model，不注册 vm）                             |

> 命名约定：`board*.ts` 是「组合根/门面层」文件，全部位于 `src/` 根，与既有
> `boardComposition.ts` 同级；不塞进 `platform/`（它们不是引擎能力）。
> 新增 14 个文件的数量已拍板接受（A12），不再合并。

### 3.2 依赖方向与循环 import 规则

1. `boardHost.ts` 只 import **类型**（`import type`），可 import 具体 Service 类；
   禁止 import `app.ts` / `boardCommands.ts` 的值。
2. `boardStreams.ts` / `boardQueries.ts` / `boardTeardown.ts` / `boardDebug.ts` /
   `boardProject.ts` 对 `app.ts` 只允许 `import type`；值依赖由 `app.ts` → 这些模块单向注入。
3. `boardActionBar.ts` 不 import `app.ts` / `boardCommands.ts`：多选参与数用**回调**传入
   （`() => number`），避免为一行计数引入环。
4. `widgetRuntime.ts` 位于组合根层，import 具体 Model/Vm 是它的职责；`types/` 不得反向 import 它。
5. 类型环（`import type`）无害；**值环**由 `pnpm build`（rollup）与单测共同兜底。新增文件若出现
   `app.ts → X → app.ts` 的值导入，一律把 X 的 app 依赖改成`import type`。

### 3.3 宿主契约（`boardHost.ts`）

```ts
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
>;

export type IBoardQueryHost = Pick<
  IBoardServices,
  'viewport' | 'vmEngine' | 'selector' | 'mindService'
>;

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

export type IBoardProjectHost = Pick<IBoardServices, 'projectFile'>;

/** 调试探针适配器：只读服务 + 会话工具默认值 */
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
```

说明：

- 接口字段**必填但可空**（`T | null`），不写成 optional：组装前字段存在只是值为 null；
  测试桩缺字段时必须显式 `as unknown as IBoardCommandHost`（见 §5 Step 1），
  避免把「桩不完整」伪装成合法契约。
- `BoardSDK` 加 `implements IBoardServices, IBoardCommandHost`（前者含后者所需字段，后者含查询方法）。

### 3.4 输出流（`boardStreams.ts`）

```ts
import { BehaviorSubject, Subject } from 'rxjs';
import type { IRect } from './common/geometry';
import type { CursorMode, IContextMenuState, IStorageStatus, ShapeType } from './types';
import type { IBoardStreamHost } from './boardHost';
```

实现要点（照搬现有 getter 体，不改语义）：

```ts
export class BoardOutputs {
  constructor(private readonly host: IBoardStreamHost) {}
  // 构造器只存引用，禁止读 host（app.ts 字段初始化顺序 = 声明顺序）

  private cursorModeFb: BehaviorSubject<CursorMode> | null = null;
  // …其余 16 条兜底在此集中持有（原 app.ts 的 fallbacks 对象 + 5 个 private 字段）

  get cursorMode$(): BehaviorSubject<CursorMode> {
    return (
      this.host.viewport?.cursorMode$ ??
      (this.cursorModeFb ??= new BehaviorSubject<CursorMode>('cursor'))
    );
  }
  // …逐字照搬：docState$/wsState$/persistState$/storageStatus$/selected$/canUndo$/canRedo$ 等
}
```

`app.ts` 侧：

```ts
private readonly outputs = new BoardOutputs(this);

get cursorMode$(): BehaviorSubject<CursorMode> {
  return this.outputs.cursorMode$;
}
```

- `BoardOutputs` 承担 17 条流；`widgetsChanged$`（普通 `Subject`）与 `defaultToolOptions$`（写通道聚合，`__debug` 读其 `.value`）**留在 app.ts**。
- 兜底实例的惰性创建、返回同一实例、组装后返回真实流——语义与现在逐字一致。
- `editBlocked$` / `mindGhostSuppressed$` / `mindFocusChanged$` / `contextMenuOptions$` / `dragMove$`
  的私有兜底字段一并迁入 `BoardOutputs`。
- `defaultToolOptions$` 与 `syncToolOption` 暂留 `app.ts`（写通道，不是纯输出；`__debug` 依赖其 `.value`）。

### 3.5 ActionBar（`boardActionBar.ts` + `actionBarOptions.ts`）

```ts
// boardActionBar.ts
export function buildActionBarSchema(
  host: IActionBarHost,
  collapsedParticipantCount: () => number,
): IActionBarSchema | null {
  // 原 app.ts 510–753 行主体逐字迁入；唯一差异：
  // const participants = collapsedParticipantCount();
}
```

```ts
// app.ts
getActionBarSchema(): IActionBarSchema | null {
  return buildActionBarSchema(this, () => this.commands.collectCollapsedParticipants().length);
}
```

- 常量 `SHAPE_PALETTE` / `LINE_PALETTE` / `ARROW_BAR_OPTIONS` / `LINE_HEIGHT_OPTIONS` /
  `ALIGN_OPTIONS` / `typoItems` 全部迁入 `actionBarOptions.ts`；`boardActionBar.ts` 只留分支逻辑。
- 参与数回调只在多选分支调用（与原实现调用时机一致：单选分支不计算）。
- 返回对象逐字段一致：多选 9 键顺序、disabled 规则、各类型 items 顺序、默认值回退
  （`shapeType ?? 'rect'` 等）都不许改。

### 3.6 查询 / 销毁 / 调试 / 项目门面

```ts
// boardQueries.ts
export function getSelectionBounds(host: IBoardQueryHost): IRect | null;
export function toScreenPoint(
  host: IBoardQueryHost,
  p: { x: number; y: number },
): { x: number; y: number };
export function getMindAddButtons(host: IBoardQueryHost): IMindAddButtonsState | null;
```

```ts
// app.ts
getSelectionBounds(): IRect | null {
  return getSelectionBounds(this);
}
```

- `getSelectionBounds` 的脑图焦点分支（4.9 节点级选中）逐字保留。
- `toScreenPoint` 仍用 `host.viewport!`（未组装即抛错，维持现状）。
- `getMindAddButtons` 的 4 个早退（无 mindService / 拖拽中 / 非 cursor / 无焦点）逐字保留。

```ts
// boardTeardown.ts
export function disposeBoard(host: IBoardTeardownHost): void {
  if (host.disposed) return;
  host.disposed = true;
  // ↓ 顺序与注释逐行照搬 app.ts 980–1020，不允许「顺手整理」
  host.editingService?.exitActive();
  host.projectFile?.dispose();
  // …（全部 25 行销毁序列）
  host.registry.dispose();
  host.cullingForgetSub?.unsubscribe();
  host.initialized = false;
}
```

```ts
// boardDebug.ts —— debugSnapshot.ts 保持纯聚合，不 import 具体服务
export function buildBoardDebugSnapshot(host: IBoardDebugHost) {
  return buildDebugSnapshot({
    engine: host.engine as unknown as { modelMapping?: Map<string, unknown> } | null,
    vmMapping:
      (host.vmEngine as unknown as { vmMapping?: Map<string, IBaseWidgetVm> })?.vmMapping ??
      new Map(),
    // …原 app.ts 800–833 的适配逐行迁入
    defaultToolOptions: { ...host.defaultToolOptions$.value },
    shapeTypeOptionIds: SHAPE_TYPE_OPTIONS.map((o) => o.id),
  });
}
```

```ts
// boardProject.ts
export function exportProject(
  host: IBoardProjectHost,
  opts?: IProjectExportOptions,
): Promise<IProjectExportResult>;
export function importProject(
  host: IBoardProjectHost,
  file: Blob,
  opts?: IProjectImportOptions,
): Promise<IProjectImportResult>;
```

- NOT_READY 判定与错误类型保持不变（`ProjectFileError('PROJECT_NOT_READY', '画布未初始化或已释放')`）。

### 3.7 公共面 allowlist（`boardPublicApi.ts`）

```ts
import type { BoardSDK } from './app';

/** 宿主可依赖的**唯一**名单。新增公开成员必须手动加到这里。 */
export const BOARD_PUBLIC_MEMBERS = [
  // 生命周期
  'initialize',
  'dispose',
  // 输出流（19）
  'widgetsChanged$',
  'cursorMode$',
  'defaultShapeType$',
  'defaultToolOptions$',
  'vpScale$',
  'vpBounds$',
  'editable$',
  'docState$',
  'wsState$',
  'editBlocked$',
  'persistState$',
  'storageStatus$',
  'selected$',
  'canUndo$',
  'canRedo$',
  'contextMenuOptions$',
  'dragMove$',
  'mindGhostSuppressed$',
  'mindFocusChanged$',
  // 查询（6）
  'modelCount',
  'defaultShapeType',
  'getSelectionBounds',
  'toScreenPoint',
  'getMindAddButtons',
  'getActionBarSchema',
  // 命令（37）
  'setTheme',
  'setCursorMode',
  'setDefaultShapeType',
  'setDefaultToolOption',
  'updateEditable',
  'setPageScale',
  'zoomIn',
  'zoomOut',
  'zoomToFit',
  'undo',
  'redo',
  'removeSelected',
  'mindAddChild',
  'mindAddSibling',
  'mindDeleteFocused',
  'bringToFront',
  'sendToBack',
  'bringForward',
  'sendBackward',
  'alignSelection',
  'distributeSelection',
  'groupSelection',
  'ungroupSelection',
  'canGroupSelection',
  'canUngroupSelection',
  'copySelected',
  'cutSelected',
  'pasteAt',
  'pasteAtScreenCenter',
  'closeContextMenu',
  'updateSelectedStyle',
  'exportPNG',
  'exportProject',
  'importProject',
  'retryPersist',
  'refreshStorageStatus',
  'requestStoragePersist',
] as const satisfies readonly (keyof BoardSDK)[];

export type BoardPublicMember = (typeof BOARD_PUBLIC_MEMBERS)[number];

/** 非公共成员：服务字段、组装/调试/兜底、仅组合根使用的方法 */
export type BoardInternalMember =
  | 'registry'
  | 'commands'
  | 'viewport'
  | 'engine'
  | 'vmEngine'
  | 'history'
  | 'selector'
  | 'shapeService'
  | 'rectEditor'
  | 'refLine'
  | 'layer'
  | 'group'
  | 'textService'
  | 'editingService'
  | 'lineService'
  | 'penService'
  | 'eraserService'
  | 'stickyService'
  | 'imageService'
  | 'assetStore'
  | 'imageTextures'
  | 'lastAssetMaintenance'
  | 'mindService'
  | 'contextMenu'
  | 'keyboard'
  | 'clipboard'
  | 'textRender'
  | 'spatial'
  | 'culling'
  | 'awareness'
  | 'awarenessVm'
  | 'network'
  | 'projectFile'
  | 'storageStatus'
  | 'initialized'
  | 'syncToolOption'
  | '__debug'
  | 'disposed'
  | 'cullingForgetSub';

export type BoardPublicApi = Pick<BoardSDK, BoardPublicMember>;

// —— 编译期分类锁：任一约束不满足，tsc 在别名声明处报错 ——
type AssertNever<T extends never> = T;
type Classified = BoardPublicMember | BoardInternalMember;

/** 新增了成员但没归类 */
export type _BoardKeysClassified = AssertNever<Exclude<keyof BoardSDK, Classified>>;
/** 同一成员既公开又内部 */
export type _BoardKeysDisjoint = AssertNever<Extract<BoardPublicMember, BoardInternalMember>>;
/** 名单写了不存在的成员（拼写错误） */
export type _BoardKeysExist = AssertNever<Exclude<Classified, keyof BoardSDK>>;
```

规则：

- 公开面 = **门面合同**：生命周期 + 输出流 + 查询 + 命令。内部 = 服务字段、组装态、
  调试探针、兜底字段、仅组合根用的方法（`syncToolOption`）。
- 私有成员（`fallbacks` / `defaultToolOptionsBs` / `expectProjectFile` / `outputs`）
  不在 `keyof BoardSDK` 里，**无需分类**；新增 private 成员不触发锁。
- 旧 `Omit` 的教训：blocklist 对不存在的键静默放行（`snapshotCompute` / `compactWorkerUsed` 就是幽灵键）。
  allowlist 的 `_BoardKeysExist` 锁正是为堵这个洞：名单里写错一个名字就 tsc 红。
- `BoardPublicApi` 只做类型收窄；运行时仍导出完整类（§1.2）。
- `index.ts` 保持 `export type { BoardPublicApi }` 与 `export { BOARD_PUBLIC_MEMBERS }`，
  外部导入路径不变。

**消费方切换**（这是 allowlist 的真实验证）：

| 文件                         | 改法                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `react/store/bridge.ts`      | 删除 `BoardSDK` import；`schemaCache: ReturnType<BoardPublicApi['getActionBarSchema']>` |
| `react/store/commands.ts`    | `let board: BoardPublicApi \| null`；`bindBoard(sdk: BoardPublicApi)`                   |
| `react/components/Board.tsx` | **保持** `BoardSDK`（要 `new`、要挂 DEV 句柄）；传入处天然兼容                          |

`commands.ts` 覆盖 29 条命令、`bridge.ts` 覆盖全部流与拉取查询——
allowlist 漏一个成员，这两个文件先编译红。

### 3.8 类型注册表单源（`types/widget.ts` + `widgetRuntime.ts`）

**(a) union 派生**（`types/widget.ts`）：

```ts
type RegistrySchema = (typeof WIDGET_REGISTRY)[keyof typeof WIDGET_REGISTRY]['schema'];

// z.discriminatedUnion 要求「非空 tuple」；Object.values 只能是数组，
// 故此处一次断言。非空性由 widgetRegistry.test 的「注册表覆盖七类型」兜底。
const REGISTRY_SCHEMAS = Object.values(WIDGET_REGISTRY).map(
  (e) => e.schema,
) as unknown as readonly [RegistrySchema, ...RegistrySchema[]];

export const WidgetDataUnion = z.discriminatedUnion('type', REGISTRY_SCHEMAS);
export type IWidgetData = z.infer<typeof WidgetDataUnion> & IRect;

// —— 派生等价锁：手写 union 回归 / schema 与注册表漂移，编译期即红 ——
type AssertNever<T extends never> = T;
type RegistryData = {
  [K in keyof typeof WIDGET_REGISTRY]: z.infer<(typeof WIDGET_REGISTRY)[K]['schema']>;
}[keyof typeof WIDGET_REGISTRY];

export type _UnionCoversRegistry = AssertNever<
  Exclude<RegistryData, z.infer<typeof WidgetDataUnion>>
>;
export type _RegistryCoversUnion = AssertNever<
  Exclude<z.infer<typeof WidgetDataUnion>, RegistryData>
>;
export type _UnionTypeKeys = AssertNever<
  | Exclude<keyof typeof WIDGET_REGISTRY, z.infer<typeof WidgetDataUnion>['type']>
  | Exclude<z.infer<typeof WidgetDataUnion>['type'], keyof typeof WIDGET_REGISTRY>
>;
```

已用 zod 4.6.7 实测：上述断言在 `RegistrySchema` 联合上通过，且 `z.infer<...>['type']`
与 `keyof typeof WIDGET_REGISTRY` 双向可赋值（不是 any）——
`'NOPE'` 会被拒绝、七个类型键一个不少。

**(b) 运行时注册表**（`widgetRuntime.ts`）：

```ts
import { token, type Token, type ServiceRegistry } from './platform/registry/serviceRegistry';
import type { IBaseModel, IBaseWidgetVm } from './types';
import { Tokens } from './tokens';
import { WIDGET_REGISTRY } from './types/widget';
import { ShapeModel } from './widgets/shape/shapeModel';
import { ShapeVm } from './widgets/shape/shapeVm';
// …其余 6 类 Model/Vm

export const WIDGET_RUNTIME = {
  SHAPE: {
    modelToken: token<IBaseModel>('ShapeModel'),
    vmToken: token<IBaseWidgetVm>('ShapeVm'),
    createModel: (r: ServiceRegistry) => new ShapeModel(r.resolve(Tokens.DataProcessor)),
    createVm: (r: ServiceRegistry) => new ShapeVm(r.resolve(Tokens.TextRender)),
  },
  // …TEXT / LINE / PEN / STICKY / IMAGE / MIND_MAP 逐项照搬 widgetFactories.ts
} as const satisfies Record<
  keyof typeof WIDGET_REGISTRY,
  {
    modelToken: Token<IBaseModel>;
    vmToken: Token<IBaseWidgetVm>;
    createModel: (r: ServiceRegistry) => IBaseModel;
    createVm: (r: ServiceRegistry) => IBaseWidgetVm;
  }
>;

/** 注册表之外多出来的类型（satisfies 只能查漏，这里查多） */
type AssertNever<T extends never> = T;
export type _RuntimeOnlyKeys = AssertNever<
  Exclude<keyof typeof WIDGET_RUNTIME, keyof typeof WIDGET_REGISTRY>
>;
```

- token 用 `token<T>(desc)` 现场生成（`Symbol(desc)`，仅调试可读），**删除** `Tokens.ShapeModel` 等
  14 个常量与 `WIDGET_TOKENS`。这些具名常量只被 `tokens.ts` 自身与 `createEngineForTest.ts` 引用；
  `WIDGET_TOKENS` 映射另被 `widgetRegistry.test.ts` 引用（Step 7 一并改）。
- `types/widgetFactories.ts` 删除：`types/` 层不再 import widgets（分层归位）。

**(c) 装配点**：

```ts
// boardComposition.ts
const modelTokens = new Map<string, Token<IBaseModel>>(
  Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.modelToken] as const),
);
const vmTokens = new Map<string, Token<IBaseWidgetVm>>(
  Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.vmToken] as const),
);
// …
for (const entry of Object.values(WIDGET_RUNTIME)) {
  sdk.registry
    .register(entry.modelToken, entry.createModel)
    .register(entry.vmToken, entry.createVm);
}
```

```ts
// __tests__/helpers/createEngineForTest.ts —— 只注册 model（与现状一致，不引入 Vm）
for (const entry of Object.values(WIDGET_RUNTIME)) {
  registry.register(entry.modelToken, entry.createModel);
}
```

> 该 helper 现在会顺带注册 MIND_MAP（原手工表漏了它）；只影响注册表内容，不影响任何用例断言（A11 已确认）。

## 4. 成员分类全表（照抄）

### 4.1 公开（64）

生命周期 2：`initialize` `dispose`

输出流 19：`widgetsChanged$` `cursorMode$` `defaultShapeType$` `defaultToolOptions$` `vpScale$`
`vpBounds$` `editable$` `docState$` `wsState$` `editBlocked$` `persistState$` `storageStatus$`
`selected$` `canUndo$` `canRedo$` `contextMenuOptions$` `dragMove$` `mindGhostSuppressed$`
`mindFocusChanged$`

查询 6：`modelCount` `defaultShapeType` `getSelectionBounds` `toScreenPoint`
`getMindAddButtons` `getActionBarSchema`

命令 37：`setTheme` `setCursorMode` `setDefaultShapeType` `setDefaultToolOption` `updateEditable`
`setPageScale` `zoomIn` `zoomOut` `zoomToFit` `undo` `redo` `removeSelected` `mindAddChild`
`mindAddSibling` `mindDeleteFocused` `bringToFront` `sendToBack` `bringForward` `sendBackward`
`alignSelection` `distributeSelection` `groupSelection` `ungroupSelection` `canGroupSelection`
`canUngroupSelection` `copySelected` `cutSelected` `pasteAt` `pasteAtScreenCenter`
`closeContextMenu` `updateSelectedStyle` `exportPNG` `exportProject` `importProject`
`retryPersist` `refreshStorageStatus` `requestStoragePersist`

### 4.2 内部（39）

`registry` `commands` `viewport` `engine` `vmEngine` `history` `selector` `shapeService`
`rectEditor` `refLine` `layer` `group` `textService` `editingService` `lineService`
`penService` `eraserService` `stickyService` `imageService` `assetStore` `imageTextures`
`lastAssetMaintenance` `mindService` `contextMenu` `keyboard` `clipboard` `textRender`
`spatial` `culling` `awareness` `awarenessVm` `network` `projectFile` `storageStatus`
`initialized` `syncToolOption` `__debug` `disposed` `cullingForgetSub`

### 4.3 分类判据（遇到新成员时用）

| 判据                                               | 归 public | 归 internal |
| -------------------------------------------------- | --------- | ----------- |
| 宿主 UI 需要订阅/拉取/触发                         | ✓         |             |
| 服务实例、组装状态、内部计数器                     |           | ✓           |
| DEV/E2E 探针（`__debug` / `lastAssetMaintenance`） |           | ✓           |
| 仅组合根调用的写通道（`syncToolOption`）           |           | ✓           |
| 内部实现字段（`cullingForgetSub` / `disposed`）    |           | ✓           |

## 5. 实施步骤

每步一个提交、独立可回退；**每步结束必须 `pnpm verify` 全绿**，标注了 E2E 的步骤再补
`pnpm test:e2e`。提交信息按 `refactor: …` / `test: …` / `docs: …`。

### Step 1 — 宿主契约 + `ctx` 类型化

- 新增 `boardHost.ts`（§3.3）。
- `boardCommands.ts`：构造签名改 `constructor(private ctx: IBoardCommandHost)`；
  删 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 与第 50 行注释里的「宽松 any 桥」表述。
- `app.ts`：`export class BoardSDK implements IBoardCommandHost`（该接口已含 `IBoardServices`；
  显式 `implements` 让字段改名/漏改在类声明处即红）。
- `__tests__/updateEditable.test.ts`：两处 `new BoardCommands(ctx)` 改
  `new BoardCommands(ctx as unknown as IBoardCommandHost)`（桩只覆盖用到的字段，cast 是明确声明，不是掩盖）。
- 验收：`pnpm typecheck && pnpm lint && pnpm test`；`grep -rn "ctx: any" packages/core/src` 为空。
- 回退：单独 revert。

### Step 2 — 输出流迁出（`BoardOutputs`）

- 新增 `boardStreams.ts`（§3.4）；`app.ts` 删 `fallbacks` 对象、5 个私有兜底字段，
  17 个 getter 改一行委托，加 `private readonly outputs = new BoardOutputs(this)`。
- 逐字对照清单（迁出 17 条；最后两条留在 app.ts）：`cursorMode$` `defaultShapeType$` `vpScale$` `vpBounds$` `editable$` `docState$`
  `wsState$` `editBlocked$` `persistState$` `storageStatus$` `selected$` `canUndo$` `canRedo$`
  `contextMenuOptions$` `dragMove$` `mindGhostSuppressed$` `mindFocusChanged$`
  `defaultToolOptions$`（留 app.ts）`widgetsChanged$`（留 app.ts）。
- 验收：`pnpm verify`；`boardSdkCursorMode.test.ts`（构造后塞桩）与 `boardSdkDispose.test.ts` 保持绿。
- 回退：单独 revert；无外部签名变化。

### Step 3 — ActionBar 迁出 + 单测

- 新增 `actionBarOptions.ts`、`boardActionBar.ts`（§3.5）。
- `app.ts` 删 68–143 与 510–753 的主体，getter 三行委托。
- 新增 `__tests__/boardActionBar.test.ts`（用例见 §6.1）。
- 验收：`pnpm verify` + **全量 E2E**（ActionBar 是最敏感交互面，slot 顺序/禁用态/默认值都要真渲染验证）。
- 回退：单独 revert；若 E2E 红，先对比返回的 schema JSON（可直接打日志 diff）。

### Step 4 — 命令拆分（本批必做：`boardCommands.ts` → `alignCommands` / `exportCommand` / `styleCommands`）

- 新增三个命令模块（§3.1）；`BoardCommands` 同名方法改单行委托。
- `updateSelectedStyle` 主体从 `app.ts` 迁入 `styleCommands.ts`，`BoardSDK.updateSelectedStyle`
  一行委托（不走 `BoardCommands`，避免给命令类加一个只有门面在用的方法；公开签名不变）。
- 约束：
  - `collectCollapsedParticipants` 仍是 `BoardCommands` 的公开方法（`getActionBarSchema` 在用）。
  - `assertEditable` 只读守卫留在命令层，语义不变（`updateSelectedStyle` 自己的 editable 判断照旧）。
  - `exportPNG` 的纹理上限、culling 挂起/恢复、`finally` 顺序逐字保留。
  - `canvasTokenColor` 迁入 `exportCommand.ts`（当前 core 内只有这一份，旧的「app.ts 同款副本」注释是过期的，顺手改成当前事实）。
- 验收：`pnpm verify` + `pnpm test:e2e`（align/group/export 相关 spec 必跑）；
  `wc -l boardCommands.ts` < 400。
- 回退：单独 revert（纯函数搬家）。

### Step 5 — `app.ts` 收尾（必须 < 400）

- 新增 `boardQueries.ts` / `boardTeardown.ts` / `boardDebug.ts` / `boardProject.ts`（§3.6）。
- `IBoardConfig` 迁 `boardConfig.ts`；`index.ts`、`boardComposition.ts` 改 import。
- `app.ts` 只留：服务字段、`commands`/`outputs`/`widgetsChanged$`/`defaultToolOptions$`、`initialize`、
  17 个流 getter（一行委托）、3 个查询委托、`getActionBarSchema`、`updateSelectedStyle`、
  `__debug`、37 个公开命令方法（31 个委托 `BoardCommands`、1 个走 `styleCommands`、
  3 个存储直连、2 个走 `boardProject`）、
  `dispose`、`disposed`/`cullingForgetSub`。
- 删除字段区重复了 31 次的 `/** @internal 组装/命令层（批 B 三分）共享字段 */`，
  改成一个区块头注释（省 ~30 行）。
- **行数门禁**：`wc -l packages/core/src/app.ts` < 400。实测若仍超限，按此顺序继续外移（每移一项复跑）：
  1. `defaultToolOptionsBs` + `syncToolOption` → `BoardOutputs`；
  2. 命令委托改走「门面基类」`BoardFacade`（17 条流 getter + 32 条命令委托，`BoardSDK extends BoardFacade`）——
     仅在 1 之后仍超 400 时使用，且需在 `docs/04 §3` 记一句门面基类。
- 验收：`pnpm verify` + 全量 `pnpm test:e2e`（dispose 与 `__debug` 形状必须零变化）。
- 回退：单独 revert（Step 3/4 不依赖它）。

### Step 6 — 公共面 allowlist

- 新增 `boardPublicApi.ts`（§3.7）；`index.ts` 改为 re-export（删除原 `Omit` 大块）。
- 按 §3.7 切 `bridge.ts` / `commands.ts`；`Board.tsx` 不动。
- 新增 `__tests__/boardPublicApi.test.ts`（§6.2）。
- 验收：三包 `pnpm typecheck`（allowlist 漏成员会先在 react 包红）+ `pnpm lint` + `pnpm test`。
  额外验证：临时把某命令从名单删掉，确认 `commands.ts` 编译红，再恢复（自检锁有效）。
- 回退：单独 revert；`Bridge` 的 `ReturnType` 改动可独立回退。

### Step 7 — 类型注册表收口

- `types/widget.ts` union 派生 + 锁（§3.8 a）。
- 新增 `widgetRuntime.ts`、删除 `types/widgetFactories.ts`、收窄 `tokens.ts`（§3.8 b）。
- 改 `boardComposition.ts` 与 `createEngineForTest.ts` 的装配源（§3.8 c）。
- 改 `widgetRegistry.test.ts`：键集断言改 `WIDGET_RUNTIME`，补 union 键锁测试；
  顺带清掉 `boardComposition.ts` 里仍提 `WIDGET_TOKENS/WIDGET_FACTORIES` 的过期注释。
- 验收：`pnpm verify`（build 能抓值环）+ 全量 `pnpm test:e2e`（初始化装配是主链路）。
- 回退：单独 revert；先 revert 本步即可回到三表并存，不影响前六步。

### Step 8 — 文档与实测数字

- `docs/04 §3`：`WIDGET_TOKENS/WIDGET_FACTORIES` → `WIDGET_RUNTIME`；补「类型注册表 = schema + 运行时一项」。
- `docs/12 §2`：桥/命令模块消费 `BoardPublicApi`；补一句「公共面 = allowlist + 编译期分类锁」。
- `docs/13 §2 P2 架构收口`：四条改成 `[x]` 并用当前事实描述（不写日期/哈希/叙事）。
- `docs/20 §5.2`：`projectFile` 的「Omit 列表」表述改成「不在 allowlist，走 `@internal` 字段」。
- `AGENTS.md`「当前状态」：单测数、E2E 用例数按**复跑结果**更新。
- 复跑 `pnpm test:coverage`，确认 61/51/63/52 阈值不破（新增文件多为搬运，风险低但必须实测）。

## 6. 测试计划

### 6.1 新增 `__tests__/boardActionBar.test.ts`

用桩 host（`as unknown as IActionBarHost`），断言：

1. 无选中 → `null`；单选但 vm/model 缺失 → `null`。
2. 多选 2 参与者：6 个 align 可点、2 个 dist 禁用、group 键态来自 `group.getGroupActionState()`。
3. 多选 3 参与者：dist 可点；参与数由回调提供（回调未被调用时不算——单选分支不调用）。
4. SHAPE 分支：`shapeType` 取当前值、缺省回落 `rect`；字号/行高/对齐项存在且 value 带默认。
5. LINE 分支：8 项顺序固定（lineType/strokeWidth/dashed/startArrow/endArrow/color + 字号/文字色）。
6. STICKY 分支：便签色 + 排版项；TEXT 分支只有排版项。
7. MIND_MAP 节点焦点：只出分支色，value 来自 `getFocusedLineColor()`；根焦点 → 空 items。
8. IMAGE → `items: []`。

### 6.2 新增 `__tests__/boardPublicApi.test.ts`

1. 运行时：`BOARD_PUBLIC_MEMBERS` 每一项 `in new BoardSDK()`（getter 在原型上，`in` 成立）。
2. 类型：`expectTypeOf<keyof BoardPublicApi>().toEqualTypeOf<BoardPublicMember>()`。
3. 反向抽样：`'viewport'` / `'engine'` / `'__debug'` 不在名单里（`expect(BOARD_PUBLIC_MEMBERS).not.toContain(...)`）。

### 6.3 改既有测试

- `updateEditable.test.ts`：两处构造加 cast（Step 1），断言零改动。
- `widgetRegistry.test.ts`：`WIDGET_TOKENS/WIDGET_FACTORIES` 断言换成 `WIDGET_RUNTIME` 键集 +
  `modelToken/vmToken` 唯一性；保留 schema parse 与类型等价锁。
- `alignCommand.test.ts` / `boardSdkDispose.test.ts` / `boardSdkCursorMode.test.ts`：不改（桩仍打在 `BoardSDK` 字段上）。

### 6.4 E2E

- 全量必跑三次：Step 3（ActionBar）、Step 5（dispose/debug）、Step 7（装配）。
- 重点 spec：`smoke`（`__debug` 形状）、`toolbar`（ActionBar 交互）、`align`、`group`、`export`、`mind`、`multiTab`。

## 7. 验收门禁（DoD）

### 7.1 命令

```bash
pnpm verify
pnpm test:e2e
pnpm test:coverage          # 阈值 61/51/63/52 不破
wc -l packages/core/src/app.ts packages/core/src/boardCommands.ts
grep -rn "ctx: any" packages/core/src          # 0 行
grep -rn "WIDGET_TOKENS\|WIDGET_FACTORIES\|widgetFactories" packages --include=*.ts   # 0 行
grep -rn "Omit<BoardSDK" packages/core/src     # 0 行
```

### 7.2 数字

| 指标               | 基线           | 目标                                                                        |
| ------------------ | -------------- | --------------------------------------------------------------------------- |
| `app.ts`           | 1026 行        | < 400                                                                       |
| `boardCommands.ts` | 465 行         | < 400                                                                       |
| 新增源文件         | —              | 均 ≤ 400                                                                    |
| core 单测          | 869            | 不下降（复审实测新增 14 例 → 883，ActionBar 10 + PublicApi 3 + Registry 1） |
| react 单测         | 26             | 不变                                                                        |
| E2E                | 20 spec/186 例 | 全绿；用例数不变                                                            |
| 公开面             | 46 个 Omit 键  | 64 个 Pick 成员 + 39 个 internal 分类                                       |

### 7.3 文档同步

见 Step 8 清单。`docs/` 只写当前事实：不写「此前是 Omit，现在改 Pick」这类叙事，
直接描述 allowlist 与分类锁的现状。

## 8. 风险与对策

| 风险                                          | 触发点                            | 对策                                                                                                      |
| --------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 值循环 import（app ↔ 新模块）                 | Step 1/2/5                        | 新模块对 app 只 `import type`；`pnpm build` 与单测双兜底                                                  |
| 类字段初始化顺序（`useDefineForClassFields`） | `new BoardOutputs(this)` 早于字段 | 构造器只存引用；Step 2 用 `boardSdkCursorMode`（构造后塞桩）验证                                          |
| 桩测 cast 掩盖契约错误                        | Step 1                            | cast 只出现在测试、且只此两处；源码零 `any`                                                               |
| schema 逐字段漂移                             | Step 3                            | 新增单测锁分支 + E2E toolbar；先跑单测再跑 E2E                                                            |
| dispose 顺序被「顺手整理」                    | Step 5                            | 逐行照搬 + 现有幂等测试；diff 只允许文件位置变化，不允许行序变化                                          |
| `__debug` 形状变化                            | Step 5                            | 适配器逐字段照搬；E2E 162 处 `__debug` 引用是硬断言                                                       |
| 覆盖率跌破阈值                                | Step 3/4/5/7                      | 完成前跑 `test:coverage`；不足则补 `boardActionBar` 分支用例                                              |
| `widgetRuntime` 把 PIXI 带进数据层测试        | Step 7                            | 唯一消费方 `createEngineForTest` 跑在 jsdom；若 node 环境报错，退回保留 `WIDGET_TOKENS`（本步可局部回退） |
| `Object.entries` 丢 `as const` 精度           | Step 7                            | Map 显式泛型；`satisfies Record<…>` 兜底                                                                  |
| allowlist 分类遗漏                            | Step 6                            | 三条编译锁（未归类/重叠/不存在）；临时删成员自检                                                          |

## 9. 评审与拍板结论

### 9.1 已拍板（实施方直接执行，不再讨论）

| #   | 决策                                                           | 理由                                                                |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| A1  | 新文件放 `src/` 根、`board*` 命名                              | 与 `boardComposition.ts` 同级，属组合根/门面层，不进 platform       |
| A2  | `IBoardCommandHost` 字段必填可空，测试桩用显式 cast            | 契约完整 + 桩的不完整性可见，不污染生产契约                         |
| A3  | `syncToolOption` 归 internal；`defaultShapeType` 归 public     | 前者仅组合根种子写入；后者是会话态查询，与 `defaultShapeType$` 对称 |
| A4  | 运行时收窄继续挂账                                             | 破坏性，需要主版本；本批只做类型收口                                |
| A5  | `WIDGET_RUNTIME` 的 token 现场生成，删除 14 个具名常量         | 去掉第三个注册源；token 仅调试用途                                  |
| A6  | `updateSelectedStyle` 归命令层（`styleCommands.ts`）           | 它本来就是写命令；也让 app.ts 稳定 < 400                            |
| A7  | `Board.tsx` 保持 `BoardSDK` 类型                               | DEV 句柄要内部字段（E2E 162 处 `__debug`），换类型等于自断调试面    |
| A8  | 门面基类 `BoardFacade` 只作为 Step 5 的兜底 rung，不做默认方案 | 避免为行数引入继承；先靠外移与注释去重解决                          |
| A9  | allowlist 只做类型层，运行时收窄留到破坏性版本                 | 评审确认 A4 的范围；E2E 与桩测依赖 internal 字段可访问              |
| A10 | `boardCommands` 拆分纳入本批（Step 4 必做）                    | 465 行已超 400，顺势收口；不做「另开一批」                          |
| A11 | `createEngineForTest` 与组合根同构，顺带注册 MIND_MAP          | 只影响测试装配，现有断言零改动                                      |
| A12 | 接受 14 个新文件，不做门面合并                                 | 单文件职责优先于文件数量；`boardFacades.ts` 合并方案作废            |

### 9.2 评审记录

本轮评审对原「待确认」四项全部通过，落为 A9–A12：allowlist 仅类型层（A9）、
`boardCommands` 拆分进入本批（A10）、`createEngineForTest` 与组合根同构（A11）、
接受 14 个新文件不合并（A12）。

因此：

- §5 Step 4 是**必做项**，不再保留「可跳过」路径；
- Step 7 的测试 helper 改动按 §3.8(c) 直接执行，不再评估；
- §3.1 的文件布局即为最终形态，不引入 `boardFacades.ts`；
- 运行时收窄不进入本批，`internal` 成员继续以公开字段存在。

## 10. 实施硬约束清单

**必须**

- 每步独立提交、独立可回退；提交前 `pnpm verify` 全绿。
- 新增类型导入一律 `import type`（`verbatimModuleSyntax`）。
- `dispose` 顺序、兜底流语义、`__debug` 形状：逐字照搬。
- §4 成员表一个不多一个不少；新增成员先在表里归类再写代码。
- 注释解释「为什么」；迁移代码时保留原有约束注释（尤其 docs 引用段落号）。

**禁止**

- 禁止顺手改行为、改默认值、改 E2E 期望。
- 禁止把 internal 字段改成 `private`/`#private`（桩测与 DEV 句柄会断）。
- 禁止在 `types/` 里 import `widgets/`（Step 7 后应删除该类依赖）。
- 禁止用 `--no-verify` 绕过门禁。
- 禁止把本文的实施流水账写进 `docs/`（docs 只写当前事实）。

## 11. 复审记录（2026-10-25，独立复跑门禁）

复审范围 `b95a05c..758bb9d`（本文全部实施提交）。复跑结果：`pnpm verify` 通过、
单测 909（core 883 + react 26，106 文件）、coverage 阈值不破、E2E 186 例全绿、
app.ts/boardCommands.ts 复审时 243/265 行、四条 grep（ctx:any / WIDGET_TOKENS /
WIDGET_FACTORIES / Omit<BoardSDK）源码零残留、allowlist 与 §4 成员表逐项一致。
行为保真逐字核对通过：dispose 32 步顺序、17 条流兜底、`__debug` 18 字段、
ActionBar 分支、align/export/style 事务时序。

发现与处置（无阻断项，全部已修）：

| 级别 | 位置                  | 发现                                                                               | 处置                                                              |
| ---- | --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P2   | docs/15 §2            | 基线仍写 895/869/104 文件                                                          | 改 909/883/106                                                    |
| P2   | types/README.md       | 引用已删除的 widgetFactories 与已合并的 token/工厂表                               | 改 WIDGET_REGISTRY（schema 域）+ widgetRuntime.ts（运行时域）     |
| P3   | core/README.md        | 「token 登记（tokens.ts）」不完整（漏控件 token 新位置）                           | 补「服务 token 在 tokens.ts，控件 token/工厂在 widgetRuntime.ts」 |
| P3   | widgetRuntime.ts 头注 | 「Service 不在此注册」误指 docs/16 §8（性能篇，继承自 widgetFactories 的失效引用） | 改指 docs/04 §3                                                   |
| P3   | boardCommands.ts      | 委托方法名与模块导入同名，靠「方法名不进词法作用域」解析，未来重构有误递归风险     | 导入改 `xxxImpl` 别名（app.ts 同款 6 处顺带一致修复）             |
| P3   | 本文 §7.2             | 「新增 ~13 例」与实测 +14 不符                                                     | 改实测 14 例                                                      |

运行时收窄按 A9 继续挂账；`window.__spinth` 保持 BoardSDK 类型（A7），E2E 162 处探针不受影响。
