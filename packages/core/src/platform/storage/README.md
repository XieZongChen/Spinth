# storage — 存储状态（docs/02 §6.1）

浏览器持久化授权（`navigator.storage.persisted/persist`）与站点配额估算
（`estimate`）的可见化。`StorageStatusService` 组合注入端口 `IStorageManager`
（测试替身与浏览器实现同源），输出单一 `status$` 流；`storageMath` 是
阈值/压力/格式化的唯一实现源。不轮询——只在启动、面板打开、窗口可见、
写失败时刷新。

语义边界：`persistState$`（DbProvider）是文档写 IndexedDB 的落盘状态；
`IStorageStatus` 是浏览器持久化授权 + 站点配额，两者不可合成一个状态。
