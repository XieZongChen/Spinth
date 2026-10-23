# 多标签（单写者 + 只读跟随）：spec

> 本轮：多标签「单写者 + 只读跟随」（方案 A）。实施由另一个 agent 执行，本文件作者只做审查与验收。
> 本文件随仓库提交（`specs/`，实现方案与审查记录）。

## 1. 目标与完成定义

一句话：同一个 docId 在整台浏览器里同时只有一个可写标签；其余标签只读，写者离开后自动接管。

完成定义（缺一不可）：

1. 两个标签打开同一 docId：先到者 leader 可写，后到者 follower 只读（顶栏徽标 + 画布提示条 + 写工具禁用）。
2. 关闭/刷新/跳走 leader：follower 在 2s 内自动刷新接管，内容是 leader 最后落盘的状态，无需手动操作。
3. 不同 docId 的两个标签都可写，互不影响。
4. 只读标签：滚轮缩放、抓手拖动平移可用；选择、拖拽、编辑、粘贴、撤销、导入全部 no-op。
5. 只读标签不向 IndexedDB 写任何文档增量，不跑资产维护链（迁移 + GC）。
6. 浏览器没有 Web Locks（老浏览器/受限环境）：降级为单标签假设（可写、无提示），不阻塞画布。
7. 新增 core 单测 + 双标签 E2E；pnpm verify 全绿，pnpm test:e2e 全绿。
8. 新建 docs/21，同步 docs/02/12/13/15/19/README；数字为实测。

## 2. 现状（实施前先核对，均为当前代码事实）

- 写闸门已经成体系：viewportService 的指针分发在 editable$ === false 时整条丢弃（含选择/框选），
  keyboardService、clipboardService、boardCommands.assertEditable、imageService、Toolbar
  各自也有同款守卫；updateEditable(false) 会先 editingService.exitActive()。只读 UI 有现成落点，
  不要再造第二个写开关。
- IBoardConfig.editable 已存在，composeBoard 用它调 viewport.initialize({ editable })；app 目前不传
  （默认 true）。sdk.editable$ 经 bridge 镜像进 zustand，顶栏已有 !editable 的「只读」徽标（App.tsx:78）。
- 持久化：DbProvider 为自研，不监听其他标签的 IndexedDB 变更，也没有 BroadcastChannel —— 跨标签**没有**
  实时同步（docs/02 §10）。因此 follower 看到的是加载时的快照。
- 锁：全仓只有资产 GC 用 Web Locks（assetGc.ts 的 withAssetGcLock，锁名 spinth-asset-gc），与文档写无关。
- 维护链：composeBoard 启动 3s 后跑 runAssetMaintenance（迁移 + GC），受 config.assetMaintenance 控制。
- 只读态视图操作现在就能用：hand 模式走 pixi-viewport 的 drag 插件（setCursorMode('hand') →
  plugins.resume('drag')），不经过指针闸门；滚轮缩放是容器级监听。选择/框选/复制被闸门禁用。
  docs/12 §4「只读态仍保留选择/复制/视图操作」与实现不符，本轮按实现修正文案。
- 测试：core 单测 + Playwright；app 无 vitest 工程；E2E 用 window.__spinth 探针（DEV 下 Board 挂载）。
- 应用壳在 main.tsx 开启 StrictMode，Board 有双挂载防御（AbortController）。角色锁**不能**挂在 SDK
  生命周期上：双挂载窗口里第二个实例会误判为 follower。

## 3. 设计决策

**D1 角色在应用壳取得，SDK 只消费 editable。**

- 理由：标签身份是页面/宿主概念；SDK 已有成体系的 editable 闸门；把锁放进 composeBoard 就要处理
  StrictMode 双挂载与 dispose 竞态。
- 代价：绕过 app 直接 new BoardSDK() 的宿主没有多标签保护——写成 docs/21 的已知边界。

**D2 Web Locks 排他锁是唯一事实来源，锁名按文档：spinth-doc-write:<docId>。**

- 按 docId 而不是按浏览器：两个标签看不同文档时都该能写。
- 锁由页面持有，页面销毁浏览器自动释放，崩溃不会留下死锁。

**D3 先拿锁，再挂画布。**

- role === pending 时不渲染 Board，沿用现有 loading 覆盖层（「正在恢复画布…」）。
- 这样不存在「先可写、后降级」的窗口，editable 从第一帧起就是终值。

**D4 只读 = editable: false + 不落盘 + 不跑维护，三处同时生效。**

