# AGENTS.md — spinth 开发约定

> 本文件是 AI 助手与人类开发者在 spinth 仓库工作的最高优先级约定。
> 与代码冲突时，以本文件与 `docs/` 为准；修改本文件需人类确认。

## 项目是什么

spinth 是一个**本地优先的白板与思维导图编辑器**。当前阶段只做单机版：文档、
撤销历史和图片资产保存在浏览器，不依赖服务端、账号或网络。

核心架构一句话：**所有写操作只写 Yjs；所有渲染只订阅 Yjs。**

## 仓库结构

```
packages/core    @spinth/core    框架无关 SDK（PIXI 8 + Yjs）
packages/react   @spinth/react   zustand 只读镜像 + DOM UI
packages/app     @spinth/app     应用壳（Vite + React 19）
docs/            规格文档（本仓库自己的文档）
```

当前没有 `packages/server`。协同是后置能力，不属于本阶段。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm hygiene
pnpm verify
pnpm verify:log
```

提交前必须全绿：`pnpm verify`（hygiene + lint + prettier + typecheck + `pnpm -r test` + build）。
跑门禁用 `pnpm verify:log`（或 `set -o pipefail`）——裸 `pnpm verify | tail` 会用 tail 的
退出码掩盖红测试；pre-push 钩子同样会跑一次 `pnpm verify`。
Node >= 24，pnpm 11.28.5。

## 八条铁律

1. **文档即规格**：实现前先读对应 docs；实现与文档不一致时先改文档或说明理由。
2. **接口先行**：先在 `packages/core/src/types/` 写 TS interface + zod schema。
3. **数据流铁律**：禁止绕过 Yjs 直接改 VM/PIXI；拖拽/缩放只允许视觉预览，松手必须经 Model 写回。
4. **显式依赖**：构造函数注入，通过 ServiceRegistry 获取依赖；禁止装饰器 DI 和全局单例。
5. **单文件单职责**：非测试代码目标 < 400 行，超过就拆 Service/Vm/工具；测试文件按文件/功能域拆分，不套用 400 行上限。
6. **测试护栏**：纯逻辑有 vitest；编排有桩测试；整机链路有 Playwright。提交前 `pnpm verify`，改交互补跑 `pnpm test:e2e`。
7. **新增控件 = 三件套**：`xxxModel.ts` + `xxxVm.ts` + `xxxService.ts` + 注册；不改 dataEngine/vmEngine。
8. **单机优先**：启动主路径不启用服务端、账号或远端同步；协同相关代码不得进入默认启动路径。本地文档必须能离线编辑、刷新恢复。

## 渲染同步铁律

拖拽/缩放系列 bug 的六条规则：跟随框绝对定位禁止增量累加 / setState 先渲染后广播 /
交互数学无状态化 / 几何读取缩放感知 / 松手落库用最后一帧输出 / 交互几何 per-type 契约。
回归测试：`__tests__/renderSync.test.ts`。违反任何一条 = 重做。

## 代码风格

- TS strict（含 `noUncheckedIndexedAccess`）。
- 文件：`xxxService.ts / xxxVm.ts / xxxModel.ts`；接口 `I` 前缀；rx 流 `$` 后缀；常量 UPPER_SNAKE。
- 注释解释“为什么”（约束、踩坑、算法出处），不复述“是什么”。
- 提交信息：`feat|fix|docs|refactor|test|chore: 中文描述`。

## 文档迭代与仓库卫生

- 文档只写**当前事实**（格式、契约、约束、当前验收状态）；不写日期、提交哈希、PR 编号、验收流水账，也不追加“此前/现在/已修复”叙事。历史由 git 提交信息承载。
- 修改能力时**直接改写对应段落**，不新增变更记录；文档与代码不一致时先改文档。
- 实现方案与审查记录写入 `specs/<功能名>.md`（按功能命名、无前缀），随代码提交；`specs/` 是过程文档，允许提交哈希与实施过程记录，不受 `docs/` 的“只写当前事实”约束。
- `specs/` **不豁免隐私与来源要求**：本机路径、用户名、邮箱、密钥由通用规则拦截；其他项目名称等来源信息由本机 `.hygiene.local.json` 的拒绝词拦截（全库 `denyPatterns`，可按路径收窄；名称不入库）。
- 代理计划、评审草稿与 `HANDOFF*` / `*handoff*` 不入库：只保留在本机，写本机 `.git/info/exclude`，由 `pnpm hygiene` 拦截。
- 验收清单、手工验证步骤与运行手册不写入 `docs/`；它们属于 `specs/` 下的实现文档。docs 只保留规格、约束、架构与当前边界。
- 仓库内容不得包含本机绝对路径、用户名、邮箱、其他项目名称或来源痕迹。需要本地拒绝词时写 `.hygiene.local.json`（ignored），不要写进仓库。
- `pnpm install` 会安装 pre-commit（staged 卫生）与 pre-push（`pnpm verify`）钩子；
  已有自定义钩子不会被覆盖。绕过钩子（`--no-verify`）等于放弃本地门禁，CI 仍是 backstop。

## docs 索引

完整阅读路径与任务路由见 [docs/README.md](docs/README.md)；代码注释中的 `docs/NN §M`
必须能在对应篇目中找到。

| 篇目                      | 主题                                 |
| ------------------------- | ------------------------------------ |
| 00-overview               | 产品定位、架构铁律、包边界           |
| 01-conventions            | 仓库约定、技术栈、ADR、AI 工作流     |
| 02-data-engine            | Yjs、IndexedDB、undo、replay、持久化 |
| 03-render-engine          | PIXI、视口、分层、按需渲染、导出     |
| 04-widget-system          | Model/Vm/Service、注册表、能力位     |
| 05-selection-drag         | 选中、拖拽、缩放、旋转、对齐/分布    |
| 06-refline                | 参考线吸附、等间距                   |
| 07-text                   | 三态文本、测量引擎、两级渲染         |
| 08-line                   | 连线、路由、锚定、线上文字           |
| 09-clipboard-shortcuts    | 剪贴板、快捷键、闸门                 |
| 10-collaboration          | 未来协同边界（当前不启用）           |
| 11-mindmap                | 脑图数据、布局、拖拽、导航           |
| 12-ui-layer               | zustand 桥、DOM UI、主题、启动链路   |
| 13-roadmap                | 路线图、优先级、决策台账             |
| 14-render-sync-principles | 拖拽/缩放六条同步规则                |
| 15-testing                | 单测/编排/E2E/视觉基线               |
| 16-performance            | 空间索引、culling、性能债            |
| 17-editing-service        | 统一编辑会话、双内核、profile        |
| 18-group                  | 编组数据模型、命令、选择集成         |
| 19-assets                 | 本地资产、GC、失败回退               |
| 20-project-file           | 项目文件格式、导出/导入              |
| 21-multi-tab              | 多标签单写者、只读跟随、接管         |

## AI 工作流

1. 读 `docs/13-roadmap.md` 确认当前阶段。
2. 读相关 docs + `packages/core/src/types/` 现有契约。
3. 不确定的设计点先提问，不猜。
4. 顺序：types → 纯逻辑（带单测）→ PIXI 视图 → Service 接线 → 手动验证 → 同步 docs。
5. 每完成一个可验证单元就自检 lint/test/typecheck。
6. 小步提交，每步可回退。

## 当前状态

单机基线已完成：画布、形状/文本/便签/连线/画笔/图片/脑图、多选/编组/对齐/旋转/
参考线、富文本/排版/橡皮、撤销/重做、IndexedDB 持久化、本地资产库、移动端工具菜单、
项目文件导出/导入（`.spinth.zip`，docs/20）、存储状态面板（docs/02 §6.1）、
多标签单写者/只读跟随（docs/21）、资产/图片生命周期（加载会话/纹理共享/
纹理保活/重试/GC 分片预算，docs/19 + specs/texture-keepalive）、只读态收口
（右键不建选区、呈现门禁、运行时降级序列，
docs/21 §4）、可访问性与移动端收口批次 A（语义色 WCAG AA + 对比度护栏、共享
错误态 role=alert、390px 九面布局矩阵、单机断网不变量，specs/a11y-mobile）、
公共 API 收口与 P2 架构收口（`BoardPublicApi` allowlist + 分类编译锁、
`boardCommands` 宿主契约类型化、`app.ts` 门面化 + `BoardFacade` 纯委托基类、
`WIDGET_RUNTIME` 类型注册表单源，specs/api-surface）、可访问性挂账收口批次 B
（右键菜单键盘协议 roving + Shift+F10 + 菜单期快捷键闸门、工具主题色 `-ink`
按角色拆分 4.5:1、320 重排/200% 缩放/安全区矩阵、画布 role=application +
Announcer 播报器，specs/a11y-closeout）。
PWA/Service Worker 平台能力已落地（specs/pwa.md）：manifest + 192/512/maskable
图标、子路径 SW（scope=base，注册经 `publicAsset()`）、构建期实算预缓存清单
（含懒加载 chunk，latin 字体白名单）、导航 network-first + shell 回退、字体 SWR、
跨源/非 GET/Range 直通、waiting + 用户确认的可控更新（横幅只刷新点击方）、
`check-pages-build` 六断言、`__BUILD_TAG__` 构建标记；dev 不注册 SW；附带修复
zod JIT 探测在生产 CSP 下触发 securitypolicyviolation 的存量缺陷（jitless）。
Linux 视觉基线已落地（specs/linux-visual）：`@playwright/test` 精确 pin、
官方 playwright 镜像派生（fonts-noto-cjk 版本必传 + Noto Sans CJK SC 定档 +
构建期 fc 断言，镜像 tag 含环境指纹）、`pnpm visual:linux` 容器执行器
（`--update` 自带新容器复验，提交前先跑 `--stability` 双跑全等——specs §10.3
仪式，脚本不强制）、基线齐全护栏接入 verify 与 CI gate、visual job 真门禁
（update dispatch 跳过校验直接生成）；darwin/linux 双平台各 5 张基线。

边缘自动滚屏已落地（specs/edge-auto-scroll）：元素/脑图节点拖拽进 56px 边缘
热区按帧平移视口（三档 180/480/1080 屏幕 px/s、dt 钳 50ms），补偿走输入层
`replayLastPointerMove`（同一屏幕坐标重放 move，世界坐标每帧现算）；越阻尼
才启用、松手/取消/离容器/管线拒发即停，落库语义不变（一次拖拽一次撤销）；
复审返工补齐回归测试与异常兜底、抽 `selectorMarquee.ts`（selectorService
386 行）；手工验收五项待人工（specs/edge-auto-scroll §13.5）。

当前实测基线：`pnpm verify` 通过；1036 单测（core 947 + react 51 + app 38）；
E2E 45 spec / 218 用例全绿（视觉 4/4 双平台；图片/资产专项 12/12；a11y 6/6；
mobile 9/9；a11yKeyboard 9/9；a11yLayout 9/9；pwa 6/6 + dev 不注册 1）。

下一阶段顺序：发布前工程债余项（拆大文件、纹理保活、边缘自动滚屏已完成，
specs/split-large-files、specs/texture-keepalive、specs/edge-auto-scroll；
仅剩运行时收窄）
→ 开源发布 v1.0（发布清仓、仓库公开、CI 实证、GitHub Pages）
→ 1.0 后可访问性与平台遗留；协同最后（docs/10，不进入默认启动路径）。
可访问性遗留（画布内容朗读/px→rem/幽灵对比度等）见 docs/13 §3 与
specs/a11y-closeout §13.5；PWA 待人工项（iOS/Android 真机添加到主屏幕的启动
形态与图标裁切）见 specs/pwa.md §14；Linux 视觉 CI 实证（Actions 恢复后
普通 + update 两次 dispatch 补验）见 specs/linux-visual §14.7。
