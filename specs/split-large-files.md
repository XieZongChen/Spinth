# 拆大文件：技术方案与架构设计

> 范围：[docs/13](../docs/13-roadmap.md) §2 阶段 1.1（发布前工程债之一）。
> 状态：**已实施完成**（分支 `refactor/split-large-files`，§6 的 16 笔全部落地；
> 外部审查后按「一笔一个 seam」重建：lineSelect import 修复并回 widgets E2E 笔、
> mindNodeEdit 细分并回 mind E2E 笔，另有 CI 路径/文档事实/两处收口的追加笔）。
> 关联：AGENTS「单文件单职责」、[docs/15](../docs/15-testing.md) §5、[docs/16](../docs/16-performance.md) §6。

## 0. 实施结果（2026-10-30）

- 源码行数报告（附录 A 命令）输出为空：10 个目标源文件全部拆至 < 400 行。
- E2E > 500 行文件为空；401-500 区间仅 5 个 spec（lineQuickAdd 460、
  toolbarMenu 430、lineSelect 429、imageAsset 419、textEditShape 414）。
- 计数不变：单测 983（core 894 + react 51 + app 38）；E2E 主配置 205 用例 +
  pwa 配置 6 用例 = 211；spec 文件主配置 22 → 43（含 pwa 共 23 → 44）。
- 与设计的偏差（均在方案框架内适配，见 §8.4 精神）：
  - 方案点名的部分「模块级函数」（lineVm 的 createLineTextNode 等、
    lineHoverOverlay 的 resolveLineHover 等、textService 的 commitEdit）实为
    类方法或内联逻辑——按手法 B 做方法体外移，类方法变薄委托。
  - `pathLength` 放 lineGeometry（route/path 两域共用度量）；
    `readLegacyUpdates` 外移 dbMaintenance；线型/线宽选项表外移 lineDrawSession
    并经 lineService re-export 保持消费路径（§3.3 先例）。
  - dbProvider/lineService/selectorService 拆后行数按真实接线成本落在
    390-398 区间（设计预估 350-380 偏乐观），均 < 400 达标。
  - mindService 单测拆分时发现既有 `mindNav.test.ts`（mindNav 纯逻辑 29 例）
    与方案文件名撞名——保留原文件，方向键导航 2 例并入 mindBuild。
  - E2E helper 命名按实际探针函数（probe/lineProbe）落位
    boardE2e/widgetProbeE2e/mindProbeE2e/textProbeE2e/imageProbeE2e +
    各域 E2e helper；multiTab 继续复用 projectFileE2e 的 ready。
- 外部审查收口（同日）：
  - P1：nightly multitab-stress 的 CI 命令与 docs/15 同命令改指
    `multiTabRole.spec.ts`（`multiTab.spec.ts` 已拆分，原命令 No tests found）。
  - P2：docs/15（spec 计数/专项清单/coverage 数值/命令）、docs/16（>400 行
    台账）、docs/17、docs/21、AGENTS、docs/13 的「当前事实」全部同步。
  - 提交历史重建：考古确认 lineSelect 缺 import 由 widgets E2E 拆分笔新建时
    漏写（非后续删除）；import 修复与 mindNodeEdit 拆分分别并回对应笔，
    bc8e91c 不再存在——每笔独立可回退。
  - P3.1：LINE_TYPE_OPTIONS/LINE_WIDTH_STEPS/LINE_WIDTH_OPTIONS 自
    lineDrawSession 抽至 `lineOptions.ts`（拉线状态机不再持有 ActionBar
    选项表；lineService re-export 保持消费路径）。
  - P3.2：viewportZoom 立即路径的双 markRender 收敛为经 host.onMoved 一次
    （与拆分前渲染计数一致）。

## 1. 目标与非目标

### 1.1 目标

- **源码硬目标**：清单内源文件拆分后单文件 < 400 行；新增文件同样遵守。
- **测试软目标**：单测按 describe 域拆分，单文件目标 < 400 行；E2E 按用户流程拆分，单文件目标 < 500 行，**不新增 > 600 行文件**。
- **行为零变化**：schema、默认值、Yjs 数据、渲染像素、undo 粒度、快捷键、E2E 断言全部不变。
- **兼容面稳定**：公共 import 路径、类名、构造签名、方法签名、常量导出不变；core 的 index.ts 不新增导出。
- **可回退**：每个 seam 一笔提交；源拆分与测试拆分分开；任一笔可单独 revert。
- **建立边界**：为阶段 1.2–1.4（纹理保活、边缘滚屏、运行时收窄）降低审查面与冲突面。

### 1.2 非目标

- 不做运行时收窄、纹理保活、边缘自动滚屏；它们各自独立立项。
- 不新增依赖、不改构建配置、不改 tsconfig 别名、不改测试框架、不改 CI。
- 不新增行数 lint 硬门禁；拆分期先以命令报告为准，门禁另立。
- 不重命名公共 API、不调整包边界、不合并目录、不改数据格式。
- 不顺手修 bug、不改默认值、不改注释语义、不删除历史约束注释。
- 不把测试改成更宽松的断言；测试只搬家，不改期望。

## 2. 现状盘点

### 2.1 超 400 行清单（设计时实测）

源码：

| 文件                                                   | 行数 | 主要职责                                         |
| ------------------------------------------------------ | ---: | ------------------------------------------------ |
| packages/core/src/widgets/line/lineMath.ts             |  983 | 连线锚点/命中/路由/曲线/切片/手柄几何            |
| packages/core/src/widgets/line/lineService.ts          |  610 | 拉线手势、quick-add 接线、锚定跟随、文字编辑委托 |
| packages/core/src/platform/dataEngine/dbProvider.ts    |  609 | IndexedDB 双 store、写聚合、compaction、维护函数 |
| packages/core/src/platform/viewport/viewportService.ts |  590 | PIXI 视口、分层、指针分发、缩放、resize          |
| packages/core/src/platform/selector/selectorService.ts |  485 | 点选/框选/拖拽状态机、选区框                     |
| packages/core/src/boardComposition.ts                  |  479 | BoardSDK 单函数装配                              |
| packages/core/src/widgets/text/textService.ts          |  461 | 文本创建、编辑会话、排版落库                     |
| packages/core/src/widgets/line/lineVm.ts               |  433 | 连线绘制、文字节点、命中                         |
| packages/core/src/widgets/line/lineHoverOverlay.ts     |  417 | 连线/连接点悬停、手柄、quick-add 影子            |
| packages/core/src/types/widget.ts                      |  414 | zod schema、能力位注册表、ActionBar 契约         |

