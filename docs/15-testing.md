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

- 单测：1222 passed（core 1106 + react 78 + app 38）。
- E2E：50 个 spec（主配置 49 + pwa 1）、262 例（260 通过 + 2 跳过——旋转手柄用例
  暂跳，specs/rotate-hide；分层：fast = 主配置 245（243 通过 + 2 跳过）+ pwa 7
  另跑，CI gate 合计 252 / timing+bench 5 /
  visual 5（245 + 7 + 5 + 5 = 262 对账）；混跑不作门禁，各层跑法见
  `.github/workflows/ci.yml`）。
- 视觉：5/5（darwin 系统 Chrome / linux 容器 Chromium，双平台基线 6 张齐全；
  flowchart-sample 为流程图收口样本，specs/flowchart-closeout）。
- 可访问性专项：a11y.spec 6 例（对比度护栏：21 组令牌配对 × 浅/深 + 实际元素
  （激活工具钮/flyout 选中项/菜单 kbd/删除项）——从浏览器计算样式取色，不在测试里
  持有颜色字面量；错误态 ×2：IndexedDB 注入 → role=alert/标题聚焦/390 无横滚/两主题
  对比度。helper `a11yE2e.ts` 为 WCAG 对比度纯函数，遇 alpha 直接红）。
- 可访问性键盘/布局专项（specs/a11y-closeout）：a11yKeyboard.spec 12 例（菜单键盘
  协议遍历与触发/Esc 不清选区/Shift+F10/菜单期闸门/宿主浮层闸门 ×3（项目菜单与存储
  面板开着静默、关闭后不残留）/Tab 序单停靠/画布语义与播报/五组控件可访问名扫描
  （点名三组另断言显式 aria-label）/右键不开内联编辑器）；a11yLayout.spec 10 例
  （Z1 720×450 缩放代理 ×2、Z2 rem 200%、R1 320×640 重排 ×3、S1 安全区注入 ×4：
  竖屏 notch / 横屏顶栏 / 浮层不进 inset / 注入后 resize 重算）。
- 文本缩放专项（specs/rem-typography）：textScale.spec 6 例（1440×900，根字号 16→32px）——
  T1/T2 迁移文本的计算字号与行高、右键菜单宽逐值精确（1x 与迁移前一致、200% 全部 ×2）；
  T3 右键菜单实测尺寸翻转夹取、行不重叠、行高 68、矮视口过高内滚；T4 项目菜单与存储
  面板与悬停提示；T5 Shift+F10 不滚屏、Esc 归还焦点；T6 元素菜单（6 项）实测 432×468、
  行高 68 与行不重叠。横幅主配置不可达，字号断言在 pwa P5。
- 移动端布局专项：mobile.spec 9 例（390×844 九面矩阵 M1–M9：壳层截断/工具坞 40×40
  内滚/二级菜单/缩放胶囊防重叠/项目菜单双高度/右键边缘翻转/操作栏与 Popover/
  脑图按钮钳制/空画布提示；helper `layoutE2e.ts`：boxWithin 容差 0.5px、minTarget
  24 下限、intersects、noDocHScroll；断言只用 `data-spinth-*` 标记，坐标从 canvas
  box / `__spinth`·`__spinthDebug` 探针推导）。
- 运行时公共面/调试面：debugSurface.spec 3 例（`__spinth` = 65 成员冻结投影、
  内部字段不可见不可写、方法绑定与身份稳定、`__spinthDebug.__debug` 快照与逃生口）
  与 pwa P7（无 `?e2e=1` 时两全局零探针且画布可编辑；specs/runtime-narrowing §6.2）。
- 单机断网不变量：core `networkService`（默认离线不阻断/blockOnOffline 三态翻转/
  构造即离线/dispose 摘监听）+ smoke 断网 E2E（断言 `navigator.onLine===false` 前置
  → 创建/撤销/落盘照常 → OfflineBar 与只读 pill 均 0；断网中不 reload）。
