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
5. **单文件单职责**：目标 < 400 行，超过就拆 Service/Vm/工具。
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
- 交接 Prompt、代理计划、评审草稿不入库：`HANDOFF*`、`*handoff*.md` 与本地代理目录只保留在本机；具体目录写本机 `.git/info/exclude`，由 `pnpm hygiene` 拦截。
- 验收清单、手工验证步骤与运行手册不写入 `docs/`；它们属于本地交接文档。docs 只保留规格、约束、架构与当前边界。
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
多标签单写者/只读跟随（docs/21）、资产/图片生命周期（加载会话/纹理共享/重试/
GC 分片预算，docs/19）。
当前实测基线：`pnpm verify` 通过；857 单测（core 848 + react 9）；E2E 18 spec /
169 用例全绿（视觉 4/4；图片/资产专项 10/10）。

下一阶段重点是只读态收口、移动端/可访问性与公共 API 收口。
