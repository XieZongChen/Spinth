# 开源发布清仓（批次 A）

## 1. 范围

阶段 2 的第一批：把仓库从「内部可用」整理到「可对外」。本批只动发布面
（许可证、对外文档、社区文件、页面元信息、版本号），不改产品行为。

后续批次：B 仓库转 public + CI 实证，C GitHub Pages 上线，D v1.0.0 tag，
E npm 包可发布化。

## 2. 已定决策

| 决策         | 结论       | 影响                                                           |
| ------------ | ---------- | -------------------------------------------------------------- |
| 许可证       | MIT        | 根 `LICENSE` + 四个 `package.json` 的 `license` 字段           |
| 对外文档语言 | 双语       | `README.md`（英文主文档）+ `README.zh-CN.md`；社区文件英文单份 |
| 提交元数据   | 保留原样   | 不重写历史；作者信息维持现状                                   |
| 自定义域名   | 暂不使用   | canonical / OG 固定为 Pages 地址                               |
| npm 发布     | 1.0 之后做 | 见 §6 待办                                                     |

## 3. 交付物

### 3.1 许可证

- `LICENSE`：MIT 全文。
- `package.json`（root / core / react / app）增加 `"license": "MIT"`。

### 3.2 第三方声明

- `scripts/lib/dependency-licenses.mjs`：依赖闭包收集器。
  - `collectRuntimeClosure()`：从三个 workspace 包的 `dependencies` 出发做 BFS，
    解析一律走 `realpath`——pnpm 的 `node_modules` 是符号链接，用相对路径上溯会
    丢掉 store 位置并静默漏扫传递依赖（本批踩过：修复前只扫到 29 个包）。
  - `collectInstalledPackages()`：扫 `node_modules/.pnpm`，供白名单门禁区分
    「随产物分发」与「仅本地构建」。
- `scripts/gen-third-party-notices.mjs` + `THIRD_PARTY_NOTICES.md`：
  86 个运行时包、7 种许可。`--check` 与依赖树逐字比对，进 verify 防漂移。
- 版权行只取带年份的署名行：MIT/OFL 正文里 "COPYRIGHT HOLDERS BE LIABLE"、
  "Copyright Holder." 这类条款句同样以 copyright 开头，不过滤会污染清单。

### 3.3 许可门禁

`scripts/check-licenses.mjs`：

- 运行时闭包必须落在白名单内（13 项 SPDX），无例外；
- 全量安装面允许构建期出现 `MPL-2.0`（当前只有 lightningcss），一旦进入运行时闭包
  立即报红；
- 许可表达式按 `OR` / `AND` / `WITH` 拆原子判断，任一原子不在白名单即失败。

接入 `pnpm verify`：`typecheck` 之后依次跑 `pnpm license:check` 与
`gen-third-party-notices --check`。

### 3.4 对外文档

- `README.md`：定位、Demo、功能、快速开始、架构、浏览器支持、隐私、部署、贡献、许可。
- `README.zh-CN.md`：同结构中文版，顶部互链。
- 原 README 的「仓库结构 / 设计原则 / 文档索引」内部段落移除；文档索引仍在
  `docs/README.md`，架构不变量压缩成三条留在 README。

### 3.5 社区文件

`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`（Contributor Covenant 2.1）、`SECURITY.md`、
`CHANGELOG.md`、`.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`、
`.github/pull_request_template.md`。

举报通道走 GitHub 私有安全公告与私信，不写邮箱——`pnpm hygiene` 对邮箱是全库拦截，
把联系方式换成平台渠道比给单个文件开豁免更干净。

### 3.6 页面元信息

`packages/app/index.html`：description、canonical、robots、og:_、twitter:_；
新增 `packages/app/public/og-image.png`（1200×630，Playwright + 系统 Chrome 渲染，
复用品牌色与 Nunito 字体）。

绝对地址写死在 HTML 里（静态页无法读构建期变量）；换域名时同步改 canonical 与
og/twitter 共 6 处。

### 3.7 版本

四个 `package.json` → `1.0.0`；`CHANGELOG.md` 记录 1.0.0 内容；
`docs/13` 的当前版本与 §2.1 勾选同步。

## 4. 验收

- `pnpm verify`：hygiene、lint、format、typecheck、licenses、notices --check、
  视觉基线护栏、单测、build 全绿。
- `SPINTH_BASE=/Spinth/ pnpm build` + `node scripts/check-pages-build.mjs`
  通过（8 chunks，预缓存预算内）。
- `git log -p --all` 全历史扫描：本机绝对路径 0 命中、密钥 0 命中、本机拒绝词 0 命中。

## 5. 外部来源复审

清仓时对全库与全历史做了一次「是否描述了其他项目」的复审：

- 12 个本地拒绝词（保存在本机 `.hygiene.local.json`，名称不入库）在历史与工作树中
  均为 0 命中；
- `lucide`（图标库依赖）、`canvas`、`mindNode` 等命中是子串误报；
- 代码注释里的「参考」只指向本文档体系（如 `penModel` 一次性迁移、
  等间距参考线概念），没有指向外部项目的设计来源；
- 无第三方版权头、无外链仓库地址（唯一外部域名为 SVG 命名空间与测试占位域）。

## 6. 批次 B/C 实证（2026-11-01）

### 6.1 仓库公开与 CI

- 9 个清仓提交推送后，仓库转 public；`main` 分支保护：required status checks =
  `gate`（strict），禁强推与删除。
- 转 public 后首轮 CI 全红，定位到 `pwa.spec.ts` P5：390px 下更新横幅「刷新」按钮
  宽 42 < 44（Linux 与 macOS 的 CJK 字体度量差异）。修复：两个按钮补
  `max-[419px]:min-w-11` + `justify-center`（提交 `1f57c82`）。
