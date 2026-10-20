# 15 — 测试护栏

## 1. 分层

| 层           | 守卫对象                                                      | 位置                        | 运行            |
| ------------ | ------------------------------------------------------------- | --------------------------- | --------------- |
| 纯逻辑单测   | 数学与数据：吸附、断行、DataProcessor、渲染同步规则、网格数学 | `packages/*/src/__tests__/` | `pnpm test`     |
| 编排层桩测试 | 指针流 → 预览/吸附/落库/事务边界；stub 协作对象               | `__tests__/`                | `pnpm test`     |
| E2E          | 真实浏览器整机链路与验收清单                                  | `packages/app/e2e/`         | `pnpm test:e2e` |
| 视觉快照     | 像素级行为：主题双态、marks 粗细/颜色、旋转/形变              | `visual.spec.ts`            | 本地/nightly    |

三层互补：纯逻辑证明算法对，编排证明装配与同步对，E2E 证明整机能用。
提交前 `pnpm verify` 全绿；改交互编排补跑 `pnpm test:e2e`。

## 2. 当前基线

- 单测：**709 passed**（core 700 + react 9，84 文件）。
- E2E：15 个 spec、**140 例**；fast 层排除 @timing/@bench/@visual。
- 视觉：**4/4**（macOS 系统 Chrome）。
- 图片/资产专项：**6/6**。
- `pnpm verify`：lint + prettier + typecheck + 单测 + build，通过。
- coverage：Stmts **63.06%** / Branch **52.32%** / Funcs **54.49%** / Lines **64.93%**，
  阈值 61/51/52/63。

## 3. 各层怎么加

### 纯逻辑单测

新控件的布局数学、吸附计算、delta 转译、路由函数写成纯函数（docs/01 ADR-7），
直接 `describe/it`。范例：`adsorber.test.ts`、`dotGridMath.test.ts`。

### 编排层桩测试

模式：捕获指针 handlers + stub 协作对象，直接驱动 down/move/up，断言副作用
（commitDrag 参数、事务次数、预览一致性）。不渲染、无 PIXI 依赖即可跑 node。
范例：`selectorDrag.test.ts` 守卫「吸附修正随落库」「一次拖拽一个事务」「阻尼阈值」。

**判据**：修过一次的编排 bug 必须留下桩测试。

### E2E

- `playwright.config.ts` 复用系统 Chrome；vite 5199；每用例随机 docId。
- 本环境全局 HTTP_PROXY 会劫持 localhost——走 `pnpm test:e2e`（脚本注入 NO_PROXY），
  浏览器加 `--no-proxy-server`。
- 断言优先 `window.__spinth.__debug` 数据探针；坐标从探针世界坐标反推屏幕坐标
  （加画布偏移，顶栏 44px），禁手写屏幕数字。
- E2E 交互铁律：
  - 脑图选中态 Esc = 取消选中并清焦点；
  - 再点已选中脑图 = 进编辑，textarea 会吃掉后续指针事件；
  - 矩形/画笔创建工具创建即回 cursor，连续创建须重新点工具；
  - Playwright 对 `opacity:0` 也判 visible，幽灵断言用 `toHaveCSS`/transform；
  - `page.evaluate` 返回 SDK 实例会丢 getter，在页面内取值再返回；
  - 新护栏做区分验证：旧实现跑新用例应红；
  - 布局断言双向（宽度下界 + 高度上界）；
  - `mouse.click` 的 modifiers 不达 DOM 事件，shift 加选用 keyboard.down/up 包夹；
  - bench 负载敏感，偶红先看 `uptime`。

## 4. E2E 剧本清单

| 文件                | 覆盖                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `smoke.spec.ts`     | 创建→拖拽→undo→刷新恢复；初始化失败出口；只读态；空态/新建画布；单机启动无网络 |
| `bench.spec.ts`     | 1000 控件拖拽 rAF 双指标 + culling 翻转                                        |
| `clipboard.spec.ts` | 剪贴板链路 + 右键菜单                                                          |
| `mind.spec.ts`      | 脑图全链路/节点级选中/拖拽/快捷键                                              |
| `widgets.spec.ts`   | 线/画笔/橡皮/图形交互                                                          |
| `textEdit.spec.ts`  | 文字编辑与排版                                                                 |
| `image.spec.ts`     | 图片拖放/粘贴/资产迁移/objectURL 配平/GC                                       |
| `coverage.spec.ts`  | redo/图层/色板/缩放/快捷键面                                                   |
| `toolbar.spec.ts`   | 工具坞常驻二级菜单                                                             |
| `visual.spec.ts`    | 视觉快照 4 例                                                                  |
| `refline.spec.ts`   | 参考线吸附/等间距                                                              |
| `align.spec.ts`     | 对齐/分布/undo 裂项                                                            |
| `export.spec.ts`    | PNG 导出双入口                                                                 |
| `rotate.spec.ts`    | 旋转                                                                           |
| `group.spec.ts`     | 编组                                                                           |

## 5. 视觉快照

- 定位：数据探针的补充层，不是替代。探针能证数据，证不了像素。
- 适用：主题双态整帧、marks 粗细/颜色、旋转/形变。
- 禁用：动画/光标/时间敏感、外部资源依赖、高频 DOM 文本。
- 基线：`packages/app/e2e/visual.spec.ts-snapshots/`，按平台分文件；当前只有
  `-darwin.png`。容差 `maxDiffPixelRatio: 0.02`。
- 改视觉行为必须 `--update-snapshots` 重录并在提交信息说明；重录后核实文件真变了
  （mtime/字节数/git status）。复跑两轮零漂移才算稳定。
- CI：visual job 仅 nightly/手动，Linux 基线待补，当前 `continue-on-error`。

## 6. 已知缺口（下一阶段补）

- 资产 GC Web Locks 单写者：已修复 + 4 例回归（`assetGcLock.test.ts`）。
- `navigator.storage.persist/estimate`：存储状态专项为 0。
- 项目导出/导入：0（功能未实现，M1 补 round-trip）。
- 多标签：0（双页面只读/接管/GC 并发）。
- 默认启动无外部网络：无显式 E2E 断言。
- coverage include 已收窄到 TS/TSX，README 解析噪声已消除。
- 视觉 Linux 基线缺失；CI visual 非阻塞。
- 大测试文件（lineMath 1048 行、mindService 707 行）可按域拆分，降低阅读成本。

## 7. 验收

- [x] 纯逻辑/编排/E2E 三层均有当前能力覆盖。
- [x] 视觉快照 4/4；图片/资产 6/6。
- [x] `pnpm verify` 通过；coverage 过阈值。
- [ ] 上述缺口补齐后，首个里程碑验收全绿。