- 图片/资产专项：12/12（imageCreate——创建入口；imageAsset——资产引用、存量迁移、
  objectURL 配平（保活持租约 → 到期归零 → undo 复开）、GC 清孤儿；imageLifecycle——
  纹理共享 refs 递减、窗口内 undo 复用同 uid、pagehide 清空闲/留在租、切 src 计数配平、
  http 自动重试（route 前两次 abort）、missing 双击手动重试）。
- 图片加载链单测：`imageRetry`（重试分类）/ `imageLoadController`（token 会话、
  迟到成功/失败只动自己的租约、重试计时器纪律）/ `imageKeepAlive`（假计时器：
  窗口到期/wake 重计时/双上限 LRU/单条超预算/windowMs=0/dropAll+forget 幂等）/
  `imageTextureCache`（同 assetId 一份纹理、并发 in-flight 去重、失败分阶段
  retryable、保活三态（空闲/复用/到期销毁）、pagehide 清空闲、dispose 兜底）；
  GC 单测含空库短路、mark 中断零删除、sweep 预算部分完成、协作让出节奏。
- 多标签专项：multiTabRole 5 例 + multiTabReadonly 6 例（双标签角色/接管/只读不写盘/
  不同文档并行/无锁降级；只读视图操作/390px/手动刷新/只读不跑维护链/只读标签双击
  missing 图可重试不写盘/只读右键降级——不建选区无操作栏画布菜单；同 context 双 page
  共享 Web Locks）。
- 只读态收口单测：core `contextMenuReadonly`（右键只读：不建选区/onWidget 恒 false/
  canPaste 恒 false）+ `updateEditable`（降级调用序含翻闸门相对位/手势收口恰好一次/
  切回可写无记忆/setCursorMode 只读钳制与无 viewport 语义）+ `rectEditor`（取消手势：
  撤 window 监听、预览按起点回落零写、迟到抬手不落库、跟随层通知与标脏）；react
  `readonlyGate`（工具坞三键禁用、ActionBar/MindAddButtons 不渲染、schema disabled
  三类控件契约）；E2E smoke 1.22 扩为运行时降级收口（徽标/三键/选区清除/降级后工具
  复位 + 只读态宿主直调写工具被钳回 cursor）。
- 存储状态专项：storage.spec 8 例（持久化授权/申请/配额压力/unsupported/390px/
  备份入口/保存失败入口/外部重开清旧错误；navigator.storage 经 addInitScript 桩注入）。
- PWA 专项（specs/pwa.md）：pwa.spec 7 例（独立配置 `playwright.pwa.config.ts`——
  子路径生产构建 + preview 专用 webServer：首装即受控/断网冷启动编辑撤销恢复/断网
  另一文档/CSP 0 violation/真重建更新流程含横幅 a11y 与字号 1x·200%/多标签只刷新
  点击方/正常流量零探针）+ smoke 1 例（dev 不注册）。跑法 = 主配置 + pwa 配置双命令
  （gate 与 `test:e2e`），nightly 三层只用主配置不付 preview 构建成本。生产探针为构建期
  开关（`SPINTH_E2E=1`）与 `?e2e=1` 双门控的只读桥（`src/e2eProbe.ts`），Pages 产物零暴露。
- coverage：69.04 / 61.49 / 71.03 / 59.64（语句/分支/行/函数），阈值 66/58/68/57。
- CI gate 另跑 Pages 子路径构建（SPINTH_BASE）与产物路径校验
  （`scripts/check-pages-build.mjs`）。
- 多标签接管另有 nightly 压力任务：`multiTabRole.spec -g 接管 --repeat-each=20 --workers=2 --retries=0`
  （不重试；失败即红并上传现场，见 `.github/workflows/ci.yml`）。

## 3. 断言纪律

