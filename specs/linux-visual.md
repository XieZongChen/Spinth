# Linux 视觉基线：技术方案与架构设计

> 状态：**已实施（本地全链验证，2026-10）**——实施档案与偏差见 §14.5，两轮
> 返工见 §14.6–§14.7；CI 实证挂账（Actions 因私有仓库计费不可用，恢复后
> 普通 + update 两次 dispatch 补验，见 §14.7）。
> 审查记录见 §14。
> 范围：为现有 4 个 `@visual` 用例生成并校验 Linux 基线，把 CI visual 层从「试运行挂账」升为真门禁；不改产品渲染、交互与数据流。
> 关联：[docs/13](../docs/13-roadmap.md) §2–§3、[docs/15](../docs/15-testing.md) §4、[docs/01](../docs/01-conventions.md)、[specs/pwa](pwa.md) 的 CI/构建门禁先例。
> 基线：`main @ cfed9f2`（撰写时）；实施后以代码与实测为准。
> 本文件是过程文档；`docs/` 只吸收当前事实。

## 0. 结论摘要

| 维度     | 结论                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| 运行环境 | 官方 `mcr.microsoft.com/playwright:v1.64.1-noble`，派生一层装 **Noto Sans CJK SC**；固定 amd64 |
| 版本     | `@playwright/test` 精确 `1.64.1`；镜像内 Node 24；pnpm 11.28.5                                 |
| 运行方式 | 容器内 `E2E_VISUAL_CHANNEL=bundled`，`--workers=1 --retries=0`                                 |
| 基线     | 新增 5 张 `-linux.png`；`-darwin.png` 不动                                                     |
| 生成路径 | 本地容器优先；CI `workflow_dispatch` 生成作为完整备选                                          |
| 门禁     | 撤 `continue-on-error`；nightly/手动真红；PR 门禁列为 Phase 2                                  |
| 护栏     | 版本断言、CJK/WebGL 前置、基线齐全、未跟踪文件、双跑哈希                                       |
| 不做     | 跨平台像素一致、换渲染器、改视觉场景、云视觉服务                                               |

## 1. 目标与完成定义

一句话：**同一套固定环境，能在任意一台 x86_64 开发机或 CI 上重建、校验并更新 Linux 视觉基线，且缺基线或环境漂移时红灯而不是假绿。**

完成定义（缺一不可）：

1. **基线齐全**：5 张 `-linux.png` 已提交，与 `visual.spec.ts` 中的 5 个 `toHaveScreenshot` 名称一一对应。
2. **CI 真红**：visual job 去掉 `continue-on-error` 后仍绿；删除任意一张 Linux 基线会让它红。
3. **可复现**：同一镜像、同一提交连续两次独立生成，截图逐字节一致（或像素严格一致，见 §10）。
4. **不伤 macOS**：既有 `-darwin.png` 全部保留且 macOS 4/4 仍绿；本次不改写 darwin 基线。
5. **画面对**：容器内中文不是豆腐块；首次生成必须人工打开 3 张含中文的快照确认。
6. **环境对**：容器内 WebGL 可用、CJK 字体可枚举、Node/Playwright 版本符合契约。
7. **护栏对**：缺少任一平台基线、出现未提交 actual、版本不匹配时，门禁明确报错。
8. **流程对**：本地更新、CI 更新、版本升级三条流程都有文档化入口。

## 2. 非目标

- 不追求 darwin 与 linux 像素一致；基线继续按平台分文件。
- 不新增视觉场景，不改 `visual.spec.ts` 的断言内容与截图区域；只允许加环境前置检查。
- 不改产品渲染、字体栈、PIXI 配置、DOM/UI；不改 Yjs 数据流。
- 不引入云视觉服务，不把截图上传到仓库以外的第三方。
- 不做每次 PR 都跑 visual；PR 门禁是 Phase 2 的独立决策。
- 不解决 2% 容差本身的灵敏度问题；不追求逐 token 差异检测。
- 不支持 Windows 基线；当前只维护 darwin 与 linux。
- 不把 arm64 容器作为基线权威；amd64 是唯一权威架构（见 §5.1）。

## 3. 现状与证据

### 3.1 现有视觉用例

| 用例           | 快照                                 | 含中文 | 截图对象     |
| -------------- | ------------------------------------ | ------ | ------------ |
| delay 扁高守界 | `delay-tall.png`                     | 否     | canvas 局部  |
| 主题双态       | `theme-light.png` / `theme-dark.png` | 是     | canvas 整帧  |
| marks 渲染     | `marks-render.png`                   | 是     | 文字控件区域 |
| 矩形旋转 45°   | `rotate-45.png`                      | 否     | 页面局部     |

4 个用例、5 张快照；基线目录 [visual.spec.ts-snapshots](../packages/app/e2e/visual.spec.ts-snapshots)。当前只有 `-darwin.png`。

### 3.2 运行链路

