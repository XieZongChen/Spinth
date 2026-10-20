# 16 — 性能专项

## 0. 优先级与现状

```
P0  空间索引 + 视口 culling
P1  pen points 增量写
P1  Model.update 局部校验
P2  observe → toJSON 增量投影
P2  测量缓存池
P3  快照纹理 LOD（已落地）
P3  TextVm.render 全量重建（平移复用已落地）
```

验收基准：1000 控件 + 视口外滚动，拖拽帧间隔相对增量 < 8ms；启动维护链走
`requestIdleCallback`，不阻塞首屏。

## 1. 空间索引 + 视口 culling

- `SpatialIndex`：世界坐标固定格宽 512，`Map<cellKey, Set<widgetId>>`；
  vmEngine add/remove/geometry-change 增量维护。
- 消费点：`getVmByPoint`、`getVmByRect`、RefLine 参照物收集。
- culling：`vpBounds$` 变化 → 索引查可视格集合 → diff 翻转 widget
  `renderable`（不动 `visible`，保留事件语义）。
- 256px margin 防抖；MIND_MAP 豁免（树增长会使索引过期，整图一个渲染单元）。
- 单测：格分配/跨界多格/增删一致性/culling diff。

## 2. pen points 增量写

- `PenSchema.points` 存 `Y.Array<[number, number]>`；采样时
  `yPoints.push([x, y])` 增量，update 帧只含新点。
- 落笔 `stopCapturing()` 切分 undo 粒度。
- 旧数据普通数组 → 首读一次性转 Y.Array。
- 单测：增量 push 的 update 帧只含新点；undo 一步回退整笔。

## 3. Model.update 局部校验

- `BaseModel.update(patch)`：zod `schema.pick(Object.keys(patch))` 只校验变更字段；
  全量 parse 只保留给 add。
- 单测：非法字段仍被拒；合法字段更新后 toJSON 正确。

## 4. observe → toJSON 增量投影

- `BaseWidgetVm.onModelUpdate` 消费 `Y.YEvent[]`：path/keys 受影响字段集 →
  `setState(pick(toJSON(), fields))`，绕过全量 toJSON。
- rect YArray 变化映射到 `RECT_KEYS`；深嵌套（MIND_NODE 树）先保持全量。
- 桩测试：单字段变更时 partial 只含该字段。

## 5. 测量缓存池

- `TextMeasure` LRU（键 `font|size|text`，上限 2000）；measureDoc 断行试探与
  TextVm 渲染共用。
- jsdom 桩测：同键命中。

## 6. 当前性能债台账

已落地：

- 100ms 写聚合 + 失败指数退避；compaction 前置冲刷。
- 审计日志以快照为锚点重写，窗口 = 最近一次 compaction 之后。
- 文本拖动出屏重评、平移复用、编辑期节能早退。
- 快照纹理 LOD、测量缓存、空间索引、culling。

有意保留：

- culling 后场景树仍 O(N) 遍历（renderable=false 只省提交）；上万控件才需 PIXI cull 区。
- MIND_MAP 豁免 culling。
- 选中框/参考线/落点预览每 move 重建 Graphics（圆角矩形级 tessellation，便宜且正确）。
- 事件小对象分配抖动（现代 GC 无感）。
- `getFocused/findNode` O(树)（数百节点大树才显现，届时可挂 id 索引）。
- `worldToClient` 每次调 `getBoundingClientRect`（调用点已节流 34ms）。

仍需关注：

- GC 全库扫描是线性成本（文档数多时）。
- 同图多实例各自解码/上传纹理，未做纹理共享。
- `lineService` / `app.ts` / `dbProvider` 等文件超过 400 行，阅读与维护成本高。
- 纹理共享、图片重试、GC 分片：下一阶段。

## 7. 基准与验收

- `bench.spec.ts`：程序化创建 1000 控件（shape/text/pen），断言拖拽 rAF
  绝对 p95 < 25ms 且相对增量 < 8ms；3 屏外滚动 culling 翻转计数。
- headless 软渲染空转 p95 ≈ 18ms 是环境噪声；机器高负载（load > 8）会边缘超限
  26–28ms，偶红先看 `uptime` 再怀疑代码。
- 启动维护链 `requestIdleCallback`，超时兜底 3s。

## 8. 性能审查机制

- 任何优化必须保留正确性测试和可回退路径。
- 先保证正确性和可观测性，再做缓存。
- 性能数字必须可复跑（bench/探针），不接受“体感变快”。
- 修改数据/渲染热路径时同步更新本篇与 docs/03 §10、docs/07 §9。