单测：

| 文件                                                     | 行数 |
| -------------------------------------------------------- | ---: |
| `packages/core/src/__tests__/lineMath.test.ts`           | 1047 |
| `packages/core/src/__tests__/mindService.test.ts`        |  707 |
| `packages/core/src/__tests__/dbProvider.test.ts`         |  707 |
| `packages/core/src/__tests__/mindDragDescendant.test.ts` |  573 |
| `packages/core/src/__tests__/shapeVm.test.ts`            |  427 |

E2E：

| 文件                              | 行数 |
| --------------------------------- | ---: |
| packages/app/e2e/widgets.spec.ts  | 2359 |
| packages/app/e2e/mind.spec.ts     |  985 |
| packages/app/e2e/textEdit.spec.ts |  968 |
| packages/app/e2e/image.spec.ts    |  897 |
| packages/app/e2e/toolbar.spec.ts  |  581 |
| packages/app/e2e/align.spec.ts    |  573 |
| packages/app/e2e/group.spec.ts    |  549 |
| packages/app/e2e/coverage.spec.ts |  485 |
| packages/app/e2e/multiTab.spec.ts |  469 |
| packages/app/e2e/rotate.spec.ts   |  432 |

### 2.2 结构判断

- **lineMath**：纯函数库，15 个消费者，已有清晰的重叠段落（锚点/命中、路由、路径、手柄）。适合域模块 + 显式 barrel。
- **lineService**：已经是编排器，已有 LineHoverOverlay / LineQuickAdd / LineAnchorFollow / LineEndpointDrag / LineSegTextSlide / LineTextEditor 六个协作者。剩余体量集中在拉线手势状态机，适合抽一个状态协作者。
- **dbProvider**：写聚合（buffer/timer/retry）、compaction、维护函数三域边界清楚；compaction 状态耦合最重，**不拆**；写聚合与维护函数可安全外移。
- **viewportService**：指针输入（stage 监听/pointerId/取消通道）与相机缩放（setPageScale/zoom/fit）两块独立；分层与状态同步留在主类。
- **selectorService**：选中状态与拖拽状态机混在一起；拖拽分支是纯状态迁移，适合抽无状态操作函数，状态仍归主类。
- **textService**：工具创建、编辑会话、落库/测高三块；落库与排版解析是纯函数，适合外移，不引入新类。
- **lineVm / lineHoverOverlay**：绘制与命中/悬停数学可分离；纯数学外移，绘制副作用留在原类。
- **boardComposition**：单函数 420 行，装配顺序是语义；不能按服务类型随意重排，只能按连续阶段外移。
- **types/widget**：schema 是单源，拆 per-widget 文件会引入环与注册表碎片；只外移 ActionBar DOM 契约。

### 2.3 约束

- 依赖方向单向：types → core services → VMs → composition；新模块不得反向 import 上层。
- 叶子模块不得 import barrel；barrel 只给包外消费者。
- 新文件不得从 core 的 index.ts 导出（除非原本就是公共面）。
- 测试数与覆盖率阈值不得下降；E2E 用例数必须保持 211。
- 不出现新的全局单例、ServiceRegistry 注册项或装饰器 DI。
- 注释随代码移动；docs/NN §M 引用不得改号或丢失。

## 3. 总体策略

### 3.1 五种拆分手法

| 手法                             | 适用                                                              | 规则                                                   |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| A. 纯函数域模块 + 显式 barrel    | lineMath                                                          | 子模块互相 import 具体文件；barrel 只列原公开名        |
| B. 无状态操作函数 + context      | selector 拖拽、text 落库、lineVm 命中、hover 数学                 | 状态仍归原类；函数只接收显式 context                   |
| C. 有状态协作者 + host interface | lineDrawSession、dbWriteQueue、viewportPointerInput、viewportZoom | 只有 timer/listener/状态机才用类；构造注入，不查注册表 |
| D. 装配阶段函数                  | boardComposition                                                  | 每个函数是一段连续代码；调用顺序不变                   |
| E. 纯类型外移 + re-export        | types/widget → types/actionBar                                    | 不拆 schema；类型模块不 import 运行时                  |
| F. 测试按域搬迁                  | 单测/E2E                                                          | 只移动 test 块；共享 setup 先抽 helper                 |

优先级：A/B 优先；C 只在必须拥有 timer/listener/状态时使用；D 只用于组合根；E 只在无环时使用。

### 3.2 依赖方向

```text
types/actionBar   ←   types/widget (re-export)
lineMathTypes   →   lineGeometry   →   lineRoute / linePath   →   lineHandles
lineService     →   lineDrawSession → lineHitTest
lineService     →   lineHoverOverlay → lineHoverMath
lineVm          →   lineVmText / lineVmHit
dbProvider      →   dbWriteQueue / dbMaintenance → dbSchema
viewportService →   viewportPointerInput / viewportZoom
selectorService →   selectorDragOps
textService     →   textEditStyle / textCommit
boardComposition →  boardAssembly* → services
```

硬规则：

1. 叶子模块（types、math、context、ops）不得 import 任何 facade/barrel/组合根。
2. 新增协作者不得 import 原服务；需要回调时用 host interface，由原服务实现。
3. 任何新模块不得 import core 的 index.ts。
4. lineMath 子模块不得 import lineMath.ts；外部消费者可继续 import barrel。

### 3.3 兼容面

| 原文件              | 兼容方式                                   | 消费者需要改 import 吗 |
| ------------------- | ------------------------------------------ | ---------------------- |
| lineMath.ts         | 保留为 barrel，显式 re-export 原公开名     | 否                     |
| lineService.ts      | 类、常量、构造签名不变；协作者内部持有     | 否                     |
| dbProvider.ts       | 类不变；维护函数/错误类原路径 re-export    | 否                     |
| viewportService.ts  | 类不变；指针/缩放内部委托                  | 否                     |
| selectorService.ts  | 类不变；拖拽操作内部委托                   | 否                     |
| textService.ts      | 类不变；落库/排版解析内部 import           | 否                     |
| lineVm.ts           | 类与常量不变；常量从 lineVmText re-export  | 否                     |
| lineHoverOverlay.ts | 类与 ILineOverlayHost 不变                 | 否                     |
| boardComposition.ts | composeBoard 签名不变                      | 否                     |
| types/widget.ts     | ActionBar 契约 re-export；types/index 不变 | 否                     |

### 3.4 命名规则

