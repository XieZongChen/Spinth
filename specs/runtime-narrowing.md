# 运行时收窄 — 技术设计与实施规格

> 状态：**已实施（S1–S7 全量落地，见 §13 实施记录）**。范围：[docs/13 §1.4](../docs/13-roadmap.md)（阶段 1 最后一项）。
> 关联：[specs/api-surface.md](api-surface.md)（类型层收口）。本文只做设计与审查，
> 实施按 §5 的步骤由实施方执行；每一处「现状」都以当前代码为准。

## 0. 一句话

把「公共面 allowlist」从类型层落到运行时：包入口只导出 `createBoard()`，返回的
实例在**枚举、读取、调用**三个层面都只含 `BOARD_PUBLIC_MEMBERS`；内部服务与调试
快照移入 DEV-only 的 `__spinthDebug`，生产构建字节级零残留，`SPINTH_E2E` 构建
只保留只读探针；E2E 从 `__spinth.__debug` 迁移到「公开面 + 调试入口」。

## 1. 目标与非目标

### 1.1 目标（逐条可验收）

| ID  | 目标                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| G1  | `@spinth/core` 包入口不再导出 `BoardSDK`；唯一构造入口是 `createBoard(): BoardPublicApi`                                       |
| G2  | 运行时投影只含 `BOARD_PUBLIC_MEMBERS` 的 65 个成员；内部字段不可枚举、不可读、不可调用；投影已 `Object.freeze`                 |
| G3  | 方法 `this` 绑定到内部实例且函数身份稳定；流/查询 getter 每次读取都委托内部实例（组装前后语义与当前逐字一致）                  |
| G4  | 调试面分离：DEV 下 `window.__spinth` = 公开投影，`window.__spinthDebug.__debug` = 内部探针；生产构建两者均不携带               |
| G5  | `SPINTH_E2E=1` 构建保留只读探针：`window.__spinth` 为公开只读子集，`window.__spinthDebug.__debug` 只有 `modelCount` 等只读字段 |
| G6  | E2E 迁移：169 处 `__spinth.__debug` 与 20 处内部字段访问改走调试入口；能用公开查询/命令的优先改公开面                          |
| G7  | 构建门禁：新增产物扫描脚本并接入 `pnpm build`；生产包出现调试面即构建失败                                                      |
| G8  | 测试与文档：运行时 allowlist、调试入口、生产 DCE、E2E 全量；docs/AGENTS 同步当前事实                                           |

### 1.2 非目标（本批明确不做）

- 不改任何交互、渲染、Yjs 写路径、数据格式、zod schema、默认值。
- 不改 `dispose()` 顺序、输出流兜底语义、ActionBar schema、快捷键闸门。
- **不把服务字段改成 `private` / `#private`**：组合根 friend 函数（`composeBoard` 等）
  以字段赋值方式装配，core 单测也以字段注入桩（`boardSdkCursorMode` / `boardSdkDispose` /
  `alignCommand`）。本批只切「宿主拿到的对象」，不切内部类的字段可见性。
- 不做公开流的只读包装（`BehaviorSubject.next` 仍可被宿主调用）——见 §11 遗留。
- 不做 E2E 全量 TypeScript 类型检查（当前 E2E 由 Playwright 转译，不跑 tsc）。
- 不引入服务端、账号、协同；不改单机离线语义。
- 不新增公开查询方法（不为了少用一次 `__debug` 而扩公共 API）。

## 2. 现状证据

### 2.1 公共面：类型层已收口，运行时仍全量

| 对象                                                                                      | 现状                                               | 问题                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| [packages/core/src/index.ts](../packages/core/src/index.ts) L9                            | `export { BoardSDK } from './app'`                 | 宿主可直接 `new BoardSDK()`，拿到全部服务字段        |
| [packages/core/src/app.ts](../packages/core/src/app.ts) L229–233                          | `get __debug()` 静态 import `boardDebug`           | 即便生产不挂 `window.__spinth`，调试快照代码仍进产物 |
| [packages/core/src/boardPublicApi.ts](../packages/core/src/boardPublicApi.ts)             | `BOARD_PUBLIC_MEMBERS` 65 项 + 三条编译锁          | 只约束类型；运行时实例仍有 39 个 internal 字段       |
| [packages/react/src/components/Board.tsx](../packages/react/src/components/Board.tsx) L35 | `new BoardSDK()`，DEV 下整实例挂 `window.__spinth` | 宿主与调试面共用一个对象，无法区分                   |
| `packages/core/src/boardHost.ts` `IBoardDebugHost`                                        | 已存在，供 `buildBoardDebugSnapshot` 使用          | 调试适配器只差一个 DEV 入口                          |

`BoardPublicApi` 当前 = 生命周期 2 + 输出流 19 + 查询 6 + 命令 38 = **65 个成员**；
内部 = 服务字段、组装态、`lastAssetMaintenance`、`syncToolOption`、`__debug` 等 **40 个**
（设计期误计 39，按代码现实修正；删 `__debug` 后 39——见 §13 实施记录）。

### 2.2 依赖面（谁能被改坏）

| 文件/区域                                 | 用法                                                                                                                                 | 本批影响                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `packages/react/src/store/bridge.ts`      | 17 条流订阅 + 4 个拉取查询；类型 `BoardPublicApi`                                                                                    | 只换实例来源，逻辑零改动                |
| `packages/react/src/store/commands.ts`    | 29 条命令薄转发；`bindBoard(BoardPublicApi)`                                                                                         | 同上                                    |
| `packages/react/src/components/Board.tsx` | `new` / `initialize` / `setTheme` / `dispose` / DEV 句柄                                                                             | 改用 `createBoard()` + 调试入口         |
| core 单测                                 | 5 处 `new BoardSDK()`；3 个文件给服务字段塞桩                                                                                        | 继续走内部模块 `../app`，不改断言       |
| E2E                                       | **169 处** `__spinth.__debug`，**20 处**内部字段（`engine` 9 / `viewport` 5 / `assetStore` 2 / `lastAssetMaintenance` 4），50 个文件 | 路径迁移；少量改公开查询/命令           |
| 生产 E2E 探针                             | [packages/app/src/e2eProbe.ts](../packages/app/src/e2eProbe.ts) 在 `SPINTH_E2E=1` + `?e2e=1` 挂只读镜像                              | 形状对齐到 `__spinth` + `__spinthDebug` |

### 2.3 构建事实

- workspace 内 `@spinth/core` 以 **TS 源码**被 Vite 直接编译（`packages/app/vite.config.ts`
  alias 到 `../core/src/index.ts`），core 没有独立产物；因此「生产剥离」只能靠
  app 构建期的常量折叠 + DCE，并由产物扫描兜底。
- 现有 `import.meta.env.DEV` 分支已证明可被完全删除（`specs/pwa.md` §17.4 记录
  `__spinth` 在生产包 0 处）；本批把同一机制用于 `@spinth/core/dev` 动态入口。
- `__E2E_PROBE__` 已存在（`packages/app/vite.config.ts` L71，仅 `SPINTH_E2E=1` 为 true），
  生产 E2E 只读探针的构建期门控无需新开关。

## 3. 目标架构

