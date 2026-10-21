# docs — 规格文档索引

本目录是 spinth 的工程规格。代码注释引用 `docs/NN §M` 时，NN 与章节号必须能在
对应篇目中找到；新增/修改能力先更新规格，再改实现。

## 1. 阅读路径

### 第一次接手

1. [AGENTS.md](../AGENTS.md) — 最高优先级约定与命令。
2. [00-overview](00-overview.md) — 产品定位、架构铁律、包边界。
3. [13-roadmap](13-roadmap.md) — 当前阶段与下一优先级。
4. [01-conventions](01-conventions.md) — 依赖方向、命名、门禁。

### 按任务查

| 任务                    | 先读                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 数据/Yjs/IndexedDB/undo | [02-data-engine](02-data-engine.md)、[10-collaboration](10-collaboration.md)                          |
| 渲染/视口/导出          | [03-render-engine](03-render-engine.md)                                                               |
| 新增或修改控件          | [04-widget-system](04-widget-system.md)                                                               |
| 选中/拖拽/缩放/旋转     | [05-selection-drag](05-selection-drag.md)、[14-render-sync](14-render-sync-principles.md)             |
| 参考线/等间距           | [06-refline](06-refline.md)                                                                           |
| 文本/富文本/排版        | [07-text](07-text.md)、[17-editing-service](17-editing-service.md)                                    |
| 连线                    | [08-line](08-line.md)                                                                                 |
| 剪贴板/快捷键           | [09-clipboard-shortcuts](09-clipboard-shortcuts.md)                                                   |
| 脑图                    | [11-mindmap](11-mindmap.md)                                                                           |
| UI/zustand/主题/移动端  | [12-ui-layer](12-ui-layer.md)                                                                         |
| 测试/E2E/视觉基线       | [15-testing](15-testing.md)                                                                           |
| 性能/索引/culling       | [16-performance](16-performance.md)                                                                   |
| 图片资产/GC/失败回退    | [19-assets](19-assets.md)                                                                             |
| 项目导出/导入/备份      | [20-project-file](20-project-file.md)、[19-assets](19-assets.md)、[02-data-engine](02-data-engine.md) |

## 2. 篇目

| 编号 | 文件                                                      | 主题                                |
| ---- | --------------------------------------------------------- | ----------------------------------- |
| 00   | [00-overview](00-overview.md)                             | 产品定位、架构铁律、包边界          |
| 01   | [01-conventions](01-conventions.md)                       | 仓库约定、技术栈、ADR、AI 工作流    |
| 02   | [02-data-engine](02-data-engine.md)                       | Yjs 文档、DataProcessor、DB、replay |
| 03   | [03-render-engine](03-render-engine.md)                   | PIXI、视口、按需渲染、导出          |
| 04   | [04-widget-system](04-widget-system.md)                   | Model/Vm/Service、注册表、能力位    |
| 05   | [05-selection-drag](05-selection-drag.md)                 | 选中、拖拽、缩放、旋转、对齐/分布   |
| 06   | [06-refline](06-refline.md)                               | 参考线吸附、等间距                  |
| 07   | [07-text](07-text.md)                                     | 三态文本、测量引擎、两级渲染        |
| 08   | [08-line](08-line.md)                                     | 连线、路由、锚定、线上文字          |
| 09   | [09-clipboard-shortcuts](09-clipboard-shortcuts.md)       | 剪贴板、快捷键、闸门                |
| 10   | [10-collaboration](10-collaboration.md)                   | 未来协同边界（当前不启用）          |
| 11   | [11-mindmap](11-mindmap.md)                               | 脑图数据、布局、拖拽、导航          |
| 12   | [12-ui-layer](12-ui-layer.md)                             | zustand 桥、DOM UI、主题、启动链路  |
| 13   | [13-roadmap](13-roadmap.md)                               | 路线图、优先级、决策台账            |
| 14   | [14-render-sync-principles](14-render-sync-principles.md) | 拖拽/缩放六条同步规则               |
| 15   | [15-testing](15-testing.md)                               | 单测/编排/E2E/视觉基线              |
| 16   | [16-performance](16-performance.md)                       | 空间索引、culling、性能债           |
| 17   | [17-editing-service](17-editing-service.md)               | 统一编辑会话、双内核、profile       |
| 18   | [18-group](18-group.md)                                   | 编组数据模型、命令、选择集成        |
| 19   | [19-assets](19-assets.md)                                 | 本地资产、GC、失败回退、导出边界    |
| 20   | [20-project-file](20-project-file.md)                     | 项目文件格式、导出/导入             |

## 3. 文档纪律

- **编号稳定**：不要复用/重排已有编号；新增主题追加到末尾（当前下一个是 21）。
- **章节稳定**：代码引用 `§M` 时，修改标题/顺序必须同步改引用或保留锚点。
- **接口先行**：类型/zod 契约在 `packages/core/src/types/`，文档与实现同步。
- **只写当前事实**：文档描述当前实现、契约与约束；不写变更记录、日期、提交哈希、PR 编号或验收流水账，也不追加“此前/现在/已修复”叙事。历史由 git 提交信息承载。
- **原地更新**：能力变化时改写对应段落，不新增变更记录；代码引用 `§M` 的章节号保持稳定。
- **不写来源对比**：不出现其他项目名称、来源路径、历史对比或本机绝对路径、用户名、邮箱。
- **交接不入库**：`HANDOFF*`、`*handoff*.md`、`本地代理目录`、`本地代理目录`、`本地代理目录` 只在本机；由 `.gitignore` 与 `pnpm hygiene` 拦截。
- **时点数字要真跑**：测试数、覆盖率、用例数写“当前实测”，并在提交前复跑。

## 4. 命令

```bash
pnpm hygiene      # 交接文件/隐私路径/文档历史记录检查
pnpm verify       # hygiene + lint + prettier + typecheck + pnpm -r test + build
pnpm test:coverage
pnpm test:e2e
```

提交前 `pnpm verify` 必须全绿；改交互编排补跑 `pnpm test:e2e`。
