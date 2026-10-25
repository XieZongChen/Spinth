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

## 3. 读取与纹理共享

加载链分层：`ImageVm`（几何/占位/sprite）→ `ImageLoadController`（加载会话）
→ `ImageTextureCache`（纹理租约）→ 解码（`Image.decode`）+ 建纹（`Texture.from`）。

1. `ImageLoadController`：一次 src 变化 = 一个 token 化会话；会话完成时按
   token 校验一次，过期结果不落地、只释放自己拿到的租约（不触碰当前会话）。
2. `ImageTextureCache`：同 assetId 只解码/建纹一次，多实例各持一份纹理租约
   （引用计数），归零才 `texture.destroy(true)` 并归还 URL 租约——
   同图 N 实例 = 1 次解码、1 份 GPU 纹理、1 份 objectURL 计数。
3. data URL / http 不共享（data URL 超长不可作 Map key；http 内容可变），
   每次加载独立建纹、释放即销毁。
4. 切换 src 期间旧图保持显示（防闪烁）；新图提交或失败后才替换 sprite 与
   释放旧租约；失败时立即销毁旧图（不允许「新 src + 旧图」并存）。

不使用 PIXI Assets 的 URL 推断路径：无扩展名 blob URL 无法判定 parser。

- objectURL 引用计数；并发首载共用同一个 in-flight Promise，避免重复创建 URL。
- 释放归零时 revoke；持活引用 > 0 的资产 GC 不删（下轮再看）——缓存条目
  在存活期间持有 URL 租约，该闸门对共享纹理同样生效。
- sprite 销毁不销毁纹理（纹理归缓存租约所有）；缓存由组合根创建、随 SDK
  dispose 无条件清空。

## 4. 失败分类与重试

加载失败分两类，占位框四态区分（empty/loading 灰框单对角线；failed 红框
叉号；missing 琥珀框叉号——错误色是语义色不随主题）：

| 失败来源                        | kind    | 自动重试              |
| ------------------------------- | ------- | --------------------- |
| 资产行不存在 / 无解析器         | missing | 否（等手动）          |
| `decode()` 失败，src 是 http(s) | decode  | 是，600ms/1800ms 两次 |
| `decode()` 失败，data/blob/资产 | decode  | 否（内容本地确定）    |
| 建纹 / 存储层故障               | decode  | 否（重试易放大）      |

- 自动重试只排计时器不改 src；src 变化或 VM dispose 立即取消计时。
- 手动重试：cursor 模式下双击画布上的失败/缺失图（`ImageService` 监听
  window dblclick capture，只认 canvas target；loaded 态 no-op）。手动重试
  重置重试计数、不限次数；只读标签允许（纯本地渲染，不写文档）。
- 资产入库失败（配额满、隐私模式、IndexedDB 禁用、非安全上下文）时回退
  data URL 创建图片，保证用户不会「贴了没反应」。`persistState` 继续反映
  本地文档写入状态；配额/持久化状态见 [02-data-engine](02-data-engine.md) §6.1。
- 离线时外链图片仍走同一占位 + 重试语义：Service Worker 只接管同源静态资源，
  跨源请求一律直通不缓存（specs/pwa.md D8）。

## 5. GC 与安全

- 启动 idle 后执行一次 mark-sweep：
  - 引用集 = 当前 doc 内存引用 ∪ 其他磁盘文档引用 ∪ 删前重采；
  - 资产库差集即孤儿；
  - undo 栈非空时整轮跳过；
  - 本会话新 put 的资产受启动时间基线保护；
- 启动成本控制：
  - 空资产库短路：不发现/不扫描任何文档，直接返回；
  - mark 每篇文档后协作让出主线程（`scheduler.yield`，缺失时 setTimeout(0)）；
  - sweep 批量删除：单批（64 行）一次读事务 + 一次写事务，替代逐行两事务；
  - 单轮软预算 1500ms（只影响清理完整度不影响正确性，下轮继续）；
  - 页面销毁/切页（`shouldContinue=false`）随时中断。
- 中断语义：**mark 阶段被打断 = 零删除**（部分引用集绝不能用于删除）；
  sweep 阶段可部分完成（已删块保留），`lastAssetMaintenance.partial`
  暴露 `none / budget / cancelled`，另有 `docs / assets / ms` 统计字段。
- 维护链（迁移 + GC）只在写者标签运行：app 壳按标签角色传
  `assetMaintenance = 基线 && writable`，core 侧 `composeBoard` 调度与执行前再各断言
  一次（docs/21 §4）；Web Locks 锁保留为并发兜底。
- 多标签用 Web Locks 串行化（锁覆盖整轮含协作让出）；锁被占用时跳过本轮，
  Web Locks API 不可用时降级直跑（单标签场景无竞争）。
- 删除批内检查 objectURL 引用计数；正在渲染的资产跳过。
- 存量迁移链与 GC 同源：每 8 张迁移协作让出一次，同样接受 shouldContinue 中断
  （迁移幂等，中断安全）。

## 6. 备份与项目导出

- 项目级导出必须同时打包 Yjs 快照与图片 blob，不能只导出文档而丢失图片。
- 导入时资产按内容寻址写回，文档仍只存 `spinth-asset:` 引用，不把 base64 写回 Yjs。
- 导出/导入格式与失败回滚见 [20-project-file](20-project-file.md)。
- 导出打包被引用资产原始字节（导出前重算哈希校验）；导入只写被引用资产、按内容寻址去重；外链/dataURL 图片保留在 Yjs 并给 warning。