### 3.1 运行时形状

```text
宿主 UI（react bridge / commands / app 壳）
        │  只能拿到 BoardPublicApi
        ▼
   createBoard() ── 投影（65 个 getter / 绑定方法，Object.freeze）
        │
        │  WeakMap<BoardPublicApi, BoardSDK>（仅 core 内部可查）
        ▼
   BoardSDK（内部类，不导出）── 服务字段 / 组合根 / Yjs / PIXI

DEV（仅 import.meta.env.DEV 分支）
   window.__spinth       = BoardPublicApi 投影
   window.__spinthDebug  = { __debug: 快照 + 四个不可枚举逃生口 }

生产（普通构建）        ：两个全局都不存在，调试模块不进产物
生产（SPINTH_E2E=1）    ：window.__spinth 只读子集 + window.__spinthDebug.__debug 只读字段
```

### 3.2 文件布局

| 文件                                                 | 状态 | 职责                                                               |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| `packages/core/src/boardPublicApi.ts`                | 改   | `BoardPublicApi = Readonly<Pick<…>>`；新增 `projectBoardPublicApi` |
| `packages/core/src/createBoard.ts`                   | 新增 | 唯一公开构造入口：new 内部类 → 投影 → 注册 runtime                 |
| `packages/core/src/boardRuntime.ts`                  | 新增 | `WeakMap` 内部实例注册表；不导出到包入口                           |
| `packages/core/src/boardDevTools.ts`                 | 新增 | 调试 API 构造 / `window.__spinthDebug` 挂载与卸载；带入口标记      |
| `packages/core/src/dev.ts`                           | 新增 | `@spinth/core/dev` 子路径入口；只 re-export 调试工具               |
| `packages/core/src/index.ts`                         | 改   | 删 `BoardSDK` 导出；加 `createBoard`；更新公共面注释               |
| `packages/core/src/app.ts`                           | 改   | 删 `__debug` getter 与 `boardDebug` import                         |
| `packages/core/src/boardDebug.ts`                    | 改   | 注释改为「DEV 调试入口的适配器」；形状不变                         |
| `packages/core/src/debugSnapshot.ts`                 | 改   | 只改过时注释；聚合逻辑零改动                                       |
| `packages/core/src/boardHost.ts`                     | 改   | 只改注释（`IBoardDebugHost` 契约保留）                             |
| `packages/react/src/components/Board.tsx`            | 改   | `createBoard()`；DEV 动态挂公开/调试两个句柄                       |
| `packages/core/package.json`                         | 改   | `exports` 增加 `"./dev"`                                           |
| `packages/app/vite.config.ts`                        | 改   | 精确 alias `@spinth/core/dev`（regex，先于根 alias）               |
| `packages/app/src/e2eProbe.ts`                       | 改   | 只读探针拆成公开子集 + `__spinthDebug.__debug`                     |
| `packages/app/package.json`                          | 改   | `build` 末尾接产物扫描                                             |
| `scripts/check-debug-bundle.mjs`                     | 新增 | 产物扫描：生产零调试面、E2E 构建有只读探针                         |
| `packages/core/src/__tests__/boardPublicApi.test.ts` | 改   | 增加投影/冻结/绑定/活 getter 用例                                  |
| `packages/core/src/__tests__/boardRuntime.test.ts`   | 新增 | 注册/查找/未注册错误                                               |
| `packages/core/src/__tests__/boardDevTools.test.ts`  | 新增 | 调试 API 形状、挂载/卸载、标记                                     |
| `packages/app/e2e/helpers/debugE2e.ts`               | 新增 | E2E 统一读取 `__spinthDebug.__debug`                               |
| `packages/app/e2e/debugSurface.spec.ts`              | 新增 | 运行时 allowlist / 调试面 E2E                                      |
| `packages/app/e2e/pwa.spec.ts`                       | 改   | 增加「正常流量零探针」P7                                           |
| `packages/app/e2e/**`                                | 改   | 50 个文件的探针路径迁移                                            |

### 3.3 运行时投影（`boardPublicApi.ts`）

```ts
import type { BoardSDK } from './app';

export const BOARD_PUBLIC_MEMBERS = [
  /* 现有 65 项，一个字符都不改 */
] as const satisfies readonly (keyof BoardSDK)[];

export type BoardPublicMember = (typeof BOARD_PUBLIC_MEMBERS)[number];
export type BoardPublicApi = Readonly<Pick<BoardSDK, BoardPublicMember>>;

/**
 * 运行时 allowlist：只把 BOARD_PUBLIC_MEMBERS 定义到投影上。
 * - 方法：首次读取时 bind(source)，缓存函数身份；宿主拿不到未绑定 this。
 * - 流/查询 getter：每次读取都 Reflect.get(source)，保证组装前后切换真实流。
 * - 未知键不进投影；Object.freeze 后不可新增/删除/改写。
 */
export function projectBoardPublicApi(source: BoardPublicApi): BoardPublicApi {
  const api: Record<string, unknown> = {};
  const bound = new Map<string, (...args: unknown[]) => unknown>();

  for (const key of BOARD_PUBLIC_MEMBERS) {
    if (!(key in source)) {
      throw new Error(`BOARD_PUBLIC_MEMBER_MISSING: ${key}`);
    }
    Object.defineProperty(api, key, {
      enumerable: true,
      configurable: false,
      get() {
        const value = Reflect.get(source as object, key);
        if (typeof value !== 'function') return value;
        let fn = bound.get(key);
        if (!fn) {
          fn = value.bind(source) as (...args: unknown[]) => unknown;
          bound.set(key, fn);
        }
        return fn;
      },
    });
  }
  return Object.freeze(api) as unknown as BoardPublicApi;
}
```

**为什么不用 Proxy**：Proxy 的 `ownKeys` / `getOwnPropertyDescriptor` / `preventExtensions`
在 `Object.freeze` 与对象展开下有不变式陷阱；投影对象是普通对象，`Object.keys` /
`in` / `Reflect.ownKeys` 的行为可直接断言，调试与 devtools 也更直观。

**为什么不用 `#private`**：内部装配是 friend 函数 + 字段赋值（`composeBoard` / `assembleCore`
等），`#private` 会让 30+ 个装配点与 5 个桩测同时失配；本批目标是「宿主拿到的对象」，
不是内部类的封装等级。

### 3.4 工厂与内部注册表

```ts
// createBoard.ts
import { BoardSDK } from './app';
import { projectBoardPublicApi, type BoardPublicApi } from './boardPublicApi';
import { registerBoardRuntime } from './boardRuntime';

/** 唯一公开构造入口（0.0.1 阶段无兼容包袱；1.0 起为稳定 API） */
export function createBoard(): BoardPublicApi {
  const sdk = new BoardSDK();
  const board = projectBoardPublicApi(sdk);
  registerBoardRuntime(board, sdk);
  return board;
}
```

```ts
// boardRuntime.ts —— 不导出到 index.ts
import type { BoardSDK } from './app';
import type { BoardPublicApi } from './boardPublicApi';

const runtimes = new WeakMap<BoardPublicApi, BoardSDK>();

export function registerBoardRuntime(board: BoardPublicApi, sdk: BoardSDK): void {
  runtimes.set(board, sdk);
}

export function getBoardRuntime(board: BoardPublicApi): BoardSDK | undefined {
  return runtimes.get(board);
}
```

