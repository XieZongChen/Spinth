# Spinth

**本地优先的白板与思维导图编辑器，所有内容都留在你的浏览器里。**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Demo](https://img.shields.io/badge/demo-live-8f7dff)](https://xiezongchen.github.io/Spinth/)

spinth 是一块无限画布：形状、文本、便签、图片、自由画笔、连线和思维导图都在这里。
文档、撤销历史和图片资产全部保存在浏览器本地（IndexedDB）——不需要账号、不连服务端、
没有任何埋点。

**[打开在线 Demo →](https://xiezongchen.github.io/Spinth/)**

## 能力

- 无限画布：矩形、文本、便签、图片、自由画笔、连线
- 思维导图树形布局：拖拽改父级、键盘导航、就地编辑
- 多选、编组、对齐/分布、参考线吸附
- 富文本编辑，支持选区级排版覆盖与行内 marks
- 基于 Yjs 文档 + IndexedDB 的撤销/重做，刷新页面不丢
- 内容寻址的本地资产库：图片自动去重，文档只存短引用
- 项目文件：导出/导入可携带的 `.spinth.zip`
- 深色/浅色主题、390px 移动端布局、可安装 PWA 与离线缓存
- 多标签安全：单写者持有文档，其余标签页只读跟随

## 快速开始

```bash
pnpm install      # Node >= 24，pnpm 11.28.5
pnpm dev          # http://localhost:5173
pnpm build        # 生产构建（含 Service Worker）
pnpm test         # 单元测试
pnpm test:e2e     # Playwright 端到端
pnpm verify       # 卫生 + lint + 格式 + 类型 + 许可 + 单测 + 构建
```

## 架构

| 包               | 角色                                         |
| ---------------- | -------------------------------------------- |
| `packages/core`  | `@spinth/core`——框架无关 SDK（PIXI 8 + Yjs） |
| `packages/react` | `@spinth/react`——zustand 只读镜像 + DOM UI   |
| `packages/app`   | `@spinth/app`——Vite 应用壳                   |

三条不变量守住数据流：

1. 所有写操作只走 Yjs；渲染层只订阅 Yjs。
2. `core` 不依赖任何 UI 框架，`react` 不直接操作 PIXI/Yjs，`app` 只消费 `react`。
3. 服务端、账号、远端同步都不在启动路径上——单机离线体验就是产品本身，不是降级方案。

实现说明与规格文档见 [`docs/`](./docs/README.md)。

## 浏览器支持

需要 IndexedDB、WebGL，以及离线缓存所需的 Service Worker。
Chromium 是自动化基线：全部端到端与视觉测试都在此运行；Firefox 与 Safari 预期可用，
但尚未纳入 CI。

## 隐私

- 无账号、无注册、无统计、无第三方脚本。
- 文档、撤销历史与图片都保存在浏览器本地存储。
- 不上传任何数据；导出 `.spinth.zip` 是数据离开本机的唯一方式。
- 清除站点数据会删除画布，需要备份请先导出。

## 部署

任意静态托管即可。部署到 GitHub Pages 这类子路径时，在构建期注入基路径并校验产物：

```bash
SPINTH_BASE=/Spinth/ pnpm build
node scripts/check-pages-build.mjs packages/app/dist /Spinth/
```

## 参与贡献

欢迎提 issue 与 PR。动手前请先读 [CONTRIBUTING.md](./CONTRIBUTING.md)：
仓库门禁是 `pnpm verify`，提交需要 DCO 签名（`git commit -s`）。

## 许可

[MIT](./LICENSE)。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
