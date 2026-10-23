# 15 — 测试策略

## 1. 分层

| 层           | 守卫对象                                                      | 位置                        |
| ------------ | ------------------------------------------------------------- | --------------------------- |
| 纯逻辑单测   | 数学与数据：吸附、断行、DataProcessor、渲染同步规则、网格数学 | `packages/*/src/__tests__/` |
| 编排层桩测试 | 指针流 → 预览/吸附/落库/事务边界；stub 协作对象               | `__tests__/`                |
| E2E          | 真实浏览器整机链路                                            | `packages/app/e2e/`         |
| 视觉快照     | 像素级行为：主题双态、marks 粗细/颜色、旋转/形变              | `visual.spec.ts`            |

三层互补：纯逻辑证明算法对，编排证明装配与同步对，E2E 证明整机能用。

## 2. 当前基线

- 单测：881 passed（core 865 + react 16，102 文件）。
- E2E：18 个 spec、170 例（分层：fast 161 / timing+bench 5 / visual 4；混跑不作门禁，
  各层跑法见 `.github/workflows/ci.yml`）。
- 视觉：4/4（macOS 系统 Chrome）。
- 图片/资产专项：10/10（image.spec——创建入口、资产引用、存量迁移、objectURL
  配平、GC 清孤儿，以及生命周期专项：纹理共享 refs 递减、切 src 计数配平、
  http 自动重试（route 前两次 abort）、missing 双击手动重试）。
- 图片加载链单测：`imageRetry`（重试分类）/ `imageLoadController`（token 会话、
  迟到成功/失败只动自己的租约、重试计时器纪律）/ `imageTextureCache`（同
  assetId 一份纹理、并发 in-flight 去重、失败分阶段 retryable、dispose 兜底）；
  GC 单测含空库短路、mark 中断零删除、sweep 预算部分完成、协作让出节奏。
- 多标签专项：multiTab.spec 11 例（双标签角色/接管/只读不写盘/不同文档并行/无锁降级/
  只读视图操作/390px/手动刷新/只读不跑维护链/只读标签双击 missing 图可重试不写盘/
  只读右键降级——不建选区无操作栏画布菜单；同 context 双 page 共享 Web Locks）。
- 只读态收口单测：core `contextMenuReadonly`（右键只读：不建选区/onWidget 恒 false/
  canPaste 恒 false）+ `updateEditable`（降级调用序含翻闸门相对位/手势收口恰好一次/
  切回可写无记忆/setCursorMode 只读钳制与无 viewport 语义）+ `rectEditor`（取消手势：
  撤 window 监听、预览按起点回落零写、迟到抬手不落库、跟随层通知与标脏）；react
  `readonlyGate`（工具坞三键禁用、ActionBar/MindAddButtons 不渲染、schema disabled
  三类控件契约）；E2E smoke 1.22 扩为运行时降级收口（徽标/三键/选区清除/降级后工具
  复位 + 只读态宿主直调写工具被钳回 cursor）。
- 存储状态专项：storage.spec 8 例（持久化授权/申请/配额压力/unsupported/390px/
  备份入口/保存失败入口/外部重开清旧错误；navigator.storage 经 addInitScript 桩注入）。
- coverage：65.79 / 55.37 / 56.68 / 67.81，阈值 61/51/52/63。
- CI gate 另跑 Pages 子路径构建（SPINTH_BASE）与产物路径校验
  （`scripts/check-pages-build.mjs`）。
- 多标签接管另有 nightly 压力任务：`multiTab.spec -g 接管 --repeat-each=20 --workers=2 --retries=0`
  （不重试；失败即红并上传现场，见 `.github/workflows/ci.yml`）。

## 3. 断言纪律

- 数据探针优先：断言 `window.__spinth.__debug` 或 SDK 状态，不靠截图代替数据。
- E2E 坐标从探针世界坐标反推屏幕坐标（加画布偏移与顶栏 44px），禁手写屏幕数字。
- 修过一次的编排 bug 必须留下桩测试；新护栏做区分验证（旧实现跑新用例应红）。
- 单测不依赖真实网络、真实计时器、真实浏览器下载；E2E 不依赖未跟踪 actuals。
- 布局断言双向：宽度下界 + 高度上界。
- 浮层/幽灵类断言注意 Playwright 对 `opacity:0` 也判 visible，使用 `toHaveCSS` 或 transform 探针。

## 4. 视觉快照

- 定位：数据探针的补充层，不是替代。探针能证数据，证不了像素。
- 适用：主题双态整帧、marks 粗细/颜色、旋转/形变。
- 禁用：动画/光标/时间敏感、外部资源依赖、高频 DOM 文本。
- 基线：`packages/app/e2e/visual.spec.ts-snapshots/`，按平台分文件；当前只有
  `-darwin.png`。容差 `maxDiffPixelRatio: 0.02`。
- 视觉基线按平台分文件；容差 0.02；不得用未跟踪截图代替基线。
- CI visual job 仅 nightly/手动；Linux 基线待补，当前 `continue-on-error`。

## 5. 覆盖率与已知缺口

- coverage include 收窄到 TS/TSX；阈值 61/51/52/63，低于基线即红。
- 资产 GC Web Locks 单写者已修复并有回归测试。
- 多标签单写者/只读/接管由 `multiTab.spec` E2E + tabSession 单测覆盖
  （[21-multi-tab](21-multi-tab.md)）；跨标签实时同步未实现（非目标）。
- 存储状态：StorageStatusService 10 单测 + storageMath 6 单测 + E2E 8 例
  （docs/02 §6.1；阈值/降级/申请语义有分支覆盖）。
- 项目导出/导入已有 68 单测 + 7 E2E 覆盖；规格见 [20-project-file](20-project-file.md)。
- 大测试文件（lineMath、mindService）可按域拆分，降低阅读成本。
- Linux 视觉基线缺失；CI visual 非阻塞。