- 数据探针优先：断言 `window.__spinthDebug.__debug`（DEV 调试入口）或公开查询，不靠截图代替数据。
- E2E 坐标从探针世界坐标反推屏幕坐标（加画布偏移与顶栏 44px），禁手写屏幕数字。
- 修过一次的编排 bug 必须留下桩测试；新护栏做区分验证（旧实现跑新用例应红）。
- 单测不依赖真实网络、真实计时器、真实浏览器下载；E2E 不依赖未跟踪 actuals。
- 布局断言双向：宽度下界 + 高度上界。
- 文本缩放断言读 `getComputedStyle` 的字号与行高、几何用 boundingBox，不靠截图（视觉
  基线只截画布，证不了铬件）；注入根字号只证明 rem 链路，浏览器「默认字号」设置路径
  （同时改变媒体查询的 rem 解析）另走人工验收。
- 浮层/幽灵类断言注意 Playwright 对 `opacity:0` 也判 visible，使用 `toHaveCSS` 或 transform 探针。

## 4. 视觉快照

- 定位：数据探针的补充层，不是替代。探针能证数据，证不了像素。
- 适用：主题双态整帧、marks 粗细/颜色、旋转/形变。
- 禁用：动画/光标/时间敏感、外部资源依赖、高频 DOM 文本。
- 基线：`packages/app/e2e/visual.spec.ts-snapshots/`，按平台分文件（`-darwin.png`
  与 `-linux.png` 各 5 张）。容差 `maxDiffPixelRatio: 0.02`；不得用未跟踪截图
  代替基线。
- darwin：系统 Chrome（`channel: chrome`）本地直接跑；`@visual` 用例另带 DPR=1 /
  WebGL / 字体就绪三项环境断言（只影响失败信息，不改像素）。
- linux：容器固定环境生成与校验（specs/linux-visual）——`pnpm visual:linux`
  校验、`--update` 生成回写（内建新容器复验）、`--stability` 双跑 SHA-256
  全等；提交基线前先跑 `--stability`（specs §10.3 仪式，脚本不强制）。
  宿主要求 docker + rsync；镜像 tag 含环境指纹（字体版本/Dockerfile/fonts.conf
  任一变动自动重建）。
  镜像 = 官方 playwright noble 派生（fonts-noto-cjk 版本必传 + fontconfig
  prefer Noto Sans CJK SC + 构建期 fc 断言）；视觉 flags 只在
  `E2E_VISUAL_CHANNEL=bundled` 时注入，不影响 darwin 路径。
- 护栏：`scripts/check-visual-baselines.mjs`（stem × 双平台存在/非空/PNG 头 +
  目录白名单）接入 `pnpm verify` 与 CI gate；CI visual job 为真门禁（容器校验，
  失败即红，diff 现场上传 artifact）。
- 版本纪律：`@playwright/test` 精确 pin，且与 `docker/visual.Dockerfile` base
  tag 原子同改（执行器构建前断言，不符 exit 2）。

## 5. 覆盖率与已知缺口

- coverage include 收窄到 TS/TSX；阈值 66/58/68/57（语句/分支/行/函数），低于基线即红。
- 资产 GC Web Locks 单写者已修复并有回归测试。
- 多标签单写者/只读/接管由 `multiTabRole`/`multiTabReadonly` E2E + tabSession 单测覆盖
  （[21-multi-tab](21-multi-tab.md)）；跨标签实时同步未实现（非目标）。
- 存储状态：StorageStatusService 10 单测 + storageMath 6 单测 + E2E 8 例
  （docs/02 §6.1；阈值/降级/申请语义有分支覆盖）。
- 项目导出/导入已有 68 单测 + 7 E2E 覆盖；规格见 [20-project-file](20-project-file.md)。
- 测试文件不套用 400 行上限：按文件/功能域拆分（单测按 describe 域，E2E 一个
  spec 一个用户流程域）；当前 E2E 单文件最大 lineQuickAdd 460 行，是流程域自然结果，
  不作为行数门禁。
