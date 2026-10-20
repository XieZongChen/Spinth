# @spinth/react

React 胶水层：zustand 只读镜像（bridge.ts 流订阅 + 拉取式聚合）+ DOM UI 组件
（components/，清单见其 README）。

不允许直接操作 PIXI/Yjs——只经 BoardSDK 的输出流与命令方法。宿主契约（语义令牌/
Tailwind 源扫描等五项）见 docs/12 §5。