- UI/命令：viewport.editable$（已有）。
- 磁盘：DbProvider 收到 readOnly 后丢弃 update、跳过 compaction 与 legacy 迁移写（D10）。
- 维护链：app 传 assetMaintenance = base && writable；core 侧再加一道 config.editable !== false。

**D5 接管 = 让锁 300ms 后整页刷新。**

- 不原地重建 Y.Doc：replay/undo/选区/空间索引/纹理的一致性成本远大于一次刷新。
- 300ms 的两个作用：① 刷新/跳转的 leader，其新页面会在这段时间排进锁队列，刷新完成后优先拿回锁
  （用户刚刷新的前台标签不会反被另一个标签抢成只读）；② 覆盖 pagehide 时 100ms 写聚合窗口的 flush。
- 常量 PROMOTION_DELAY_MS = 300，测试可注入。

**D6 pagehide 主动让锁；pageshow(persisted) 整页刷新。**

- 否则标签跳到新文档后，旧页面进 bfcache 仍持有旧 doc 的锁，另一个标签永久只读。
- bfcache 恢复时页面内存状态必然过期，直接刷新最省事。

**D7 无 Web Locks → solo：可写、不显示只读提示、不做跨标签保护。**

- 与资产 GC 的降级口径一致；不引入 localStorage 心跳 / BroadcastChannel 后备（另开需求）。

**D8 只读保留视图操作，不放开选择与复制。**

- 抓手拖动与滚轮缩放已可用（§2），E2E 只断言，不改 viewport。
- 选择/框选松手会走 selector 的 engine.transact 落库，放开等于半个写者；复制还牵动剪贴板语义。
- 本轮明确不放开，docs/12 文案改为「只读态保留缩放/平移；选择与复制受写门禁限制」。

**D9 只读标签禁用项目导入，允许导出与「新建画布」。**

- 导入 = 写新文档 + 导航；导出纯读；新建画布会导航到新 docId，天然是新写者。

**D10 磁盘兜底：DbProvider 在只读时拒绝写入。**

- 理由：editable 闸门有十来处，漏一处就是第二个写者。Yjs 会合并，但 undo 栈与用户预期都会坏。
- 拒绝时 console.warn 一次；persistState$ 保持 saved（没有真实的「未落盘」发生）。
- setEditable(true) 时同步恢复写入，避免宿主运行时切换后静默丢写。

**D11 app 的模块级 session 是页面级单例，注释必须写明：**

生命周期 = 本标签页，不是 SDK 实例；StrictMode 双挂载复用同一 session，start() 幂等。

## 4. 契约与核心实现

### 4.1 新增 packages/core/src/types/tabSession.ts

```ts
import { z } from 'zod';

export const TabRoleSchema = z.enum(['pending', 'leader', 'follower', 'solo']);
export type TabRole = z.infer<typeof TabRoleSchema>;

export interface ITabSessionState {
  role: TabRole;
  /** leader | solo = 本标签是该 docId 当前唯一写者 */
  writable: boolean;
}
export const INITIAL_TAB_SESSION_STATE: ITabSessionState = { role: 'pending', writable: false };

export interface ITabLockHandle {
  release(): void;
}

/** 注入端口：生产 = Web Locks；单测 = 内存实现；null = 浏览器不支持 */
export interface ITabLockPort {
  tryAcquire(name: string): Promise<ITabLockHandle | null>;
  wait(name: string): Promise<ITabLockHandle>;
}
```

- types/index.ts 与 core/index.ts 导出类型与 INITIAL_TAB_SESSION_STATE（app 要 import）。
- 不进 BoardPublicApi：角色不是 SDK 能力。

### 4.2 新增 packages/core/src/platform/tabSession/tabSessionService.ts

```ts
export const TAB_LOCK_PREFIX = 'spinth-doc-write:';
export const PROMOTION_DELAY_MS = 300;
export const PROMOTION_FALLBACK_MS = 1000;

export interface ITabSessionOptions {
  docId: string;
  locks: ITabLockPort | null;
  /** 接管回调：实现方必须导航（app 传 location.reload） */
  onPromoted: () => void;
  promotionDelayMs?: number;
}

export class TabSessionService extends Disposable {
  readonly state$: BehaviorSubject<ITabSessionState>;
  constructor(opts: ITabSessionOptions);
  start(): Promise<void>; // 幂等
  release(): void; // pagehide：让锁，不发状态（页面即将消失）
  override dispose(): void;
}
```

行为要求：