- 连线：lineMathTypes / lineGeometry / lineRoute / linePath / lineHandles / lineHitTest / lineDrawSession / lineVmText / lineVmHit / lineHoverMath。
- 数据：dbSchema / dbWriteQueue / dbMaintenance。
- 视口：viewportPointerInput / viewportZoom。
- 选择：selectorDragOps。
- 文本：textEditStyle / textCommit。
- 组合根：boardAssemblyCore / boardAssemblyData / boardAssemblyProject / boardAssemblyInteraction / boardAssemblyTools / boardMaintenanceSchedule。
- 禁止 utils.ts / helpers.ts / common.ts / shared.ts / misc.ts 这类无域名词。
- host interface 命名 I<Owner><Collaborator>Host，定义在协作者文件内，不进 types/。

### 3.5 提交协议

- 分支：refactor/split-large-files。
- 每个 seam 一笔；**先源拆分，现有测试不动并通过**；再测试拆分。两者不混提。
- 每笔提交前跑 pnpm verify；提交后立即 push；禁止 --no-verify。
- 每个 wave 结束跑全量 E2E；触及渲染模块的 wave 追加视觉校验。
- 提交信息模板：
  - refactor: 拆 lineMath 为几何/路由/路径/手柄模块
  - test: 拆 lineMath 单测
  - refactor: 抽 LineDrawSession
  - test: 拆 mind 单测
  - test: 拆 widgets E2E（连线/画笔/橡皮）
- 不 squash、不批量重排 import、不顺手格式化无关文件。

## 4. 文件级设计

### 4.1 lineMath.ts

**目标树**

```text
lineMath.ts           显式 barrel（只 re-export 原公开名）
lineMathTypes.ts      IPt / JoinDir
lineGeometry.ts       锚点、最近边、点线距离、命中、裁剪、段几何、通用几何
lineRoute.ts          走廊/绕行/贴边/短末段/routeElbow/pinKeepMiddle
linePath.ts           端点收缩、曲线、ratio 定位、镂空/虚线切片、effectivePath
lineHandles.ts        主段、胶囊、分支错位、外移点、段滑移
```

**符号归属**

| 模块             | 吸收符号                                                                                                                                                                                                                                   | 预估 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---: |
| lineMathTypes.ts | IPt、JoinDir                                                                                                                                                                                                                               |  ~20 |
| lineGeometry.ts  | centerOf、anchorOf、nearestJoin、segmentDirection、sqDistToSegment、polylineHit、JOIN_DIRS、quantizeJoin、segmentIntersectsRect、clipSegmentToRect、segmentGeoms、ISegmentGeom、r2、nearestSegBody、intersectLine                          | ~240 |
| lineRoute.ts     | NODE_MARGIN、ELBOW_RADIUS、pathClear、approachOk、pathHugsEdge、mergeCollinear、absorbTinyJogs、IRouteElbowOptions、routeElbow、pinKeepMiddle                                                                                              | ~250 |
| linePath.ts      | pathLength、LINE_END_GAP、insetEnds、CURVE_ARM、curveControlPoints、flattenCurve、pointAtRatio、ratioAtPoint、slicePathExcludingRect、slicePathByDash、effectivePath                                                                       | ~210 |
| lineHandles.ts   | MAJOR_SEG_MIN_SCREEN、majorSegments、CAPSULE_MIN_PIECE_SCREEN、QUICK_ADD_GAP、BRANCH_STAGGER_GAP、branchStride、branchSlotOffset、capsuleAnchors、ANCHOR_DOT_OFFSET、dotOffsetCenter、SEGMENT_BODY_TOLERANCE、SEG_SLIDE_STUB、slideSegment | ~220 |
| lineMath.ts      | 原公开名显式 re-export + rotatePointAround/inverseRotatePoint                                                                                                                                                                              |  ~60 |

**barrel 规则**

- 禁止 export *：部分 helper 从 private 变为跨模块可用（如 centerOf、clipSegmentToRect、pathClear、CURVE_ARM），export * 会把它们变成新公开面。
- barrel 按当前 lineMath.ts 的 export 清单逐项列出；IPt/JoinDir 用 export type。
- 保留 rotatePointAround / inverseRotatePoint 的 re-export；lineVm 等消费者不感知。
- 子模块之间只 import 具体文件；lineRoute/linePath 可以 import lineGeometry；lineHandles 可以 import lineGeometry/linePath；禁止反向。

**测试拆分**

| 新测试               | 吸收 describe                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| lineGeometry.test.ts | lineMath（docs/08 §3）、segmentGeoms 段几何                                                       |
| lineRoute.test.ts    | routeElbow 正交路由、mergeCollinear/absorbTinyJogs、绕行候选、贴边降权、锚定进入段、pinKeepMiddle |
| linePath.test.ts     | 线上文字定位、镂空与虚线切分、effectivePath 视图语义路径                                          |
| lineHandles.test.ts  | majorSegments、capsuleAnchors、slideSegment                                                       |
| lineSchema.test.ts   | LineSchema pinned 默认值                                                                          |

**验收**

- 现有 lineMath.test.ts 在源拆分后不改一行仍全绿（走 barrel）。
- 测试拆分后 70 个用例一个不少；测试标题不改。
- barrel 的 export 清单与拆分前一致；全仓 typecheck 通过。
- 无子模块 import lineMath.ts。

### 4.2 lineService.ts

**目标文件**

| 文件               | 职责                                                                                                                                                   | 预估 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---: |
| lineDrawSession.ts | 拉线状态机：drawingId、pendingMove、moveTimer、startAnchor、pointer down/move/up、applyMove、flush、settle、isDrawing、dispose                         | ~230 |
| lineHitTest.ts     | hitWidget（严格命中 + 边缘容差环），供 draw session 与 endpoint drag 共用                                                                              |  ~40 |
| lineService.ts     | 默认线型/线宽、initialize 接线、overlay/quickAdd/anchorFollow/endpointDrag/segTextSlide、handleGestureDown、maybeShapeAnchorGrab、dblclick、探针、委托 | ~370 |

**LineDrawSession 契约**

```ts
export interface ILineDrawHost {
  readonly overlay: Pick<LineHoverOverlay, 'showDrawFeedback' | 'hideDrawFeedback'> | null;
  getDefaultLineType(): LineType;
  getDefaultStrokeWidth(): number;
}

export class LineDrawSession extends Disposable {
  constructor(
    viewport: IViewportService,
    engine: IDataEngineService,
    vmEngine: IVmEngineService,
    selector: ISelectorService,
    history: IHistoryService,
    host: ILineDrawHost,
  );
  beginFromQuickAdd(id: string, anchor: ILineAnchorData): void;
  queueMove(world: { x: number; y: number }): void;
  pointerDown(e: IPointerEventInfo): void;
  pointerMove(e: IPointerEventInfo): void;
  pointerUp(e: IPointerEventInfo): void;
  flush(): void;
  settle(id: string): void;
  get isDrawing(): boolean;
  get startAnchor(): { nodeId: string | null; join: JoinDir | null; point: IPt } | null;
  override dispose(): void;
}
```

