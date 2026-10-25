# PWA / Service Worker 骨架：技术方案与架构设计

> 状态：设计稿（待实施）。实施由另一个 agent 执行，本文件作者负责设计与复审。
> 范围：可安装（manifest）、离线首开与刷新、版本更新送达。不含推送/后台同步/分享目标。
> 关联：[docs/12](../docs/12-ui-layer.md) §6 启动链路、[docs/13](../docs/13-roadmap.md) §2–§3 平台挂账、
> [docs/21](../docs/21-multi-tab.md) 多标签、[docs/19](../docs/19-assets.md) 资产、[docs/15](../docs/15-testing.md) 测试分层。

## 1. 目标与完成定义

一句话：**装得进桌面、断网能冷启动、新版本可控地送达**——同时不触碰「所有写操作只写 Yjs、所有渲染只订阅 Yjs」的数据流。

完成定义（缺一不可，数字以实测为准）：

1. **离线冷启动**：首次在线访问后断网 → 刷新 → 画布可开、可编辑、可撤销，再刷新数据仍在。
2. **首装即受控**：首次访问后 `navigator.serviceWorker.controller` 非空（无需第二次刷新），此时断网已可用。
3. **子路径正确**：`SPINTH_BASE=/spinth/` 构建后 SW scope 恰为 `/spinth/`，注册 URL 走 base；根路径 `/sw.js` 不请求。
4. **更新可控**：新构建上线后，旧页面出现「新版本可用」，用户点击后**恰好刷新一次**；不点击则页面继续可用、不被打断。
5. **不自我劫持**：`sw.js` 自身不进任何缓存；跨源请求、非 GET、Range 请求一律直通。
6. **开发不受污染**：`pnpm dev` 不注册 SW，HMR 与 React refresh 行为不变。
7. **构建可校验**：`check-pages-build.mjs` 能拦住「SW/manifest 前缀丢失」与「产物漏进预缓存清单」两类回归。
8. **门禁全绿**：`pnpm verify` 与 `pnpm test:e2e` 通过；docs 按「只写当前事实」直接改写。

## 2. 非目标

- 推送通知、Background Sync、Periodic Sync、Share Target、File Handler、协议处理。
- 缓存用户内容：文档与图片资产已在 IndexedDB（docs/02、docs/19），SW 不参与数据层。
- 跨源资源缓存：外链图片离线仍走既有占位 + 重试（docs/19 §4），行为不变。
- 自定义安装按钮（`beforeinstallprompt` 接管）：浏览器原生入口足够，见 §14 已定决策。
- 容量淘汰/配额治理：只按版本清理，不做 LRU；预算由构建期护栏守住（§8）。
- Linux 视觉基线：独立立项（docs/13 §2）。

## 3. 现状核对（实施前逐条对照）

- **无任何 PWA 设施**：`packages/app/public/` 只有 4 个 png；`index.html` 无 manifest link、无 SW 注册。
- **CSP 已就位**：`vite.config.ts` 的 `cspInject` 在 build 时把内联脚本 hash 注入 meta CSP，已含
  `worker-src 'self' blob:`——SW 脚本拉取走 `worker-src`，无需改 CSP（E2E 断言无 violation 为准）。
- **部署形态**：`pages.yml` 用 `upload-pages-artifact` **原样发布产物**（不跑 Jekyll，无需 `.nojekyll`），
  子路径由 `SPINTH_BASE` 注入；无自定义响应头能力（Pages 固定 `Cache-Control`）。