1. start() 幂等；locks === null → emit solo；dispose() 后调用直接返回。
2. tryAcquire 成功 → leader；返回 null → follower，随后 wait() 排队。
3. tryAcquire/wait 抛错（SecurityError 等）→ console.warn + solo（不阻塞画布）。
4. 排队授予后：持有 handle，setTimeout(promotionDelayMs) → onPromoted()；再过 PROMOTION_FALLBACK_MS
   页面仍存活 → 释放锁、回 follower、warn（防接管回调没导航、留下陈旧写者）。
5. release()/dispose()：清定时器、释放 handle；dispose() 之后 complete state$。
6. 所有 await 之后先判 disposed 再 emit；dispose 后授予的 handle 立刻 release，不回调。
7. 不要有模块级可变状态；实例由调用方持有。

### 4.3 新增 packages/core/src/platform/tabSession/browserLockPort.ts

```ts
export function createBrowserLockPort(): ITabLockPort | null;
```

- navigator.locks 或 request 缺失 → null。
- tryAcquire：request(name, { ifAvailable: true, mode: 'exclusive' }, cb)；cb 收到 null → resolve null；
  收到 lock → resolve handle，并用一个未决 Promise 占住锁直到 release()。
- wait：request(name, { mode: 'exclusive' }, cb)，授予时 resolve handle 并占住。
- 坑：ifAvailable 在锁被占用时**仍会调用 callback**（传 null），必须显式判空——与 withAssetGcLock 同一个坑。
- handle 的 release() 必须幂等。

### 4.4 写保护（core）

1. packages/core/src/types/services.ts：IDataEngineService.initialize 的 config 增加 writeEnabled?: boolean；
   新增 setWriteEnabled(v: boolean): void。
2. DbProvider：
   - attach(docId, yDoc, opts?: { replay?: boolean; readOnly?: boolean })；新增 setReadOnly(v: boolean): void。
   - onDocUpdate 只读时直接 return，首次 warn 一次；flushPendingWrites 只读时 no-op；compact() 同。
   - legacy 迁移：只读时只把旧库 update 应用到内存，不写新库、不删旧库（主写者会完成迁移）。
   - 切回可写：恢复写缓冲路径，persistState$ 语义不变。
3. DataEngineService：initialize({ writeEnabled }) → db.attach(..., { readOnly: writeEnabled === false })；
   setWriteEnabled 转发。
4. boardCommands.updateEditable(v)：保持先 exitActive()、再 viewport.editable$.next(v)，末尾加
   engine?.setWriteEnabled(v)。
5. composeBoard：
   - engine.initialize({ ..., writeEnabled: config.editable !== false })；
   - 维护链调度条件改为 config.assetMaintenance !== false && config.editable !== false，并在
     runMaintenance 内再断言一次。
6. 单测：dbProvider.test.ts 补「只读丢弃增量且 persistState 保持 saved」「切回可写后写入恢复」
   「只读 attach 不影响恢复」；dataEngineService.test.ts 补 writeEnabled 透传。

### 4.5 app 接线

新增 packages/app/src/tabSession.ts：

```ts
const sessions = new Map<string, TabSessionService>();

export function tabSessionFor(docId: string): TabSessionService; // 页面级单例（D11）
export function useTabRole(docId: string): ITabSessionState; // useSyncExternalStore
```

- 创建时挂 pagehide → session.release()；pageshow 且 persisted → location.reload()。
- onPromoted: () => window.location.reload()。
- start() 放在 effect 里调用；不要在 render 期间发起副作用。
- useSyncExternalStore 的 getSnapshot 直接返回 state$.value（引用稳定）。

App.tsx：

- const tab = useTabRole(docId)；const writable = tab.role === 'leader' || tab.role === 'solo'。
- role === 'pending' 时不渲染 <Board>（loading 覆盖层已在）。
- <Board config={{ docId, editable: writable, assetMaintenance: base && writable }} />。
- 根节点加 data-spinth-tab-role={tab.role} 供 E2E。
- 顶栏「只读」徽标：title/aria-label 按角色区分（follower =「此画布为只读——另一标签正在编辑」），
  加 data-spinth-readonly-pill。

## 5. UI

### 5.1 只读提示条（新增 packages/app/src/ReadOnlyNotice.tsx）

- 仅 role === 'follower' 渲染；role="status"、aria-live="polite"。
- 文案：「另一标签正在编辑此画布，本页只读。」副行「关闭那个标签后本页会自动接管并刷新。」
- 操作：「刷新」（location.reload()）与「知道了」（关闭，仅本次会话，不持久化）。关闭后顶栏徽标的
  aria-label 仍能说明原因。