- WeakMap 以投影对象为键：不在投影上留 symbol/隐藏属性（`Reflect.ownKeys` 也看不到），
  投影被回收后条目随之释放；多实例（StrictMode 双挂载、测试多画布）天然隔离。
- `index.ts` 只 re-export `createBoard`；`BoardSDK` 仍可从 `src/app.ts` 内部导入给
  core 单测与组合根，但包入口不再提供。

### 3.5 调试入口

```ts
// boardDevTools.ts
import type { BoardSDK } from './app';
import type { BoardPublicApi } from './boardPublicApi';
import { getBoardRuntime } from './boardRuntime';
import { buildBoardDebugSnapshot } from './boardDebug';

/** 产物扫描标记：只出现在 DEV 调试入口，生产/E2E 构建都必须为 0 */
export const BOARD_DEBUG_ENTRY = Symbol.for('spinth:core-dev-debug');

export type BoardDebugSnapshot = ReturnType<typeof buildBoardDebugSnapshot>;

/** 四类逃生口：只挂在 __debug 上，且不可枚举（Object.keys / JSON.stringify 不可见） */
export interface IBoardDebugEscapes {
  readonly engine: BoardSDK['engine'];
  readonly viewport: BoardSDK['viewport'];
  readonly assetStore: BoardSDK['assetStore'];
  readonly lastAssetMaintenance: BoardSDK['lastAssetMaintenance'];
}

export type BoardDebugBag = BoardDebugSnapshot & IBoardDebugEscapes;

export interface IBoardDebugApi {
  readonly __debug: BoardDebugBag;
}

function buildBoardDebugBag(sdk: BoardSDK): BoardDebugBag {
  const bag = buildBoardDebugSnapshot(sdk) as unknown as BoardDebugBag;
  Object.defineProperties(bag, {
    engine: { get: () => sdk.engine, enumerable: false, configurable: true },
    viewport: { get: () => sdk.viewport, enumerable: false, configurable: true },
    assetStore: { get: () => sdk.assetStore, enumerable: false, configurable: true },
    lastAssetMaintenance: {
      get: () => sdk.lastAssetMaintenance,
      enumerable: false,
      configurable: true,
    },
  });
  return bag;
}

export function createBoardDebugApi(board: BoardPublicApi): IBoardDebugApi {
  const sdk = getBoardRuntime(board);
  if (!sdk) {
    throw new Error('BOARD_DEBUG_RUNTIME_NOT_FOUND: 该实例不是 createBoard() 创建的');
  }
  const api: IBoardDebugApi = {
    get __debug() {
      return buildBoardDebugBag(sdk);
    },
  };
  Object.defineProperty(api, BOARD_DEBUG_ENTRY, { value: true });
  return api;
}

export function attachBoardDebug(board: BoardPublicApi, target: object): () => void {
  const api = createBoardDebugApi(board);
  const slot = target as { __spinthDebug?: IBoardDebugApi };
  slot.__spinthDebug = api;
  return () => {
    if (slot.__spinthDebug === api) delete slot.__spinthDebug;
  };
}
```

```ts
// dev.ts（包入口 @spinth/core/dev，不是公共 API）
export { attachBoardDebug, createBoardDebugApi } from './boardDevTools';
export type {
  BoardDebugBag,
  BoardDebugSnapshot,
  IBoardDebugApi,
  IBoardDebugEscapes,
} from './boardDevTools';
```

**调试面收敛在 `__spinthDebug.__debug` 一个对象上**：快照字段照旧，额外四个逃生口
（`engine` / `viewport` / `assetStore` / `lastAssetMaintenance`）以**不可枚举 getter**
挂在同一对象上——E2E 可读，但 `Object.keys` / `JSON.stringify` 仍只看到原快照字段。不新增 E2E 专用
getter；确需新增时先改本表与 E2E helper，不允许直接暴露任意服务。

`Object.defineProperty(api, BOARD_DEBUG_ENTRY, …)` 让入口标记不可枚举；产物扫描只认这个
字符串，因此 `SPINTH_E2E` 构建里同样存在的 `__spinthDebug` 不会误报「core 调试入口被打包」。

### 3.6 宿主接线（`Board.tsx`）

```tsx
import { createBoard, type BoardPublicApi, type IBoardConfig } from '@spinth/core';

const boardRef = useRef<BoardPublicApi | null>(null);

useEffect(() => {
  // …existing AbortController / StrictMode 防御
  const controller = new AbortController();
  let disconnect: (() => void) | undefined;
  let detachDebug: (() => void) | undefined;
  let cleanedUp = false;

  const board = createBoard();
  boardRef.current = board;
  const ready = board.initialize(config, el, controller.signal);
  if (theme) board.setTheme(theme);

  void ready
    .then(async () => {
      if (controller.signal.aborted) {
        board.dispose();
        return;
      }
      bindBoard(board);
      disconnect = connectBoard(board);
      // …canvas aria-hidden / 现有逻辑

      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
        // 先等调试入口就绪，再同时曝光 __spinth 与 __spinthDebug：
        // E2E 的 waitForSynced 只等 __spinth，不能让它看到「有公开面、没调试面」的中间态。
        try {
          const { attachBoardDebug } = await import('@spinth/core/dev');
          if (controller.signal.aborted || cleanedUp) return;
          detachDebug = attachBoardDebug(board, window);
          (window as unknown as Record<string, unknown>).__spinth = board;
        } catch (err) {
          // 调试入口加载失败不阻塞画布（生产没有这段；DEV 下让 E2E 明确红）
          console.warn('[spinth] 调试探针加载失败', err);
        }
      }
      onReady?.();
    })
    .catch((err) => {
      // …existing AbortError / initError 分支不变
    });

  return () => {
    cleanedUp = true;
    controller.abort();
    disconnect?.();
    detachDebug?.();
    unbindBoard();
    // 句柄清理收进 DEV 常量分支（S6 修正）：裸的读/删 window.__spinth 会让
    // 生产产物残留 __spinth 字符串，四标记清零断言不成立（§13 实施记录）
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      if ((window as unknown as { __spinth?: unknown }).__spinth === board) {
        delete (window as unknown as { __spinth?: unknown }).__spinth;
      }
    }
    if (boardRef.current === board) boardRef.current = null;
    void ready.then(
      () => board.dispose(),
      () => board.dispose(),
    );
  };
}, []);
```

要点：

- **原子曝光**：`__spinth` 与 `__spinthDebug` 在同一个同步块内挂载；动态 import 失败时
  不挂 `__spinth`（E2E 会明确失败，而不是拿到半个探针）。
- **StrictMode**：`cleanedUp` + `controller.signal.aborted` 双闸；清理时按身份删除
  `__spinth`，不误删第二次挂载的实例；`detachDebug` 内部也按对象身份判断。
- **生产**：`import.meta.env.DEV` 为 false 的构建里整个分支（含动态 import）被删除；
  不改变 `onReady` 时序（生产没有额外 await）。
