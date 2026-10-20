# store/ — zustand 桥

- `spinthStore.ts`：单 store 只读镜像（SDK rxjs 输出流 → zustand）。只读镜像 + 命令分离；
  高频视口流由命令式订阅 / ref 直写消费，不全部进 React 渲染。
- `bridge.ts`：流订阅 + 拉取式聚合（ActionBar / MindAddButtons）。
- `commands.ts`：命令模块（纯转发 BoardSDK 方法，不进 store）。

设计决策记录（为什么 zustand 而非 jotai）见 docs/01 §6；UI 数据流见 docs/12 §2。