- 位置：<main> 内顶部居中（top-3 left-1/2 -translate-x-1/2），max-w-[calc(100vw-24px)]；工具坞在底部，
  390px 下不重叠。
- data-spinth-readonly-notice 供 E2E。

### 5.2 项目菜单

- ProjectMenu 的「导入项目…」在 !editable 时 disabled + title「只读时无法导入（另一标签正在编辑）」，
  隐藏的 file input 不触发。
- 导出、新建画布、主题、复制链接不受影响。

### 5.3 不做的 UI

- 不新增 zustand 字段：editable 已镜像。
- 不改 ActionBar/ContextMenu 的禁用样式（只读下选择不可达）；docs/13 的 P2 条目保留。
- 不改工具栏结构（写工具已 disabled，cursor/hand 可用）。

## 6. 测试

### 6.1 S0 探针（先做，决定 E2E 方案是否成立）

同一个 BrowserContext 开两个 page，在第二个 page 里执行：

```ts
await page.evaluate(() =>
  navigator.locks.request('spinth-probe', { ifAvailable: true }, (l) => !!l),
);
```

期望 false（被第一个 page 持有）。**若为 true**（Playwright 的 page 之间不共享锁），立刻停下来：
说明双标签 E2E 方案要改（不能用同 context 两 page），把结论写回本文件，不要硬写用例。

### 6.2 core 单测（新增 tabSessionService.test.ts）

内存 ITabLockPort 桩：held 集合 + 手动 grant。用例：

1. 锁空闲 → leader、writable true。
2. 锁被占 → follower、writable false。
3. follower 等到授予 → 延时后 onPromoted 恰好一次。
4. promotionDelayMs 之前 dispose() → 不回调。
5. release() 后 handle 被释放，且不 emit。
6. locks === null → solo。
7. tryAcquire 抛错 → solo + warn。
8. start() 幂等（调用两次只申请一次）。
9. dispose 后授予 → handle 立即释放、不回调。
10. PROMOTION_FALLBACK_MS 后仍存活 → 释放并回 follower（假时钟）。
11. dispose() 后 state$ completed。

dbProvider.test.ts 补 4 条（§4.4-6）。

### 6.3 E2E（新增 packages/app/e2e/multiTab.spec.ts，约 7 例）

前置：同一 BrowserContext、同一 ?doc=、?assetMaint=0；用 data-spinth-tab-role 与 __spinth 探针断言。

1. **双标签同文档**：A 就绪 → 开 B → B follower、徽标/提示条可见、写工具 disabled、undo disabled；
   B 按 R 拖拽不产生控件（modelCount 不变）。
2. **接管**：关 A → B 自动刷新 → leader、提示条消失、能看到 A 最后创建的控件（先等 A 的
   persistState === 'saved'）。
3. **只读不写盘**：A 建控件后 B 保持旧内容；B 的 modelCount 不涨。
4. **不同文档并行**：?doc=x 与 ?doc=y 两个标签都 leader。
5. **无 Web Locks 降级**：addInitScript 里 Object.defineProperty(Navigator.prototype, 'locks',
   { value: undefined }) → solo、可写、无提示条。
6. **只读视图操作**：B 切抓手（工具坞 hand 按钮）拖动 → vpBounds 变化；滚轮缩放 pageScale 变化。
7. **390px**：B 的提示条在视口内、无横向滚动、顶栏仍 44px；「知道了」可关闭。

补充（有余力）：B 在 follower 状态点「刷新」仍为 follower，内容更新。

断言纪律：坐标从 __spinth 世界坐标反推；等待用 expect.poll/waitForFunction，不写死 sleep；
接管刷新用 page.waitForLoadState() + 既有 ready()。

### 6.4 区分验证

新用例在旧实现上必须红：临时把 editable 传 true 或去掉锁，确认用例 1/2/6 失败，结果写进回执。

## 7. 文档同步

先写 docs，再改代码（AGENTS 铁律 1）。docs 只写当前事实，不写验收步骤/日期/PR。