**委托映射**

- LineService.onPointerDown/Move/Up → drawSession 同名方法。
- LineQuickAdd 回调：
  - beginSession → drawSession.beginFromQuickAdd
  - endSession → drawSession.flush 后清 drawingId（session 内部完成）
  - throttledMove → drawSession.queueMove
  - settle → drawSession.settle
  - getStartAnchor → drawSession.startAnchor
- handleGestureDown / onLineDblClick 的 drawingId 判断 → drawSession.isDrawing。
- LineService.dispose → drawSession.dispose 后再 super.dispose。
- hitWidget 从 LineService 移到 lineHitTest，endpointDrag 的 hitTest 改 import。

**必须保留的顺序**

1. 松手先 flush，再清 drawingId，再 settle；注释与顺序原样保留。
2. quick-add endSession 先 flush 再清状态。
3. moveTimer 只能有一个；dispose 清 timer。
4. settle 的未拖出 <4px 删除 → 否则选中逻辑不改。

**验收**

- 现有 lineDrawFlush / lineDefaultType / selectorDrag 等测试不改仍绿。
- 一次拖拽只写一次 Yjs；E2E 连线用例全绿。
- 无 timer 泄漏；dispose 后无回调。

### 4.3 dbProvider.ts

**目标文件**

| 文件             | 职责                                                                                     | 预估 |
| ---------------- | ---------------------------------------------------------------------------------------- | ---: |
| dbSchema.ts      | DOC_DB_PREFIX、STORE_UPDATES、STORE_ALL、IAuditEntry、reqToPromise、openDb               |  ~60 |
| dbWriteQueue.ts  | 写聚合：buffer/auditBuffer、flushTimer、flushing、retryDelayMs、enqueue、flush、dispose  | ~160 |
| dbMaintenance.ts | listPersistedDocIds、scanDocAssetRefs、DocExistsError、createDocFromSnapshot             | ~130 |
| dbProvider.ts    | 类：attach、readOnly、onDocUpdate、compaction、readAuditLog、dispose；维护函数 re-export | ~350 |

**DbWriteQueue 契约**

```ts
export interface IDbWriteQueueHost {
  getDb(): IDBDatabase | null;
  onFlushed(count: number): void;
}

export class DbWriteQueue {
  constructor(
    host: IDbWriteQueueHost,
    persistState$: BehaviorSubject<'saved' | 'saving' | 'failed'>,
  );
  enqueue(update: Uint8Array): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
  /** 测试探针：与旧字段同名语义 */
  get retryDelayMs(): number;
  get buffered(): number;
}
```

**状态归属**

| 状态                                                                                                               | 归属                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| db / doc / pendingCount / compactTimer / compacting / snapshotCompute / compactWorkerUsed / readOnly / skipOrigins | DbProvider                      |
| writeBuffer / auditBuffer / flushTimer / flushing / retryDelayMs                                                   | DbWriteQueue                    |
| persistState$                                                                                                      | DbProvider 持有，构造时注入队列 |

**接线**

- onDocUpdate：skipOrigins/readOnly/db 判定留在 provider；通过后 queue.enqueue(update)。
- flushPendingWrites：委托 queue.flush()。
- setReadOnly(true)：void queue.flush()；切回可写只复位 warned。
- flush 成功：host.onFlushed(count) → pendingCount += count；scheduleCompact()。
- dispose：清 compactTimer → const pending = queue.dispose() → super.dispose()（立即，不 await）→ pending.finally 关闭 db。
- 维护函数与 DocExistsError 从 dbProvider re-export，保持 assetGc/projectImport 的 import 路径。

**测试探针迁移**

dbProvider.test.ts 有 5 处直接读 private：

- retryDelayMs 4 处 → writeQueue.retryDelayMs
- writeBuffer.length 1 处 → writeQueue.buffered

断言值不变；这只是访问路径迁移。readOnly、snapshotCompute 仍在 provider，测试不动。

**验收**

- dbProvider.test.ts 24 例、dbProvider.importSnapshot 4 例不改期望仍绿。
- 写失败退避、pagehide/visibilitychange 冲刷、只读冲刷、dispose 冲刷全部保持。
- 无 timer 双清、无 flush 重入。

### 4.4 viewportService.ts

**目标文件**

| 文件                    | 职责                                                                                                           | 预估 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ---: |
| viewportPointerInput.ts | handlers map、stage 五事件、pointerId 过滤、主键过滤、native pointercancel、window blur、dispatchGestureCancel | ~200 |
| viewportZoom.ts         | setPageScale、zoomIn、zoomOut、zoomToFit                                                                       |  ~90 |
| viewportService.ts      | 生命周期、分层/zOrder、视口状态同步、坐标变换、wheel/space/光标、resize、dispose                               | ~310 |

**ViewportPointerInput 契约**

```ts
export interface IViewportPointerHost {
  readonly stage: Container;
  readonly canvas: HTMLCanvasElement;
  toWorld(p: { x: number; y: number }): Point;
  readonly cursorMode$: BehaviorSubject<CursorMode>;
  readonly editable$: BehaviorSubject<boolean>;
  readonly curPos$: BehaviorSubject<IPoint | null>;
  isEditBlocked(): boolean;
}

export class ViewportPointerInput extends Disposable {
  constructor(host: IViewportPointerHost);
  register(mode: CursorMode, handlers: IPointerHandlers): void;
  bind(): void;
  dispatchCancel(mode: CursorMode): void;
}
```

**ViewportZoom 契约**

```ts
export interface IViewportZoomHost {
  readonly viewport: Viewport;
  readonly widgetLayer: Container;
  getRendererSize(): { width: number; height: number } | null;
  onMoved(): void;
}

export class ViewportZoom {
  constructor(host: IViewportZoomHost);
  setPageScale(scale: number, focus?: { x: number; y: number }, immediate?: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(padding?: number): void;
}
```

**事件归属**

| 资源                                          | 归属            | 释放                  |
| --------------------------------------------- | --------------- | --------------------- |
| stage pointerdown/move/up/upoutside/rightdown | PointerInput    | bind 内 addDisposable |
| canvas pointercancel                          | PointerInput    | 同上                  |
| window blur                                   | PointerInput    | 同上                  |
| wheel capture                                 | ViewportService | addDisposable         |
| window keydown/keyup（space）                 | ViewportService | addDisposable         |
| ResizeObserver                                | ViewportService | dispose disconnect    |

