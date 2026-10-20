# 13 — 路线图与决策台账

## 1. 当前基线

已完成单机基线：

- [x] Yjs 文档 + IndexedDB 双 store + undo/redo + compaction
- [x] PIXI 画布、视口、按需渲染、空间索引、culling
- [x] SHAPE / TEXT / STICKY / LINE / PEN / IMAGE / MIND_MAP
- [x] 多选、编组、对齐/分布、旋转、参考线吸附
- [x] 富文本编辑、排版 override、marks、橡皮分段擦除
- [x] 本地资产库、图片 GC、失败回退
- [x] 390px 移动端工具菜单
- [x] 709 单测、视觉 4/4、图片/资产专项 6/6、`pnpm verify` 通过

## 2. 下一阶段优先级

### P1 项目导出/导入

设计已评审通过（2026-10-21）：[20-project-file](20-project-file.md)。格式与导入语义以该文为准；实施按该文 §16 的 PR1→PR3 拆分。

- 导出：Yjs 文档快照 + 图片资产 blob + manifest。
- 导入：校验版本/哈希/限额，恢复文档与资产，新建画布，失败回退。
- 文件格式已定稿：`.spinth.zip` = manifest.json + document.yjs + assets/<sha256>（docs/20 §4）。
- 必须 round-trip 测试（含一张图片）；不能把 base64 写回 Yjs。

### P1 多标签策略

- [x] 修复资产 GC 的 Web Locks 单写者 bug：锁被占用时跳过（896ddca + `assetGcLock.test.ts`）。
- [ ] 明确策略：单写者 + 其他标签只读 + 原标签关闭后自动接管，或 BroadcastChannel 实时同步。
- 补双标签并发 GC/只读/接管测试。

### P1 存储可靠性

- `navigator.storage.persist()` 已在启动时调用；仍需暴露 persisted 状态，并让 `estimate()` 配额/用量可见。
- 配额不足/写入失败的用户提示；导出/导入作为备份/恢复入口。
- 存储面板不要挤压 390px 顶栏。

### P1 资产/图片生命周期

- 快速切换 src 时的在途加载竞态。
- 同图多实例纹理共享。
- 图片加载失败后的重试策略。
- GC 全库扫描的启动成本。

### P2 UI / 可访问性

- 390px 顶栏 docId/保存状态换行。
- 只读态 ActionBar/undo/delete 的“看起来可点”项。
- 错误页/危险色对比度。
- 移动端完整布局断言。

### P2 架构收口

- `app.ts` 继续拆分（当前 956 行）。
- `boardCommands.ts` 的 `ctx: any` 类型化。
- `BoardPublicApi` 从 blocklist 改 allowlist。
- 类型注册表 union/tokens/factories 多源收口。
- 先做不影响功能的收口，不为拆而拆。

### P2 CI / 视觉

- visual 基线目前只有 darwin；Linux 基线缺失，CI visual 非阻塞。
- 新项目不保留“靠未跟踪 actuals 假绿”的做法。

## 3. 首个里程碑验收

- [ ] `pnpm verify` 全绿
- [ ] 项目导出/导入 round-trip 通过（含图片资产）
- [x] Web Locks 单写者 bug 修复并有测试
- [ ] 多标签策略明确（双标签只读/接管/GC 并发）
- [ ] 存储持久化/配额状态可见
- [ ] 默认启动无外部网络请求
- [ ] 图片/空态/移动端 E2E 不回归
- [ ] docs 与实现同步，不出现其他项目名称或来源说明

## 4. 决策与挂账

- 空间索引 + culling 的 MIND_MAP 豁免：树增长不触发几何 diff，整图一个渲染单元；
  索引会过期，因此豁免 culling。
- LINE 选区交互：线不可整体拖动/缩放；拖线身 = 段滑移，端点 = 重锚定。
- 边缘自动滚屏：规格保留，未实现。
- 纹理共享、图片重试、GC 分片：挂账。
- 多标签实时同步：策略待拍板；首期建议单写者 + 只读跟随。
- 项目文件格式、导入语义、ZIP 依赖：已冻结（docs/20）——`fflate` + `.spinth.zip`、导入新建画布、外链保留 + warning、未知条目忽略 + warning。