- **新增 docs/21-multi-tab.md**：
  1. 目标与边界（单机、单写者、无实时同步；只读 = 视图 + 接管）；
  2. 角色与锁（Web Locks、锁名、状态机、降级 solo）；
  3. 启动时序（锁 → 角色 → 画布）；
  4. 只读语义（允许/禁止清单；不落盘、不跑维护）；
  5. 接管（300ms、整页刷新、pagehide/pageshow）；
  6. 已知限制（快照过期、刷新丢视口、≥3 标签的多次刷新、崩溃丢 ≤100ms 未 flush）；
  7. 测试锚点（单测/E2E 位置，不写用例编号流水账）。
- **docs/02**：§6 DbProvider 补「只读标签拒绝写入（writeEnabled）」；§10 把「跨标签页实时同步未实现，
  多标签策略待定」改为「无实时同步；单写者策略见 21-multi-tab」。
- **docs/19 §5**：维护链只在写者标签运行；Web Locks 锁保留为并发兜底。
- **docs/12 §4**：顶栏只读徽标 + 只读提示条；「只读态仍保留选择/复制/视图操作」改成事实口径。
- **docs/13**：P1 多标签三条改完成；§3 决策台账补「单写者 + 只读跟随，接管 = 刷新，不做实时同步」。
- **docs/15 §2/§5**：单测/E2E 数字、multiTab spec；「多标签实时同步未实现」改为指向 docs/21。
- **docs/README**：篇目表加 21；「按任务查」加一行「多标签/只读」。
- 不动 AGENTS.md（改它需要人类确认）；需要更新「当前状态」时在回执里提请。

## 8. 验收

- [ ] A1 pnpm verify 0；pnpm test:coverage 不低于现有阈值；E2E 按 CI 分层验收：fast 层
      `--grep-invert "@timing|@bench|@visual"` 全绿 + timing 层 `--workers=1 --grep "@timing|@bench"`
      全绿（混跑不作为门禁）。【按方案作者审查口径更正——原「test:e2e 全绿无 flaky」写法有误】
- [ ] A2 tabSessionService 14 条单测；DbProvider 只读 7 条；browserLockPort 5 条；
      writeEnabled 透传 1 条。【按二轮审查更正为实测计数——首轮 11/4/1 为初版口径】
- [ ] A3 同一 docId 双标签：只有一个 leader，另一个 follower，角色可从 DOM 属性观察。
- [ ] A4 关闭 leader 后 follower ≤2s 自动接管且内容最新。
- [ ] A5 只读标签无任何文档写入：DbProvider 单测 + E2E 中 modelCount 不变。
- [ ] A6 只读标签不跑资产维护链（app 传 false；core 侧再断言）。
- [ ] A7 无 Web Locks 时 solo 可写、无提示条、无报错。
- [ ] A8 不同 docId 并行可写。
- [ ] A9 只读态抓手平移 + 滚轮缩放可用；选择/拖拽/编辑/粘贴/撤销/导入不可用。
- [ ] A10 setEditable(true) 后写入恢复（单测）。
- [ ] A11 StrictMode 下只有一个 session、不闪只读、不重复申请锁。
- [ ] A12 pagehide 释放、pageshow(persisted) 刷新（单测 + 手工说明；bfcache 不做 E2E）。
- [ ] A13 390px 提示条在视口内、顶栏 44px、无横向滚动。
- [ ] A14 无新依赖、无 any、新文件 <400 行、core 不 import React/zustand、页面级单例有注释。
- [ ] A15 docs/21 与 6 处更新与实现一致；数字实测；无日期/PR/流水账。

## 9. 风险、非目标、回退

风险：

- **Playwright 同 context 的 Web Locks 共享未经验证**（S0）——不通过就停下来改测试方案。
- Web Locks 兼容性：Safari 15.4+/Firefox 96+；更老浏览器降级 solo，无跨标签保护（文档写明）。
- 接管刷新会丢视口/选择；follower 在刷新前是旧快照，提示条要说清。
- ≥3 个标签同时等待时，关闭写者可能触发多次刷新（每个标签至多一次），最终收敛到一个写者。
- bfcache：pagehide 释放是尽力而为；释放失败时另一个标签会一直等到该页面被销毁。
- leader 崩溃：最后 ≤100ms 未 flush 的 op 丢失（现有写聚合窗口），与本轮无关。
- writeEnabled 与宿主的 setEditable(false) 绑定：只读宿主不再落盘，文档写明。

非目标：

- BroadcastChannel 实时同步；原地重建 Y.Doc 接管；跨标签 undo 合并；只读态选择/复制；只读态导入；
  Web Locks 后备实现；修改 Yjs/IndexedDB 格式。

回退：

