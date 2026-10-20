# 08 — 性能

## 1. 已落地

- 按需渲染：`renderId` 变化才 `app.render()`。
- 空间索引：命中/框选走格查询，视口外控件 culling。
- 写聚合：100ms 批量 IndexedDB 写入，失败指数退避。
- compaction：Worker 计算全量快照，主线程只做事务校验。
- 本地资产：文档只存 sha256 引用，避免 base64 膨胀。
- UI：ActionBar schema 缓存、zOrder max 缓存、工具栏二级菜单 portal 定位。
- 大图：长边 480px 缩小，图片纹理按需创建/销毁。

## 2. 指标

- 主 JS 目标 < 500KB（vendor 分层：pixi/tiptap/react/yjs）。
- 1000 控件拖拽帧间隔 P95 相对空转增量 < 8ms。
- 启动维护链走 `requestIdleCallback`，不阻塞首屏。

## 3. 已知债

- GC 启动全库扫描，文档数多时仍是线性成本。
- 同图多实例各自解码/上传纹理，未做纹理共享。
- `addWidget` 每次全量排序；大画布可改批量插入。
- pen 点数组读取和 line 邻接反查仍有 O(n) 路径。
- 项目级导出/导入未实现，大数据归档依赖浏览器存储。

## 4. 原则

先保证正确性和可观测性，再做缓存；任何优化必须保留正确性测试和可回退路径。
