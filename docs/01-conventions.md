# 01 — 工程约定

## 1. 包边界

| 包              | 职责                         | 禁止                   |
| --------------- | ---------------------------- | ---------------------- |
| `@spinth/core`  | SDK：数据/渲染/控件/交互     | React、zustand、DOM UI |
| `@spinth/react` | zustand 镜像 + DOM UI + 命令 | 直接 import PIXI/Yjs   |
| `@spinth/app`   | 应用壳、主题、路由、顶栏     | 越过 react 碰 core     |

包边界由 `eslint.config.js` 的 `no-restricted-imports` 强制。

## 2. 命令

```bash
pnpm dev
pnpm build
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm verify
```

`pnpm verify` 是提交前唯一入口：lint + prettier + typecheck + `pnpm -r test` + build。

## 3. 命名

- 文件：`xxxService.ts` / `xxxVm.ts` / `xxxModel.ts`
- 接口：`I` 前缀
- rx 流：`$` 后缀
- 常量：`UPPER_SNAKE`
- 魔法数字必须提为具名常量，并注明来源。

## 4. 代码风格

- TypeScript strict，含 `noUncheckedIndexedAccess`。
- 注释解释“为什么”，不复述“是什么”。
- 修改行为必须同步更新对应 docs。

## 5. 数据流铁律

1. 写操作只经过 Model → DataProcessor → Yjs。
2. 渲染层只订阅 Yjs 投影，不维护第二份业务状态。
3. 视觉预览只写 PIXI，不写 Yjs；松手必须写回。
4. 非用户写入（恢复/维护）必须带非 null origin，禁止进入 undo 栈。