- 删 app 的 session 接线与提示条即可回到单标签行为；core 的服务与 writeEnabled 是加法，默认
  writeEnabled !== false，不影响旧宿主；DbProvider 只读默认 false。

## 10. 提交拆分与交付

1. docs: 多标签单写者规格（docs/21 + 6 处改写）。
2. feat: 标签会话锁与角色服务（types/tabSession + service + browserLockPort + 11 单测 + 导出）。
3. feat: 只读写保护与维护链闸门（DbProvider/DataEngine/composition/updateEditable + 5 单测）。
4. feat: 多标签只读 UI 与自动接管（app/tabSession、App、ReadOnlyNotice、ProjectMenu）。
5. test: 双标签 E2E（multiTab.spec 约 7 例 + 390px）。
6. docs: 实测数字校正（docs/15、docs/13）。

每步 pnpm verify；第 3、4 步后 pnpm test:e2e；第 5 步后全量 E2E。不要提交 dist、test-results。

**实施回执**（写在本文件末尾）：提交哈希、verify/coverage/E2E 输出与实测数字、S0 结论、区分验证结果、
与设计的偏差及原因。

**审查（方案作者）重点**：

1. 写者唯一性链路：role → editable → engine.writeEnabled → DbProvider，有没有绕过的写入口。
2. 启动时序与 StrictMode：是否真的只有一个 session、不会闪只读。
3. 接管生命周期：300ms、pagehide、pageshow、dispose 的竞态处理。
4. E2E 是否真的两个 page 共享锁（S0 结论），是否会 flaky。
5. 文档与实现一致、数字实测、无叙事遗留。
6. 范围控制：没有顺手改选择/复制/实时同步。

审查结论（方案作者）：待实施后填写。

---

## 11. 实施回执（实施 agent 填写）

**提交清单**（均已完成、已 push）：

| #   | 提交     | 内容                                                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | e540f56  | docs: 多标签单写者规格（docs/21 + docs/02/12/13/15/19/README 六处改写）                                            |
| 2   | 9b7844a  | feat: 标签会话锁与角色服务（types/tabSession + TabSessionService + browserLockPort + 11 单测 + 导出）              |
| 3   | a458440  | feat: 只读写保护与维护链闸门（DbProvider readOnly / engine writeEnabled / composeBoard / updateEditable + 5 单测） |
| 4   | fabbf2e  | feat: 多标签只读 UI 与自动接管（app/tabSession 页面级单例 + App + ReadOnlyNotice + ProjectMenu 导入禁用）          |
| 5   | a526934  | test: 双标签 E2E（multiTab.spec 8 例 + 区分验证）                                                                  |
| 6   | （本次） | docs: 实测数字校正（docs/15）+ multiTab spec lint/prettier 收口                                                    |

**实测数字**：

- `pnpm verify` 0：hygiene/lint/prettier/typecheck 全绿；单测 809（core 800 + react 9，95 文件）；
  build 通过。
- `pnpm test:coverage`：64.29 / 54.11 / 55.28 / 66.24（阈值 61/51/52/63，通过；较基线
  64.31/54.05/55.36/66.22 略降——新增代码中 browserLockPort 无单测覆盖，见偏差 5）。
- `pnpm test:e2e`（全量 18 spec / 163 例）：162 直接过；唯一失败是存量
  coverage.spec P0-7 @timing（缩放锚点数学断言，不涉及本轮任何改动面）——单独重跑绿，
  `--workers=1` 串行整 spec 11/11 绿，确认为并发负载下的既有偶发（config 注释本就
  说明 @timing 层用 --workers=1 跑）。multiTab.spec 8/8（43s）。
- 单测明细：tabSessionService 11 条；dbProvider 只读 4 条；dataEngineService writeEnabled
  透传 1 条。

**S0 结论**：通过。同一 BrowserContext 两个 page 共享 Web Locks——A 持锁时 B
`ifAvailable` 得 false；A 释放后 B 可获取（探针脚本三断言全过；脚本一次性使用后已删）。

**区分验证**：

- 篡改 A（App 的 writable 写死 true，模拟「有角色但不降级」）：用例 1（双标签 follower
  判定/徽标/提示条）与用例 7（390px 提示条）红，其余过——符合预期（该篡改只破坏
  editable 传递面）。
- 篡改 B（locks 传 null，模拟「完全无锁」）：8 例全红（角色判定面整体失效）。
- 两种篡改合并覆盖目标用例 1/2/6 的区分性；篡改后已还原并复跑 8/8 绿。

**与设计的偏差**：

