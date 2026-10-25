# 21 — 多标签（单写者 + 只读跟随）

## 1. 目标与边界

同一 docId 在整台浏览器里同一时间只有一个可写标签；其余标签只读，写者离开后自动接管。

单机阶段没有跨标签实时同步（docs/02 §10）：follower 显示的是它打开时的快照；接管 =
整页刷新后以 leader 身份重载最新落盘状态。角色在应用壳（`packages/app`）取得，SDK 只
消费 `editable`；绕过 app 壳直接 `new BoardSDK()` 的宿主没有多标签保护（已知边界）。

## 2. 角色与锁

- 角色 `TabRole`：`pending → leader | follower | solo`；`leader` / `solo` 即本标签对该
  docId 唯一写者（`ITabSessionState.writable`）。
- Web Locks 排他锁是唯一事实来源，锁名 `spinth-doc-write:<docId>`（按 docId 而不是按
  浏览器——两个标签看不同文档时都该能写）；锁由页面持有，页面销毁浏览器自动释放。
- `TabSessionService`（core `platform/tabSession`）：`tryAcquire` 成功 = leader；返回
  null = follower 并 `wait()` 排队。降级分两种语义：**`navigator.locks` 缺失或
  `tryAcquire` 抛错 = solo**（可写、无提示、无跨标签保护——与资产 GC 的降级口径
  一致，docs/19 §5）；**排队后 `wait` 抛错 = 保持 follower 只读**（能排队即确有
  写者，不允许降级成第二个写者），30s 退避后重排。
- 浏览器端口 `createBrowserLockPort()`：`ifAvailable` 在锁被占用时**仍会调用 callback**
  （传 null），必须显式判空（与 docs/19 §5 的 GC 锁同一个坑）。
- `ITabLockPort` 是注入端口：生产 = Web Locks，单测 = 内存桩。

## 3. 启动时序

锁 → 角色 → 画布。app 壳经 `tabSessionFor(docId)` 取页面级单例 session：生命周期 =
本标签页，不是 SDK 实例；StrictMode 双挂载复用同一 session，`start()` 幂等。
`role === pending` 时不挂载 Board（loading 覆盖层在场）——`editable` 从第一帧起就是
终值，不存在「先可写、后降级」的窗口。

## 4. 只读语义

三处同时生效：

- **UI/命令**：`editable: false` 走既有闸门（viewport 指针分发整条丢弃、keyboard /
  clipboard / boardCommands / image 守卫，docs/09）。
- **磁盘**：`writeEnabled === false` 时 `DbProvider.attach(..., { readOnly: true })` ——
  **新**文档 update 直接丢弃（首次 warn 一次）、compaction 与 legacy 迁移写跳过
  （旧库 update 只应用到内存，不写新库、不删旧库，主写者会完成迁移）；已进写缓冲的
  增量仍正常 flush 落盘——只读只拒绝新写，不滞留未落盘状态。`setEditable(true)` 经
  `engine.setWriteEnabled` 同步恢复写入，运行时切回不丢写。
- **维护链**：app 传 `assetMaintenance = 基线 && writable`；core 侧 `composeBoard`
  调度与执行前再各断言一次 `config.editable !== false`。

只读可交互面矩阵（呈现层与命令层各守其半——命令层是安全网，矩阵保证 UI 不出现
「看起来可点但静默 no-op」的入口）：

| 入口                                                     | 只读表现                                              | 实现层 |
| -------------------------------------------------------- | ----------------------------------------------------- | ------ |
| 工具坞：写工具（shape/text/line/pen/eraser/sticky/mind） | 禁用                                                  | react  |
| 工具坞：cursor / hand                                    | 可用                                                  | react  |
| 工具坞：undo / redo / delete                             | 禁用                                                  | react  |
| 画布指针：选择 / 拖拽 / 框选 / 绘制                      | 丢弃                                                  | core   |
| 右键：命中元素                                           | 不选中、不出元素菜单；出画布菜单                      | core   |
| 右键菜单：复制/剪切/置顶/置底/删除                       | 不出现（元素菜单不可达）                              | core   |
| 右键菜单：粘贴                                           | 禁用（`canPaste` 恒 false）                           | core   |
| 右键菜单：导出画布 PNG / 适应屏幕                        | 可用（读操作）                                        | —      |
| ActionBar（含删除、样式）                                | 不渲染                                                | react  |
| MindAddButtons（脑图 ＋）                                | 不渲染                                                | react  |
| 键盘：工具键 / 删除 / undo                               | 拦截                                                  | core   |
| 键盘：缩放四键 / F / Esc / 空格抓手                      | 可用                                                  | core   |
| 键盘：Shift+F10 / Menu（键盘开菜单）                     | 可用（画布菜单，同右键只读分支）                      | core   |
| 项目菜单：导入                                           | 禁用                                                  | app    |
| 项目菜单：导出 / 新建画布 / 主题 / 存储面板              | 可用（读/导航；新建画布导航到新 docId，天然是新写者） | —      |

右键是 DOM 事件（不经 viewport 指针分发），`ContextMenuService` 只读自守：不做命中
测试的就地选中、`onWidget` 恒 false、`canPaste` 恒 false——菜单降级为画布菜单，只保留
读操作。只读态选择/复制不放开：选择松手会走 selector 的 engine.transact 落库，放开
等于半个写者。

