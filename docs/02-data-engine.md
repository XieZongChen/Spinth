# 02 — 数据引擎（Yjs）

## 1. 设计目标

- **单一数据源**：`Y.Doc` 是唯一真相，Model 是薄封装，`toJSON()` 实时投影、无副本。
- **统一写入口**：业务写入经 DataProcessor；事务化 + 写前 diff。
- **撤销粒度 = 事务粒度**：一次语义操作一个 transaction。
- **本地可用**：IndexedDB 持久化；刷新恢复；未来协同时断线可编辑、重连合并。
- **可回放调试**：本地审计日志支持逐 op 重演。

## 2. 文档结构

单 `Y.Doc`（`guid = docId`），顶层唯一 `Y.Array('widgets')`。每个 widget 是一个
`Y.Map`：

```ts
{ id, type: 'SHAPE', zOrder: 'a0', color: '#1d2939', ... }

// 几何字段独立存放（yRect：Y.Array<{ key, val }>）
rect: Y.Array<{ key: 'x' | 'y' | 'width' | 'height'; val: number }>

// TEXT/STICKY/LINE/SHAPE：排版 override 平铺在主 Y.Map（TypoFields，docs/17 §4）
// MIND_MAP：root（Y.Map）+ 节点 children（Y.Array）递归树（docs/11）
```

几何与属性分离的原因：高频位移与低频属性分开，撤销粒度可控，样式修改不会和连续
位移混在同一栈帧。

### zOrder：fractional indexing

- 层级是字符串 key（`generateKeyBetween`），任意两层之间总能生成新键。
- 改层级只改一个字段，O(1)；多端并发不冲突；字典序即渲染序。
- 初始 key：`generateKeyBetween(maxOrder, null)`（追加到顶层）。

## 3. DataEngineService（接口契约）

```ts
interface IDataEngineService {
  initialize(config: { docId: string; wsUrl?: string; userName?: string }): Promise<void>;

  add(data: IWidgetData): IBaseModel; // 工厂建 Model → push 进 yWidgets
  removeByIds(ids: string[]): void; // 批量删除包一个事务 = 一次撤销
  genInitialOrder(): string; // zOrder 初值
  getModelById(id: string): IBaseModel | undefined;

  onModelCreated$: Subject<IBaseModel>; // 本地 + 远端新增统一出口
  onModelRemoved$: Subject<string[]>;
  onModelUpdated$: Subject<void>; // 文档任意 update（几何置脏用）
  docState$: BehaviorSubject<'idle' | 'loading' | 'synced'>;
  wsState$: BehaviorSubject<'off' | 'connecting' | 'synced' | 'disconnected'>;
  persistState$: BehaviorSubject<'saved' | 'saving' | 'failed'>;

  transact<T>(fn: () => T, origin?: unknown): T;
  readonly yWidgets: Y.Array<unknown>;
  readonly yDoc: Y.Doc;
}
```

恢复与远端要点：

- observe widgets 数组的 added items → 按 `type` 建 Model → `initializeY(yData)` →
  `onModelCreated$.next`。
- 删除检测用「现存 ids vs 本地 modelMapping keys」差集；不要读 `changes.deleted`
  里的 Y.Map（undo 会先剥离嵌套内容，`id` 读不到）。
- 未知类型/建模失败进入隔离区，跳过并计数，不阻塞文档其余部分打开。
- 远端数据不可信：缺 rect 补默认值（REPAIR_ORIGIN，不进 undo）；schema 形状过滤、
  长度上限、几何 clamp 在 `initializeY` 一次性完成。

## 4. DataProcessor（唯一写入口）

```ts
class DataProcessor {
  transact<T>(fn: () => T, origin?: unknown): T;
  create(data: Record<string, unknown>, yData: Y.Map): void;
  update(patch: Record<string, unknown>, yData: Y.Map): void; // 扁平字段
  updateRect(patch: Partial<IRect>, yRect: Y.Array): void; // 几何
}
```

纪律：

1. **写前 diff**：`Object.is` 相同则跳过 set，避免同值 op 与事件。
2. rect 更新走 YKeyValue 按 key 更新，同样写前比对。
3. `stopCapturing()` 在语义边界调用（拖拽结束、连续 Tab 建节点、一次粘贴），
   把连续事务切分为多个撤销步。
4. 维护写用 `REPAIR_ORIGIN` / `MIGRATE_ORIGIN` 等非 null origin，不进 undo 栈。

## 5. Model 层（薄封装）