**验收**

- 指针过滤、只读/断网守卫、awareness 光标节流、cancel 通道逐行保持。
- setPageScale immediate/non-immediate 两条路径、zoomToFit 空画布分支不变。
- E2E 快捷键/缩放/拖拽/只读用例全绿。

### 4.5 selectorService.ts

**目标文件**

| 文件               | 职责                                                                                         | 预估 |
| ------------------ | -------------------------------------------------------------------------------------------- | ---: |
| selectorDragOps.ts | DragState 类型、DRAG_TRACTION_SCREEN、applyDragMove、commitDrag、cancelDrag、createDragState | ~110 |
| selectorService.ts | 选中状态、initialize、pointer down、框选、单击激活、选区框同步                               | ~380 |

**契约**

```ts
export interface ISelectorDragContext {
  readonly viewport: IViewportService;
  readonly vmEngine: IVmEngineService;
  readonly engine: IDataEngineService;
  readonly history: IHistoryService;
  readonly selectionVm: SelectionVm;
  readonly dragMove$: Subject<void>;
  getRefLine(): RefLineService;
  onDragCommitted(ids: string[], dx: number, dy: number): void;
  syncSelectionVm(): void;
}

export function applyDragMove(ctx: ISelectorDragContext, state: DragState, world: IPoint): void;

export function commitDrag(ctx: ISelectorDragContext, state: DragState): void;

export function cancelDrag(ctx: ISelectorDragContext, state: DragState): void;
```

**规则**

- 状态仍归 SelectorService：dragState 的创建、清空、isDragging 判定留在主类。
- 拖拽分支的视觉预览、吸附、commitDrag、onDragCommitted、stopCapturing、syncSelectionVm 原样迁移。
- 单击激活逻辑留在主类：commit 返回后读 moved/wasSelected，再决定 onActivate。
- 框选、脑图拖拽、shift/alt 选择扩展不动。

**验收**

- selectorDrag.test 8 例、mindDragWiring 相关用例不改仍绿。
- 拖拽预览零 Yjs 写；松手一个事务；吸附最后一帧落库。
- 取消回弹、选区框跟随、单击已选中进编辑不变。

### 4.6 textService.ts

**目标文件**

| 文件             | 职责                                                                          | 预估 |
| ---------------- | ----------------------------------------------------------------------------- | ---: |
| textEditStyle.ts | IEditStyle、editStyleOf（override → 类型常量默认）                            |  ~60 |
| textCommit.ts    | commitTextEdit（TEXT/STICKY 测高 + SHAPE autoHeight 分流）                    |  ~80 |
| textService.ts   | 默认字号、工具创建、enterEdit/beginSession、reflowHeight、pasteText、exitEdit | ~330 |

**契约**

```ts
export interface ITextEditStyle {
  /* 原 IEditStyle 字段 */
}

export function editStyleOf(type: string, data: Record<string, unknown>): ITextEditStyle;

export interface ITextCommitDeps {
  readonly engine: IDataEngineService;
  readonly vmEngine: IVmEngineService;
}

export function commitTextEdit(
  deps: ITextCommitDeps,
  id: string,
  html: string,
  style: ITextEditStyle,
): void;
```

**规则**

- 不引入 TextEditSession 类；beginSession 与 style watch 仍在主类，避免 dispose 语义变化。
- commitTextEdit 是原 commitEdit 的方法体外移；测高、insetRectOf、shapeHeightFromTextHeight、事务顺序不改。
- reflowHeight 调 commitTextEdit；pasteText 调 editStyleOf。
- 空文本策略、SHAPE keep、STICKY fixed frame 全部留在 beginSession 描述符里。

**验收**

- textService.test 15 例、textDefaultFontSize 2 例不改仍绿。
- TEXT/STICKY/SHAPE 三态编辑、autoHeight、空删/keep 语义不变。
- 无新增 dispose/unsubscribe 行为。

### 4.7 lineVm.ts

**目标文件**

| 文件          | 职责                                                                                                                            | 预估 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---: |
| lineVmText.ts | LINE_TEXT_FONT_SIZE / LINE_TEXT_LINE_HEIGHT / KNOCKOUT_PADDING、createLineTextNode、applyLineTextStyle、computeLineTextKnockout |  ~80 |
| lineVmHit.ts  | HIT_TOLERANCE_BASE、hitTestLinePoint、hitTestLineText                                                                           |  ~50 |
| lineVm.ts     | 生命周期、drawLine 编排、strokePath/strokeRounded/drawArrow、previewRoute、编辑帧、getBounds、空操作覆写、dispose               | ~330 |

**规则**

- lineVm.ts 显式 re-export 两个文字常量，lineTextEditor 的 import 不变。
- lineVmText 不 import lineVm；只有 lineVm → lineVmText 单向。
- lineVmHit 接收 state/root/textSprite，不接收 LineVm 实例，避免环。
- 绘制指令、虚线模式、箭头角度、镂空 padding 逐像素不变。

**验收**

- interactionGeometry 相关用例不改仍绿。
- 视觉基线 5 张不变（本笔不跑 --update）。
- 预览文字滑移的 markRender 仍由 previewTextRatio 触发。

### 4.8 lineHoverOverlay.ts

**目标文件**

| 文件                | 职责                                                                              | 预估 |
| ------------------- | --------------------------------------------------------------------------------- | ---: |
| lineHoverMath.ts    | dotCenter、dotSnapshots、nearestDot、resolveLineHover（端点/段身命中 + 光标方向） |  ~90 |
| lineHoverOverlay.ts | 手柄/指示器/幽灵预览/悬停状态副作用、refreshHandles、followQuickDots、show/hide   | ~330 |

**规则**

- 纯数学收进 lineHoverMath；viewport.setHoverCursor、endpointHandles.show、ghostPreview.show 等副作用留在 overlay。
- resolveLineHover 只依赖 points/lineType/knockout/world/scale，不依赖 LineVm 类。
- 12px 抓取半径、8px 段身容差、主段过滤、双胶囊索引全部保持。

**验收**

- 连线 hover/端点/段条/幽灵预览 E2E 全绿。
- anchorHoverDebug / lineSegmentsDebug 等探针形状不变。

### 4.9 boardComposition.ts

**目标文件**