- 一次 `workflow_dispatch` 四 job 全绿：gate / timing（含 1 次重试后转绿）/
  multitab-stress / visual（Linux 基线 4/4 全等）。
- 第二次 dispatch（`visual_update=true`）走 update 分支并产出基线 artifact；
  timing 层在四 job 并发下 1 次 `@bench` 采样帧数不足（29 < 60），属 flake 记录层。

### 6.2 Pages

- `POST /pages` 以 `build_type=workflow` 启用，`pages.yml` 部署成功。
- 线上 smoke（真实 Chrome）：首屏 5.4s、`canvas` 挂载、SW 已接管、控制台与页面
  0 错误、CSP violation 0；`index.html` / `manifest.webmanifest` / `sw.js` /
  `og-image.png` / `icons/*` 全部 200，资源路径带 `/Spinth/` 前缀。
- 仓库 homepage、description、topics、README badges 已同步。

## 7. 待办

- README 截图/GIF：素材未产出，等 Pages 上线后从生产站点截取再补。
- npm 发布（批次 E）：包构建产物（当前 `main`/types 指向 `src/`）、注册
  `@spinth` scope、`yjs`/`pixi.js` 是否转 peer 依赖。

## 8. 线上验收记录（2026-11-01）

> v1.0 收尾批次（任务 B）。首屏/资源 200/SW 接管/断网刷新/CSP 零 violation/
> 390px 无横滚已在 §6.2 落账，本节不复验。真机项见 §8.5 挂账，不阻塞 1.0.0。

### 8.1 PWA 安装前置（自动验证）

- `manifest.webmanifest` 200：`name`/`short_name` 齐全、`display: standalone`、
  `start_url: "."`（相对 manifest 解析为站点根）。
- 图标三项全 200：192×192（any，约 10KB）、512×512（any，约 53KB）、
  512×512（maskable，约 52KB）——满足安装前提（≥192 与 ≥512 any + maskable）。
- SW：scope `https://xiezongchen.github.io/Spinth/`，activated 且控制页面；
  注册参数 `updateViaCache: 'none'`（`packages/app/src/pwa/serviceWorker.ts`）。
- Lighthouse 12 已移除 PWA 分类与 installability 审计
  （`--only-audits=installable-manifest` 不存在），安装形态以人工为准。

### 8.2 更新横幅（真实部署验证）

部署载体 `46811d8`：Pages 构建此前不注入 `SPINTH_BUILD_TAG`，线上
`data-spinth-build` 恒为空，且仅测试/文档类提交不改变产物字节——SW 无版本
差，更新链路不可观测。该提交给 pages 构建注入短 sha 构建标记后，每次部署
产生真实 SW 版本更替，版本标记成为可观测证据。

| 步骤                                                 | 结果                                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧 tab 持旧 SW（`data-spinth-build=""`），新部署上线 | 线上 JS 产物确认含新标记                                                                                                                                         |
| 触发更新检测 `registration.update()`                 | updatefound → waiting → 横幅「新版本可用」出现（role=status）                                                                                                    |
| 点「稍后」                                           | 横幅消失；sessionStorage `spinth.pwa.update-dismissed=1`；再触发 update 不回弹；waiting 保留                                                                     |
| 新开 tab（新会话，dismissed 清除）                   | 横幅加载即现（返回访客：waiting 直接提示路径）                                                                                                                   |
| 点「刷新」                                           | 单次整页刷新（navigation type=reload、单文档、会话标记跨刷新存续）；新 SW activated；旧 shell 缓存清除（仅剩新版本）；`data-spinth-build` = 部署短 sha；横幅消失 |
| 他页（已 dismissed 的旧 tab）                        | 不自动刷新（specs/pwa D11），横幅被 dismissed 抑制                                                                                                               |

触发方式说明：自动化浏览器的 tab 切换不派发真实 visibilitychange，更新检测
由 `registration.update()` 直接发起——与应用 `checkForUpdate` 内部调用的
同一 API；横幅出现证明 updatefound → waiting → available 接线完整。
「稍后」为 sessionStorage 语义：本会话（含刷新）不再提示、新会话再次提示。

### 8.3 390px 真机（待人工）

设备与系统版本待补。清单：首屏顶栏 6 控件不裁切/工具坞在视口内/无横滚；
触摸拖拽建件松手落库、撤销可回退；双指缩放以手指中心为锚点不漂移；软键盘
不遮编辑框、失焦落库；工具坞二级菜单 portal 定位不越界可点；刘海与底部
指示条不压工具坞。

### 8.4 Lighthouse

| 端                          | Performance | Accessibility | Best Practices | SEO |
| --------------------------- | ----------- | ------------- | -------------- | --- |
| desktop（阈值 90/95/95/90） | 98          | 100           | 100            | 100 |
| mobile（只记录）            | 85          | 100           | 100            | 100 |

- desktop 关键指标：LCP 1.0s / TBT 80ms / FCP 0.5s / CLS 0.001 / SI 1.0s。
- mobile 拖分归因（不阻塞，优化单独立项）：pixi 画布引擎整包加载的 unused JS
  约 385KB、CDN 长缓存策略提示约 570KB、LCP 2.9s / TBT 190ms——画布重型
  应用的已知特性。

### 8.5 人工挂账汇总

- B1 桌面安装点击：地址栏安装图标 → standalone 窗口（无地址栏）→ 断网打开
  仍可进入空画布。
- B1 iOS Safari / Android Chrome 添加到主屏幕（与 specs/pwa §14 合并跟踪）。
- B3 390px 真机六项（§8.3，与 specs/pwa §14 移动端部分合并跟踪）。