- `theme` 注入仍用 `boardRef.current?.setTheme(theme)`；投影的 `setTheme` 已绑定内部实例。

### 3.7 生产 E2E 只读探针（`e2eProbe.ts`）

```ts
export function attachE2eProbe(): void {
  if (!__E2E_PROBE__) return;
  if (attached) return;
  if (new URLSearchParams(window.location.search).get('e2e') !== '1') return;
  attached = true;

  const write = (): void => {
    (window as unknown as Record<string, unknown>).__spinth = {
      docState$: { getValue: () => useSpinthStore.getState().docState },
      persistState$: { getValue: () => useSpinthStore.getState().persistState },
      get modelCount() {
        return useSpinthStore.getState().modelCount;
      },
    };
    (window as unknown as Record<string, unknown>).__spinthDebug = {
      __debug: {
        get modelCount() {
          return useSpinthStore.getState().modelCount;
        },
      },
    };
  };
  write();
  useSpinthStore.subscribe(write);
}
```

- `__spinth` 只镜像公开面字段（`docState$` / `persistState$` / `modelCount`），可写面为零；
  不暴露 `engine`、`viewport`、`assetStore`、`lastAssetMaintenance`。
- `__spinthDebug.__debug` 只有 `modelCount`；PWA 的 `ready()` / `modelCount()` 继续工作。
- 该探针仍由 `__E2E_PROBE__`（构建期）+ `?e2e=1`（运行期）双门控；正常流量零暴露。

### 3.8 E2E 迁移映射

| 旧路径                          | 新路径                                       | 数量 | 备注                                                                           |
| ------------------------------- | -------------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| `__spinth.__debug`              | `__spinthDebug.__debug`                      | 169  | 机械替换；快照字段一个不改                                                     |
| `__spinth.engine`               | `__spinthDebug.__debug.engine`               | 9    | 其中 3 处 `persistState$`：2 处 `getValue` 改公开，1 处 `next` 留调试入口      |
| `__spinth.viewport`             | `__spinthDebug.__debug.viewport`             | 5    | `viewportInstance.toScreen` 改公开 `toScreenPoint({x,y})`；`center` 留调试入口 |
| `__spinth.assetStore`           | `__spinthDebug.__debug.assetStore`           | 2    | 读租约计数 / 注入 `put` 失败                                                   |
| `__spinth.lastAssetMaintenance` | `__spinthDebug.__debug.lastAssetMaintenance` | 4    | 启动资产维护统计                                                               |

非 `__debug` 内部字段的文件分布（169 处 `__spinth.__debug` 不在此表重复）。
下表为**设计期快照**（当时统计 20 处）；实施时另发现 4 类漏计共 9 处（bench
`engine!`、a11yKeyboard `selector.selected$`、imageLifecycle ×2、`worldToClient` ×3
等），实改合计 29 处，逐条见 §13 实施记录：

| 文件                            | 旧访问                                    | 数量   | 迁移                                            |
| ------------------------------- | ----------------------------------------- | ------ | ----------------------------------------------- |
| `e2e/imageAsset.spec.ts`        | `engine.transact/add/genInitialOrder`     | 3      | `__spinthDebug.__debug.engine`                  |
| 同上                            | `assetStore.objectUrlRefs/objectUrls`     | 1      | `__spinthDebug.__debug.assetStore`              |
| 同上                            | `lastAssetMaintenance`                    | 3      | `__spinthDebug.__debug.lastAssetMaintenance`    |
| `e2e/projectFile.spec.ts`       | `assetStore.put` 注入失败                 | 1      | `__spinthDebug.__debug.assetStore`              |
| `e2e/storage.spec.ts`           | `engine.persistState$.next('failed')`     | 1      | `__spinthDebug.__debug.engine`                  |
| `e2e/smoke.spec.ts`             | `engine.wsProvider`                       | 1      | `__spinthDebug.__debug.engine`                  |
| `e2e/rotateAnchor.spec.ts`      | `engine.yWidgets/getModelById`            | 1      | `__spinthDebug.__debug.engine`                  |
| `e2e/helpers/projectFileE2e.ts` | `engine.yWidgets`；`engine.persistState$` | 2      | 前者调试入口；后者公开 `__spinth.persistState$` |
| `e2e/helpers/imageProbeE2e.ts`  | `engine.persistState$`                    | 1      | 公开 `__spinth.persistState$`                   |
| `e2e/shortcuts.spec.ts`         | `viewport.viewportInstance.center`        | 2      | `__spinthDebug.__debug.viewport`                |
| `e2e/multiTabReadonly.spec.ts`  | `viewport.viewportInstance.center`        | 1      | `__spinthDebug.__debug.viewport`                |
| 同上                            | `lastAssetMaintenance`                    | 1      | `__spinthDebug.__debug.lastAssetMaintenance`    |
| `e2e/visual.spec.ts`            | `viewport.viewportInstance.toScreen`      | 2      | 公开 `__spinth.toScreenPoint({x,y})`            |
| **合计**                        |                                           | **20** |                                                 |

迁移纪律：

1. 先做纯路径替换（`__spinth.__debug` → `__spinthDebug.__debug`），**不改断言、不改等待**。
2. 再逐条处理 20 处内部字段：能换公开查询/命令的换（`toScreen` / `persistState$`），
   不能换的走调试入口。
3. 同一个 `page.evaluate` 里同时读公开面与调试面时，拆成两个类型断言，避免
   `__spinth` 类型里残留 `__debug`/服务字段。
4. 新增 `packages/app/e2e/helpers/debugE2e.ts`：
   ```ts
   export function debugOf<T>(page: Page): Promise<T | null> {
     return page.evaluate(() => {
       const w = window as unknown as { __spinthDebug?: { __debug?: unknown } };
       return (w.__spinthDebug?.__debug as T | undefined) ?? null;
     });
   }
   ```
   新用例优先用它；存量 169 处不强制抽 helper（避免为迁移而迁移）。
   它只回快照字段；四个逃生口是不可枚举 getter，必须在 `page.evaluate` 内直接读
   `__spinthDebug.__debug.<name>` 并只返回标量，不要整包返回（序列化不保证带上不可枚举属性）。
5. 迁移后用 grep 验收：
   `grep -rn "__spinth\.\(__debug\|engine\|viewport\|assetStore\|lastAssetMaintenance\)" packages/app/e2e` 必须 0 行。

### 3.9 构建期 DCE 与产物扫描

`packages/app/vite.config.ts`：

```ts
resolve: {
  alias: [
    // 必须精确且先于根 alias：字符串 alias 会把 @spinth/core/dev 前缀匹配到 index.ts
    { find: /^@spinth\/core\/dev$/, replacement: fileURLToPath(new URL('../core/src/dev.ts', import.meta.url)) },
    { find: /^@spinth\/core$/, replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
    // react 原样
  ],
},
optimizeDeps: {
  exclude: ['@spinth/core', '@spinth/core/dev'],
},
```

`packages/core/package.json`：

```json
"exports": {
  ".": "./src/index.ts",
  "./dev": {
    "types": "./src/dev.ts",
    "default": "./src/dev.ts"
  }
}
```

`scripts/check-debug-bundle.mjs`（新增，纯 Node，不 import TS）：

