# Spinth

spinth 是一个**本地优先的白板与思维导图编辑器**。当前版本只做单机模式：文档、
撤销历史和图片资产全部保存在浏览器本地，不依赖服务端。

## 能力

- 无限画布、矩形/文本/便签/连线/画笔/图片
- 思维导图树形布局与拖拽重排
- 多选、编组、对齐/分布、旋转、参考线吸附
- 富文本编辑、排版覆盖、橡皮分段擦除
- Yjs 文档模型 + IndexedDB 持久化 + 本地撤销/重做
- 本地图片资产库（内容寻址去重，文档只存短引用）
- 深色/浅色主题、390px 移动端布局

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build
pnpm test
pnpm test:e2e
pnpm verify       # lint + format + typecheck + 单测 + build
```

要求 Node >= 24、pnpm 11.28.5。

## 部署（GitHub Pages）

子路径部署到 `https://<user>.github.io/<repo>/` 时，用 `SPINTH_BASE` 注入基路径：

```bash
SPINTH_BASE=/Spinth/ pnpm build          # 产物全量带 /Spinth/ 前缀
node scripts/check-pages-build.mjs packages/app/dist /Spinth/   # 产物路径校验
```

push main 由 `.github/workflows/pages.yml` 自动构建部署；前提是仓库
Settings → Pages → Source 选 **GitHub Actions**。自托管/根路径部署不需要
`SPINTH_BASE`（默认 `/`）。站内跳转与 public 资源统一走
`packages/app/src/siteBase.ts`，不要在 JS 里写死根路径。

## 仓库结构

```
packages/core    @spinth/core    框架无关 SDK（PIXI 8 + Yjs）
packages/react   @spinth/react   zustand 只读镜像 + DOM UI
packages/app     @spinth/app     Vite 应用壳
docs/            规格与设计文档
```

## 设计原则

1. **所有写操作只写 Yjs**；渲染层只订阅 Yjs。
2. 本地操作与未来可能加入的协同操作走同一条数据路径。
3. core 不依赖 React；react 不直接操作 PIXI/Yjs；app 只消费 react。
4. 服务端、账号、远端同步不属于当前版本。

## 文档

完整索引与任务路由见 [docs/README.md](docs/README.md)。

- [总览](docs/00-overview.md)
- [工程约定](docs/01-conventions.md)
- [数据引擎](docs/02-data-engine.md)
- [渲染引擎](docs/03-render-engine.md)
- [控件体系](docs/04-widget-system.md)
- [选中与拖拽](docs/05-selection-drag.md)
- [参考线](docs/06-refline.md)
- [富文本](docs/07-text.md)
- [连线](docs/08-line.md)
- [剪贴板与快捷键](docs/09-clipboard-shortcuts.md)
- [未来协同边界](docs/10-collaboration.md)
- [脑图](docs/11-mindmap.md)
- [UI 层](docs/12-ui-layer.md)
- [路线图](docs/13-roadmap.md)
- [渲染同步原则](docs/14-render-sync-principles.md)
- [测试](docs/15-testing.md)
- [性能](docs/16-performance.md)
- [统一编辑会话](docs/17-editing-service.md)
- [编组](docs/18-group.md)
- [本地资产](docs/19-assets.md)