| 文件                        | 职责                                                                                                                       | 预估 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---: |
| boardAssemblyCore.ts        | 同步构造：engine/viewport/assetStore/imageTextures/textRender/registry/widget 注册/vmEngine/横切订阅/textRender.initialize |  ~90 |
| boardAssemblyData.ts        | engine.initialize（恢复）                                                                                                  |  ~30 |
| boardAssemblyProject.ts     | projectFile + storageStatus                                                                                                |  ~40 |
| boardAssemblyInteraction.ts | culling/history/refLine/selector/group/shape/rectEditor/layer/editing/text/lineService 及接线                              | ~150 |
| boardAssemblyTools.ts       | pen/eraser/sticky/image/contextMenu/network/keyboard/clipboard/mind/awareness                                              | ~150 |
| boardMaintenanceSchedule.ts | 资产维护链 idle 调度与双重闸门                                                                                             |  ~40 |
| boardComposition.ts         | composeBoard：按序调用 + throwIfAborted + initialized/storage 初始化                                                       |  ~60 |

**顺序契约（不可重排）**

|  步 | 操作                                         | 原位置  | 约束                                                                                          |
| --: | -------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
|   1 | assembleCore                                 | 64–137  | vmEngine 必须先于 engine.initialize 订阅；assetStore/imageTextures 先于恢复；横切订阅先于恢复 |
|   2 | throwIfAborted                               | 138     | 位置不变                                                                                      |
|   3 | await attachData                             | 142–148 | engine.initialize 带 writeEnabled                                                             |
|   4 | throwIfAborted                               | 149     | 位置不变                                                                                      |
|   5 | assembleProject                              | 151–173 | projectFile 闭包 + storageStatus                                                              |
|   6 | await viewport.initialize                    | 176     | 渲染就绪                                                                                      |
|   7 | throwIfAborted                               | 177     | 位置不变                                                                                      |
|   8 | textRender.attachRenderer                    | 179     | 必须在 viewport.initialize 之后                                                               |
|   9 | assembleInteraction                          | 181–299 | culling 先于恢复事件消费；lineService.initialize 后接 resizeMove                              |
|  10 | assembleTools                                | 300–440 | contextMenu 先于 keyboard；mind 先于 awareness                                                |
|  11 | initialized = true；storageStatus.initialize | 442–447 | 顺序不变                                                                                      |
|  12 | scheduleMaintenance                          | 449–478 | 只读/关闭维护不调度                                                                           |

**规则**

- 每个 helper 只包含连续代码块；不得把后面的服务提前构造。
- helper 接收 (sdk, config) 或 (sdk, root)；不引入新的全局状态。
- 注释随代码移动；阶段边界注释保留。
- 不在 helper 内调用 throwIfAborted；由 composeBoard 在固定位置调用。

**验收**

- 启动链路 E2E（smoke / pwa / multiTab）全绿。
- 刷新恢复、连线跟随、ActionBar、存储状态、资产维护链行为不变。
- sdk.initialized 时所有服务已就位；无 undefined 访问。

### 4.10 types/widget.ts

**目标文件**

| 文件               | 职责                                                                                        | 预估 |
| ------------------ | ------------------------------------------------------------------------------------------- | ---: |
| types/actionBar.ts | ActionBarItemKind、IActionBarOption、IActionBarItem、IActionBarSchema、IMindAddButtonsState |  ~50 |
| types/widget.ts    | zod schema、WIDGET_REGISTRY、WidgetDataUnion、派生锁、TYPES_WHERE；ActionBar 类型 re-export | ~370 |

**规则**

- 只移动 ActionBar DOM 契约；不拆 per-widget schema、不动 WIDGET_REGISTRY、不动派生锁。
- actionBar.ts 不 import widget.ts；widget.ts 用 export type 显式 re-export。
- types/index.ts 与 core 的 index.ts 不改。
- types/README.md 增加一行 actionBar.ts 说明。

**验收**

- 全仓 typecheck 通过；widgetRegistry.test 的类型锁不变。
- IActionBarSchema 等从 @spinth/core 与 ../types 的导入路径不变。

## 5. 测试拆分

### 5.1 单测映射

| 原文件                           | 新文件                                                                                 | 共享 helper                   |
| -------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| lineMath.test.ts（70）           | lineGeometry / lineRoute / linePath / lineHandles / lineSchema                         | 无                            |
| mindService.test.ts（33）        | mindBuild / mindNav / mindEdit / mindSelect / mindTool                                 | helpers/mindServiceFixture.ts |
| dbProvider.test.ts（24）         | dbProvider.store / dbProvider.writeQueue / dbProvider.compaction / dbProvider.readonly | helpers/dbProviderFixture.ts  |
| mindDragDescendant.test.ts（23） | mindDragLegality / mindDragText / mindDragDrop                                         | helpers/mindDragFixture.ts    |
| shapeVm.test.ts（41）            | shapeInset / shapeHeight / shapeVmRender                                               | 无                            |

**规则**

- 每个 describe 整体搬到对应文件；it 标题不改。
- 共享 setup 只在被 2 个以上新文件使用时抽 helper；否则保留本地。
- helper 不得改变 stub 顺序；见 §5.4。
- 测试文件数增加，用例总数不变（983）。

### 5.2 E2E 映射

| 原文件           | 新文件                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| widgets.spec.ts  | lineCreate / lineQuickAdd / lineEndpoint / lineSelect / lineText / lineStyle / pen / eraser |
| mind.spec.ts     | mindTool / mindLayout / mindSelect                                                          |
| textEdit.spec.ts | textEditText / textEditShape / textEditStyle                                                |
| image.spec.ts    | imageCreate / imageAsset / imageLifecycle                                                   |
| toolbar.spec.ts  | toolbarMenu / toolbarLine                                                                   |
| align.spec.ts    | align（基础）+ alignAnchor（连线跟随）                                                      |
| group.spec.ts    | groupCreate / groupOps                                                                      |
| coverage.spec.ts | historyLayer / styleResize / shortcuts（原文件删除）                                        |
| multiTab.spec.ts | multiTabRole / multiTabReadonly                                                             |
| rotate.spec.ts   | rotate（基础）+ rotateAnchor（连线/命中）                                                   |

**规则**

- 一个 spec 文件 = 一个用户流程域；超过 600 行继续按子流程拆。
- test 标题不改；skip 条件不改；docId 前缀按域唯一（防并行 worker 撞库）。
- 每个 test 独立 setup；若存在顺序依赖，保留在同一文件并显式 serial，不跨文件。
- 拆分后 playwright test --list 用例数仍为 211；spec 数增加是预期。

### 5.3 helper 抽取

**E2E**