- 输入：`dist` 目录（默认 `packages/app/dist`）；遍历全部 `.js`（含 `assets/*.js` 与 `sw.js`）。
- 判定：
  - 普通构建（`SPINTH_E2E !== '1'`）：`__spinth`、`__spinthDebug`、`__debug`、
    `spinth:core-dev-debug` 均必须 0 处；`__spinth` 用 `__spinth(?!Debug)` 计数，
    避免把 `__spinthDebug` 误算成 DEV 句柄。
  - `SPINTH_E2E=1` 构建：`__spinth`、`__spinthDebug`、`__debug` 必须存在
    （只读探针在位）；`spinth:core-dev-debug` 必须 0 处。
- 失败退出码 1，并打印命中的文件与计数；缺失 `dist` 也失败。
- 脚本头写 `/* global process, console */`（与 `scripts/check-pages-build.mjs` 一致），
  否则 ESLint 的 `no-undef` 会让 `pnpm verify` 红。
- 接入 `packages/app/package.json` 的 `build` 末尾：
  `node ../../scripts/check-debug-bundle.mjs dist`。这样 `pnpm verify` 的 `pnpm build`
  与 PWA 的 `SPINTH_E2E=1 … build` 都会自动跑。

> 注意：E2E 构建里 `__spinthDebug` 是**只读探针**（§3.7），不是 core 调试入口；
> 用 `spinth:core-dev-debug` 这个独立标记区分，不能拿 `__spinthDebug` 当唯一判据。

## 4. 契约细节

### 4.1 公共成员（65）

沿用 [boardPublicApi.ts](../packages/core/src/boardPublicApi.ts) 现有表：生命周期 2、
输出流 19、查询 6、命令 38。一个不增、一个不减；`BoardPublicApi` 改为
`Readonly<Pick<…>>`，运行时 `Object.freeze` 与之对齐。

### 4.2 内部成员

`BoardInternalMember` 删除 `'__debug'`（成员已从类上移除）；其余 39 项保留
（原始名单实为 40 项，见 §13 实施记录）。
删除是强制的：三条编译锁里的 `_BoardKeysExist` 会因为名单里有不存在的成员而让
`tsc` 红——这是本批的「成员删除也会被锁住」护栏。

### 4.3 边界与错误

| 场景                                         | 行为                                                                |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `createBoard()`                              | 不抛错；返回已冻结投影（未初始化，服务字段为 null）                 |
| `initialize()`                               | 沿用内部类；投影方法已绑定，重复 initialize 语义不变                |
| `dispose()`                                  | 投影方法委托内部 `disposeBoard`；幂等语义不变                       |
| 投影读取未初始化服务                         | 流 getter 返回 `BoardOutputs` 的 fallback（与当前一致）             |
| 投影写入/删除                                | 冻结对象 + ESM 严格模式 → `TypeError`；`Object.keys` 不出现内部字段 |
| `attachBoardDebug` 传非 `createBoard()` 实例 | 抛 `BOARD_DEBUG_RUNTIME_NOT_FOUND`（DEV 明确暴露接线错误）          |
| `attachBoardDebug` 返回的 detach             | 只删除自己挂的实例；不误删另一个 board 的 `__spinthDebug`           |
| StrictMode 双挂载                            | 首个实例 abort 后不曝光；清理按对象身份删除；第二个实例正常         |
| 未初始化即 `__debug`                         | 返回零值快照（modelCount 0 / vmStates [] 等），不抛错               |

### 4.4 类型约束

- 新增类型导入一律 `import type`（`verbatimModuleSyntax`）。
- `projectBoardPublicApi` 的参数类型用 `BoardPublicApi` 而不是 `BoardSDK`，让
  `boardPublicApi.ts` 不产生对 `app.ts` 的值依赖；`BoardSDK` 结构上满足该类型。
- `BoardPublicApi` 的 `Readonly` 只影响类型；运行时冻结由投影保证。
- 调试 API 类型只从 `@spinth/core/dev` 导出，不进 `BoardPublicApi`、不进 `index.ts`。
- `BOARD_DEBUG_ENTRY` 是 `symbol`，不是公共枚举；E2E 不依赖它，只有构建脚本认字符串。

## 5. 实施步骤

> 原则：S1–S4 每步独立提交、独立可回退，`pnpm verify` 全绿；**S5 必须是一个原子提交**
> ——公开面切换、`__debug` 移除、E2E 全量迁移彼此耦合，拆开会出现中间红。

### S0 — 本文（设计与审查）

产出：`specs/runtime-narrowing.md`。不改代码。

### S1 — 运行时投影（不影响宿主）

- 改 `boardPublicApi.ts`：`BoardPublicApi = Readonly<Pick<…>>` + `projectBoardPublicApi`。
- 扩展 `__tests__/boardPublicApi.test.ts`：枚举/不可读/不可写/冻结/方法绑定/活 getter/
  缺成员报错。
- 此时 `index.ts` 仍导出 `BoardSDK`，`Board.tsx` 不变。
- 门禁：`pnpm --filter @spinth/core test`、`pnpm typecheck`、`pnpm lint`。
- 回退：单文件 revert。

### S2 — 工厂 + 内部注册表

- 新增 `createBoard.ts` / `boardRuntime.ts`；`index.ts` 增加 `export { createBoard }`，
  **暂时保留** `export { BoardSDK }`（宿主未切换）。
- 新增 `__tests__/boardRuntime.test.ts`：注册后可查、未注册 undefined、不同 board 隔离。
- 门禁：`pnpm verify`。
- 回退：删两个新文件 + 回退 index 一行。

### S3 — 调试入口（先不接线）

- 新增 `boardDevTools.ts` / `dev.ts`；`package.json` 加 `"./dev"`；Vite alias 精确化。
- 新增 `__tests__/boardDevTools.test.ts`：快照零值、`engine/viewport/assetStore/lastAssetMaintenance`
  读内部实例、挂载/卸载、未注册 board 抛错、标记存在。
- 此时 `app.ts` 的 `__debug` getter 还在；调试入口与旧探针并存，不挂任何全局。
- 门禁：`pnpm verify`。
- 回退：删新增文件 + 回退 package/vite/alias。

### S4 — 产物扫描脚本（宽松版）

- 新增 `scripts/check-debug-bundle.mjs`，只断言 `spinth:core-dev-debug` 不出现 +
  `SPINTH_E2E` 构建有 `__spinth`；暂不断言普通构建的 `__debug`（旧 getter 还在）。
- 接入 app build。
- 门禁：`pnpm build`；手工构造负向产物验证脚本会红。
- 回退：移除 build 命令尾缀 + 删脚本。

### S5 — 原子翻转（本批核心提交）

一次性完成：

