# 07 — 测试

## 1. 三层

| 层         | 位置                        | 命令            |
| ---------- | --------------------------- | --------------- |
| 纯逻辑单测 | `packages/*/src/__tests__/` | `pnpm test`     |
| 编排桩测试 | `__tests__/` 内 stub 协作者 | `pnpm test`     |
| 整机 E2E   | `packages/app/e2e/`         | `pnpm test:e2e` |

视觉快照属于 E2E 的补充层，只收颜色、粗细、主题这类数据探针测不到的行为。

## 2. 提交门槛

```bash
pnpm verify
```

必须全绿。改交互编排再跑目标 E2E；CI fast gate 排除 `@timing/@bench/@visual`，
nightly 承接时敏/性能/视觉。

## 3. E2E 约定

- 每个用例随机 docId，IndexedDB 从零开始。
- 探针优先读 `window.__spinth.__debug`，不要靠截图猜数据。
- 图片用例必须断言 `hasSprite`/像素，不允许只断言 vm 数量。
- 视觉基线固定放在 `packages/app/e2e/visual.spec.ts-snapshots/`，按平台分文件。

## 4. 当前基线

- 单机图片创建/刷新/迁移/GC 有专项用例；
- 390px 工具二级菜单有专项用例；
- server/协同 relay 不在本版本测试范围。

## 5. 回归纪律

修过一个编排 bug，必须留下对应桩测试或 E2E；不要只改代码不补护栏。