| helper                        | 内容                                                     | 使用方            |
| ----------------------------- | -------------------------------------------------------- | ----------------- |
| e2e/helpers/boardE2e.ts       | waitForSynced、openBoardDoc（保留现有 ready 的等待语义） | 所有拆分后的 spec |
| e2e/helpers/widgetProbeE2e.ts | widgetProbe、createTwoRects、barPick、dragBy             | line*/pen/eraser  |
| e2e/helpers/mindProbeE2e.ts   | mindProbe、ghostPos                                      | mind*             |
| e2e/helpers/textProbeE2e.ts   | textOf、centerOf、textEditor                             | textEdit*         |
| e2e/helpers/imageProbeE2e.ts  | imageState、PNG_B64                                      | image*            |

注意：不要用 layoutE2e.openBoard 替换现有 ready；后者多等字体/双 rAF，会改变时序。

**单测**

| helper                                    | 内容                             | 使用方                         |
| ----------------------------------------- | -------------------------------- | ------------------------------ |
| `__tests__/helpers/mindServiceFixture.ts` | makeService、makeTreeService     | mindBuild/Nav/Edit/Select/Tool |
| `__tests__/helpers/dbProviderFixture.ts`  | writeWidget、flush、openProvider | dbProvider.*                   |
| `__tests__/helpers/mindDragFixture.ts`    | makeDragService、固定 rect VM 桩 | mindDrag*                      |

### 5.4 测试 preamble 与顺序

- `// @vitest-environment jsdom` 必须是文件第一行；拆分后每个新文件都要保留。
- import 'fake-indexeddb/auto'、stubPixiCanvasDocument()、mindViewportStub 的调用顺序按原文件逐字复制；helper 不得在 module 顶层提前执行 Pixi 构造。
- E2E 的 test.skip、test.describe.configure、beforeEach 原样保留。
- 不把 helper 写成有模块级可变状态的单例。

### 5.5 计数与覆盖率

- 单测：983（core 894 + react 51 + app 38）；拆分后总数不变。
- E2E：23 spec / 211 用例；拆分后用例数不变。
- coverage 阈值 66/58/68/57 不降；拆完跑 pnpm test:coverage 对比。
- 视觉基线 5 张不变；不跑 --update。

## 6. 实施顺序

### Wave 0 — 基线

- 记录 pnpm -r test 三包计数、playwright test --list 用例数、coverage 摘要、目标文件 wc -l。
- 确认工作区干净、pre-push 钩子可用。
- 建分支 refactor/split-large-files。

### Wave 1 — 纯函数与类型

|   # | 提交                                            | 内容                                 | 验收                      |
| --: | ----------------------------------------------- | ------------------------------------ | ------------------------- |
|   1 | refactor: 拆 lineMath 为几何/路由/路径/手柄模块 | 新增 5 模块 + barrel；旧测试不动     | pnpm verify；70 例绿      |
|   2 | test: 拆 lineMath 单测                          | 5 个测试文件；删旧文件               | 用例数不变                |
|   3 | refactor: 拆 lineVm 文字与命中                  | lineVmText/lineVmHit；常量 re-export | 视觉不更新；typecheck     |
|   4 | refactor: 抽 lineHover 几何判定                 | lineHoverMath；overlay 副作用不动    | 连线 E2E 定向             |
|   5 | refactor: 外移 ActionBar 契约                   | types/actionBar + re-export + README | typecheck；widgetRegistry |

### Wave 2 — 有状态协作者

|   # | 提交                                     | 内容                                                    | 验收                     |
| --: | ---------------------------------------- | ------------------------------------------------------- | ------------------------ |
|   6 | refactor: 拆 dbProvider 写队列与维护函数 | dbSchema/dbWriteQueue/dbMaintenance；4 处测试探针改路径 | dbProvider 24+4 例       |
|   7 | refactor: 拆 viewport 指针输入与缩放     | viewportPointerInput/viewportZoom                       | 快捷键/缩放 E2E          |
|   8 | refactor: 抽 selector 拖拽操作           | selectorDragOps；状态仍归主类                           | selectorDrag 8 例        |
|   9 | refactor: 拆 text 落库与排版解析         | textEditStyle/textCommit                                | textService 15 例        |
|  10 | refactor: 抽 LineDrawSession             | lineDrawSession + lineHitTest                           | lineDrawFlush + 连线 E2E |
|  11 | refactor: 拆 boardComposition 装配阶段   | 5 个 assembly/维护 helper                               | smoke/pwa/multiTab       |

### Wave 3 — 测试与 E2E

|   # | 提交                                                      | 内容                                | 验收                   |
| --: | --------------------------------------------------------- | ----------------------------------- | ---------------------- |
|  12 | test: 拆 mind/db/shape 单测                               | 15 个新测试文件 + 3 helper          | 总数不变               |
|  13 | test: 抽 E2E 公共 helper                                  | board/widget/mind/text/image helper | 现有 spec 不改用例仍绿 |
|  14 | test: 拆 widgets E2E                                      | line*/pen/eraser 8 文件             | 定向 + 全量 E2E        |
|  15 | test: 拆 mind/text/image E2E                              | 9 文件                              | 定向 + 全量 E2E        |
|  16 | test: 拆 toolbar/align/group/coverage/multiTab/rotate E2E | 13 文件                             | 全量 E2E               |

### 提交信息模板

```text
refactor: 拆 lineMath 为几何/路由/路径/手柄模块
test: 拆 lineMath 单测
refactor: 抽 LineDrawSession
test: 拆 mind 单测
test: 拆 widgets E2E（连线/画笔/橡皮）
```

每笔只做一件事；不把源拆分与测试拆分混在同一提交；不把多个文件域的拆分混提。

## 7. 验收标准

### 7.1 每笔提交

```bash
pnpm verify
git diff --check
git diff --color-moved=blocks --stat
```

- 现有测试不改仍绿（源拆分笔）。
- 新增文件 < 400 行（源码）；测试文件不超过目标上限。
- 没有新增 any / ts-ignore / eslint-disable。
- 公共 export 不减；barrel 无 export *。
- 通过后立即 push。

### 7.2 每个 Wave

```bash
pnpm test:e2e
pnpm test:coverage
node scripts/check-visual-baselines.mjs
```

- E2E 211 用例全绿；视觉基线不变。
- coverage 阈值不降。
- 目标文件行数报告更新。

### 7.3 最终

```bash
find packages -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' -print0   | xargs -0 wc -l | awk '$1 > 400 && $2 != "total"'
```

- 上述命令输出为空（源码）；测试/E2E 只允许白名单例外，且必须有理由。
- pnpm -r test 983 例；playwright test --list 211 例。
- pnpm verify 全绿。
- core 的 index.ts 导出面无变化。
- pnpm-lock.yaml、视觉基线、schema、默认值均无变化。