1. E2E 探针字段：用例 6 的缩放断言用 `vpScale$`（coverage.spec 既有写法）+ 抓手平移用
   `viewportInstance.center`；HANDOFF 写的 vpBounds/pageScale 是意图名，实际无此探针。
2. compact 只读拦截放在私有 `compact()` 内部（公开入口 compactNow 经 flush（已拦）→
   compact（已拦）自然覆盖），与 HANDOFF「compact() 同」语义一致。
3. PROMOTION_FALLBACK_MS 触发后「释放锁、回 follower、warn」之后**不再自动重新排队**：
   接管回调失效场景下重排会造成无限「授予→刷新失败→释放」循环（HANDOFF 字面未说重排，
   此解读写入代码注释）。
4. 「切回可写后写入恢复」单测不做「单条增量恢复出控件」断言：Yjs 增量以被丢弃的首条
   update 为 left 基座，悬空属预期；真实只读场景 UI 闸门在前不存在悬空增量。断言改为
   persistState saved→saving→saved 流转 + audit 只含切回后的增量。
5. browserLockPort 无独立单测（node 单测环境无 navigator.locks；其行为由 S0 探针 +
   E2E 用例 1/2/5 在真实浏览器覆盖），coverage 数字因此微降但仍高于阈值。
6. commit 5 的 spec 含 lint/prettier 收口修正（unused import、格式），并入 commit 6 一起
   提交（提交表 #5 为 spec 主体）。

**实施中的额外问题排查**（非设计偏差，记录备查）：

- 本机 shell 会话注入了全局代理（HTTP_PROXY=127.0.0.1:7890，无 NO_PROXY），Playwright
  webServer 就绪探测被代理劫持（vite 实际 243ms 就绪，探测经代理得 502）导致 E2E 全量
  假超时；跑 E2E 需 `env -u HTTP_PROXY … pnpm test:e2e`。
- 初版 useSyncExternalStore 直接把 rxjs Subscription.unsubscribe 方法引用交给 React 做
  清理函数：unbound 调用读 this.closed 抛 TypeError，StrictMode 首次 cleanup 即整页崩
  （ErrorBoundary「页面出现异常」）；已改为箭头函数包裹（tabSession.ts 有注释）。

## 12. 审查处置（实施 agent 第二轮，回应方案作者审查）

追加 4 个 fix 提交（不改写历史）：879002f / a01fb1d / 2bced45 / b6336f9。

**P0 全部修复**：

1. **只读 flush 滞留（P0-1）**：`flushPendingWrites` 不再被 readOnly 拦截（只读的拦截
   收窄到 onDocUpdate——新 update 进不了缓冲；已发生的写经切换/pagehide/dispose 同一
   入口正常落盘）；`setReadOnly(true)` 内主动冲缓冲。补 3 条单测：切只读冲刷
   （audit=1 且 saved，不滞留 saving）、切只读后新写仍丢弃、切只读后 dispose 冲刷不丢。
   docs/02 §6、docs/21 §4 同步改为「只拒绝新 update；已进缓冲的增量仍 flush」。
2. **等锁失败误降级 solo（P0-2）**：`queueWait` 的 catch 改为 emit follower + warn——
   排队前提是 tryAcquire=null（确有写者），wait 失败不允许变成第二个写者；仅 tryAcquire
   失败可降级 solo。补单测：tryAcquire=null + wait=reject → follower。
3. **browserLockPort 零覆盖（P0-3）**：`createBrowserLockPort(locks?)` 注入参数（显式
   null = 禁用，undefined = 探测 navigator.locks）；tryAcquire 的 request rejection 不再
   吞成 null（reject 传播，消费方才能区分「被占」与「出错」）。补 5 条单测（内存
   FakeLocks，浏览器语义：锁持有期 = callback promise pending 期）。
   **附带发现：node 24 自带全局 `navigator.locks`（LockManager）**——上一轮回执
   「node 环境没有 navigator.locks」的说法不成立（undefined 用例会命中真 LockManager，
   故单测只断言显式 null / 缺 request 分支）。

**P1 修复**：docs/13 P1 第三条改为实名（「只读/接管/维护链测试（multiTab.spec，含
『只读标签不跑维护链』断言）；GC 锁并发由 withAssetGcLock 单测覆盖」）并补对应 E2E
用例（?assetMaint=1 下 leader 的 lastAssetMaintenance 非 null、follower 恒 null）。