1. `index.ts`：删 `BoardSDK` 导出，保留/新增 `createBoard`。
2. `app.ts`：删 `__debug` getter 与 `boardDebug` import；字段区注释改为「组合根 friend 函数与桩测依赖可写性」，不再提 DEV 句柄。
3. `boardPublicApi.ts`：`BoardInternalMember` 删 `'__debug'`；文件头从「仅类型层收窄」改为「类型 + 运行时投影」。
4. `Board.tsx`：`createBoard()` + DEV 动态挂 `__spinth`/`__spinthDebug`（§3.6）。
5. `e2eProbe.ts`：只读探针拆成公开子集 + `__spinthDebug.__debug`（§3.7）。
6. E2E 50 个文件：169 处 `__debug` + 20 处内部字段迁移（§3.8）；能换公开查询/命令的先换。
7. 新增 `debugSurface.spec.ts` 与 `helpers/debugE2e.ts`。
8. `pwa.spec.ts` 增加 P7（无 `?e2e=1` 时零探针）。

门禁：`pnpm verify` + **全量** `pnpm test:e2e`（主配置 + pwa 配置）+
`pnpm test:coverage`。回退：整体 revert 本提交；S1–S4 不受影响。

### S6 — 收紧产物扫描

- 普通构建增加断言：`__spinth` / `__spinthDebug` / `__debug` 均 0 处。
- E2E 构建保持：`__spinth` + `__spinthDebug` + `__debug` 存在、`spinth:core-dev-debug` 为 0。
- 负向验证：临时把 `__spinthDebug` 挂到生产可达路径 → 构建红；恢复。
- 门禁：`pnpm verify`；`SPINTH_E2E=1 pnpm --filter @spinth/app build` 通过。

### S7 — 文档与数字

按 §10 清单更新 docs/AGENTS；复跑单测/E2E 后写**实测**数字；不写日期/哈希/叙事。

## 6. 测试计划

### 6.1 core 单测

| 文件                     | 用例                 | 断言                                                                                                                     |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `boardPublicApi.test.ts` | 投影键集 = allowlist | `Object.keys(api).sort()` 与 `[...BOARD_PUBLIC_MEMBERS].sort()` 全等；65 项                                              |
| 同上                     | 内部字段不可枚举     | `Object.keys` / `Reflect.ownKeys` 不含 `viewport` `engine` `__debug` `initialized` `registry` `syncToolOption`           |
| 同上                     | 内部字段不可读       | `api.viewport === undefined`；`'viewport' in api === false`；`Object.getOwnPropertyDescriptor(api,'viewport')` undefined |
| 同上                     | 不可调用             | 把 `api.viewport` 当函数调用会 `TypeError`（值为 undefined）                                                             |
| 同上                     | 冻结                 | `Object.isFrozen(api)`；赋值/删除抛 `TypeError`                                                                          |
| 同上                     | 方法绑定             | `api.undo()` 的 `this` 是内部 sdk；`api.undo === api.undo`（缓存身份）                                                   |
| 同上                     | 活 getter            | 投影后替换 `sdk.viewport.vpScale$`，`api.vpScale$` 读到新流（不是构造时快照）                                            |
| 同上                     | 缺成员报错           | 用不完整桩调 `projectBoardPublicApi` → `BOARD_PUBLIC_MEMBER_MISSING`                                                     |
| `boardRuntime.test.ts`   | 注册/查找            | `createBoard()` 后 `getBoardRuntime(board)` 是内部实例；普通对象 undefined；两个 board 互不串                            |
| `boardDevTools.test.ts`  | 零值快照             | 未初始化 board 的 `__debug`：modelCount 0、vmStates []、canvasCount 0、defaultShapeType 'rect'                           |
| 同上                     | 四类逃生口           | 给 sdk 塞 `engine/assetStore/lastAssetMaintenance` 后，`api.__debug.engine` 等读到同一引用                               |
| 同上                     | 单一入口             | `Object.keys(api)` 只有 `['__debug']`；`Object.keys(api.__debug)` 不含四个逃生口（不可枚举）                             |
| 同上                     | 挂载/卸载            | `attachBoardDebug(board, {})` 后 `target.__spinthDebug` 在位；detach 后 `delete`；不误删他 board                         |
| 同上                     | 未注册               | `attachBoardDebug({} as BoardPublicApi, {})` → `BOARD_DEBUG_RUNTIME_NOT_FOUND`                                           |
| 同上                     | 标记                 | `Object.getOwnPropertyDescriptor(api, BOARD_DEBUG_ENTRY)?.value === true`                                                |

### 6.2 E2E

| 文件/用例                       | 断言                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debugSurface.spec.ts` · 公共面 | `Object.keys(__spinth)` 长度 65、`Object.isFrozen` true、`viewport/engine/__debug/initialized` 均 `undefined`、赋值不生效（严格模式抛 `TypeError`） |
| 同上 · 方法                     | `typeof __spinth.undo === 'function'`；`__spinth.undo === __spinth.undo`；`__spinth.setCursorMode('shape')` 后 `cursorMode$` 变化                   |
| 同上 · 调试面                   | `__spinthDebug.__debug.modelCount` 是 number；`__spinthDebug.__debug.engine` 在初始化后非 null；`__spinthDebug.__debug.assetStore` 非 null          |
| `pwa.spec.ts` P7                | 无 `?e2e=1` 时 `window.__spinth` 与 `window.__spinthDebug` 均 undefined；画布仍可编辑                                                               |
| 存量 45 spec                    | 全量绿；用例数不下降（新增 = 46 spec / 约 222 例，以实跑为准）                                                                                      |

### 6.3 构建/产物

| 检查         | 命令                                                                | 期望                                                                                   |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 普通生产构建 | `pnpm build`                                                        | `check-debug-bundle` 通过；dist 中 `__spinth` / `__spinthDebug` / `__debug` / 标记均 0 |
| E2E 构建     | `SPINTH_E2E=1 SPINTH_BASE=/spinth/ pnpm --filter @spinth/app build` | `__spinth`、`__spinthDebug`、`__debug` 存在；`spinth:core-dev-debug` 0                 |
| 负向         | 临时在生产可达代码挂 `__spinthDebug`                                | 构建退出 1，打印命中文件                                                               |
| 子路径       | `node scripts/check-pages-build.mjs packages/app/dist /spinth/`     | 现有六断言仍过                                                                         |

### 6.4 手工验收（DEV console）

1. `Object.keys(window.__spinth).length === 65`；`'viewport' in window.__spinth === false`。
2. `window.__spinth.__debug === undefined`；`window.__spinthDebug.__debug.modelCount` 可读。
3. `Object.isFrozen(window.__spinth) === true`；赋值 `window.__spinth.viewport = null` 抛错。
4. 选中一个元素、拖动、撤销：行为与迁移前一致；ActionBar 跟随正常。
5. 刷新页面（StrictMode）：没有残留的旧 `__spinth`（第二个实例的句柄可读）。
6. 生产 preview（无 `?e2e=1`）：两个全局都 undefined；画布可编辑。

## 7. 验收门禁（DoD）

```bash
pnpm verify
pnpm test:coverage
pnpm test:e2e

