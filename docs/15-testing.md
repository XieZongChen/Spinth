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

- 单测：983 passed（core 894 + react 51 + app 38）。
- E2E：23 个 spec、211 例（分层：fast 202 / timing+bench 5 / visual 4；混跑不作门禁，
  各层跑法见 `.github/workflows/ci.yml`）。
- 视觉：4/4（macOS 系统 Chrome）。
- 可访问性专项：a11y.spec 6 例（对比度护栏：21 组令牌配对 × 浅/深 + 实际元素
  （激活工具钮/flyout 选中项/菜单 kbd/删除项）——从浏览器计算样式取色，不在测试里
  持有颜色字面量；错误态 ×2：IndexedDB 注入 → role=alert/标题聚焦/390 无横滚/两主题
  对比度。helper `a11yE2e.ts` 为 WCAG 对比度纯函数，遇 alpha 直接红）。
- 可访问性键盘/布局专项（specs/a11y-closeout）：a11yKeyboard.spec 9 例（菜单键盘
  协议遍历与触发/Esc 不清选区/Shift+F10/菜单期闸门/Tab 序单停靠/画布语义与播报/
  五组控件可访问名扫描（点名三组另断言显式 aria-label）/右键不开内联编辑器）
  - a11yLayout.spec 9 例（Z1 720×450 缩放代理 ×2、Z2 rem 200%、R1 320×640 重排 ×3、
    S1 安全区注入 ×3：竖屏 notch / 横屏顶栏 / 浮层不进 inset）。
- 移动端布局专项：mobile.spec 9 例（390×844 九面矩阵 M1–M9：壳层截断/工具坞 40×40
  内滚/二级菜单/缩放胶囊防重叠/项目菜单双高度/右键边缘翻转/操作栏与 Popover/
  脑图按钮钳制/空画布提示；helper `layoutE2e.ts`：boxWithin 容差 0.5px、minTarget
  24 下限、intersects、noDocHScroll；断言只用 `data-spinth-*` 标记，坐标从 canvas
  box / `__spinth` 探针推导）。
- 单机断网不变量：core `networkService`（默认离线不阻断/blockOnOffline 三态翻转/
  构造即离线/dispose 摘监听）+ smoke 断网 E2E（断言 `navigator.onLine===false` 前置
  → 创建/撤销/落盘照常 → OfflineBar 与只读 pill 均 0；断网中不 reload）。
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
- PWA 专项（specs/pwa.md）：pwa.spec 6 例（独立配置 `playwright.pwa.config.ts`——
  子路径生产构建 + preview 专用 webServer：首装即受控/断网冷启动编辑撤销恢复/断网
  另一文档/CSP 0 violation/真重建更新流程含横幅 a11y/多标签只刷新点击方）+
  smoke 1 例（dev 不注册）。跑法 = 主配置 + pwa 配置双命令（gate 与 `test:e2e`），
  nightly 三层只用主配置不付 preview 构建成本。生产探针为构建期开关（`SPINTH_E2E=1`）
  - `?e2e=1` 双门控的只读桥（`src/e2eProbe.ts`），Pages 产物零暴露。
- coverage：67.48 / 59.04 / 69.4 / 58.19（语句/分支/行/函数），阈值 66/58/68/57。
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

- coverage include 收窄到 TS/TSX；阈值 61/51/63/52（语句/分支/行/函数），低于基线即红。
- 资产 GC Web Locks 单写者已修复并有回归测试。
- 多标签单写者/只读/接管由 `multiTab.spec` E2E + tabSession 单测覆盖
  （[21-multi-tab](21-multi-tab.md)）；跨标签实时同步未实现（非目标）。
- 存储状态：StorageStatusService 10 单测 + storageMath 6 单测 + E2E 8 例
  （docs/02 §6.1；阈值/降级/申请语义有分支覆盖）。
- 项目导出/导入已有 68 单测 + 7 E2E 覆盖；规格见 [20-project-file](20-project-file.md)。
- 大测试文件（lineMath、mindService）可按域拆分，降低阅读成本。
- Linux 视觉基线缺失；CI visual 非阻塞。
