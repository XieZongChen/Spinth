# @spinth/app

应用壳（Vite 7 + React 19 + Tailwind 4）：单编辑页（`?doc=xxx`）、主题令牌
（tokens.css + theme.ts 换肤）、启动 loading 链路、E2E 剧本（e2e/，docs/15）。

只消费 @spinth/react。开发：仓库根 `pnpm dev`（:5173）；E2E：仓库根 `pnpm test:e2e`。

品牌资产在 `public/`：`spinth-logo.png` 顶栏/加载态使用；`favicon-32.png`、
`apple-touch-icon.png` 由同源 logo 派生，分别供浏览器标签页和 iOS 主屏使用。