# 公共面/调试面源码检查
grep -rn "export { BoardSDK }" packages/core/src/index.ts            # 0
grep -rn "get __debug" packages/core/src/app.ts                      # 0
grep -rn "__spinth\.\(__debug\|engine\|viewport\|assetStore\|lastAssetMaintenance\)" packages/app/e2e  # 0
grep -rn "@spinth/core/dev" packages/react/src packages/app/src                              # react 侧仅 Board.tsx；app 侧 0
```

数字门禁（实施后按实测更新，不预写）：

- 单测总数不下降；coverage 阈值 66/58/68/57 不破。
- E2E 45 spec / 218 例全绿；新增后 46 spec / 约 222 例。
- `packages/app/dist` 普通构建：四个调试标记 0 处。

## 8. 风险与对策

| 风险                                                 | 触发点 | 对策                                                                                                                                  |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 动态 import 未被 DCE，生产仍带 dev chunk             | S5/S6  | `import.meta.env.DEV` 分支 + 产物扫描；若 Rollup 保留 chunk，改为 Vite 插件在 prod 把 `@spinth/core/dev` 解析为空模块（仍以扫描为准） |
| `@spinth/core/dev` alias 被根 alias 前缀误匹配       | S3     | regex 精确 alias + `optimizeDeps.exclude`；dev server 与 build 双验证                                                                 |
| E2E 迁移改错语义                                     | S5     | 只做路径替换；公开化只限 `toScreen`/`persistState$`；全量 E2E + 逐文件 diff 审查                                                      |
| 调试句柄曝光竞态（有 `__spinth` 没 `__spinthDebug`） | S5     | 先 await 调试入口，再同一同步块挂两个全局；E2E `waitForSynced` 只等 `__spinth` 也安全                                                 |
| StrictMode 清理误删新实例句柄                        | S5     | 清理按对象身份判断；`cleanedUp` 阻止迟到的 attach                                                                                     |
| 冻结投影破坏宿主/测试的隐式写入                      | S1/S5  | 宿主只读；若有写入点，先查是否绕过 Yjs（铁律 3），不允许改为可写                                                                      |
| `Readonly<Pick>` 引起 react 类型噪声                 | S1     | 先跑三包 typecheck；仅当 `ReturnType`/赋值处不兼容时回退为普通 `Pick`（运行时冻结不受影响）                                           |
| WeakMap 被误认为隐藏全局单例                         | S2     | 以 board 为键、随 GC 释放；不导出到 index；仅在 dev 入口读取                                                                          |
| `__debug` 从类上删除导致编译锁误报                   | S5     | 同步删 `BoardInternalMember` 的 `'__debug'`；`_BoardKeysExist` 是预期护栏，不是 bug                                                   |
| 覆盖阈值因新文件下降                                 | S1–S3  | 单测直接 import `dev.ts` 入口覆盖 re-export；`boardRuntime` 经 `createBoard` 覆盖                                                     |
| docs 引用漂移（`__spinth.__debug`）                  | S7     | 按 §10 清单逐处改；grep 复核 0 残留                                                                                                   |
| E2E 生产探针与 DEV 探针形状分叉                      | S5     | `ready/modelCount` helper 只依赖 `docState$` 与 `__spinthDebug.__debug.modelCount`；P7 固化零探针                                     |

## 9. 设计评审（自审）

### 9.1 评审结论

方案**通过（Approved with conditions）**，条件：

1. S5 必须原子提交；禁止把「删 `__debug`」与「E2E 迁移」拆成两个提交。
2. S6 的产物负向验证必须真跑一次（临时注入 → 构建红 → 恢复），不能只看脚本存在。
3. E2E 全量必须真跑；不得用「只跑 debugSurface」代替。

### 9.2 发现与处置

| #   | 发现                                                              | 级别 | 处置                                                                                      |
| --- | ----------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| F1  | 删 `__debug` 与 E2E 169 处引用同瞬生效，拆提交会出现中间红        | P1   | S5 原子提交；S1–S4 先落地且各自绿                                                         |
| F2  | 调试 chunk 异步加载与 `__spinth` 曝光存在竞态                     | P1   | 先 await 调试入口，再同步挂两个全局（§3.6）                                               |
| F3  | `@spinth/core/dev` 子路径可能被根 alias 前缀匹配成 `index.ts/dev` | P1   | regex 精确 alias，置于根 alias 之前；dev/build 双验证                                     |
| F4  | 仅靠 DCE 无法证明生产零调试面                                     | P1   | 产物扫描 + 负向注入；`spinth:core-dev-debug` 独立标记区分 E2E 只读探针                    |
| F5  | E2E 生产探针也使用 `__spinthDebug`，不能拿它当 core 调试入口判据  | P2   | 用 `Symbol.for('spinth:core-dev-debug')` 作为 core 入口标记；E2E 构建允许 `__spinthDebug` |
| F6  | `Readonly<Pick>` 可能影响 `ReturnType`/bridge 类型                | P2   | S1 先跑三包 typecheck；不兼容则回退普通 `Pick`，运行时不变                                |
| F7  | 公开流仍是 `BehaviorSubject`，宿主可 `.next()` 伪造状态           | P2   | 本批不做；§11 明确遗留，1.0 后再评估只读包装（避免与 30+ 处 `.getValue()` 读取对撞）      |
| F8  | 投影的 `this` 绑定若在构造时快照，会破坏组装前 fallback 流        | P2   | 非函数值每次 `Reflect.get`；只有方法缓存绑定；单测覆盖「投影后替换流」                    |
| F9  | StrictMode 清理可能误删第二次挂载的 `__spinth`                    | P2   | 清理按对象身份删除；`cleanedUp` 阻止迟到 attach                                           |
| F10 | `attachBoardDebug` 传错对象会静默失败                             | P3   | 抛 `BOARD_DEBUG_RUNTIME_NOT_FOUND`；单测覆盖                                              |
| F11 | 新增文件拉低 coverage                                             | P3   | 单测从 `dev.ts` 入口导入；coverage 门禁复跑                                               |
| F12 | docs 多处 `__spinth.__debug` / `new BoardSDK()` 会过期            | P3   | §10 清单 + grep 复核                                                                      |

### 9.3 实施方必须补做的负向验证

1. **公共面负向**：在 DEV console 执行 `__spinth.viewport = null` → 必须抛 `TypeError`；
   `'viewport' in __spinth` → false。
2. **调试面负向**：临时把 `attachBoardDebug` 改成静态 import（或把 `__spinthDebug` 挂到
   生产可达路径）→ `pnpm build` 必须红；恢复后绿。
3. **E2E 负向**：临时把 `__spinthDebug.__debug.modelCount` 改为 undefined → `pwa.spec` 的
   `modelCount` 用例必须红（证明 helper 真读调试入口，不是碰巧通过）。
4. **多实例负向**：连续创建/销毁两个 board（StrictMode 已覆盖），确认旧 `__spinth` 不会
   指向已 dispose 的实例。

## 10. 文档同步清单

> docs 只写当前事实；不写「此前是 BoardSDK，现在改 createBoard」的叙事。

| 文件                                                                                                | 要改的段落                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [docs/12-ui-layer.md](../docs/12-ui-layer.md) §2/§4                                                 | 桥/命令消费「运行时投影」；主题注入句的 `BoardSDK.setTheme`；补 DEV `__spinthDebug` 与生产零探针            |
| [docs/04-widget-system.md](../docs/04-widget-system.md) §3                                          | 组合根改为「`createBoard()` → 内部 `BoardSDK`，不导出」                                                     |
| [docs/13-roadmap.md](../docs/13-roadmap.md) §1.4/§3                                                 | 五条 checkbox 全部改 `[x]` 并写当前事实；§1 基线数字复跑后更新；§3 补「运行时公共面 = 投影 + DEV 调试入口」 |
| [docs/15-testing.md](../docs/15-testing.md)                                                         | E2E 数据探针路径改 `window.__spinthDebug.__debug`；补运行时 allowlist 用例                                  |
| [docs/14-render-sync-principles.md](../docs/14-render-sync-principles.md) §4                        | 「截图会撒谎」段落中的探针路径                                                                              |
| [docs/03-render-engine.md](../docs/03-render-engine.md)                                             | `__spinth.__debug.renderCount` → `__spinthDebug.__debug.renderCount`                                        |
| [docs/21-multi-tab.md](../docs/21-multi-tab.md)                                                     | 删除「绕过 app 壳直接 `new BoardSDK()`」的边界（包入口已无该类）；全文探针路径                              |
| [docs/20-project-file.md](../docs/20-project-file.md) §5.2/§5.3                                     | `projectFile` 不在公共投影；`BoardSDK` 只作组合根内部类                                                     |
| [docs/07-text.md](../docs/07-text.md) / [docs/17-editing-service.md](../docs/17-editing-service.md) | 全文 `BoardSDK.setTheme` 提及改为「门面 `setTheme`」或注明类不导出                                          |
| [AGENTS.md](../AGENTS.md) 「当前状态」                                                              | 增运行时收窄；单测/E2E 数字按复跑；下一阶段改为「开源发布 v1.0」                                            |

## 11. 遗留与后续

- **公开流只读化**：`BoardPublicApi` 的 19 条流仍是 `BehaviorSubject`/`Subject`，
  宿主可调用 `.next()`。本批不包装（会改公开类型并影响 30+ 处 `.getValue()` 读取）；
  作为 1.0 后 API 评审项，候选方案是 `ReadonlyBehaviorSubject` 视图。
- **E2E TypeScript 类型检查**：当前 Playwright 只转译；迁移后的 `window` 形状由各 spec
  局部断言。后续可加独立 `tsconfig.e2e.json`，不在本批。
- **调试 API 不是公共 API**：`@spinth/core/dev` 不承诺 semver；新增探针字段随时可改。
- **历史文档**：[specs/api-surface.md](api-surface.md) 的 A4/A9 是当时的挂账记录，
  本文是其运行时续章；不回改历史记录，避免 specs 变成“已修复”叙事。

## 12. 实施硬约束清单

**必须**

- S1–S4 每步独立提交、`pnpm verify` 全绿；S5 原子提交并跑全量 E2E。
- `BOARD_PUBLIC_MEMBERS` 顺序/内容零改动；只加运行时投影。
- `dispose` 顺序、17 条流兜底、ActionBar schema、E2E 断言内容零改动。
- 新增类型导入用 `import type`；core 源码零 `any`（沿用既有 lint 规则）。
- 单文件 < 400 行；新文件拆在 `src/` 根的组合根层，不塞 `platform/`。
- 产物扫描接入 `pnpm build`；负向验证真跑。
- docs 只写当前事实；数字按复跑结果。

**禁止**

- 禁止把服务字段改成 `private`/`#private`（组合根与桩测会断）。
- 禁止在 `BoardPublicApi` 里新增成员来「方便 E2E」。
- 禁止把 `@spinth/core/dev` 静态 import 进生产路径。
- 禁止用 `--no-verify` 绕过门禁。
- 禁止把本设计文档的实施流水账写进 `docs/`。