## 8. 风险、回滚与审查

### 8.1 风险

| 风险                              | 级别 | 缓解                                               |
| --------------------------------- | ---- | -------------------------------------------------- |
| 协作者抽取改变 this/初始化顺序    | 高   | move-only；host interface；逐行 diff；现有测试不动 |
| boardComposition 重排导致启动差异 | 高   | 顺序契约表；每步只搬连续块；启动 E2E               |
| timer/listener 释放两次或漏释放   | 高   | dispose 矩阵；每笔检查 addDisposable               |
| barrel export * 扩大公共面        | 中   | 显式 re-export 白名单；审查 diff                   |
| 测试 helper 提前执行 Pixi stub    | 中   | 每个新测试文件复制 preamble；不 module 顶层构造    |
| E2E 拆分后并行撞库/时序抖动       | 中   | 唯一 docId 前缀；独立 setup；全量复跑              |
| coverage 因 barrel/新文件下降     | 中   | 每 wave 跑 coverage；不降阈值                      |
| 拆过度导致无意义薄文件            | 中   | 只按域拆；单文件低于 80 行需合并回相邻域           |

### 8.2 dispose / listener 矩阵

| 所有者                     | 资源                     | 释放                                                 |
| -------------------------- | ------------------------ | ---------------------------------------------------- |
| LineDrawSession            | moveTimer                | dispose clear；LineService.dispose 先调 session      |
| DbWriteQueue               | flushTimer、buffers      | dispose clear + flush；DbProvider 等 flush 完再关 db |
| ViewportPointerInput       | stage/canvas/window 监听 | bind 内 addDisposable；service addDisposable(input)  |
| ViewportZoom               | 无自有监听               | 无                                                   |
| SelectorDragOps            | 无自有资源               | 无                                                   |
| TextCommit / TextEditStyle | 无                       | 无                                                   |
| 原 LineHoverOverlay        | 现有监听/订阅            | 保持不变                                             |

### 8.3 回滚

- 每个 seam 一笔；失败直接 git revert <sha>，不修历史。
- 源拆分失败：revert 后 barrel/原文件恢复，测试不受影响。
- 测试拆分失败：revert 测试笔，源模块保留。
- E2E 拆分失败：revert 该 spec 文件组，不阻塞后续源拆分。
- 不在同一笔里同时改源码和测试期望；否则无法判断回归来源。

### 8.4 设计自审记录

1. **曾考虑把 types/widget 按控件拆 schema**：会造成 schema 单源碎片与类型环，否决；只外移 ActionBar 契约。
2. **曾考虑把 dbProvider compaction 抽成协作者**：compacting/snapshotCompute/pendingCount 跨方法耦合，状态线程化风险高，否决；只抽写队列与维护函数。
3. **曾考虑把 boardComposition 按服务类型分组**：会改变装配顺序，否决；改为连续阶段 helper + 顺序契约。
4. **曾考虑把 text 编辑会话抽成类**：会改变 style watch 的 dispose 语义，否决；改为纯 commit/style 函数。
5. **曾考虑把 selector 拖拽抽成类**：单击激活/取消回弹跨状态，类边界反而更绕，否决；改为无状态 ops。
6. **曾考虑 E2E 按行数机械切**：会切断共享 setup 与顺序依赖，否决；改为 helper 先行、按用户流程切。
7. **barrel 最初想用 `export *`**：会把原本 private 的 centerOf/clipSegmentToRect 等变成公开面，否决；改为显式白名单。
8. **测试 helper 抽取最初想统一放一个 module**：会让 Pixi stub 提前执行，否决；改为按域 helper + 每文件 preamble。

### 8.5 审查清单

**实施者自检**

- [ ] 本笔只搬代码，没有改逻辑/默认值/断言。
- [ ] 公共 import 路径不变；barrel 显式白名单。
- [ ] 新文件没有 import 上层/barrel（叶子模块）。
- [ ] timer/listener 有唯一所有者，dispose 路径明确。
- [ ] 注释与 docs 引用随代码移动。
- [ ] pnpm verify 绿；测试计数不变。
- [ ] 提交信息符合 refactor/test 前缀。

**审查者检查**

- [ ] git diff --color-moved=blocks 显示为移动而非重写。
- [ ] git diff -U0 的非移动行只有 import/export/delegation。
- [ ] 没有新增 any/ts-ignore/eslint-disable。
- [ ] 没有改动 schema、默认值、视觉基线、lockfile。
- [ ] boardComposition 顺序与 §4.9 表一致。
- [ ] E2E test 标题、skip、docId 前缀保持。
- [ ] 最终文件行数报告为空或例外有理由。

### 8.6 明确不做

- 不修 bug、不改交互、不改渲染、不改默认值、不改快捷键。
- 不新增依赖/脚本/CI 步骤。
- 不新增行数硬门禁。
- 不触碰阶段 1.2–1.4 的纹理/滚屏/运行时收窄。
- 不拆分 compaction、不拆 per-widget schema、不重命名公共 API。

## 9. 附录

### A. 行数基线命令

```bash
find packages -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' -print0   | xargs -0 wc -l | awk '$1 > 400 && $2 != "total"' | sort -rn
```

### B. 公共导出白名单

- lineMath.ts：以拆分前 export 清单为准；含 IPt、JoinDir、常量、函数、rotatePointAround/inverseRotatePoint。
- lineVm.ts：LINE_TEXT_FONT_SIZE、LINE_TEXT_LINE_HEIGHT、LineVm。
- lineService.ts：LINE_TYPE_OPTIONS、LINE_WIDTH_STEPS、LINE_WIDTH_OPTIONS、LineService。
- dbProvider.ts：DOC_DB_PREFIX、DbProvider、listPersistedDocIds、scanDocAssetRefs、DocExistsError、createDocFromSnapshot。
- types/widget.ts：现有 schema/registry/union/TYPES_WHERE + ActionBar 五个类型 re-export。

### C. 参考文档

- [docs/13](../docs/13-roadmap.md) §2 阶段 1.1。
- [docs/15](../docs/15-testing.md) §5 已知缺口。
- [docs/16](../docs/16-performance.md) §6 性能债台账。
- [docs/05](../docs/05-selection-drag.md) §4.5（阶段 1.3，不在本批）。
- [docs/19](../docs/19-assets.md) §3（阶段 1.2，不在本批）。
- [specs/api-surface.md](api-surface.md)（运行时收窄，阶段 1.4，不在本批）。
