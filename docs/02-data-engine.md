# 02 — 数据引擎

## 1. 文档模型

- 单 `Y.Doc`，`guid = docId`。
- 顶层 `Y.Array('widgets')` 保存控件 `Y.Map`。
- 几何字段放在独立的 rect `Y.Array`，避免和业务字段互相触发。
- 控件 schema 由 zod 定义，`IWidgetData` 从 schema 派生。

## 2. 本地持久化

- 每个 docId 一个 `spinth-doc:<docId>` IndexedDB。
- `updates` 存增量，`allupdates` 存审计记录。
- 写缓冲按 100ms 聚合；失败指数退避重试，状态经 `persistState$` 暴露。
- 达到阈值后 compaction：先冲刷写缓冲，再写全量快照，最后清增量。
- compaction 在 Worker 中计算；失败自动退同步路径。
- `pagehide` / `visibilitychange(hidden)` / dispose 触发 best-effort flush。

## 3. Undo

- `Y.UndoManager` 只跟踪用户 origin（null）。
- 恢复、迁移、维护写使用非 null origin，不进撤销栈。
- 拖拽/编辑按语义切分撤销项。

## 4. 本地资产

图片 `src` 支持三种形态：`data:`、`http(s):`、`spinth-asset:<sha256>`。
资产层细节见 [06-assets.md](06-assets.md)。

## 5. 未来协同

数据层不依赖服务端；协同若加入，应作为可选 provider 注入，复用同一 Yjs 文档
和 origin 纪律。当前版本不启动网络连接。