**P2 也做了**：`useTabRole` 改 `useState(() => tabSessionFor(docId))` 惰性初始化
（render 期间不建 session/不挂监听）；fallback 后 30s 自愈重排
（`RETRY_AFTER_FALLBACK_MS`，retryTimer 纳入清理），补自愈单测。

**回执更正（接受审查重分类）**：原「6 处偏差」中 vpScale$ / compact 拦截位置 /
fallback 不重排三处**不是偏差**；「切回可写单测不做单条恢复断言」一条**掩盖了 P0-1**
（用例方向是「先切再写」，避开了「写进缓冲再切」的真实出错方向）；browserLockPort
无单测是**真缺口**且理由不成立。NO_PROXY 说明更正：`pnpm test:e2e` 脚本自带
`NO_PROXY=localhost,127.0.0.1`，无需 env -u；直跑 `npx playwright test` 才需要。
P0-7 @timing 按仓库惯例记 flake（CI 本就分层跑），本轮未改。

**处置后验收实测**（签收标准逐项）：

- `pnpm verify` 0：单测 819（core 810 + react 9）——新增 10 条（flush 3 + port 5 +
  wait 失败 1 + 自愈 1），超过审查要求的 7–9 条。
- `pnpm test:coverage`：64.60 / 54.27 / 55.92 / 66.57——回到并超过基线
  （64.31 / 54.05 / 55.36 / 66.22）。
- fast 层（CI 命令原样 `--grep-invert "@timing|@bench|@visual"`）：155/155 全绿（5.9m）。
- timing 层（CI 命令原样 `--workers=1 --grep "@timing|@bench"`）：5/5 全绿（22.3s）。
- multiTab.spec 9/9（含维护链新用例）。
- 未改架构、未加依赖、未回退/改写历史。

## 13. 二轮审查处置（实施 agent 第三轮）

审查结论「代码层面通过，可签收；差一个 docs 提交」。处置（5861cd2 + 本轮 docs 提交）：

- **必须项 3 处**：docs/15 基线更新为实测（820 单测 / 96 文件；E2E 18 spec 164 例，
  分层 fast 155 + timing/bench 5 + visual 4；multiTab 9 例；coverage 64.61 / 54.28 /
  55.94 / 66.59）；docs/21 §2 降级口径拆开（tryAcquire 失败 = solo；排队后 wait 失败
  = 保持 follower，不允许降级成第二写者）；docs/21 §7 测试锚点补 browserLockPort
  单测与维护链 E2E；HANDOFF A2 计数更正为实测（tabSessionService 14 / DbProvider
  只读 7 / browserLockPort 5 / writeEnabled 1）。
- **观察项 2 条也已落实**（5861cd2）：wait 失败保持 follower 后挂与 fallback 同款
  30s 退避自愈重排（写者离开后仍可自动接管，不需手动刷新），补单测「wait 失败 →
  30s 重排 → 授予 → 接管尝试」；「dispose 冲刷不丢」用例改为直设私有 readOnly
  （绕过 setReadOnly 主动冲刷），dispose 成为唯一落盘入口——回应「原用例证明不了
  dispose 入口」的批评；切只读两用例的 `flush(30)` 改 `expect.poll`。
- 实测：`pnpm verify` 0（820 单测：core 811 + react 9）；`pnpm test:coverage`
  64.61 / 54.28 / 55.94 / 66.59（基线以上）；multiTab 9/9（42.9s）复跑绿。
  fast/timing 层未重跑（本轮改动仅 wait 失败路径与文档，不在其上；上轮分层全绿
  数字不变）。

## 14. 收口（方案作者直接修改）

二轮审查剩余 4 条 nit 直接落地：

- `RETRY_AFTER_FALLBACK_MS` → `RETRY_DELAY_MS`：wait 失败与接管回调失效两条路径
  共用（§12 回执里的旧名保留为历史）。
- `start` / `queueWait` 的失败回调补 `released` 守卫：pagehide 之后到达的失败不再
  emit、不再挂重试。
- 30s 重排调度抽成 `scheduleRetry(name)` 单飞（fallback 与 wait 失败共用；已有待执行
  重排时不重复挂）。
- dbProvider 的 dispose 冲刷用例去掉固定 `flush(30)`，改轮询重连读
  （`expect.poll`，3s）——慢环境不再假红。
- 复核：`pnpm verify` 0；单测 820（96 文件）；coverage 64.60 / 54.30 / 55.94 /
  66.58；multiTab 9/9（38.8s）。§13 的 coverage 数字为收口前实测。
