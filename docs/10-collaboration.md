# 10 — 协同扩展边界（当前不启用）

> 当前版本是单机版：默认启动不连接网络、不启动 relay、不显示协同状态。
> 本文只定义未来协同的扩展边界，避免单机实现把路堵死。

## 1. 当前边界

- 启动主路径不传 `wsUrl`；`y-websocket` 只在显式配置时动态加载。
- 没有 `packages/server`；未来协同服务端必须独立成包，不能进入 core/react 的默认依赖。
- 本地文档是唯一副本：导出/导入、IndexedDB 持久化、资产库优先于协同。
- 协同只复用 Yjs 文档、origin 纪律、asset provider 边界，不把服务端逻辑带进单机主路径。

## 2. wsProvider 与状态语义

```ts
new WebsocketProvider(wsUrl, 'spinth/<docId>', yDoc);
```

- 只有 `config.wsUrl` 存在时才动态 `import('y-websocket')`；加载失败降级为单机可编辑。
- 连接状态：
  - `off`：本地模式（默认）；
  - `connecting`：连接中/首同步未完成；
  - `synced`：已同步；
  - `disconnected`：断连，可继续编辑。
- `docState$` 只表示本地数据是否可渲染（loading/synced）；`wsState$` 单独表示连接态；
  `persistState$` 单独表示本地落盘态。三者不得混同。
- 远端 update 的 origin 是 provider 实例：不进本地 undo 栈，但照常落盘。
- 断线重连交给 y-websocket 内建机制 + 指数退避；单机路径不加载该栈。

## 3. Awareness

- 仅协同模式创建 `AwarenessService`（依赖 `wsProvider.awareness`）；本地模式零开销。
- 状态：userId、userName、userColor、cursorPos、selectedWidgetIds、mindNodeId。
- 光标上报经 `curPos$` 80ms 节流；选中变化即时上报。
- 渲染：`AwarenessVm + PeerRenderer` 挂 `optionLayer`；用户色板中性 10 色。
- 单机版本不显示成员光标/在线列表。

## 4. NetworkService 与离线守卫

- `NetworkService` 监听浏览器在线状态；`editBlocked$` 仅表示物理断网（阻断编辑）。
- ws 断连只提示，不阻断编辑。
- 守卫矩阵：
  - 断网：工具/删除/undo 被拦；视图类缩放键、适应屏幕、Esc 可用；
  - 只读：写工具、删除、undo/redo 被拦；选择/复制/视图可用；
  - 右键菜单打开：剪贴板写操作被拦。
- 单机模式无远端写入，断网仍可编辑、撤销、刷新恢复。

## 5. Undo / Redo 保护

- `Y.UndoManager` 只跟踪用户 origin（null）；恢复、迁移、repair、replay 写都是非 null origin。
- 第二层：污染截断兜底——检测到不可撤销的远端污染时清空/截断 undo 栈，避免撤销穿越他人操作。
- undo 恢复通知：`restoredWidgets$` 供 UI/探针消费。
- 协同时远端删除不进入本地 undo；本地 undo 只回退本地用户操作。

## 6. Replay 时间机器

- localStorage 开关 `spinth.replay=1`；跳过普通恢复，从 `allupdates` 逐条
  `applyUpdate`。
- 可选：`spinth.replay.speed`（每步毫秒）、`spinth.replay.until`（截止时间戳）、
  `spinth.replay.verbose`（`Y.logUpdate` 明细）。
- origin 为 `REPLAY_ORIGIN`：不进 undo 栈、不回写 db。
- 数据源受 compaction 限制：可回放深度 = 最近一次 compaction 之后。
- 存储结构见 §7；实现细节见 docs/02 §7。

## 7. IndexedDB 双 store

- 每 doc 一个库：`spinth-doc:<docId>`。
- `updates`：增量日志；≥ 500 条触发 compaction。
- `allupdates`：审计日志 { u, t }；compaction 以全量快照为锚点重写。
- 跨标签 compaction 在同一 IDB 事务内先 getAll 重读，合并其他标签已落盘增量。
- origin 守卫防止恢复/replay 回流；写聚合 100ms，失败指数退避。
- 单机版本地即唯一副本，不做 doc 级 LRU 整库删除。

## 8. 资产边界

- 单机资产是 `spinth-asset:<sha256>` 本地引用。
- 跨设备协同需要额外资产传输层（例如服务端 blob 端点）；在该层落地前，
  不能把本地资产引用当作跨设备可读 URL。
- 未来协同时，资产 provider 作为可选依赖注入，不能成为单机硬依赖。
