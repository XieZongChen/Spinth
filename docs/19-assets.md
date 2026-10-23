# 19 — 本地资产（图片）

## 1. 目标

图片不再把 base64 直接写进 Yjs。文档只保存短引用，图片内容放进独立 IndexedDB：

```
src = "spinth-asset:<sha256>"
```

同图多次粘贴只存一份；文档体积从 MB 级降到几十字节。跨设备协同需要额外的资产
传输层，当前不实现。

## 2. 存储

- 数据库：`spinth-assets`，对象仓库：`assets`。
- key：图片内容的 sha256。
- value：`{ buf: ArrayBuffer, mime, size, t }`。
- 写入时单次 `arrayBuffer()`，digest 与存行共用同一份数据。
- 内容寻址去重：已存在同 id 行时直接返回引用。

## 3. 读取

1. ImageVm 识别 `spinth-asset:`；
2. 经注入的 `AssetStore.objectURL` 取 blob URL；
3. 显式 `Image.decode()` 后用 `Texture.from` 建立纹理；
4. 释放时配对 revoke objectURL，纹理随 sprite 销毁。

不使用 PIXI Assets 的 URL 推断路径：无扩展名 blob URL 无法判定 parser。

- objectURL 引用计数；并发首载共用同一个 in-flight Promise，避免重复创建 URL。
- 释放归零时 revoke；持活引用 > 0 的资产 GC 不删（下轮再看）。
- 快速切换 src 时按当前 src 校验（解析与解码各一次），过期结果不落地、不覆盖新会话。

## 4. 失败回退

资产入库失败（配额满、隐私模式、IndexedDB 禁用、非安全上下文）时回退 data URL
创建图片，保证用户不会「贴了没反应」。`persistState` 继续反映本地文档写入状态；
配额/持久化状态见 [02-data-engine](02-data-engine.md) §6.1。

## 5. GC 与安全

- 启动 idle 后执行一次 mark-sweep：
  - 引用集 = 当前 doc 内存引用 ∪ 其他磁盘文档引用 ∪ 删前重采；
  - 资产库差集即孤儿；
  - undo 栈非空时整轮跳过；
  - 本会话新 put 的资产受启动时间基线保护；
- 维护链（迁移 + GC）只在写者标签运行：app 壳按标签角色传
  `assetMaintenance = 基线 && writable`，core 侧 `composeBoard` 调度与执行前再各断言
  一次（docs/21 §4）；Web Locks 锁保留为并发兜底。
- 多标签用 Web Locks 串行化；锁被占用时跳过本轮，Web Locks API 不可用时降级直跑
  （单标签场景无竞争）。
- 删除单行前检查 objectURL 引用计数；正在渲染的资产跳过。
- 全库扫描是线性成本；文档数多时仍是挂账。

## 6. 备份与项目导出

- 项目级导出必须同时打包 Yjs 快照与图片 blob，不能只导出文档而丢失图片。
- 导入时资产按内容寻址写回，文档仍只存 `spinth-asset:` 引用，不把 base64 写回 Yjs。
- 导出/导入格式与失败回滚见 [20-project-file](20-project-file.md)。
- 导出打包被引用资产原始字节（导出前重算哈希校验）；导入只写被引用资产、按内容寻址去重；外链/dataURL 图片保留在 Yjs 并给 warning。