```ts
abstract class BaseModel<D extends IWidgetData> {
  readonly yData: Y.Map; // 唯一数据源
  abstract readonly schema: z.ZodType<D>;
  abstract readonly capabilities: IWidgetCapabilities;

  initialize(data: D): Y.Map; // 本地新建
  initializeY(yData: Y.Map): void; // 远端已有：补 rect + 消毒
  update(data: Partial<D>): void; // 合并 → clamp → schema 校验 → processor.update
  toJSON(): D; // 实时投影（rect 摊平为 x/y/w/h）
}
```

约束上限：坐标 `WIDGET_POS_MAX`、尺寸 `WIDGET_SIZE_MAX` / `WIDGET_SIZE_MIN`、
文本 `TEXT_MAX_CHARS`、points `POINTS_MAX`。超限 clamp/截断，不阻塞文档打开。

## 6. DbProvider（IndexedDB 持久化）

每个 docId 一个库：`spinth-doc:<docId>`，两个 store：

- `updates`：增量日志；≥ 500 条触发 compaction（防抖 1s）。
- `allupdates`：带时间戳 `{ u, t }` 的审计日志；compaction 时以快照为锚点重写。

写入路径：

- 100ms 写聚合，单事务批量落盘；失败批退回队首，指数退避（上限 5s）。
- `persistState$`：saving（缓冲有未落盘 op）/ failed（写失败退避中）/ saved。
- compaction 在 Worker 中算快照；Worker 不可用或失败退同步路径。
- compaction 同一 IDB 事务内先 `getAll` 重读，合并其他标签页已落盘增量；审计日志
  以全量快照为锚点重写，可回放深度 = 最近一次 compaction 之后。
- origin 守卫：本实例恢复/迁移/replay 的 update 不重复落盘。
- `pagehide` / `visibilitychange(hidden)` / dispose 触发 best-effort flush。

**有意不做 doc 级 LRU**：单机版本地即唯一副本，整库删 = 删用户数据。

### 6.1 存储状态与持久化（StorageStatusService）

- `StorageStatusService`（platform/storage）组合注入端口 `IStorageManager`（测试替身与
  浏览器实现同源），输出单一 `storageStatus$` 流；浏览器实现 `createBrowserStorageManager()`
  在无 `navigator.storage` 时返回 null——降级为 unsupported，不影响画布保存。
- 启动 `initialize()`：refresh 一次；未持久化才申请一次 `persist()`（此前是
  fire-and-forget 丢弃返回值）；失败不抛、不阻塞初始化。
- `requestPersist()` 单飞；结果 `persistOutcome`（granted/denied/failed）随流到达，
  UI 提供用户手势重试，不自动反复申请。
- 配额压力阈值固定：warn ≥ 80%、critical ≥ 95%（storageMath 单源，随 pressure 输出）。
  `estimate()` 是站点总量估算（含图片资产），不是单个文档用量。
- 不轮询：只在启动、面板打开、窗口 focus/重新可见、persistState 转 failed 时 refresh；
  并发调用合并为一次查询。
- 语义边界：`persistState$` 是文档写 IndexedDB 的状态；`IStorageStatus` 是浏览器持久化
  授权 + 站点配额——UI 必须分行呈现，不得合成「已同步」。persisted 只降低被浏览器
  清理的风险，不是备份；备份 = 导出项目文件（docs/20）。

## 7. replay 时间机器

- localStorage 开关：`spinth.replay=1`；运行时跳过普通恢复，从 `allupdates`
  逐条 `applyUpdate`。
- 可选：`spinth.replay.speed`（每步毫秒）、`spinth.replay.until`（截止时间戳）、
  `spinth.replay.verbose`（`Y.logUpdate` 明细）。
- origin 为 `REPLAY_ORIGIN`：不进 undo 栈、不回写 db。
- 价值：本地复现协同/历史问题；可回放深度受 compaction 限制。

## 8. wsProvider（可选，未来协同）

- 只有显式传入 `wsUrl` 才动态 `import('y-websocket')`；单机启动不加载。
- 标准 `WebsocketProvider(wsUrl, 'spinth/<docId>', yDoc)`；断线重连由 y-websocket 内建。
- `wsState$` 只反映连接状态；本地落盘状态看 `persistState$`，两者不得混同。
- 远端 update 的 origin 是 provider 实例，不进本地 undo 栈，但照常落盘。

## 9. 资产引用

图片 `src` 支持 `data:`、`http(s):`、`spinth-asset:<sha256>`。新图片入库后
文档只存短引用；资产库、GC、失败回退见 docs/19。

## 10. 当前边界

- 跨标签页实时同步未实现，多标签策略待定。
- 项目级导出/导入已实现；格式与失败回滚见 docs/20。
