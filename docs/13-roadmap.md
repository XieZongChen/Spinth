# 13 — 路线图与决策台账

## 1. 当前基线

已完成单机基线：

- [x] Yjs 文档 + IndexedDB 双 store + undo/redo + compaction
- [x] PIXI 画布、视口、按需渲染、空间索引、culling
- [x] SHAPE / TEXT / STICKY / LINE / PEN / IMAGE / MIND_MAP
- [x] 多选、编组、对齐/分布、旋转、参考线吸附
- [x] 富文本编辑、排版 override、marks、橡皮分段擦除
- [x] 本地资产库、图片 GC、失败回退、资产/图片生命周期（加载会话/纹理共享/重试/GC 分片）
- [x] 390px 移动端工具菜单
- [x] 只读态收口：右键不建选区、工具坞/操作栏/脑图按钮呈现门禁、运行时降级序列
      （docs/21 §4 只读可交互面矩阵）
- [x] 909 单测（core 883 + react 26）、E2E 20 spec / 186 用例、视觉 4/4、图片/资产专项 10/10、`pnpm verify` 通过

## 2. 下一阶段优先级

当前下一阶段：可访问性/平台挂账收口与 Linux 视觉基线；协同为后置能力（docs/10）。

### P1 项目导出/导入

- [x] 导出：Yjs 文档快照 + 被引用图片资产 + manifest（`.spinth.zip`，fflate 异步 chunk）。
- [x] 导入：校验版本/哈希/限额 → 写资产 → `createDocFromSnapshot` 新建画布；全失败路径零写入。
- [x] round-trip 测试（含图片资产、Yjs 无 base64）：68 单测 + 7 E2E（含外链 warning 到达用户）。
- 后续可选：拖放 `.spinth.zip` 到画布导入（docs/20 §1.2 非目标）。
- 规格：[20-project-file](20-project-file.md)。

### P1 多标签策略

- [x] 资产 GC 的 Web Locks 单写者：锁被占用时跳过本轮。
- [x] 单写者 + 只读跟随（Web Locks 按文档排他锁）：先到者 leader，其余标签只读
      （视图操作保留、写入/导入禁用、不落盘、不跑维护链），写者离开后 follower 自动接管
      （整页刷新）；无 Web Locks 降级 solo。规格：[21-multi-tab](21-multi-tab.md)。
- [x] 双标签只读/接管/维护链测试（`multiTab.spec` E2E，含「只读标签不跑维护链」
      断言；GC 锁并发由 `withAssetGcLock` 单测覆盖）。

### P1 存储可靠性

- [x] 启动 refresh 一次 `persisted()/estimate()`；未持久化时申请一次 `persist()`，失败不抛（`StorageStatusService`，docs/02 §6.1）。
- [x] 顶栏保存状态即存储入口：持久化授权 / 用量配额压力（warn ≥ 80%、critical ≥ 95%）可见；写失败可重试。
- [x] 备份/恢复入口复用项目菜单（docs/20 §9），不复制导出/导入流程。
- [x] 390px：面板视口 clamp、顶栏 44px 不换行（docId 截断），E2E 覆盖。

### P1 资产/图片生命周期

- [x] 快速切换 src 的在途加载竞态：token 化加载会话 + 纹理租约，
      迟到结果只释放自己的租约（`ImageLoadController`，docs/19 §3）。
- [x] 同图多实例纹理共享：按 assetId 引用计数，N 实例一份纹理一份 URL 计数
      （`ImageTextureCache`，docs/19 §3）。
- [x] 图片加载失败重试：http(s) 解码失败自动重试两次 + 双击画布手动重试、
      占位四态区分（docs/19 §4）。
- [x] GC 全库扫描启动成本：空库短路、批量删除（单批两事务）、每篇协作让出、
      单轮软预算 1500ms 可中断（docs/19 §5）。

### P2 UI / 可访问性

- [x] 错误页/危险色对比度：语义色按角色拆分（danger-ink 文字 / accent-fill 填充，
      WCAG 2.2 AA），对比度 E2E 护栏从计算样式取色（specs/a11y-mobile A1/A2）。