- 配置：[playwright.config.ts](../playwright.config.ts) 的 `snapshotPathTemplate` 为 `{testDir}/visual.spec.ts-snapshots/{arg}-{platform}{ext}`，容差 `maxDiffPixelRatio: 0.02`。
- 浏览器：默认系统 Chrome（`channel: 'chrome'`）；`E2E_VISUAL_CHANNEL=bundled` 时切 Playwright 自带 Chromium。
- CI：[ci.yml](../.github/workflows/ci.yml) 的 visual job 仅 nightly/手动，`continue-on-error: true`，运行 `--grep "@visual"`，默认 `workers=2 / retries=1`。
- 用例：[visual.spec.ts](../packages/app/e2e/visual.spec.ts) 的 `ready()` 只等 `docState$ === 'synced'`，不检查 WebGL、DPR 或字体。
- 文本：canvas 文字固定使用 `TEXT_FONT = 'sans-serif'`（[textVm.ts](../packages/core/src/widgets/text/textVm.ts#L17)），不依赖 UI 的 Nunito；中文走系统字体回退。UI 栈见 [index.css](../packages/app/src/index.css)。
- 本机架构：`uname -m` 为 x86_64；CI `ubuntu-latest` 也是 amd64。
- 撰写环境没有容器运行时；因此本方案必须把 CI 生成路径写成完整备选，而不是「本地 Docker 失败再说」。

### 3.3 缺口清单

| #   | 缺口                                       | 影响                                              |
| --- | ------------------------------------------ | ------------------------------------------------- |
| G1  | Linux 基线完全缺失                         | Linux 渲染回归不可见                              |
| G2  | visual job `continue-on-error`             | 缺基线或真回归都不阻断，等同没有门禁              |
| G3  | Playwright 版本是 `^1.63.0` 范围           | lockfile 解析到 1.64.1，但下一次 install 可能漂移 |
| G4  | 官方镜像不保证 CJK 字体                    | 3/5 快照含中文，可能把豆腐块固化成基线            |
| G5  | WebGL/软件渲染没有断言                     | 无 GPU 容器里可能截到空白画布而不自知             |
| G6  | 字体、镜像、Node 未锁定                    | 跨机器重建结果不可信                              |
| G7  | 缺平台、缺文件、未提交 actual 没有专门护栏 | 容易靠局部实际截图假绿                            |
| G8  | 没有基线更新/版本升级流程                  | 有意改视觉时只能手改，易混入无关像素              |

### 3.4 已核实的镜像事实

撰写时（2026-10-26）直接查询 MCR registry 得到：

- `v1.64.1-noble` 存在；index digest 为 `sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea`。
- amd64 manifest 为 `sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8`，config 为 `sha256:d8e19ba36e1441fcd3f8a6d3d84c1eeb713ed5f1f46476918b9c3c1c6e765ead`。
- 镜像配置包含 `ARG NODE_VERSION=24`、`LANG=C.UTF-8`、`LC_ALL=C.UTF-8`、`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`；默认用户为 root。
- apt 层只安装 Node/git 等基础包，不保证 CJK 字体；字体必须用 `fc-list :lang=zh` 在实施时实测，不能假设。

这四条是 §5 环境契约的事实基础，也是 §14 审查里「CJK 风险」的证据。

## 4. 架构总览

```
版本源 package.json (@playwright/test = 1.64.1)
        |
        v
docker/visual.Dockerfile
  base: mcr.microsoft.com/playwright:v1.64.1-noble (amd64)
  + fonts-noto-cjk（版本固定）
  + fontconfig: sans-serif -> Noto Sans CJK SC
        |
        v
scripts/visual-linux.mjs
  build / preflight / install / test / update / stability
        |
        +--> /work 源码副本（排除 node_modules/dist/.git）
        +--> pnpm install --frozen-lockfile
        +--> playwright test @visual (bundled, workers=1, retries=0)
        |
        v
packages/app/e2e/visual.spec.ts-snapshots/*-linux.png
```

五层职责：

1. **版本层**：`package.json` 是 Playwright 版本唯一来源；Dockerfile 的 `ARG` 由脚本传入，CI 只读同一份。
2. **环境层**：镜像固定浏览器、Node、字体、fontconfig；所有生成/校验都必须在这个镜像里做。
3. **执行层**：`scripts/visual-linux.mjs` 负责构建、隔离、预检、运行、回写；不把 Docker 细节散落到 YAML。
4. **基线层**：PNG 按平台命名；只由容器产出；更新流程显式。
5. **护栏层**：版本断言、CJK/WebGL 预检、基线齐全检查、未跟踪文件检查、双跑哈希。

四条铁律：

- **单一环境**：本地与 CI 用同一个 Dockerfile、同一个 tag、同一个 `--platform linux/amd64`。
- **单一版本源**：Playwright 精确版本只写在 `package.json`；Dockerfile 的 base tag 由脚本注入。
- **源只读**：容器不直接写宿主源码；只有 update 模式把 5 张 PNG 显式复制回基线目录。
- **darwin 通道不变**：视觉 flags 只在 `E2E_VISUAL_CHANNEL=bundled` 时生效，系统 Chrome 的 macOS 基线不受影响。

## 5. 环境契约

### 5.1 版本与平台

| 项         | 固定值                                       | 说明                                     |
| ---------- | -------------------------------------------- | ---------------------------------------- |
| Playwright | `1.64.1`（精确，不带 ^）                     | 浏览器构建与快照算法随版本变化           |
| 镜像 tag   | `mcr.microsoft.com/playwright:v1.64.1-noble` | 首次成功后建议改为 digest pin            |
| 架构       | `linux/amd64`                                | CI 与当前开发机一致；arm64 不作为权威    |
| Node       | 24（镜像内置）                               | 实施时 `node -v` 复核 major              |
| pnpm       | 11.28.5（`packageManager`）                  | corepack 激活                            |
| Ubuntu     | noble（24.04）                               | 与 `ubuntu-latest` 同代，减少 glibc 差异 |
| CJK 字体   | `fonts-noto-cjk` 固定版本                    | 构建时用 `apt-cache policy` 取值写死     |

版本升级是一个**原子动作**：改 `package.json`、改 Dockerfile base、重建镜像、重新生成 darwin 与 linux 基线、同一次提交。禁止只升其中一处。

### 5.2 派生镜像

```
ARG PLAYWRIGHT_VERSION=1.64.1
FROM mcr.microsoft.com/playwright:v$PLAYWRIGHT_VERSION-noble

ARG NOTO_CJK_VERSION

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends fonts-noto-cjk=$NOTO_CJK_VERSION && rm -rf /var/lib/apt/lists/*

COPY visual-fonts.conf /etc/fonts/conf.d/99-spinth-visual.conf

RUN fc-cache -f && fc-list :lang=zh | grep -q 'Noto Sans CJK SC' && fc-match sans-serif | grep -q 'Noto Sans CJK SC'
```

构建上下文是 `docker/`，不是仓库根：只把 `visual-fonts.conf` 拷进去，避免把工作区送进 daemon。镜像只在本地/CI 临时构建，不推送 registry；Dockerfile 是可复现的单一事实源。

### 5.3 CJK 与 fontconfig

官方镜像的通用 `sans-serif` 在缺失 CJK 时会落到 DejaVu，中文变豆腐块；而 canvas 文字固定是 `sans-serif`，3/5 快照会直接固化成错误画面。派生镜像安装 Noto Sans CJK，并用 fontconfig 显式 prefer **SC**，避免 JP/KR 字形随 locale 漂移：

```
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <alias binding="same">
    <family>sans-serif</family>
    <prefer>
      <family>Noto Sans CJK SC</family>
    </prefer>
  </alias>
</fontconfig>
```

不依赖 `LANG` 选地域字形；镜像保持 `C.UTF-8`，由 fontconfig 固定 SC。构建期 `fc-match` 断言失败即构建失败，不把问题留到截图阶段。

### 5.4 Chromium 固定参数

只在 `E2E_VISUAL_CHANNEL=bundled` 时追加，系统 Chrome 路径保持原样：

| 参数                          | 目的                                  |
| ----------------------------- | ------------------------------------- |
| `--force-color-profile=srgb`  | 颜色 profile 固定，避免宿主显示器差异 |
| `--disable-lcd-text`          | 关子像素抗锯齿，统一灰度 AA           |
| `--font-render-hinting=none`  | 关 hinting，减少字体栅格差异          |
| `--use-gl=angle`              | 走 ANGLE                              |
| `--use-angle=swiftshader`     | 强制软件光栅，避免有/无 GPU 机器差异  |
| `--enable-unsafe-swiftshader` | 新版 Chromium 允许软件 WebGL 兜底     |
| `--disable-dev-shm-usage`     | 容器 /dev/shm 过小时的崩溃防护        |

`--no-proxy-server` 保留既有配置。**不默认加 `--disable-gpu`**：它可能直接关掉 WebGL；若预检失败，再把它列为回退实验项，而不是第一选择。

### 5.5 预检与回退

容器内运行前必须过四关：

1. `node -v` 主版本 = 24。
2. `npx playwright --version` = 1.64.1，且 `node_modules/@playwright/test/package.json` 版本一致。
3. `fc-match sans-serif` 命中 `Noto Sans CJK SC`，`fc-list :lang=zh` 非空。
4. 浏览器 `canvas.getContext('webgl2') ?? canvas.getContext('webgl')` 非空（由 `visual.spec.ts` 的 `ready()` 在每次用例里断言，失败信息直接指向容器 flags）。

若第 4 关失败：先去掉 `--disable-gpu`（如果实验时加了），再试 `channel: 'chromium'` 的新 headless；两者都要重新双跑验证并记录，不允许直接提交空白画布基线。

## 6. 基线契约

### 6.1 命名与文件

`snapshotPathTemplate` 已经按平台分文件，Linux 产物固定为：

```
packages/app/e2e/visual.spec.ts-snapshots/
  delay-tall-linux.png
  theme-light-linux.png
  theme-dark-linux.png
  marks-render-linux.png
  rotate-45-linux.png
```

- 平台串由 Playwright 的 `{platform}` 决定，Linux 上是 `linux`，不手写、不改名。
- 不手工编辑 PNG、不做压缩/转换；只接受 Playwright 在容器内写出的文件。
- 不同平台的截图尺寸可以不同（例如 `marks-render` 的裁剪来自文字 bbox，CJK 字体度量不同），平台内自洽即可。
- 不允许把 `-actual.png`、临时目录截图或 macOS 截图改名后提交。

### 6.2 基线检查脚本

新增 `scripts/check-visual-baselines.mjs`，不依赖 Docker，可在 gate 与 `pnpm verify` 里跑：

1. 从 `visual.spec.ts` 提取所有 `toHaveScreenshot('name.png')` 的字面量，得到期望 stem 列表。
2. 对每个 stem 断言 `name-darwin.png` 与 `name-linux.png` 都存在、非空、PNG 头正确。
3. 拒绝未知平台文件、`-actual` 文件、空文件。
4. 缺任一平台即非零退出，错误信息列出缺失路径。

从测试源码提取而不是手写列表，避免新增视觉用例时双维护；若未来出现动态名称，脚本应显式报错而不是静默跳过。

### 6.3 更新规则

- 有意的产品视觉变化：**同一提交**更新 darwin 与 linux 基线；提交信息写明「视觉基线更新」。
- 仅 Linux 特有的变化（字体/容器/flags）：允许只更新 linux，但必须在提交信息与 specs 记录里写明原因。
- 版本升级：两平台都重新生成，不沿用旧图。
- 新增视觉场景：同时更新两平台并更新 `docs/15` 的用例计数；基线检查脚本会自动发现新名称。

## 7. 执行器设计：`scripts/visual-linux.mjs`

### 7.1 命令接口

| 命令                            | 行为                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `pnpm visual:linux`             | 构建镜像（如需要）+ 校验当前 Linux 基线                       |
| `pnpm visual:linux --update`    | 更新 5 张 Linux 基线；随后立即用新基线再校验一次              |
| `pnpm visual:linux --stability` | 两次独立 update（各自 fresh work 目录）比对 SHA-256，不写宿主 |
| `pnpm visual:linux --rebuild`   | 强制重建镜像                                                  |
| `pnpm visual:linux --debug`     | 保留 work 目录、打印完整预检信息                              |

### 7.2 运行流程

1. 读 `package.json` 的 Playwright 版本；读 Dockerfile 的 base tag；两者不一致立即退出。
2. 构建 `spinth-visual:<version>` 镜像（`--platform linux/amd64`，`--build-arg` 传入版本与固定字体版本）。
3. 准备 work 目录：复制源码，排除 `node_modules`、`dist`、`.git`、`test-results`、`playwright-report`、`.cache`。
4. 在容器内以宿主 uid/gid 运行；`HOME` 指到 work 内；挂载 pnpm store 缓存目录。
5. `corepack enable`（若无 corepack 则 `npm i -g pnpm@11.28.5`）后 `pnpm install --frozen-lockfile`（依赖不落到宿主 `node_modules`）。
6. 运行预检（§5.5）。
7. 运行 `npx playwright test --grep @visual --workers=1 --retries=0`，环境为 `CI=1`、`E2E_VISUAL_CHANNEL=bundled`。
8. update 模式：加 `--update-snapshots`；把 5 张 PNG 复制到宿主基线目录；再跑一次不带 update 的校验，失败则回滚复制并退出。
9. stability 模式：两次 fresh work 各自 update，比较 5 张 PNG 的 SHA-256；不一致则保留两份到 `.cache/visual-linux/stability` 并退出。
10. 打印摘要：Playwright/Node/font 版本、`fc-match`、`fc-list :lang=zh`、镜像 digest、每张图 SHA-256、耗时。

### 7.3 隔离与所有权

- 宿主源码只读；work 是副本。只有 update/stability 的显式输出回到基线目录。
- 宿主 `node_modules` 不参与容器运行；macOS 的 esbuild/rollup 二进制不会污染 Linux 安装。
- 容器以宿主 uid/gid 运行，输出文件归属正确；若 CI 以 root 运行，输出只进 artifact，不回到开发者工作区。
- work 与 store 放 `.cache/visual-linux/`（加入 .gitignore），可复用安装缓存；lockfile 变化时重新安装。
- 容器不 enable privileged、不挂 docker socket、不使用 host network。

### 7.4 退出码

| 码  | 含义                                                     |
| --- | -------------------------------------------------------- |
| 0   | 通过                                                     |
| 1   | 视觉比较失败（有 diff，看 test-results）                 |
| 2   | 环境/预检失败（版本、CJK、WebGL、镜像构建）              |
| 3   | 基线/护栏失败（缺平台、未跟踪 actual、stability 不一致） |

CI 只需看非零，日志里保留完整原因。

## 8. CI 接线

### 8.1 目标 job

替换现有 visual job 的实现，保留 nightly/手动触发与 20–30 分钟 timeout：

```
visual:
  if: schedule 或 workflow_dispatch
  runs-on: ubuntu-latest
  timeout-minutes: 30
  permissions:
    contents: read
  steps:
    - checkout
    - setup-node 24            # 只为跑编排脚本，不安装宿主依赖
    - 构建并校验：node scripts/visual-linux.mjs
    - 基线齐全检查：node scripts/check-visual-baselines.mjs
    - 失败时上传 test-results/ 与 playwright-report/
```

关键点：

- **不再跑 `npx playwright install`**：浏览器在镜像里，宿主安装会引入第二个版本。
- **不再用系统 Chrome**：`E2E_VISUAL_CHANNEL=bundled` 由脚本设置。
- **不再有 `continue-on-error`**：缺基线、版本不符、CJK/WebGL 预检失败都红。
- gate job 额外加一步 `node scripts/check-visual-baselines.mjs`（不需要 Docker），在 push/PR 阶段先拦住「删了一张基线」这类问题。

### 8.2 update 模式

```
workflow_dispatch 输入：
  visual_update: boolean = false
```

- 只有 `github.event_name == 'workflow_dispatch'` 且 `visual_update` 为真时才走 update；schedule 永远只校验。
- update job 权限仍为 `contents: read`，不自动提交、不 push。
- 产物 `visual-linux-baselines` 包含：5 张 PNG、`environment.txt`（提交 SHA、镜像 digest、Playwright/Node/字体版本、`fc-match`、`fc-list`）、`sha256sum.txt`。
- update 后必须在同一提交上再跑一次普通校验（脚本的 update 流程已内建），并由人工下载 artifact 提交；提交前复核 3 张含中文快照。
- 无 `gh` 凭据时可直接在 Actions 网页下载 artifact，流程不依赖本机登录态。

### 8.3 门禁层级与成本

| 层        | 触发           | 是否阻断 | 说明                                               |
| --------- | -------------- | -------- | -------------------------------------------------- |
| gate      | push/PR        | 是       | 只跑轻量基线齐全脚本；不跑 Docker                  |
| visual    | nightly/手动   | 是       | 本次升级目标；冷构建约 5–8 分钟，缓存命中 2–4 分钟 |
| PR visual | PR path filter | Phase 2  | 渲染相关路径才跑，避免每次 PR 付容器成本           |

Phase 1 接受「最迟 24 小时发现回归」的窗口；是否进 PR 需要单独拍板（§13 D6）。

## 9. 防假绿与负向验证

必须做的五个负向验证：

| #   | 操作                                          | 期望                                            |
| --- | --------------------------------------------- | ----------------------------------------------- |
| N1  | 删除 `theme-dark-linux.png`                   | visual job 红；基线检查红并指出缺失             |
| N2  | 用另一张截图替换 `delay-tall-linux.png`       | visual job 红；artifact 有 expected/actual/diff |
| N3  | 把 `package.json` 版本改成 1.64.0（镜像仍旧） | 脚本预检红，不进入截图比较                      |
| N4  | 在基线目录放一个 `foo-actual.png`             | 基线检查红                                      |
| N5  | 容器内不装 CJK 或去掉 fontconfig              | 构建或预检红；中文快照不得被提交                |

补充纪律：

- visual 层 `retries=0`、`workers=1`；出现 flake 先修环境或测试等待，不靠重试和放宽容差掩盖。
- 2% 容差保留，但负向用例必须制造明显差异，避免被容差吞掉。
- 首次生成的 3 张含中文快照必须人工打开看：字形、换行、粗细、下划线都正确；这一步无法可靠自动化，记录在实施档案里。
- 任何 `--update-snapshots` 只允许在 update 模式出现；普通校验出现新文件即视为失败。

## 10. 测试方案

### 10.1 用例与环境

- 视觉用例数量不变：4 个测试 / 5 张快照；不为预检新增测试标题，避免文档计数漂移。
- `ready()` 增加三项环境断言：`devicePixelRatio === 1`、WebGL 上下文非空、`document.fonts.ready` 已 resolve。它们只影响失败信息，不改变像素。
- 运行参数：`--workers=1 --retries=0`；容差保持 0.02。

### 10.2 验收矩阵

| 验收        | 命令/动作                                                | 期望                            |
| ----------- | -------------------------------------------------------- | ------------------------------- |
| macOS 回归  | 本地 `npx playwright test --grep @visual`（系统 Chrome） | 4/4，darwin 基线零变化          |
| Linux 校验  | `pnpm visual:linux`                                      | 4/4，5 张 linux 基线匹配        |
| 可复现      | `pnpm visual:linux --stability`                          | 两次生成 SHA-256 全等           |
| update 正确 | `pnpm visual:linux --update`                             | 5 张更新；随后自动校验通过      |
| 负向        | N1–N5                                                    | 各自按预期红                    |
| 全量        | `pnpm verify`                                            | 绿；基线检查通过                |
| CI          | 一次普通 dispatch + 一次 update dispatch                 | 前者绿；后者产出可审计 artifact |

### 10.3 可复现性的判定

首选逐字节 SHA-256 全等，因为它能排除 PNG 编码差异。若出现「PNG 容器字节不同但像素一致」：

- 用 Playwright 的严格像素比较（`maxDiffPixelRatio: 0` 的临时比较）证明差异只在编码层；
- 在 specs 记录原因与结论；
- 仍不一致（真实像素抖动）则视为环境未固定，回到 flags/字体预检，不放宽容差。

## 11. 实施顺序

每一步都可独立验证、独立提交；提交前缀按仓库约定（`chore` / `test` / `docs`）。

| 步  | 内容                                                                                                  | 验证                                        | 回滚              |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------- |
| 0   | 本设计评审通过                                                                                        | 本文 §14 勾选                               | 无                |
| 1   | `package.json` 精确 pin 1.64.1 + lockfile                                                             | macOS visual 4/4；`pnpm verify`             | 还原 package/lock |
| 2   | `docker/visual.Dockerfile`、`visual-fonts.conf`、`scripts/visual-linux.mjs`、`.gitignore` 的 cache 项 | 镜像构建；`fc-match`/`fc-list`；WebGL 预检  | 删除新文件        |
| 3   | `ci.yml` visual job：加容器化/update 输入/artifact（暂留 `continue-on-error`）                        | update dispatch 产出 artifact               | 恢复旧 job        |
| 4   | 生成并提交 5 张 `-linux.png`（本地容器或 CI update artifact）                                         | `pnpm visual:linux --stability`；人工看中文 | 删除 PNG          |
| 5   | `scripts/check-visual-baselines.mjs`、`ready()` 预检、`pnpm verify` 接线                              | N1/N4 红；macOS 4/4；Linux 4/4              | 移除脚本/预检     |
| 6   | 撤 `continue-on-error`；gate 加基线齐全检查                                                           | 普通 dispatch 绿；删除基线红                | 恢复 job          |
| 7   | docs/15、docs/13、AGENTS、ci 注释、visual.spec 注释同步                                               | `pnpm verify`；文档无旧「待补」表述         | 还原文档          |
| 8   | Phase 2：PR path-filter visual                                                                        | 只在渲染路径触发                            | 关闭 workflow     |

步骤 4 之前，CI visual job 仍可保持 `continue-on-error`；步骤 6 才撤。这样基线未就位时不会误红，也不会长期挂账。

## 12. 风险与缓解

| 风险                    | 影响                         | 缓解                                                     | 发现方式                 |
| ----------------------- | ---------------------------- | -------------------------------------------------------- | ------------------------ |
| 官方镜像无 CJK          | 中文豆腐块被固化成基线       | 派生镜像 + fontconfig + 构建期 `fc-list`                 | 构建断言 + 人工首次审图  |
| 字体包/版本漂移         | 字形或宽度变化               | 固定 `fonts-noto-cjk` 版本；可选 digest pin              | 双跑 + nightly 红        |
| WebGL 不可用            | 空白画布也能「通过」         | flags + 预检 + 人工审图                                  | `ready()` 断言           |
| Playwright/镜像版本漂移 | 快照算法与浏览器行为变化     | 精确 pin + 脚本断言                                      | 预检非零退出             |
| arm64 本地生成          | 与 CI amd64 渲染不同         | 脚本固定 `linux/amd64`；arm64 只做 QEMU 校验，不作为权威 | 双跑/与 CI 对比          |
| 宿主 node_modules 污染  | macOS 二进制进容器或反向污染 | 源码副本 + 独立 store；不挂宿主 node_modules             | 安装/运行报错            |
| update artifact 被误用  | 旧基线或错误截图入库         | update 后自动再校验；权限只读；人工审图                  | artifact 的 SHA/环境文件 |
| 2% 容差吞小差异         | 细节回归漏检                 | 负向用例放大差异；后续另议更严阈值                       | 代码审查                 |
| 只有 nightly            | 回归最长 24h 才可见          | Phase 1 接受；Phase 2 PR path filter                     | 决策台账 D6              |
| 镜像构建网络失败        | job 红但不说明产品问题       | 明确日志；重试；不 fallback 到宿主 Chrome                | CI 日志                  |
| 新增视觉用例忘更新基线  | 校验红                       | 基线检查从测试源码提取名称                               | gate                     |
| 误改 darwin 基线        | macOS 假绿/假红              | flags 按 channel 隔离；先跑 macOS 后跑 Linux             | 本地 4/4                 |

## 13. 决策台账

| #   | 决策       | 结论                                              | 理由/代价                                        |
| --- | ---------- | ------------------------------------------------- | ------------------------------------------------ |
| D1  | 平台基线   | darwin/linux 分文件，不追跨平台一致               | 平台字体/GPU 差异不可消除；现有模板已支持        |
| D2  | 环境来源   | 官方镜像 + 派生字体层，不 runtime apt             | runtime apt 不可 pin，且每次都要装；派生层可断言 |
| D3  | CJK 方案   | Noto Sans CJK SC + fontconfig prefer              | 3/5 快照含中文；显式 SC 防 JP/KR 漂移            |
| D4  | 版本策略   | Playwright 精确 1.64.1                            | 范围版本会随 lockfile 漂移；视觉必须可复现       |
| D5  | 渲染路径   | 强制 ANGLE/SwiftShader，不加 `--disable-gpu`      | 去掉 GPU 差异；`--disable-gpu` 有断 WebGL 风险   |
| D6  | PR 门禁    | Phase 1 只 nightly/手动；Phase 2 再议 path filter | 容器成本与收益需单独评估                         |
| D7  | 生成路径   | 本地容器优先，CI update 备选                      | 本地可调试；无容器时仍能产出                     |
| D8  | 更新粒度   | 有意变化两平台同提交；平台特有需记录              | 防只更新一侧造成假绿                             |
| D9  | 视觉参数   | `workers=1 retries=0`                             | 失败可归因；不靠重试掩盖                         |
| D10 | 容差       | 保持 0.02                                         | 改动小、风险可控；更严阈值另案                   |
| D11 | 基线发现   | 从 `visual.spec.ts` 提取名称                      | 单一来源，避免双列表                             |
| D12 | 镜像分发   | 本地/CI 临时构建，不推 registry                   | 避免 GHCR 权限与保留策略；Dockerfile 即事实源    |
| D13 | digest pin | 首次成功后建议 pin index digest                   | 防 tag 被重推；写入 Dockerfile 需同步脚本        |
| D14 | 文档归属   | 方案/记录留在 specs；docs 只写当前事实            | 遵守仓库文档规则                                 |

## 14. 设计审查

### 14.1 约束核对

| 约束               | 结论 | 说明                                                          |
| ------------------ | ---- | ------------------------------------------------------------- |
| docs/13 的下一阶段 | 对齐 | 本方案就是 Linux 基线 + CI 真门禁                             |
| 单机优先/无服务端  | 对齐 | 只加构建/E2E 设施，不进启动路径                               |
| 数据流铁律         | 对齐 | 不改 Yjs/渲染/交互                                            |
| 接口先行/显式依赖  | 对齐 | 脚本接口、版本契约先定义；不引入隐式全局                      |
| 测试分层           | 对齐 | 视觉是数据探针的补充；不替代                                  |
| 仓库卫生           | 对齐 | 文档无本机绝对路径/账号/密钥；镜像 URL 与依赖名不属于来源痕迹 |
| 依赖治理           | 对齐 | 只改 devDependency；无运行时依赖                              |
| 小步可回退         | 对齐 | §11 八步，每步可单独回滚                                      |

### 14.2 对抗式审查发现

| #   | 发现                                                                         | 严重度       | 处置                                                    |
| --- | ---------------------------------------------------------------------------- | ------------ | ------------------------------------------------------- |
| R1  | 官方 Playwright 镜像不保证 CJK；3/5 快照含中文，最坏会把豆腐块固化成「正确」 | S1           | 派生镜像 + fontconfig + 构建期 `fc-list` + 首次人工审图 |
| R2  | 无 GPU 容器里 WebGL 可能不可用，截图全白也能通过                             | S1           | SwiftShader flags + `ready()` WebGL 断言 + 人工审图     |
| R3  | Playwright 范围版本 + 非固定镜像会让「基线」失去意义                         | S1           | 精确 pin + 脚本断言 package/image 一致                  |
| R4  | 直接挂载宿主 node_modules 会把 macOS 二进制带进 Linux                        | S2           | 源码副本 + 独立 pnpm store；不挂宿主依赖                |
| R5  | CI update 产物若自动提交，错误基线会直接入库                                 | S2           | 只读权限 + artifact + 人工提交 + update 后自动再校验    |
| R6  | 只改 Linux 基线、忘改 darwin，会造成跨平台假绿                               | S2           | 更新规则 + 提交审查；有意变化两平台同提交               |
| R7  | 新增 flags 若全局生效，会改写 darwin 基线                                    | S2           | 只在 `E2E_VISUAL_CHANNEL=bundled` 时追加                |
| R8  | 2% 容差可能吞掉小回归                                                        | S3           | 保留容差；负向用例制造明显差异；更严阈值另案            |
| R9  | 只在 nightly 跑，回归窗口 24h                                                | S2           | Phase 1 接受；Phase 2 PR path filter                    |
| R10 | arm64 开发机用 QEMU 生成的基线未必等同 amd64                                 | S2           | 固定 `linux/amd64`；CI 为权威；arm64 只做校验           |
| R11 | 字体包版本漂移会让字形变化                                                   | S2           | 固定 `NOTO_CJK_VERSION`；可选 digest pin；nightly 红    |
| R12 | 新增视觉用例后基线列表漏更新                                                 | S3           | 从测试源码提取名称，不维护第二份列表                    |
| R13 | 撰写环境无容器运行时，容易把方案写成「只支持本地 Docker」                    | S2           | 把 CI update 写成完整备选路径                           |
| R14 | 镜像 tag 存在性/Node 版本是假设                                              | S0（已核实） | 已查 MCR：tag 存在、Node 24、LANG=C.UTF-8               |

### 14.3 审查结论

**通过，附实施前四个硬门槛**：

1. 构建派生镜像成功，`fc-match sans-serif` 命中 Noto Sans CJK SC，`fc-list :lang=zh` 非空。
2. 容器内 WebGL 预检通过；截图为非空白（人工打开 5 张确认）。
3. 两次独立生成 SHA-256 全等；不等则不进入基线提交。
4. macOS 4/4 与既有 darwin 基线零变化；有任何 diff 先查 `ready()`/flags 是否误伤。

**两个人工审查门**：

- 首次生成的 3 张含中文快照逐张看字形与排版。
- update artifact 的 `environment.txt` 与提交 SHA 对齐后才允许提交。

**明确不接受**：

- 为了绕过 CJK 问题把测试文字改成纯英文（会丢失中文渲染覆盖）。
- 把 `continue-on-error` 留着，靠 artifact 人工看。
- 用宿主 Chrome 或未固定版本的浏览器生成 Linux 基线。
- 提交未经双跑验证的截图，或把 `-actual.png` 改名当基线。
- 在 PR 未验证的情况下直接 push 基线提交。

### 14.4 实施后需回填

- 镜像 index digest 与字体版本。
- `fc-match sans-serif` / `fc-list :lang=zh family` 输出。
- 5 张 PNG 的 SHA-256 与生成时间。
- 首次普通 CI 绿、update CI artifact、N1–N5 负向结果。
- macOS 4/4 与 `pnpm verify` 结果。
- 任何与设计的偏差及原因（写入本文新增小节，不散落到 docs）。

### 14.5 实施档案（2026-10，本地 colima 容器生成）

提交序列：`dadaf09`（pin）→ `8a680ad`（容器+执行器）→ `2b2fc9c`（CI 容器化，
暂留 continue-on-error）→ `3679fa3`（5 张基线）→ `2fece76`（护栏入 verify）→
`6fd9263`（撤 continue-on-error + gate 基线检查）→ 文档同步（本笔）。
步骤 8（PR path-filter）为 Phase 2 未启动。

环境与版本：

- base 镜像 `mcr.microsoft.com/playwright:v1.64.1-noble`，RepoDigest
  `sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea`
  （与 §3.4 核实值一致；弱网环境经镜像源拉取后按 digest 校验等值）。
- 容器内 node v24.22.1 / pnpm 11.28.5（corepack）/ `@playwright/test` 1.64.1。
- `fonts-noto-cjk=1:20230817+repack1-3`；构建期断言通过：
  `fc-match sans-serif` → `NotoSansCJK-Regular.ttc: "Noto Sans CJK SC"`，
  `fc-list :lang=zh` family 含 `Noto Sans CJK SC`。
- WebGL：`ready()` 环境断言（离屏 canvas 上下文非空）通过；快照非空白由人工
  审图确认（SwiftShader 软光栅生效）。

5 张基线 SHA-256（stability 双跑与 update 落盘一致）：

```
8afaf87145106f0f465d2f6b688f38f08e6f8e834d7f58b34b02546e1266dd11  delay-tall-linux.png
a615edce7dc0cdfe6929e14366de1b089185a164e9e6bc328691f9ccd4874202  marks-render-linux.png
556991fa5481f7894461fc498c8cadc081901093278dfc490a788e9fb1f068d5  rotate-45-linux.png
81c211e42af9172466e02995ca48b8940d4e2b9eb49dffc7dd07a714a5ac9838  theme-dark-linux.png
b2144ef4b945cd0ec262782f6b47cf5bfffd432516f0e2b640ea935ce756fcbd  theme-light-linux.png
```

验证结果：

- stability：两轮 fresh（各自新 work + 新容器）SHA-256 逐字节全等；
  update 落盘后新容器复验 4/4 通过；store 预热后单轮约 75s。
- 人工审图门（§14.3）：5 张逐张过——theme 双态中文「浅色态主题探针粗」
  简体字形正确（末字加粗生效）；marks 粗/斜/下划线/红/蓝与粘贴 HTML 逐字
  吻合；delay 竖笔迹平滑连续；rotate 45° 无裁切；全部非空白。
- 负向 N1–N5 全部实测红（本地等价）：
  N1 删 `theme-dark-linux.png` → 护栏 exit 1；N4 放 `foo-actual.png` → 护栏
  exit 1；N2 换图跑 `pnpm visual:linux` → exit 1 且 `last-failure/` 导出
  actual/expected/diff/trace；N3 `package.json` 改 1.64.0 → 版本契约 exit 2；
  N5 Dockerfile 移除 fonts conf COPY → 构建期 fc 断言红 exit 2。
- macOS：darwin 基线零字节变化，visual 4/4 复跑两轮通过；`pnpm verify`
  （含新护栏）全绿，且每次 push 的 pre-push 钩子全量复跑通过。
- CI 实证（普通 dispatch 绿 / update artifact）：**挂账**——Actions 不可用；
  ci.yml 已静态目检 + hygiene。本地等价指容器内命令一致（同脚本同镜像）；
  CI 侧另有条件化编排（update dispatch 跳过校验/gate 基线检查，见返工记录）。

与设计的偏差（三条）：

1. **容器编排用 `docker cp` 双向拷贝**（源码拷入、基线拷回、失败现场导出），
   替代 §7.2 的卷挂载方案：colima 卷挂载对 vite 冷启动是 IO 瓶颈。结果等价
   ——fresh work 副本 + 容器本地 fs + 持久化 store/corepack 两卷，稳定性由
   双跑哈希证明。
2. **`ready()` 环境预检提前到步骤 2**（§11 原排在步骤 5）：基线必须生成于
   最终 flags/断言形态下，否则步骤 4 生成的基线与后续断言形态不可证一致。
3. **CI 实证挂账**（用户决策：Actions 因私有仓库计费限制不可用）：本地等价
   验证替代（含基线过期 → update 恢复场景，见返工记录）；普通校验步骤与
   update 步骤在 CI 条件上互斥，恢复后需两次 dispatch 分别补验（普通绿 +
   update artifact），见 §14.7。

### 14.6 审查返工记录（2026-10）

首轮落地后的对抗式审查发现 P1–P3 共 12 项，全部修复（提交 `3441eac` →
`81d6379` → `cf0cb5c` → 文档笔）：

- **P1 CI update 被前置校验挡住**：gate 基线检查与 visual 校验步骤无条件执行，
  基线过期时 update dispatch 跑不起来。两处加
  `${{ !(dispatch && visual_update) }}` 跳过（裸 `!` 开头的 if 会被 YAML 解析
  为自定义 tag，必须包 `${{ }}`）。本地等价补测：改坏一张基线（theme-light
  覆盖为 theme-dark 内容）→ `--update` → 恢复为正确哈希 b2144ef4…、复验 4/4、
  artifact 产出、`git status` 干净（重生成与已提交基线逐字节一致）。
- **镜像 tag 加环境指纹**：`spinth-visual:<pw版本>-<sha256(字体版本+Dockerfile
+fonts.conf) 前 12 位>`——环境任一变动自动换 tag 重建（层缓存命中），本地
  不再静默复用旧镜像；实测新指纹 tag `1.64.1-8eed00e0dd28` 构建通过。
- **artifact 字段补齐 §8.2**：environment.txt 增 node / pnpm / base_digest /
  fc_match / fc_list_zh（容器存活时采集；base_digest 实测两条 RepoDigest 均
  为 §3.4 核实的 47b510dd…）。
- **stability 集合断言**：两轮产物集合必须恰好等于 spec 全部 stem（原实现只
  比对 round1 的键，skip 少一张也绿）；stem 提取抽为共享模块
  `scripts/visual-linux/stems.mjs`，护栏与执行器单源。
- **die 清理收口**：makeCleanup 注册进模块级 CLEANUPS，die 先同步清理再
  exit（幂等）——process.exit 绕过 try/finally 的失败路径不留孤儿容器；
  chownVolumes 补 `--platform linux/amd64`；宿主 rsync 缺失预检（明确报错
  替代 ENOENT 裸崩）；readDockerfileVersion 兼容 FROM digest pin 形态。
- **执行器拆分**：单文件 685 行超「目标 <400 行」约定，拆为
  scripts/visual-linux/{config,util,docker,run,artifact,stems}.mjs（最大
  242 行），行为零变化（N3 与护栏拆分后复测通过）。
- **文档修正**：§14.4→§14.5 引用（AGENTS/docs13）；stability 措辞改为事实
  （update 自带复验，stability 是提交前仪式，脚本打印提醒不强制）；
  visual.spec.ts 头注释「CI 跳过」改为当前门禁事实。
- **返工后复测全绿**：校验 4/4（35s）/ 坏基线 update 恢复（77s）/ stability
  5 张全等（77s）/ macOS visual 4/4 / pnpm verify（pre-push）。

### 14.7 第二轮审查返工（2026-10）

复审确认 P1/P2 已修、无阻断项；余七条 P3 边缘全部收口（提交 `6d705ff` →
`e986d33` → `4947bb0` → 文档笔）：

- **skip 假绿（核心）**：work 副本经 rsync 带入宿主已提交的旧 `-linux.png`，
  用例被 skip 时旧图顶替本轮产物——集合/计数断言与双跑哈希全部假绿。新增
  `stripLinuxBaselines()`：update/stability 生成轮前置删除 work 内
  `*-linux.png`（校验轮与复验轮需要宿主基线，不删）。负向实测：rotate 用例
  临时 `test.skip` → `--stability` exit 3「期望 5 张实际 4 张（rotate-45 缺）」
  ——旧实现该场景为绿；恢复后 5 张全等。
- **containerCreate 孤儿容器**：makeCleanup 改按容器名幂等（Map），docker run
  成功后立即注册——exec/chown/cp 中途失败时 die 也能清理。
- **update 事务化**：抽 `rollback()`，复验失败 / 环境采集异常 / writeArtifact
  失败统一回滚宿主基线，不再出现「基线已改而产物缺失」的半成品状态。
- **runOnce 提取 error**：`extractVisualStems` 的 error 与 runStability 一致
  走 fail(3)，不再忽略。
- **digest pin 前向兼容**：新增 `dockerfileBaseRef()` 解析 FROM 实际引用
  （变量 tag / 纯 digest / tag+digest 三形态），版本断言与 artifact 的 base
  inspect 都基于它——未来按 §5.1 换 digest pin 时链路不断；指纹已含 Dockerfile
  全文，base 引用变化指纹必变（注释写明）。
- **base_digest 归一化**：RepoDigests 优先取官方 `mcr.microsoft.com/` 那条、
  只留 `sha256:` 摘要——本地镜像源别名不进 artifact（实测输出单值
  `sha256:47b510dd…`，与 §3.4 一致）。
- **护栏按平台指引**：缺 linux → `pnpm visual:linux --update`；缺 darwin →
  macOS 宿主 `--update-snapshots`（负向实测缺 darwin 场景指引正确）。
- **返工后复测全绿**：校验 4/4（35s）/ stability 5 张全等 / 坏基线 update
  恢复（base_digest 单值）/ macOS visual 4/4 / pnpm verify（pre-push ×3）。

CI 实证验收口径（Actions 恢复后）：**两次 dispatch**——普通 dispatch 验
gate 基线检查 + visual 校验分支；带坏基线的 update dispatch 验「跳过校验 →
生成 → artifact」整条路径（两步骤条件互斥，一次 dispatch 覆盖不了两条）。

## 15. 附录

### A. 文件地图

新增：

```
docker/visual.Dockerfile
docker/visual-fonts.conf
scripts/visual-linux.mjs                 入口（模式分发 + main）
scripts/visual-linux/config.mjs          常量与 CLI 模式
scripts/visual-linux/util.mjs            子进程/日志/die+清理注册/哈希
scripts/visual-linux/docker.mjs          版本契约/镜像构建/work 同步/容器编排
scripts/visual-linux/run.mjs             安装预检/执行/runOnce/runStability
scripts/visual-linux/artifact.mjs        哈希清单/审计采集/update 产物
scripts/visual-linux/stems.mjs           基线清单单源提取
scripts/check-visual-baselines.mjs
packages/app/e2e/visual.spec.ts-snapshots/*-linux.png   (5 张)
specs/linux-visual.md                                   (本文)
```

修改：

```
package.json                   精确 pin + visual:linux 脚本
pnpm-lock.yaml                 lockfile
playwright.config.ts           bundled 视觉 flags + deviceScaleFactor: 1
packages/app/e2e/visual.spec.ts  ready() 预检 + 顶部注释
.github/workflows/ci.yml       visual job 容器化/撤 continue-on-error/update 输入
docs/15-testing.md             §2 §4 当前事实
docs/13-roadmap.md             §2 §3 状态
AGENTS.md                      当前基线与下一阶段
.gitignore                     .cache/visual-linux/
```

### B. 命令速查

```
pnpm visual:linux                   # 校验
pnpm visual:linux --update          # 更新 Linux 基线
pnpm visual:linux --stability       # 双跑哈希
pnpm visual:linux --rebuild         # 强制重建镜像
node scripts/check-visual-baselines.mjs
pnpm verify
```

macOS 基线更新仍走原路径：`npx playwright test --grep @visual --update-snapshots`（系统 Chrome，`E2E_VISUAL_CHANNEL` 不设）。

### C. 版本升级仪式

1. 改 `package.json` 的 `@playwright/test` 为新的精确版本；`pnpm install` 更新 lockfile。
2. 改 Dockerfile 的 `PLAYWRIGHT_VERSION`（脚本从 package.json 注入，二者必须一致）。
3. 重建镜像；跑预检；确认 CJK 与 WebGL。
4. 重新生成 linux 基线；双跑哈希。
5. 在 macOS 用新版本重新生成 darwin 基线。
6. 同一次提交包含 package/lock/Dockerfile/两平台基线；跑 `pnpm verify` 与视觉。
7. 记录镜像 digest 与字体版本。

### D. 基线更新仪式

1. 先确认是「有意视觉变化」，不是环境漂移。
2. macOS 更新 darwin；Linux 更新 linux。
3. 打开 5 张图逐张看；含中文的 3 张重点看。
4. 两次运行确认稳定。
5. 同一提交包含两平台基线（或记录平台特有理由）。
6. 提交后等 CI visual 绿再合入。

### E. 实施档案清单

```
[x] 镜像 digest / base tag（§14.5）
[x] Node / pnpm / Playwright 版本（§14.5）
[x] fonts-noto-cjk 版本；fc-match；fc-list :lang=zh family（§14.5）
[x] WebGL renderer/version（ready 断言非空 + 人工审图非空白，§14.5）
[x] 5 张 PNG SHA-256（§14.5）
[x] stability 两次结果（全等，§14.5）
[ ] 普通 CI run / update CI run（挂账：Actions 不可用，§14.5 偏差 3）
[x] N1–N5 负向结果（本地等价，§14.5）
[x] macOS 4/4 / pnpm verify（§14.5）
[x] 与设计的偏差（三条，§14.5）
```

### F. 参考

- [docs/15](../docs/15-testing.md) §4：视觉快照定位、容差、基线纪律。
- [docs/13](../docs/13-roadmap.md) §2–§3：下一阶段与挂账。
- [playwright.config.ts](../playwright.config.ts)：快照路径、channel、webServer。
- [visual.spec.ts](../packages/app/e2e/visual.spec.ts)：4 个用例与 5 个快照名。
- [ci.yml](../.github/workflows/ci.yml)：现有 visual job 与三层门禁。
- [textVm.ts](../packages/core/src/widgets/text/textVm.ts#L17)：canvas 字体固定为 sans-serif。