## 13. 实施记录（specs 允许过程文档）

S1–S7 按 §5 顺序各一笔提交（2ca12a8 / c3f655d / 76887d8 / 870c902 / 0b78315 /
59a019d / 本笔），每笔 `pnpm verify` 全绿后推送；S5 为原子提交（55 文件）。

与设计的偏差（均按代码现实处理，不改语义）：

- `BoardInternalMember` 实为 40 项（§2.1 写 39），删 `'__debug'` 后 39 项。
- §3.8 表的「20 处内部字段」为设计期快照；实改含探索漏计的 4 处——
  `bench.spec.ts` `__spinth!.engine`、`a11yKeyboard.spec.ts` `selector.selected$`
  （改公开 `selected$`）、`imageLifecycle.spec.ts` `assetStore.put`/`engine.yWidgets`
  ×2、`smoke.spec.ts`/`multiTabReadonly.spec.ts` `viewport.worldToClient` ×3，
  合计 29 处全部迁移，grep 清零。
- §3.6 样例里句柄清理（按身份 `delete window.__spinth`）在 DEV 常量分支**外**，
  生产产物会残留 `__spinth` 字符串（实测 2 处）——S6 把清理收进 DEV 分支后
  四标记清零成立；这是 §3.6 与 §3.9 的一处内在矛盾，以扫描断言为准修正。

负向验证（§9.3，均真跑）：

1. 公共面写入：`Object.defineProperty(冻结投影, …)` 抛 TypeError——由
   debugSurface.spec 固化（evaluate 序列化后不保证严格模式，故用 defineProperty
   而非赋值语句）。
2. 生产注入：main.tsx 临时挂 `__spinthDebug` → `pnpm build` 退出 1 并报
   `assets/index-*.js: 残留调试面（__spinth=0 __spinthDebug=1 __debug=1）`；
   恢复后绿。
3. E2E 探针：e2eProbe 的 `__spinthDebug.__debug.modelCount` 临时改返
   undefined → pwa P2 红（modelCount 断言）；恢复后绿。
4. 多实例：StrictMode 双挂载由全套主配置 E2E 覆盖（刷新/换页全绿）。

实测数字（2026-11-01）：1052 单测（core 963 + react 51 + app 38）；
coverage 68.42/60.99/58.93/70.34（阈值 66/58/57/68）；E2E 46 spec / 222 用例
（主配置 215 + pwa 7 含 P7）；普通构建四标记 0 处、E2E 构建三探针在位 +
入口标记 0（check-debug-bundle 双模式通过）。

复审返工（2026-11-01 第二轮，三笔 33b6bf1/cfc66dd/本笔）：

- P1：S7 的 perl 文档替换串含 `` $` ``（Perl `$PREMATCH`），把 docs/13 的匹配
  前缀整段插回，路线图损坏（438 行、章节 ×3）。已从 59a019d 恢复并用编辑工具
  重放三处更新；教训：含 `$`/反引号的替换一律不用 perl/JS 替换串，走编辑工具。
- P2：`toScreen` 公开化收尾——另有 6 处 `viewportInstance.toScreen` 改公开
  `toScreenPoint`（smoke/textEditShape/bench + textProbe/coverage/rotate 三
  helper；后两者整函数公开化）。`viewport` 逃生口仅剩 `center`/`worldToClient`
  等无公开等价物的消费方。
- P3：debugOf 在 debugSurface 启用（快照字段走 helper、逃生口仍 evaluate 直读）；
  pwa P7 加固就绪等待（`[data-spinth-empty-hint]` = !loading && editable &&
  modelCount===0 三合一）；本文 §2.1/§3.6/§3.8/§4.2 正文对齐当前事实；
  commands.ts/store README/app.ts 三处过时注释更新。