- [x] 移动端完整布局断言：390×844 九面矩阵（`mobile.spec.ts` M1–M9），工具坞
      防压缩、脑图按钮钳制、面板纵向兜底同批修复（specs/a11y-mobile A3）。
- [x] 物理断网（editBlocked）单机不可达不变量：core 单测 + 断网 E2E
      （specs/a11y-mobile A4）；单机不传 `wsUrl` → `editBlocked` 恒 false。

### P2 架构收口

- [x] `app.ts` 收敛为门面（< 400）：查询/销毁/调试/项目门面/配置外移为
      board* 系列文件，17 条流 getter + 31 条命令纯委托上移 `BoardFacade` 基类。
- [x] `boardCommands.ts` 宿主契约类型化（`IBoardCommandHost`，core 源码零 `any`）；
      对齐/分布/微移、PNG 导出、样式写入分块（alignCommands/exportCommand/styleCommands）。
- [x] `BoardPublicApi` 为 Pick allowlist：`BOARD_PUBLIC_MEMBERS`（64 成员）+
      编译期分类锁（未归类/重叠/幽灵键三条，boardPublicApi.ts）；桥/命令模块
      经 `BoardPublicApi` 收窄消费。
- [x] 类型注册表单源：`WIDGET_RUNTIME`（token + 工厂单源，widgetRuntime.ts），
      `WidgetDataUnion` 从 `WIDGET_REGISTRY` 派生 + 派生等价锁。
- 运行时收窄（不导出 internal 字段）需破坏性版本化——挂账。

### P2 CI / 视觉

- visual 基线目前只有 darwin；Linux 基线缺失，CI visual 非阻塞。
- 新项目不保留“靠未跟踪 actuals 假绿”的做法。

## 3. 决策与挂账

- 空间索引 + culling 的 MIND_MAP 豁免：树增长不触发几何 diff，整图一个渲染单元；
  索引会过期，因此豁免 culling。
- LINE 选区交互：线不可整体拖动/缩放；拖线身 = 段滑移，端点 = 重锚定。
- 边缘自动滚屏：规格保留，未实现。
- 纹理按 assetId 共享（引用归零销毁；data/http 不缓存）、GC 单轮软预算 + mark 中断零删除（docs/19）。
- 纹理保活缓存（VM 删除后保留 N 秒省一次重解码）：未做，undo 恢复接受重解码。
- 多标签：单写者 + 只读跟随，接管 = 整页刷新，不做实时同步（docs/21）。
- 只读态收口分层：core 修语义（右键不建选区、降级序列、工具钳制），react 修呈现（持久铬件禁用、浮动件随附着对象隐藏）；命令层守卫是安全网不是呈现面（docs/21 §4）。
- 项目文件格式、导入语义、ZIP 依赖：`fflate` + `.spinth.zip`、导入新建画布、外链保留 + warning、未知条目忽略 + warning（docs/20）。
- 颜色按角色拆分而非深浅拆分：`danger` 留给图形（≥3:1）、文字走 `danger-ink`
  （≥4.5:1）；`accent` 留给品牌/焦点环、填充按钮走 `accent-fill`+`on-accent`；
  不做「危险填充白字」（soft 底 + ink 字替代）。护栏在 `a11y.spec.ts`（CSSOM 取色）。
- 单机断网不做 editBlocked 矩阵：无 `wsUrl` 即无阻断路径，用「断言 OfflineBar
  不出现 + 断网仍可编辑/撤销/落盘」固化不变量（docs/10 §4）；`wsUrl` 进入启动
  路径时该测试先红，提醒补矩阵。
- 可访问性挂账：右键菜单键盘协议（roving focus）、工具主题色对 soft 底对比度
  八组、200% 文本缩放与安全区（`viewport-fit=cover` + `env(safe-area-inset-*)`）、
  屏读全量巡检（画布替代文本、表单标签、焦点顺序、保存状态播报）。
- 平台挂账：Service Worker / PWA 离线首开与刷新（Pages 子路径 scope + 缓存
  版本 + CSP）。
- 协同挂账：editBlocked 交互面矩阵（等 `wsUrl` 进入启动路径，与只读独立，
  docs/21 §4）。
