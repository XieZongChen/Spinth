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

- [总览](docs/00-overview.md)
- [工程约定](docs/01-conventions.md)
- [数据引擎](docs/02-data-engine.md)
- [渲染引擎](docs/03-render-engine.md)
- [控件体系](docs/04-widget-system.md)
- [UI 层](docs/05-ui-layer.md)
- [本地资产](docs/06-assets.md)
- [测试](docs/07-testing.md)
- [性能](docs/08-performance.md)
- [路线图](docs/09-roadmap.md)
- [未来协同设计边界](docs/10-collaboration.md)
