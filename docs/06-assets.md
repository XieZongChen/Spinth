# 06 — 本地资产

## 1. 目标

图片不再把 base64 直接写进 Yjs。文档只保存短引用，图片内容放进独立 IndexedDB：

```
src = "spinth-asset:<sha256>"
```

## 2. 存储

- 数据库：`spinth-assets`，对象仓库：`assets`。
- key：图片内容的 sha256。
- value：`{ buf: ArrayBuffer, mime, size, t }`。
- 同图多次粘贴只存一份；文档体积从 MB 级降到几十字节。

## 3. 读取

1. ImageVm 识别 `spinth-asset:`；
2. 经注入的 AssetStore.objectURL 取 blob URL；
3. 显式 `Image.decode()` 后用 `Texture.from` 建立纹理；
4. 释放时配对 revoke objectURL，纹理随 sprite 销毁。

不使用 PIXI Assets 的 URL 推断路径：无扩展名 blob URL 无法判定 parser。

## 4. 失败回退

资产入库失败（配额满、隐私模式、IndexedDB 禁用、非安全上下文）时回退 data URL
创建图片，保证用户不会“贴了没反应”。`persistState` 继续反映本地文档写入状态。

## 5. GC 与安全

- 启动 idle 后执行一次 mark-sweep。
- 引用集 = 当前 doc 内存引用 ∪ 其他磁盘文档引用 ∪ 删前重采。
- undo 栈非空时整轮跳过；本会话新 put 的资产受启动时间基线保护。
- 多标签用 Web Locks 串行化；锁不可用时降级为单标签假设。

## 6. 备份

项目级导出/导入尚未实现。引入时需同时打包 Yjs 快照与资产 blob，避免只导出
文档而丢失图片。