运行时降级 `updateEditable(false)`（core `boardCommands`）按序收口（顺序本身是语义）：
`exitActive()`（编辑会话先落库）→ 手势 cancel（`rectEditor.cancelGesture()`——缩放/旋转
是 window 级监听不经 viewport 路由，不显式取消则抬手仍会写库；viewport 路由的手势：
写工具走 `setCursorMode('cursor')`——viewport 内部对旧模式发 cancel，已 cursor/hand
直接 `dispatchGestureCancel`——恰好一次不双发）→ `editable$.next(false)`（先翻闸门，
派生态首算即只读）→ `setSelected([])`（选区框/ActionBar/MindAddButtons 连带消失）+
`contextMenu.close()`（已打开的菜单不再留死按钮）→ `setWriteEnabled(false)`（最后拒写，
不吞步骤①可能刚产生的文本提交）。切回可写只翻闸门 + 恢复写，不恢复工具/选区
（无记忆）。`BoardCommands.setCursorMode` 带只读钳制：非 cursor/hand 的模式落为
cursor（宿主可编程入口不得让 UI 宣称「可以画」而指针已被丢弃；空格临时抓手走
ViewportService 内部直调，不经此闸门）。空画布引导（app 壳）只读不显示——引导全是
写指令，只读不可执行。

物理断网（`editBlocked`）是与只读相互独立的另一条闸门（docs/10 §4）。单机不传
`wsUrl` → `blockOnOffline=false` → `editBlocked` 恒 false：断网仍可编辑、撤销、
落盘，`OfflineBar` 不可达（仅协同宿主可达）。`editBlocked` 交互面矩阵留到协同
批次，不并入本表。

UI：顶栏只读徽标（`data-spinth-readonly-pill`，按角色区分提示文案）+ 只读提示条
（`ReadOnlyNotice`，`data-spinth-readonly-notice`，follower 专属，可会话内关闭）。

## 5. 接管

- follower 的 `wait()` 排队获得锁后延迟 `PROMOTION_DELAY_MS = 300` 整页刷新
  （`location.reload`）。300ms 的两个作用：① 刷新/跳转的 leader，其新页面会在这段
  时间排进锁队列，刷新完成后优先拿回锁（刚刷新的前台标签不会反被另一个标签抢成
  只读）；② 覆盖 pagehide 时 100ms 写聚合窗口的 flush。
- 再过 `PROMOTION_FALLBACK_MS = 1000` 页面仍存活（接管回调没导航、留下陈旧写者）→
  释放锁、回 follower、warn；`RETRY_DELAY_MS = 30_000` 后自愈重排一轮
  （`wait()` 失败与接管回调失效共用；低频重试，不做 1s 级——会与失效回调或
  持续失败的 `wait` 组成高频循环）。写者离开后仍可自动接管，不需手动刷新。
- `pagehide` 主动 `release()` 让锁（否则跳到新文档后旧页面进 bfcache 仍持旧 doc 的锁，
  另一标签永久只读）；`pageshow(persisted)`（bfcache 恢复，内存状态必然过期）整页刷新。

## 6. 已知限制

- follower 是打开时的快照；提示条说明「关闭那个标签后本页会自动接管并刷新」。
- 接管刷新丢视口/选择；不做原地重建 Y.Doc（replay/undo/选区/空间索引一致性成本）。
- ≥3 个标签同时等待时，关闭写者可能触发多次刷新（每个标签至多一次），最终收敛到一个写者。
- bfcache：pagehide 释放是尽力而为；释放失败时另一标签会一直等到该页面被销毁。
- leader 崩溃：最后 ≤100ms 未 flush 的 op 丢失（docs/02 §6 写聚合窗口）。
- 无 Web Locks 的环境（老浏览器/受限环境）降级 solo，无跨标签保护。
- `writeEnabled` 与宿主 `setEditable(false)` 绑定：只读宿主不再落盘。
- 非目标：BroadcastChannel 实时同步、跨标签 undo 合并、只读态选择/复制/导入、
  Web Locks 后备实现。

## 7. 测试锚点

- 单测：`packages/core/src/__tests__/tabSessionService.test.ts`（角色判定/接管/降级/
  幂等/竞态/自愈重排）；`browserLockPort.test.ts`（注入锁桩：ifAvailable null 判空/
  持锁/幂等释放/reject 传播）；`dbProvider.test.ts`（只读写保护、切只读冲刷、切回
  恢复、只读 attach、legacy 迁移跳写、dispose 冲刷）；`dataEngineService.test.ts`
  （writeEnabled 透传）；`contextMenuReadonly.test.ts`（右键只读：不建选区/画布菜单
  降级/canPaste 恒 false）；`updateEditable.test.ts`（降级序列与翻闸门相对位/手势收口
  恰好一次/切回可写无记忆/只读工具钳制）；`rectEditor.test.ts`（取消缩放与旋转手势：
  撤 window 监听、预览按起点回落零写、迟到抬手不落库、跟随层通知与标脏）。
- E2E：`packages/app/e2e/multiTab.spec.ts`（同 context 双 page：leader/follower、接管、
  只读不写盘、不同 docId 并行、无锁降级、只读视图操作、390px、手动刷新、只读标签
  不跑资产维护链、只读标签双击 missing 图可重试、只读右键降级——
  `lastAssetMaintenance`/`selected$`/`__debug` 探针）；
  `smoke.spec.ts` 1.22（运行时降级收口：徽标/三键禁用/选区清除/降级后工具复位；
  只读态宿主直调写工具被钳回 cursor）。
- 单测（react）：`packages/react/src/__tests__/readonlyGate.test.tsx`（工具坞三键只读
  禁用、ActionBar/MindAddButtons 只读不渲染、schema disabled 契约三类控件）。
- DOM 锚点：`data-spinth-tab-role` / `data-spinth-readonly-notice` /
  `data-spinth-readonly-pill`（探针与断言消费）。
