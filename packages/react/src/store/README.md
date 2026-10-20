# store/ — zustand 桥

- `spinthStore.ts`：单 store 只读镜像（SDK rxjs 输出流 → zustand）。只读镜像 + 命令分离 + 高频字段独立 slice。
- `commands.ts`：命令模块（纯转发 BoardSDK 方法，不进 store）。

设计决策记录（为什么 zustand 而非 jotai）见 docs/01-conventions.md。
