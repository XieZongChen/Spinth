# 01 — 仓库约定与技术栈

## 1. 包边界（eslint 强制）

| 包            | 允许                              | 禁止（`no-restricted-imports`）             |
| ------------- | --------------------------------- | ------------------------------------------- |
| @spinth/core  | pixi.js、yjs、rxjs、zod、纯工具库 | react / react-dom / zustand / @spinth/react |
| @spinth/react | react、zustand、@spinth/core      | pixi.js / yjs / y-*                         |
| @spinth/app   | @spinth/react、react、react-dom   | pixi.js / yjs / @spinth/core                |

新增依赖前先回答：这个依赖属于哪一层？越层 = 设计错误。

补充约束：

- @spinth/react 内禁止直接 import `lucide-react`——图标统一经
  `components/Icon.tsx` 的语义名注册表。
- core 内不出现 DOM UI 组件；react 内不出现 Yjs 写操作或 PIXI 调用。

## 2. 目录约定

```
packages/core/src/
├── types/        契约层：I*Service / I*Vm / I*Model + zod schema（接口先行）
├── base/         Disposable、BaseVm、BaseWidgetVm、BaseModel
├── platform/     平台服务（dataEngine/vmEngine/viewport/selector/history/...）
├── widgets/      控件三件套（shape/sticky/text/line/pen/image/mind/eraser）
├── common/       共享工具（render、geometry、selectionStyle）
└── utils/        业务无关纯函数

packages/react/src/
├── store/        spinthStore（只读镜像）+ commands（命令转发）
└── components/   Board / Toolbar / ActionBar / ContextMenu / ZoomControl / ...

packages/app/src/
└── App.tsx、main.tsx、theme.ts、styles/
```

## 3. 命名与风格

- 文件：`xxxService.ts`（交互/逻辑）、`xxxVm.ts`（PIXI 视图）、
  `xxxModel.ts`（Yjs 数据）。
- 接口 `I` 前缀；rxjs 流 `$` 后缀；常量 UPPER_SNAKE_CASE。
- 魔法数字必须提为具名常量，注释说明约束来源。
- TS strict，含 `noUncheckedIndexedAccess`；type-only import 必须写 `import type`。
- 注释解释「为什么」：约束、踩坑、算法出处；不复述「是什么」。

## 4. 技术栈

| 领域   | 选型                                            | 版本                     |
| ------ | ----------------------------------------------- | ------------------------ |
| 渲染   | pixi.js / pixi-viewport                         | ^8.20 / ^6               |
| UI     | react / zustand                                 | ^19 / ^5                 |
| 富文本 | @tiptap/core + starter-kit + text-style + color | ^3.31                    |
| 数据   | yjs                                             | ^13.6                    |
| 协同   | y-websocket（可选，按需动态加载）               | ^3.1                     |
| 校验   | zod                                             | ^4                       |
| 快捷键 | hotkeys-js                                      | ^3.13                    |
| 工具链 | vite / typescript / vitest / eslint / prettier  | ^7 / ^5.9 / ^5 / ^9 / ^3 |

持久化不使用 y-indexeddb：`DbProvider` 自研双 store（增量 + 审计），见 docs/02 §6。

## 5. 常用命令与门禁

```bash
pnpm dev          # Vite 5173
pnpm build
pnpm test         # vitest（core + react）
pnpm test:coverage
pnpm test:e2e     # Playwright
pnpm lint
pnpm typecheck
pnpm verify       # lint + prettier + typecheck + pnpm -r test + build
```

- 提交前必须 `pnpm verify` 全绿；改交互编排补跑 `pnpm test:e2e`。
- CI 在 verify 之外还跑 coverage 与 fast E2E（排除 @timing/@bench/@visual）；
  nightly 承接时敏/性能/视觉。
- 视觉基线只作补充层；数据探针优先（docs/15）。

## 6. 架构决策记录（ADR）

### ADR-1 zustand 而非 jotai

UI 状态是 SDK rxjs 流的只读镜像，更新入口是命令式 push；zustand 单 store + selector
与之直译对应。命令模块与 store 分离，命令不产生本地状态。

### ADR-2 zod 作为 schema 唯一来源

widget schema 声明一次，`z.infer` 即 TS 类型；远端、IndexedDB、剪贴板、导入
文件都必须经过运行时校验。类型与校验同源，避免两套定义漂移。

### ADR-3 自研 ServiceRegistry

不使用装饰器 DI 和 `reflect-metadata`；显式 token 注册、构造注入、组合根装配。
依赖关系可读、可测试、tree-shaking 友好。

### ADR-4 版本选择

eslint 9、TS 5.9、vitest 5、Vite 7：以周边生态兼容为先，不追最新大版本。

### ADR-5 workspace 源码直引

@spinth/core / @spinth/react 的入口直接指向 `src/index.ts`，app 的 Vite
用 alias 指向源码，免预构建。代价是 app build 不做包级隔离——本项目不发布 npm，可接受。

### ADR-6 渲染同步契约

拖拽/缩放系列 bug 沉淀出六条规则（docs/14）；`BaseWidgetVm` 的广播时机与
`deepDiff` 的 partial 语义由契约决定，`renderSync.test.ts` 守护。

### ADR-7 服务架构形态

判据是「一个实现 vs 一族变体」：

```
多个同构实现 + 共享流程骨架 → 模板方法基类（DragCreateServiceBase）
多个可替换算法/映射       → 函数注册表（Icon / measure / shortcuts）
单一能力                   → 组合式 service + 纯函数 utils
```

继承只用于控件变体族；platform 横向能力走组合与 getter 解环。数学拆纯函数进单测。

### ADR-8 单机优先

协同是可选 provider，不是 DataEngine 的硬依赖；启动路径不得因为未来协同而引入
网络、账号或远端状态。资产引用、origin 纪律、Yjs 文档结构为未来协同保留边界。

## 7. AI 协作规范

1. 先读 `AGENTS.md`、`docs/README.md` 和相关专题，再改代码。
2. 接口先行：types → 纯逻辑（带单测）→ 视图 → Service 接线 → 手动验证 → 同步 docs。
3. 不确定的设计点先提问，不猜。
4. 小步提交，每步可回退；提交信息用 `feat|fix|docs|refactor|test|chore: 中文描述`。
5. 修过的编排 bug 必须补护栏；新增能力必须同步 docs 与测试。

## 8. 文档维护

- 文档编号是稳定契约：代码注释引用 `docs/NN §M` 时，被引用的篇目与章节必须存在。
- 新功能先写/更新规格，再实现；实现与文档不一致时先改文档或说明理由。
- 任务导向的阅读路径见 [docs/README.md](README.md)。