- **路由**：无 path 路由，`?doc=xxx` 查询参数（[App.tsx:50](../packages/app/src/App.tsx#L50)），
  因此不存在深链 404，导航回退只需处理「同一 URL 不同 query」。
- **存在懒加载 chunk**：`fflate`（项目导出/导入，`projectArchive.ts`）与 `compactWorker`（compaction）
  都是动态 import。**离线必须覆盖它们**，否则「离线可用」只对首屏成立。
- **多标签**：`tabSession.ts` 用 Web Lock 定 leader/follower，接管靠整页刷新（docs/21）。SW 与锁无耦合，
  但「SW 更新触发刷新」会释放锁，必须按 §9 处理。
- **错误呈现**：`OfflineBar` 由 `editBlocked` 驱动，单机恒 false（docs/10 §4）。PWA 不改变该不变量：
  断网可用 ≠ 需提示，离线条目要么不出现、要么是「新版本」这类主动提示。
- **测试基建**：app 包**没有** vitest 工程；Playwright 只有一个 webServer（dev，5199），
  gate 层用 `--grep-invert "@timing|@bench|@visual"` 排除慢层。
- **构建脚本**：`packages/app/package.json` 的 `build` 为 `tsc --noEmit && vite build`；
  `ci.yml` 与 `pages.yml` 各自跑一次 `SPINTH_BASE=… pnpm build` 再跑校验脚本。

## 4. 架构总览

```
浏览器
├─ 页面（app 壳，DOM 世界）
│   ├─ src/pwa/serviceWorker.ts   注册 / 更新检测 / 刷新守卫（端口注入，可桩测）
│   ├─ src/pwa/useServiceWorker.ts React 薄钩子
│   └─ PwaUpdateBanner.tsx        「新版本可用」提示（role=status）
├─ Service Worker（独立全局，无 DOM、无框架）
│   ├─ src/pwa/sw/sw.ts           生命周期 + fetch 路由装配（只做装配）
│   └─ src/pwa/sw/cachePolicy.ts  纯函数：请求分类 / 导航键归一化
└─ 构建期（Node）
    ├─ src/pwa/precacheManifest.ts 纯函数：文件列表 → 清单 + 版本
    └─ vite.sw.config.ts           扫 dist、注入清单、产出 dist/sw.js + 侧车
```

三层职责铁律：

1. **SW 不碰数据**：不打开 IndexedDB、不 import `@spinth/core` / `@spinth/react` / `react`（eslint 硬拦）。
2. **策略纯函数化**：路由分类、清单生成、更新状态机都是纯逻辑，单测覆盖；入口文件只装配。
3. **版本由产物决定**：清单与版本号从 `dist` 实算，不写死常量、不手填。

## 5. 设计决策

**D1 手写 SW，零第三方**

- 理由：缓存路由只有四条；workbox 会引入运行时与另一套版本语义，违背「显式依赖」。
- 代价：更新/清理逻辑自维护——用单测与 E2E 兜住（§11）。

**D2 注册在 app 壳，SDK 零感知**

- 理由：SW 是宿主/平台概念，与画布 SDK 无关；core/react 不得出现 `serviceWorker`。
- 守卫：eslint 对 `packages/app/src/pwa/sw/**` 加 `no-restricted-imports`（`@spinth/*`、`react`）。

**D3 SW 放 dist 根目录，scope = base**

- 理由：scope 不能超出脚本所在目录；Pages 不给 `Service-Worker-Allowed` 头，放子目录就扩不回来。
- 实现：`register(publicAsset('sw.js'), { scope: SITE_BASE, updateViaCache: 'none' })`——
  **必须走 `publicAsset()`**，否则子路径构建写死根路径（check 脚本新增正则守门）。
- `updateViaCache: 'none'`：绕过 Pages 固定 600s 的 HTTP 缓存，让 `update()` 真拿到新脚本。

**D4 预缓存清单 = 构建后对 dist 全量文件做内容 hash**

- 形态：`{ version: string, entries: [{ url, revision, size }] }`，`url` 相对 base（无前导斜杠）。
- `revision` = 文件内容 sha256 前 8 位；`version` = 各 `url@revision` 排序拼接后的 sha256 前 12 位。
- 排除：`*.woff2` 中**除 `*-latin-*.woff2` 外**的子集（cyrillic / latin-ext / vietnamese 走运行时缓存）、
  `*.map`、`sw.js`、`spinth-logo.png`（只做图标源，非运行时资源）。
- 只收 latin 一档的理由：首屏字体请求发生在 SW `claim()` 之前，不会进 runtime cache——
  「只靠运行时缓存」有首装会话缺口，见 D16。
- 理由：懒加载 chunk（fflate / compactWorker）必须进清单，离线导出与 compaction 才成立；
  内容 hash 让「无变更重建」不产生新版本、不弹更新提示。

**D5 清单内联进 sw.js，另写侧车供校验**

- `vite.sw.config.ts` 用 `define` 注入 `__SPINTH_PRECACHE__`，同时在 app 根写 `.sw-manifest.json`（gitignore）。
- 理由：`check-pages-build.mjs` 是纯 Node，不能 import TS；侧车让校验脚本不必复制算法。
- 一致性：校验断言「侧车版本字符串出现在 sw.js 中」+「侧车条目集合 == dist 实际文件集合」。

**D6 导航 = network-first（`cache: 'no-cache'`）→ 3s 超时 → shell 回退**

- `no-cache` 强制与服务器校验，避开 Pages 的 600s 陈旧 HTML。
- shell 键归一化：`new URL(base, origin).href`（去 query、保证尾斜杠），解决 `?doc=` 多文档。
- **导航响应不回写 shell 缓存**（关键）：shell 缓存只由 install 按清单填充，
  保证「离线拿到的 HTML」与「缓存里的 assets」永远同版本，不会出现新旧错配。

**D7 静态资源 cache-first；字体 stale-while-revalidate；其余直通**

- `assets/*` 与根目录图标在清单内 → cache-first（文件名带 hash，天然 immutable）。
- `*.woff2`：latin 子集进清单（首屏必用，D16）；其余子集走 `spinth-runtime`（SWR，命中即回、后台更新）。
- 同源但既不在清单、也不是字体 → 直通网络，不写缓存（防无界增长）。

**D8 只接管同源 GET**

- 跨源（外链图片）、非 GET、带 `Range` 头、pathname 不在 base 下 → 一律 `return`（不 `respondWith`）。
- 理由：跨源缓存会改变失败语义与 CORS 观感，收益（离线看外链图）不在本阶段。

**D9 更新 = waiting + 用户确认，不自动 skipWaiting**

- 理由：自动接管会在旧页面运行期间换资源版本；多标签下还会打断写者。
- 流程：`install` 完成 → `waiting` → 页面横幅 → 用户点击 → `postMessage({type:'SKIP_WAITING'})`
  → `activate` → `controllerchange` → **仅点击的那一页** reload。
- 返回访客：启动时 `registration.waiting` 已存在 → 直接出横幅。

**D10 activate 即删旧缓存，不做跨代保留**

- 理由：shell 只有一条键且被新版本覆盖，旧 HTML 不可能残留；保留旧 cache 只占空间。
- 推论：离线刷新永远落到「最新已安装版本」的 shell，自洽且自愈。
- 代价：仍在旧页面的标签若再请求未加载过的 chunk，离线会失败（在线则受部署替换影响，与 SW 无关）。
  由于本清单**全量预缓存**，正常运行中的页面不存在未加载 chunk，风险可忽略（§13 记录）。

**D11 activate 时 `clients.claim()`；刷新只由用户动作触发**

- `claim()` 让首装即可控（完成定义 2），无需二次刷新。
- `controllerchange` 处理器必须查「本页是否点了刷新」标志：只有点击方 reload，其他标签改为
  「已就绪，刷新以应用」状态——避免多标签同时重载、避免抢走 Web Lock 造成 leader 抖动。
- reload 守卫：内存标志 + 单次执行，防 `controllerchange` 重入造成刷新循环。

**D12 策略纯函数化，控制器走端口注入**

- `cachePolicy.ts`（SW 与单测共用）、`precacheManifest.ts`（构建与单测共用）无副作用。
- 页面侧 `serviceWorker.ts` 接受 `{ register, getController, addControllerChangeListener, reload }` 端口，
  单测用桩即可覆盖「waiting 首帧」「updatefound」「不点击不刷新」「重复 apply 只发一次消息」。

**D13 两步构建，SW 构建失败即构建失败**

```jsonc
// packages/app/package.json
"build": "tsc --noEmit && tsc -p tsconfig.sw.json && vite build && vite build --config vite.sw.config.ts",
"typecheck": "tsc --noEmit && tsc -p tsconfig.sw.json",
"test": "vitest run"
```

- 顺序固定：主构建产出 dist → SW 构建扫 dist 生成清单 → 写 `dist/sw.js` 与侧车。
- `emptyOutDir: false`；SW 配置启动时若缺 `dist/index.html` 直接抛错（禁止「没有 SW 的绿色构建」）。
- 类型：`src/pwa/sw/**` 用 `tsconfig.sw.json`（`lib: ES2023 + WebWorker`，无 DOM）；
  主 tsconfig `exclude` 该目录，避免 DOM 与 WebWorker 全局冲突。

**D14 E2E 用真实 Pages 形态：`SPINTH_BASE=/spinth/` + `vite preview`**

- 第二个 webServer（端口 5198）执行「`pnpm --filter @spinth/app build` → `preview`」，
  `env: { SPINTH_BASE: '/spinth/' }`（**build 与 preview 必须同 env**，否则 preview 以 `/` 提供而产物按子路径生成）。
- Playwright 新增 project `pwa`：`testMatch: '**/pwa.spec.ts'`、`baseURL: 'http://localhost:5198/spinth/'`；
  默认 project 用 `testIgnore` 排除该 spec 并保持 5199。
- 代价：每次 E2E 多一次构建（约 15–20s）。**不接受**用环境变量默认跳过——那就是假绿。

**D15 更新测试必须真重建，不 mock SW**

- 测试内用 `execSync` 重建产物，通过 `SPINTH_BUILD_TAG` 改变输出内容（见 §11.3），
  再用 `registration.update()` 触发，断言横幅出现、点击后 script 的 hash 变化。
- 禁止用 `page.route` 伪造 SW 行为——那只能证明 mock 自洽。

**D16 字体只预缓存 latin 子集**

- 首屏字体请求发生在 SW 受控之前（`claim()` 之后页面才受控），所以「字体全走运行时缓存」在
  **首装会话**里是空缓存：装完立刻断网，Latin 文字会回退系统字体。
- latin（40 KB）是首屏必用子集（品牌词、数字、快捷键字母）；cyrillic / latin-ext / vietnamese
  在中文界面里基本不命中，保持运行时 SWR。
- 代价：清单排除规则多一条白名单；收益是离线首屏与在线一致，且不付 108 KB。

## 6. 契约与接口

### 6.1 预缓存清单

```ts
interface IPrecacheEntry {
  url: string; // 相对 site base，无前导 '/'，如 'assets/index-DUgTQvjI.js'
  revision: string; // 内容 sha256 前 8 位
  size: number; // 字节，仅用于预算断言与排障
}
interface IPrecacheManifest {
  version: string; // 12 位 hex
  entries: IPrecacheEntry[]; // 按 url 字典序，保证确定性
}
```

**base 的来源**：SW **不注入 base**，运行时从自身脚本位置推导——
`const BASE = new URL('./', self.location).href`（`dist/sw.js` → `/spinth/`）。
理由：注入的 base 与部署实际不一致时（本地 preview 用 `/`、Pages 用 `/spinth/`）会静默缓存错 URL；
脚本位置是唯一可信事实。页面侧注册仍显式传 `scope: SITE_BASE`，两者由 P1 断言一致。

**条目 → 缓存键**：清单 `url` 相对 base，安装时拼成 `new URL(url, BASE).href`；
`index.html` 额外以归一化键（`BASE`）再存一份，供导航回退命中。

### 6.2 请求路由分类（`cachePolicy.ts`）

```ts
type CacheRoute = 'navigation' | 'precached' | 'runtime-revalidate' | 'passthrough';

function classifyRequest(input: {
  url: string;
  method: string;
  mode: string;
  hasRange: boolean;
  origin: string;
  basePath: string; // 以 '/' 结尾
  precached: ReadonlySet<string>; // pathname 集合（已含 base）
}): CacheRoute;
```

判定顺序（先短路，后分类）：

1. `method !== 'GET'` 或 `hasRange` → `passthrough`
2. `new URL(url).origin !== origin` → `passthrough`
3. `!pathname.startsWith(basePath)` → `passthrough`
4. `mode === 'navigate'` → `navigation`
5. `precached.has(pathname)` → `precached`
6. `/\.woff2?$/.test(pathname)` → `runtime-revalidate`
7. 否则 → `passthrough`

注：latin 子集在清单内，会先命中第 5 条走 cache-first；第 6 条只兜其余子集。**顺序不可交换**。

另导出 `navigationKey(base, origin): string`（`new URL(base, origin).href`）与
`toManifestPath(basePath, url): string`（清单 url ↔ 缓存键换算，单一来源）。

### 6.3 SW 生命周期

| 事件       | 行为                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`  | 建 `spinth-shell-<version>` 缓存 → 逐条 fetch 并 `cache.put`（`index.html` 用 `cache:'reload'`，其余走默认 HTTP 缓存避免首装翻倍流量）→ 额外把 shell 副本写到归一化键；任一条失败即 `throw`（安装失败，旧 SW 保留） |
| `activate` | 删除所有 `spinth-` 前缀且非当前 shell/runtime 的缓存 → `clients.claim()`                                                                                                                                            |
| `fetch`    | 按 §6.2 分类；`navigation` 走 D6，`precached` 走 cache-first，`runtime-revalidate` 走 SWR，其余直接 `return`                                                                                                        |
| `message`  | 仅接受 `{ type: 'SKIP_WAITING' }` → `skipWaiting()`；其余忽略                                                                                                                                                       |

缓存命名：`spinth-shell-<version>`、`spinth-runtime-v1`。

### 6.4 页面侧控制器（`serviceWorker.ts`）

```ts
interface ISwRegistration {
  waiting: { postMessage(message: unknown): void } | null;
  installing: {
    state: 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';
  } | null;
  update(): Promise<void>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}
interface IServiceWorkerDeps {
  register(url: string, opts: { scope: string; updateViaCache: 'none' }): Promise<ISwRegistration>;
  reload(): void;
  now?: () => number; // 让「节流 update」可测
}
interface IUpdateState {
  available: boolean;
  applying: boolean;
}
```

行为：

- 首次 `register` 后监听 `updatefound`：`installing.state === 'installed' && controller` → `available = true`。
- 启动即查 `registration.waiting` → `available = true`。
- `visibilitychange`（转可见）调用 `registration.update()`，节流 ≥ 60min；`now()` 注入以便单测。
- `apply()`：`waiting.postMessage({ type: 'SKIP_WAITING' })` → 置 `pendingReload = true`；
  `controllerchange` 且 `pendingReload` → `reload()`（只执行一次）。
- 3s 内无 `controllerchange`：兜底 `reload()`（避免用户点了没反应），仍受单次守卫。
- `register` 抛错（CSP/隐私模式/无 SW）：吞掉并 `console.warn` 一次，应用照常运行。

## 7. 构建与部署接线

### 7.1 产物

| 文件                             | 来源                                    | 说明                                                                             |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `dist/sw.js`                     | `vite build --config vite.sw.config.ts` | IIFE、单文件、无 import、不含 sourcemap                                          |
| `dist/manifest.webmanifest`      | `public/` 静态                          | 全部相对 URL（`start_url: "."`、`scope: "."`），子路径自动正确                   |
| `dist/icons/*.png`               | `public/icons/`                         | 192/512 透明底 + maskable-512 白底；源图 `spinth-logo.png`（内容约 56%，§14-Q3） |
| `packages/app/.sw-manifest.json` | 构建期侧车                              | gitignore；只给校验脚本用                                                        |

`index.html` 新增（Vite 会自动补 base）：

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="spinth" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

iOS 三行为「添加到主屏幕」的启动形态与图标名服务（§14-Q4）；状态栏用 `default` 而非
`black-translucent`——后者会把状态栏文字刷白，压在浅色画布上不合格。

manifest 关键字段：`name/short_name: "spinth"`、`lang: "zh-CN"`、`start_url: "."`、`scope: "."`、
`display: "standalone"`、`background_color` 与 `theme_color` 取浅色画布 `#f8f9fa`（暗色由
`theme.ts` 运行时改写 `<meta name="theme-color">`，manifest 只负责冷启动首帧）；
不写 `id`（默认 = start_url，避免换部署路径后变成两个应用）。

### 7.2 构建校验（`scripts/check-pages-build.mjs` 新增断言）

1. `dist/sw.js` 存在且非空。
2. `dist/manifest.webmanifest` 存在；`index.html` 的 `<link rel="manifest" href>` 带 base。
3. JS 产物中不得出现写死根路径的 `'/sw.js'` / `"/sw.js"` / 反引号同款（同现有三条正则风格）。
4. 侧车清单条目集合 == dist 实际文件集合 − 排除项（漏缓存 / 多缓存双向报错）；
   排除规则必须与 D4 完全一致——多进一个 cyrillic 子集、漏进一个 latin 子集都要红。
5. `sw.js` 文本包含侧车 `version`（防止侧车与内嵌清单漂移）。
6. 预缓存总量 > 3 MB 直接失败（防误把字体/大图塞进清单）。

### 7.3 CSP

- 无需改动：`worker-src 'self' blob:` 已覆盖 SW 脚本拉取；`default-src 'self'` 覆盖 manifest。
- 缓存返回的 HTML 自带 meta CSP，离线页与在线页策略一致。
- E2E 断言 `securitypolicyviolation` 事件为 0（回归即红）。

## 8. 存储与配额

- 预缓存约 **1.94 MB**（dist 2.1 MB − 非 latin 字体 108 KB − logo 49 KB），每版本一份；
  更新期间新旧两份并存，峰值约 3.9 MB，activate 后回落。
- `navigator.storage.estimate()` 含 Cache Storage，存储面板的用量与 80%/95% 阈值**不改**：
  预算增长是事实，按现状呈现即可（docs/02 §6.1 补一句「含 SW 缓存」）。
- 字体只预缓存 latin 子集（40 KB）：其余 108 KB 走运行时 SWR，离线回退系统字体。
  理由见 D16——latin 之外的子集在中文界面里基本不会被命中。

## 9. 多标签与只读

- SW 全 origin 共享（同 scope 一个注册）；每个标签各有 `ServiceWorkerRegistration` 视图与横幅状态。
- A 标签点击刷新：只有 A reload；B 标签 `controllerchange` 只更新提示文案，不自动刷新
  （避免抢 Web Lock / 造成 leader 抖动，D11）。
- follower 标签同样显示横幅；刷新后角色重新判定（写者仍在则继续只读），不改变 docs/21 语义。
- SW 更新不触碰 IndexedDB、不触碰 Web Lock、不触发资产维护链。

## 10. 更新提示与可访问性

- 位置：顶部居中浮层（顶栏下方 8px），与 `OfflineBar` 同锚点——二者互斥，`editBlocked` 优先时
  横幅不渲染（单机不可达，留给协同宿主）。
- 动作：主按钮「刷新」（`accent-fill` + `on-accent`）、次按钮「稍后」（幽灵）；不放 `×`（与「稍后」重复）。
- 文案：一行「新版本可用」。不写版本号——版本是构建细节，对用户无意义。
- 「稍后」= 本会话不再提示：把当前 waiting 的标识记进 `sessionStorage`；不清 waiting、不阻止更新，
  下次打开仍会提示（D9）。
- 语义：`role="status"`（polite），出现不抢焦点；Tab 可到达两个按钮；关闭后若焦点曾在横幅内，
  归还到触发元素，否则不动焦点。
- 尺寸：按钮 ≥24px（移动端 ≥44px 触控目标），390px 下 `max-w-[calc(100vw-16px)]` 不换行不溢出。
- 颜色走既有令牌，对比度进 `a11y.spec` 配对；新按钮纳入控件可访问名扫描。

## 11. 测试方案

### 11.1 单测（app 新增 vitest 工程，node 环境，目标 ≥ 25 例）

- `cachePolicy`：分类七条优先级 / 跨源 / Range / 非 GET / scope 外 / 字体 SWR / 导航键归一化（含 tail slash、query、编码 docId）。
- `precacheManifest`：排除规则 / 排序确定性 / 无变更重建版本不变 / 任一文件变更版本变化 / 预算统计。
- `serviceWorker` 控制器（桩端口）：waiting 首帧即提示 / `updatefound` 后 installed / 无 controller 时不提示 /
  不点击不 reload / `apply` 只发一次消息 / controllerchange 只 reload 一次 / 3s 兜底 / register 抛错不外抛。

配套工程改动：根 `vitest.config.ts` 增加 `packages/app` project；`coverage.include` 增加
`packages/app/src/pwa/**/*.ts`；四个阈值按实测重测（规则：实测下浮 1.5%，不得低于现值）。

### 11.2 E2E（`packages/app/e2e/pwa.spec.ts`，项目 `pwa`，子路径 preview）

| #   | 用例         | 断言要点                                                                                                                                         |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | 首装即受控   | `controller` 非空、`registration.scope === 'http://localhost:5198/spinth/'`、manifest link 带 base                                               |
| P2  | 离线冷启动   | `context.setOffline(true)` → reload → 画布就绪 → 创建/撤销 → 再 reload 数据仍在；`document.fonts.check('16px "Nunito Variable"')` 为真（守 D16） |
| P3  | 离线另一文档 | 离线下访问 `?doc=<另一 id>` 仍能开（验证 shell 键归一化）                                                                                        |
| P4  | 无策略破坏   | `securitypolicyviolation` 计数为 0；console 无 SW 相关 error                                                                                     |
| P5  | 更新流程     | 重建（带新 `SPINTH_BUILD_TAG`）→ `registration.update()` → 横幅出现 → 点击 → 页面重载且 `<script type="module">` 的 hash 变化                    |
| P6  | 多标签不互踩 | A 点刷新后 B 未重载（用 `performance.now()` 哨兵变量 / build tag 断言），B 仍可编辑                                                              |
| P7  | dev 不注册   | 在 dev 项目补一条：`getRegistrations()` 为空（守住 D2/D6 的 PROD 门禁）                                                                          |

### 11.3 测试用构建标记

主构建新增 `define: { __BUILD_TAG__: JSON.stringify(process.env.SPINTH_BUILD_TAG ?? '') }`，
App 根节点输出 `data-spinth-build`。用途：更新流程与多标签用例证明「确实换了版本」，
同时留作线上排障标记（空串时不影响行为）。

### 11.4 CI

- gate 已覆盖：`--grep-invert "@timing|@bench|@visual"` 不排除 pwa.spec；新增耗时约 20s，25min 预算内。
- 两条构建路径（ci gate 与 pages 部署）都要过 §7.2 校验；pages.yml 无需新增步骤。
- 不新增 job，不加 `continue-on-error`。

## 12. 实施顺序（每步可单独验证）

1. **工程底座**：app `vitest` project + `tsconfig.sw.json` + eslint 包边界规则；跑通空测试。
2. **纯函数**：`cachePolicy` + `precacheManifest` + 单测（此时无 SW 也能绿）。
3. **静态产物**：manifest + 图标 + `index.html` link；`check-pages-build` 先写失败断言（红）。
4. **构建接线**：`vite.sw.config.ts` + 侧车 + `build` 脚本顺序；本地 preview 手工确认 `/spinth/sw.js` 可取。
5. **SW 主体**：install/activate/fetch/message；手工断网验证（DevTools → Offline → 刷新）。
6. **页面侧**：`serviceWorker.ts` + 钩子 + 横幅（a11y 收口）+ `__BUILD_TAG__`。
7. **E2E**：Playwright 第二 webServer + `pwa` project + P1–P7；gate 层跑一次全量。
8. **文档**：§16 表逐条改写 + AGENTS 当前状态与实测数字。

任一步失败不回退到「先合上、后面补」——构建校验与 E2E 是完成定义的一部分。

## 13. 风险与缓解

| 风险                               | 影响                           | 缓解                                                                           |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| 旧 SW 服务旧代码，掩盖回归         | 线上「看着是新版本其实是旧的」 | `updateViaCache:'none'`；导航 `no-cache`；`sw.js` 不入缓存；E2E 断言 hash 变化 |
| 导航响应回写 shell 导致新旧错配    | 离线白屏                       | D6：shell 只由 install 按清单填充，网络导航不回写                              |
| 首装流量翻倍                       | 移动端流量与时间               | 资产用默认 HTTP 缓存填充（不 `reload`），只有 `index.html` 强制重取            |
| 漏预缓存懒加载 chunk               | 离线导出/compaction 失败       | 侧车集合 == dist 集合（§7.2-4）；单测覆盖排除规则                              |
| 多标签同时重载                     | 抢锁、抖动、丢输入焦点         | D11：只刷新点击方；controllerchange 仅改状态                                   |
| 刷新循环                           | 页面反复重载                   | 单次守卫 + 3s 兜底同受守卫                                                     |
| 配额压力提前触发 warn              | 存储面板报警变多               | 预算门禁 3 MB；文档记录基线；阈值不动                                          |
| Pages 600s 缓存让 HTML 更新延迟    | 新版本晚到 ≤10min              | 导航 `no-cache`；提示只在 waiting 时出现，不误报                               |
| 隐私模式/无 SW 环境                | 注册抛错                       | 控制器吞错 + 单次 warn；功能降级为在线使用                                     |
| `clients.claim()` 后旧页面资源错配 | 运行中页面取到新资源           | 清单全量预缓存，运行期无 chunk 缺口；update 仍需用户确认                       |

## 14. 已定决策（原开放问题）

五项均已拍板，实施按此执行；要改必须回改本节并写明理由。

**Q1 显示模式：`standalone`**

- 理由：应用壳已按「无浏览器 chrome」设计（`h-dvh`、44px 顶栏、四条安全区变量、移动端工具坞）；
  顶栏已有「复制本文档链接」，链接分享不依赖地址栏；改回 `browser` 只是 manifest 一个字段。
- 代价：standalone 下开第二个标签要复制链接再粘贴，多标签场景自然变少（不影响功能与测试）。

**Q2 更新提示：顶部居中，「刷新」+「稍后」**

- 顶部居中是唯一不与工具坞 / 缩放胶囊 / ActionBar 冲突的空位，且与 `OfflineBar` 同锚点，
  二者约定互斥（`editBlocked` 优先）。
- 「稍后」= 本会话不再提示（记忆 waiting 标识），不清 waiting；下次打开仍提示。规则见 §10。

**Q3 图标：以 `spinth-logo.png` 为源，出三张**

- 实测：`spinth-mark.png` 169×293 且已紧裁（内容 (8,7)–(161,285)），直接做 maskable 会被圆形裁掉上下；
  `spinth-logo.png` 500×500、内容 153×278（约 56%）居中，天然落在 80% 直径安全圆内。
- 产物：192 / 512 透明底 `any`；maskable-512 白底 `#ffffff`（与现有 `apple-touch-icon` 的底一致）。
- 一次性产物，提交 PNG；**不在构建期引入图像依赖**。
- 禁止把 `spinth-mark.png` 或 `favicon-32.png` 直接当 maskable（内容贴边/过满，必然被裁）。

**Q4 iOS 元信息：加 capable + title，状态栏 `default`**

- 依赖 Q1 = `standalone`；若 Q1 改变，本条作废并同步删掉三个 meta。
- 不用 `black-translucent`：状态栏文字会刷白，压在浅色画布 `#f8f9fa` 上对比度不合格；
  且与 `--spinth-safe-top` 叠加可能出现双重留白。

**Q5 字体：只预缓存 latin 子集（+40 KB）**

- 首屏字体请求发生在 SW `claim()` 之前，不会进 runtime cache——「只靠运行时缓存」有首装会话缺口（D16）。
- latin（40 KB）是唯一首屏必用子集；其余 108 KB 走运行时 SWR。
- 预缓存预算：1.9 MB → **1.94 MB**（§8）。

**仍需人工验证（无法自动化）**：iOS / Android 真机「添加到主屏幕」的启动形态与图标裁切效果。

## 15. 审查清单（实施自检 + 复审逐条打勾）

- [ ] SW 源码零 `import`（core / react / node 内建全部不出现），eslint 规则已生效。
- [ ] 注册与 manifest 链接都经 `publicAsset()` / Vite base 重写，无写死根路径。
- [ ] dev 构建不注册 SW；`getRegistrations()` 为空有断言。
- [ ] `cache.put` 前 `clone()`，响应体只读一次。
- [ ] 导航回退用归一化键，`?doc=` 不同值互不影响（P3 覆盖）。
- [ ] 跨源/非 GET/Range/scope 外全部直通，有单测。
- [ ] `skipWaiting` 只由用户动作触发；reload 单次守卫；controllerchange 不误刷新其他标签。
- [ ] 清单与版本由 dist 实算，重建无变更不改版本（单测）。
- [ ] `check-pages-build` 六条新断言在两种构建路径都跑过（故意删一条清单项应红）。
- [ ] 预缓存总量 < 3 MB；非 latin 字体与 logo 不在清单。
- [ ] 图标由 `spinth-logo.png` 生成：192/512 透明底、maskable-512 白底，圆形遮罩下不裁内容。
- [ ] 离线刷新后 `document.fonts.check('16px "Nunito Variable"')` 为真（latin 已预缓存，D16）。
- [ ] 横幅两个动作齐全；点「稍后」后本会话不再出现，重开页面仍在。
- [ ] P5 是真重建（无 mock）；P2/P3 是真断网（`context.setOffline`）。
- [ ] 横幅：`role=status`、按钮有可访问名、≥24px 目标、390px 不溢出、对比度进 a11y 扫描。
- [ ] 无 CSP violation；控制台无 SW 报错。
- [ ] `pnpm verify` 与 `pnpm test:e2e` 全绿，数字与 docs/15 一致。
- [ ] docs 已按「只写当前事实」直接改写（§16），未新增变更记录。

## 16. 文档同步

| 文件                     | 段落                       | 动作                                                   |
| ------------------------ | -------------------------- | ------------------------------------------------------ |
| `docs/12-ui-layer.md`    | §6 启动链路、§7 app 层     | 补「SW 注册 → 首帧 → 更新提示」三步与 dev 不注册的约束 |
| `docs/13-roadmap.md`     | §2 P2 CI/视觉、§3 平台挂账 | 勾掉 PWA 条目；保留 Linux 基线                         |
| `docs/15-testing.md`     | §2 基线、§5 已知缺口       | 加 pwa.spec 例数与单测数；删「PWA 未做」               |
| `docs/02-data-engine.md` | §6.1 存储状态              | 「estimate 含 SW 缓存」一句                            |
| `docs/19-assets.md`      | 失败回退                   | 外链图片离线仍走占位重试（SW 不接管跨源）              |
| `docs/21-multi-tab.md`   | 更新/刷新                  | SW 更新只刷新点击方；角色重判                          |
| `AGENTS.md`              | 当前状态                   | 完成后更新基线与下一阶段                               |
| `specs/pwa.md`           | §17                        | 实施后填复审记录（实测数字、偏差与理由）               |

## 17. 复审记录

（实施完成后由设计方填写：实测数字、与设计的偏差、为何接受、遗留项。）
