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

只读标签允许：滚轮 / Cmd 缩放、抓手平移、导出项目、新建画布（导航到新 docId，天然是
新写者）。禁止：选择/框选、拖拽、编辑、粘贴、撤销、导入项目（菜单项 disabled）。
「选择与复制受写门禁限制」——选择松手会走 selector 的 engine.transact 落库，放开等于
半个写者，本阶段明确不放开。

UI：顶栏只读徽标（`data-spinth-readonly-pill`，按角色区分提示文案）+ 只读提示条
（`ReadOnlyNotice`，`data-spinth-readonly-notice`，follower 专属，可会话内关闭）。

## 5. 接管

- follower 的 `wait()` 排队获得锁后延迟 `PROMOTION_DELAY_MS = 300` 整页刷新
  （`location.reload`）。300ms 的两个作用：① 刷新/跳转的 leader，其新页面会在这段
  时间排进锁队列，刷新完成后优先拿回锁（刚刷新的前台标签不会反被另一个标签抢成
  只读）；② 覆盖 pagehide 时 100ms 写聚合窗口的 flush。
- 再过 `PROMOTION_FALLBACK_MS = 1000` 页面仍存活（接管回调没导航、留下陈旧写者）→
  释放锁、回 follower、warn；`RETRY_AFTER_FALLBACK_MS = 30_000` 后自愈重排一轮
  （低频重试，不做 1s 级——会与失效回调组成无限循环）。`wait()` 失败保持
  follower 后走同款 30s 退避重排——写者离开仍可自动接管，不需手动刷新。
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
  （writeEnabled 透传）。
- E2E：`packages/app/e2e/multiTab.spec.ts`（同 context 双 page：leader/follower、接管、
  只读不写盘、不同 docId 并行、无锁降级、只读视图操作、390px、手动刷新、只读标签
  不跑资产维护链——`lastAssetMaintenance` 探针）。
- DOM 锚点：`data-spinth-tab-role` / `data-spinth-readonly-notice` /
  `data-spinth-readonly-pill`（探针与断言消费）。
