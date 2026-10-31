# 纹理保活 — 技术方案与架构设计

> 范围：[docs/13](../docs/13-roadmap.md) §2 阶段 1.2（发布前工程债）。
> 状态：**已实施**（三笔落地：池重构 → 行为启用+测试 → 文档同步；§7 全部用例与 §7.5 验收达成）。本文定方案、契约与验收；实现以代码为准。
> 关联：[docs/19 §3/§5](../docs/19-assets.md)、[docs/16 §6](../docs/16-performance.md)、
> [specs/assets-lifecycle](assets-lifecycle.md) §3.2/§5.4。
> 铁律核对：只动渲染侧缓存生命周期，不碰 Yjs 写路径；不新增公共 API；不新增全局单例。

## 0. 结论（拍板表）

| 编号 | 问题                                            | 结论                                                                            |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| D1   | 保活条目是否继续持有 URL 租约、是否计入 GC 持活 | **是**。条目从建纹到销毁恰好持有一份 URL 租约；保活只推迟销毁时点，不改变所有权 |
| D2   | 保活作用范围                                    | 仅 `spinth-asset:` 缓存条目；data/http 维持「释放即销毁」                       |
| D3   | 默认参数                                        | 5s / 8 条 / 32 MiB（内部常量，构造参数可配；**不进** `IBoardConfig`）           |
| D4   | 页面生命周期                                    | `pagehide` → 立即清空**空闲**条目与全部保活定时器；不监听 `visibilitychange`    |
| D5   | 超限策略                                        | 空闲条目按进入空闲的先后作 LRU，逐出即销毁；单条估算显存超预算则不保活          |
| D6   | 可观测性                                        | `debug()` 增加 `entries[].idle` 与 `keepAlive {count,bytes}`；E2E 探针同步扩展  |

一句话：**引用归零后纹理不立即销毁，进入有界空闲池；窗口内重新 acquire 直接复用，窗口结束或被预算逐出才 `destroy(true)` 并归还 URL 租约。**

## 1. 目标与非目标

### 1.1 目标

| ID  | 目标                                                                                  |
| --- | ------------------------------------------------------------------------------------- |
| G1  | 删除图片后 5s 内 undo：复用同一 GPU 纹理，不重新 `decode`/`createTexture`，无占位闪烁 |
| G2  | 快速切 src A→B→A：窗口内切回 A 直接复用，不重新解码                                   |
| G3  | 保活内存有界：空闲条目数 + 估算显存双上限，超限按 LRU 立即销毁                        |
| G4  | 定时器零泄漏：`dispose` / `pagehide` 后不再有回调；重复销毁幂等                       |
| G5  | 行为零变化：Yjs 数据面、渲染像素、公开 API（`BoardPublicApi` / `IBoardConfig`）均不变 |

### 1.2 非目标

- 不做预取/预热（不加载未上屏的图片）。
- 不给 data URL / http(s) 做保活（沿用「每次加载独立建纹、释放即销毁」）。
- 不做跨标签/跨文档纹理共享；缓存仍是每个 SDK 实例一份。
- 不改资产 GC 算法、不改 `AssetStore` 的 objectURL 计数语义。
- 不暴露宿主级配置；不因本项扩大公开 API 面。
- 不新增 `visibilitychange` 清理策略（见 D4 的取舍）。

## 2. 现状与约束

### 2.1 代码地图

| 文件                                                     | 现状                                                       | 本项关系                       |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `packages/core/src/widgets/image/imageTextureCache.ts`   | 221 行：按 assetId 共享、refs 归零即 `destroyEntry`        | 主改文件                       |
| `packages/core/src/widgets/image/imageLoadController.ts` | 195 行：token 会话、租约唯一释放点 `releaseCurrent`        | 不改契约                       |
| `packages/core/src/widgets/image/imageVm.ts`             | 232 行：先 `destroySprite` 再 `loader.dispose`             | 不改；顺序是纹理安全销毁的前提 |
| `packages/core/src/platform/dataEngine/assetStore.ts`    | objectURL 引用计数；`delete`/`sweepOrphans` 以 refs 为闸门 | 不改；D1 依赖其闸门语义        |
| `packages/core/src/boardAssemblyCore.ts`                 | L39 构造缓存（source 端口 + codec）                        | 接线点                         |
| `packages/core/src/boardTeardown.ts`                     | L41 `imageTextures.dispose()` → L42 `assetStore.close()`   | 销毁顺序不变                   |
| `packages/core/src/debugSnapshot.ts`                     | L53-56/L131-132 纹理探针类型与聚合                         | 探针扩展                       |
| `packages/app/e2e/imageLifecycle.spec.ts`                | L40-51/L100-110 断言「删后条目/租约立即归零」              | **会红，必须随行为一起改**     |

行号以当前主干为准；实施时以符号名为准。

### 2.2 必须保留的不变量

1. **单所有权**：一个缓存条目从建纹到销毁恰好持有一个 `IImageSourceHandle`；`destroyEntry` 是唯一 `source.release()` 点。
2. **释放幂等**：租约 `release` 重复调用只减一次；条目销毁后 release 为 no-op。
3. **sprite 先于纹理**：`ImageVm.dispose` 先 `destroySprite()`、再释放租约；缓存不得在 sprite 仍引用纹理时销毁纹理。
4. **销毁顺序**：`vmEngine.dispose` → `imageTextures.dispose` → `assetStore.close`（revoke 配对完整）。
5. **无 key 不共享**：data/http 走 `acquireUncached`，每次独立建纹、释放即销毁。
6. **GC 闸门**：`AssetStore.delete` / `sweepOrphans` 在 `objectUrlRefs > 0` 时跳过删除；「正在渲染/仍可复用」的资产不得被误删。
7. **GC 时机**：启动 idle 跑一次；undo 栈非空整轮跳过；协同态跳过（`assetGc` 顶部注释）。

### 2.3 现状证据（会被本项改变的断言）

- 单测 `imageTextureCache.test.ts`：`release 第二个 → destroy(true) 一次 + source 归还`、`dispose 全销毁`。
- E2E `imageLifecycle.spec.ts`「纹理共享」：第二次删除后立即断言 `entries.length === 0`、URL 租约清空。
- E2E `imageLifecycle.spec.ts`「切 src 计数配平」：切到 B 后立即断言旧 asset 的 URL 租约为 0。
- E2E `imageAsset.spec.ts`「objectURL 配平回归」：删图后 200ms 直接断言 `objectUrlRefs` 全 0、`objectUrls` 空——保活下 URL 租约仍为 1，必红。
- 探针类型：`debugSnapshot.ts` 与 `e2e/helpers/imageProbeE2e.ts`、`e2e/helpers/projectFileE2e.ts` 只声明 `{entries, pending}`。

## 3. 目标行为

### 3.1 生命周期状态机

```text
                    acquire（命中）
        ┌──────────────────────────────┐
        ▼                              │
   [live refs>0] ── release 到 0 ──► [idle refs=0] ── 窗口到期 ──► [destroyed]
        ▲                              │   ▲
        └──────── acquire（wake） ─────┘   │
                                           └── 预算逐出 / dropIdle / dispose
```

- 只有 keyed（asset）条目会进入 `idle`；transient 条目 release 即销毁。
- `idle` 期间纹理与 URL 租约都保留；定时器只属于空闲池。
- 任何销毁路径都经 `destroyEntry`：取消定时器 → 移出空闲池 → 删缓存表 → `texture.destroy(true)` → `source.release()`。

### 3.2 事件表

| 事件           | 前置                  | 动作                                        | 结果                          |
| -------------- | --------------------- | ------------------------------------------- | ----------------------------- |
| `acquire`      | 命中 live 条目        | `refs++`                                    | 发新租约                      |
| `acquire`      | 命中 idle 条目        | `wake`（取消计时、移出池）→ `refs++`        | 同一纹理，无解码              |
| `release`      | refs 降到 0，keyed    | `pool.hold(entry)`                          | 空闲，计时开始                |
| `release`      | refs 降到 0，无 key   | `destroyEntry`                              | 立即销毁（不变）              |
| 窗口到期       | 仍在空闲池            | 移出池 + `destroyEntry`                     | 纹理销毁、URL 归还            |
| 预算超限       | 插入后超条目/字节上限 | 逐出最久空闲条目                            | 立即销毁；直到回到上限内      |
| `pagehide`     | 有空闲条目            | `dropIdle()`                                | 空闲全销毁；在租条目不动      |
| `dispose`      | 任意                  | 摘监听 → 清池 → 销毁全部条目 → 兜底 pending | 幂等；此后 acquire 返回 error |
| `windowMs = 0` | release 到 0          | 不登记，直接销毁                            | 等价旧行为（测试/降级开关）   |

## 4. 关键决策

### 4.1 D1：保活期继续持有 URL 租约（核心决策）

| 方案                             | 行为                                                                                                   | 结论 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| **A. 保活期继续持租约（选）**    | 窗口结束才 revoke；GC 期间 `objectUrlRefs > 0` → 保留资产行                                            | 采用 |
| B. refs 归零即放 URL，只留纹理   | 省编码字节；但一个条目出现两个释放语义；GC 可能在窗口内删行，窗口后 undo 从「重解码」退化为「missing」 | 否   |
| C. 归零放 URL，复用时重新 `open` | 命中路径变 async 且可失败；acquire 契约被污染                                                          | 否   |

选 A 的理由：

1. **单一释放点**：`destroyEntry` 仍是对 `source.release()` 的唯一调用；不需要「提前释放 + 可能重开」的补偿状态机。
2. **命中路径保持同步**：idle → live 只是 refs++，没有 await、没有失败窗口，`ImageLoadController` 的 token 会话无需感知保活。
3. **GC 绝不误删可复用资产**：`AssetStore` 的「持活不删」闸门语义天然覆盖保活期，满足 roadmap 的硬要求。
4. **代价有界**：空闲条目最多 8 条、且受纹理字节上限约束；GC 仅启动跑一次，被保活挡下的孤儿最多留到下个会话的 GC（与任何在租资产相同），不影响正确性。

注意：`docs/19 §3` 的「归零才 `destroy(true)`」与 `specs/assets-lifecycle §5.4` 的「缓存条目在存活期持有 URL 租约」都要改写成「**存活（含保活窗口）期间持有**」。

通俗解释：纹理是已经解码好的图；URL 租约是「这份资产仍有人用」的凭证。保活 5 秒 = 图先留在桌上。如果这时把凭证退了，恰好赶上的 GC 会认为没人用，可能把库里的原图删掉，5 秒后 undo 就只能看到 missing，而不是重新解码。让凭证和纹理一起留到窗口结束，才不会有「热纹理 + 已删资产」的半截状态。

### 4.2 为什么放在缓存层，而不是 VM 或 AssetStore

- **VM 层保活 = 延迟 `ImageVm.dispose`**：会连带保留 sprite、模型订阅、事件绑定，比纹理贵得多，且 undo 恢复会复用脏 VM，违反「VM 跟随模型」。
- **AssetStore 层保活 = 缓存 blob**：只省 IndexedDB 读，不省 `decode`/GPU 上传，收益不对题。
- **缓存层**：正好拥有「解码后的纹理 + URL 租约」这一对资源；VM 删除/重建与它解耦。

### 4.3 D2：只对 assetId 条目保活

data URL 可能超长（不能作 Map key，且同内容不共享）；http 内容可变，复用旧纹理存在陈旧风险。二者继续「释放即销毁」，与 `docs/19 §3` 的现状一致。

### 4.4 D3：默认参数与配置面

```ts
windowMs: 5_000; // 窗口从最后一次 release 归零起算；0 = 关闭保活
maxEntries: 8; // 空闲条目数上限
maxBytes: 32 * 1024 * 1024; // 空闲纹理估算显存上限（32 MiB）
```

- 32 MiB 的取舍：480 边长的新贴图约 0.7 MB/张，8 张 ≈ 5.6 MB；1440×900 截图约 5.2 MB/张，约 6 张触顶；12MP 原图约 48 MB，单条即超预算 → 直接不保活（大图正是最不该留的）。
- **单条纹理估算显存 > `maxBytes` 时不保活**（直接销毁），避免「刚插入就被逐出」的无谓抖动。
- `maxBytes` 只核纹理估算；URL 租约持有的编码字节不计入（受条目数上限与贴入路径单图 5MB 上限共同约束）。
- 双上限只约束**空闲**条目；在租纹理不受预算限制（保活是回收策略，不是渲染准入）。
- 构造时对 `windowMs / maxEntries / maxBytes` 做有限数与非负钳制（`NaN`/负数回退默认），避免宿主误传导致永不逐出。
- 配置面：仅 `ImageTextureCache` 构造参数（组合根可调），**不进 `IBoardConfig`、不从 `index.ts` 导出**。1.0 公开 API 收口在即，没有宿主诉求前不扩公共面；若后续要运行时调参，按兼容变更加可选字段。
- 降级开关：组合根传 `{ windowMs: 0 }` 即恢复旧行为，无需回滚代码。

### 4.5 D4：pagehide，而非 visibilitychange

- `pagehide` 覆盖跳转/关闭/进 bfcache。回调里只清空闲条目：在租条目仍被 sprite 引用，销毁会导致 bfcache 恢复后画面破损；页面真正卸载时堆随进程回收，无需手动处理。
- 不监听 `visibilitychange`：切后台再回来仍是同一会话，保留 undo 复用更有价值；内存压力由双上限兜底。若后续真机 profiling 显示移动端后台压力大，再单独立项。
- `pagehide` 后 bfcache 恢复：空闲纹理已释放，undo 走重解码；正确性不受影响，只损失一次复用。
- 后台节流边界：隐藏标签的 5s 计时可能被延迟或冻结，空闲条目可能比窗口多留一会儿；上限 8 条 / 32 MiB 兜底，回到前台后计时继续或到期。若真机 profiling 显示移动端后台压力大，优先评估 `freeze` 而非 `visibilitychange`。

### 4.6 D6：可观测性

`debug()` 扩展为：

```ts
{
  entries: Array<{ key: string; refs: number; uid: number; idle: boolean }>;
  pending: number;
  keepAlive: {
    count: number;
    bytes: number;
  }
}
```

- `entries` 现在包含 idle 条目（`refs: 0, idle: true`）；旧注释「refs>0 存活」同步改写。
- E2E 用 `idle` 判「已进入保活」，用 `keepAlive.count/bytes` 验预算，不靠睡眠猜时序。

## 5. 设计

### 5.1 文件与职责

| 文件                                                              | 动作 | 职责                                                          |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| `packages/core/src/widgets/image/imageKeepAlive.ts`               | 新增 | 预算类型/默认值、`estimateTextureBytes`、`ImageKeepAlivePool` |
| `packages/core/src/widgets/image/imageTextureCache.ts`            | 改   | 接入池；构造参数；`dropIdle`；`dispose` 摘监听；`debug` 扩展  |
| `packages/core/src/__tests__/imageKeepAlive.test.ts`              | 新增 | 池单测（纯逻辑，假计时器）                                    |
| `packages/core/src/__tests__/imageTextureCache.test.ts`           | 改   | 集成单测（复用、到期、预算、pagehide、dispose）               |
| `packages/core/src/boardAssemblyCore.ts`                          | 改   | 注入 `lifecycle: window`（`typeof window` 守卫）              |
| `packages/core/src/debugSnapshot.ts`                              | 改   | 探针类型                                                      |
| `packages/app/e2e/helpers/imageProbeE2e.ts` / `projectFileE2e.ts` | 改   | 探针类型加 `idle` / `keepAlive`                               |
| `packages/app/e2e/imageLifecycle.spec.ts`                         | 改   | 两条旧断言迁移 + 新增 undo 复用用例                           |
| `packages/app/e2e/imageAsset.spec.ts`                             | 改   | objectURL 配平用例适配保活窗口（E4）                          |

预估体量：`imageKeepAlive.ts` ≈ 110 行；`imageTextureCache.ts` ≈ 255 行（仍 < 400）。

### 5.2 契约

```ts
export interface IImageKeepAliveBudget {
  /** 空闲窗口；0 = 关闭保活（release 即销毁）；负数/非有限由构造侧钳回默认 */
  windowMs: number;
  /** 空闲条目数上限 */
  maxEntries: number;
  /** 空闲纹理估算显存上限（字节） */
  maxBytes: number;
}

export const DEFAULT_IMAGE_KEEP_ALIVE: IImageKeepAliveBudget = {
  windowMs: 5_000,
  maxEntries: 8,
  maxBytes: 32 * 1024 * 1024,
};

export interface IImageKeepAliveTimers {
  /** 返回取消函数（与 ImageLoadController 的计时器端口同形） */
  set(fn: () => void, ms: number): () => void;
}

export class ImageKeepAlivePool<T extends object> {
  constructor(
    budget: IImageKeepAliveBudget,
    timers: IImageKeepAliveTimers,
    /** 逐出/到期回调：条目已移出池，调用方负责销毁 */
    onEvict: (item: T) => void,
    /** 估算字节数（缓存传纹理估算；池本身不认识 PIXI） */
    bytesOf: (item: T) => number,
  );
  hold(item: T): void; // refs→0：登记 + 计时 + 预算逐出；不满足保活条件时同步 onEvict
  wake(item: T): boolean; // 复用：取消计时并移出；不在池中返回 false
  forget(item: T): void; // 销毁：取消计时并移出（幂等）
  has(item: T): boolean; // 探针用
  dropAll(): void; // pagehide/dispose：逐出全部
  get stats(): { count: number; bytes: number };
}
```

`ImageTextureCache` 构造参数：

```ts
export interface IImageTextureCacheOptions {
  keepAlive?: Partial<IImageKeepAliveBudget>;
  timers?: IImageKeepAliveTimers;
  /** pagehide 来源；组合根传 window，Node 单测不传（默认 null） */
  lifecycle?: EventTarget | null;
}
```

构造签名变为 `(source, codec, options = {})`，现有两参调用保持兼容。

### 5.3 算法

```ts
// pool（空闲条目 Map 的插入序即 LRU 序；重新 hold 会移到队尾）
hold(item) {
  if (items.has(item)) return;                       // 幂等
  const bytes = bytesOf(item);
  if (budget.windowMs <= 0 || bytes > budget.maxBytes) return onEvict(item);
  const slot = { bytes, cancel: noop };
  items.set(item, slot); total += bytes;
  slot.cancel = timers.set(() => expire(item), budget.windowMs);
  while (items.size > budget.maxEntries || total > budget.maxBytes) {
    const first = items.keys().next().value;
    remove(first); onEvict(first);                   // 先移出再回调，防重入
  }
}

expire(item) {
  if (!items.has(item)) return;                      // 已被 wake/forget/dropAll 摘走
  remove(item); onEvict(item);
}

remove(item) {                                       // 只做记账，不回调
  const slot = items.get(item); if (!slot) return;
  slot.cancel(); items.delete(item); total -= slot.bytes;
}

dropAll() { for (const item of [...items.keys()]) { remove(item); onEvict(item); } }
```

```ts
// cache 接入点（仅列改动，不改变既有失败/竞态分支）
acquire 命中 live：
  keepAlive.wake(entry); entry.refs++; return lease;

release 闭包：
  entry.refs--;
  if (entry.refs > 0) return;
  if (entry.key === null) this.destroyEntry(entry);   // data/http 不变
  else this.keepAlive.hold(entry);                    // 可能同步销毁（窗口 0/超大）

destroyEntry(entry)：
  if (entry.destroyed) return;
  entry.destroyed = true;
  this.keepAlive.forget(entry);                       // 先摘计时器，再销毁
  …删 entries/transient、texture.destroy(true)、source.release()（现状不变）

dispose()：
  disposed = true;
  removeEventListener('pagehide', onPageHide);
  keepAlive.dropAll();                                // 空闲：取消计时 + onEvict→destroyEntry
  for (entry of [...entries.values()]) destroyEntry(entry);
  entries.clear();
  transient：逐条 destroyEntry；pending：then 兜底销毁（现状不变）

dropIdle()：keepAlive.dropAll();                       // pagehide 入口
```

**定时器默认实现**（不依赖 controller 的私有常量）：

```ts
const systemTimers: IImageKeepAliveTimers = {
  set: (fn, ms) => {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};
```

**显存估算**（纯函数，估算而非精确核算）：

```ts
export function estimateTextureBytes(texture: Texture): number {
  const source = (texture as { source?: { width?: number; height?: number } }).source;
  const w = finitePositive(source?.width ?? texture.width);
  const h = finitePositive(source?.height ?? texture.height);
  return w * h * 4; // RGBA；不含 mipmap/驱动开销
}
```

### 5.4 为什么用独立的池而不是散在缓存里

- 窗口 + 双上限 + LRU + 计时器是一个完整状态机；独立后可用假计时器直接测预算/顺序，不需要伪造纹理与 source。
- 缓存只保留「谁持有、何时归零」的租约语义；池只回答「还能留多久、留多少」。
- 回调在条目移出池之后触发，避免 `onEvict → destroyEntry → forget` 的重入环。

### 5.5 组合根与销毁顺序

- `assembleCore` 构造：

```ts
sdk.imageTextures = new ImageTextureCache(source, browserImageCodec, {
  lifecycle: typeof window !== 'undefined' ? window : null,
});
```

- 默认预算不进 `IBoardConfig`；`boardTeardown` 顺序不变，`imageTextures.dispose()` 仍早于 `assetStore.close()`。
- 监听器由缓存自己注册/摘除：**不新增 SDK 字段**，不触碰 `BoardPublicApi` 分类锁。
- StrictMode 双挂载：每个实例各自注册；被中止实例经 `initialize` 的 abort 路径销毁时必须走到 `dispose`（现有行为），否则监听器随实例泄漏——实施后用单测断言 `dispose` 后 `removeEventListener` 生效（假 EventTarget 可数）。

## 6. 边界与竞态

| 场景                                    | 期望行为                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `build()` 刚写入条目、refs 暂为 0       | **不得**在 build 路径登记空闲；只有 release 到 0 才 `hold`                                                                      |
| 同一租约重复 release                    | 闭包 `released` 保护；不重复减、不重复 hold                                                                                     |
| 到期回调与 acquire 同一 tick            | JS 单线程；先到者生效：先到期则 acquire 重建（丢一次复用），先 acquire 则 wake                                                  |
| dispose 时仍有空闲条目                  | 摘监听 → `dropAll` 取消全部计时 → 逐条销毁；之后到期回调不再存在                                                                |
| dispose 与在途 build                    | 现有 pending then 兜底销毁；不得再发租约（现状 `missing`）                                                                      |
| 重复 `setImageTextures`（VM 重注入）    | 前置：先 `destroySprite`（sprite 引用与租约解耦），再旧 controller dispose → release → 空闲；新会话 acquire 立即 wake，同一纹理 |
| 单条估算显存 > `maxBytes`               | 不登记，直接销毁（不产生「插入即逐出」抖动）                                                                                    |
| `windowMs = 0`                          | 直接销毁，等价旧行为（降级开关）                                                                                                |
| 一次释放后 4.9s 再次 acquire 又释放     | 计时从最后一次归零重新起算                                                                                                      |
| pagehide（含 bfcache `persisted=true`） | 只清空闲；在租纹理保留，避免恢复后 sprite 引用已销毁纹理                                                                        |
| 多标签                                  | 缓存与计时器均为每标签私有；writer 的 GC 看不到 reader 的 refs（既有边界），保活不扩大也不缩小该窗口                            |
| GC 正在跑时存在空闲条目                 | 空闲条目持有 URL 租约 → `sweepOrphans` 跳过该行，下个会话的 GC 再清；不误删                                                     |
| 纹理销毁时 sprite 仍引用                | 由不变量 3 排除：空闲只在 controller 归还租约后产生，而归还前 sprite 已销毁                                                     |
| 回调抛错                                | `destroyEntry` 已对 `texture.destroy` 兜底；`source.release` 为 AssetStore 同步操作，不吞错                                     |

## 7. 测试方案

### 7.1 单测（新增 `imageKeepAlive.test.ts`，假计时器）

| 编号 | 场景                 | 断言                                                     |
| ---- | -------------------- | -------------------------------------------------------- |
| P1   | 窗口到期             | 到期前 `onEvict` 0 次；到期恰好 1 次；`stats` 归零       |
| P2   | 窗口内 wake          | 取消计时；再推进整窗不回调                               |
| P3   | wake 后重新 hold     | 窗口重新起算（4s + wake + hold + 4s 仍存活，再 1s 到期） |
| P4   | 条目上限 LRU         | 超上限逐出最久空闲者；顺序稳定                           |
| P5   | 字节上限 LRU         | 加入后超预算 → 从最久者逐出直到回到上限内                |
| P6   | 单条超预算           | 立即 `onEvict`，不进入 `stats`                           |
| P7   | `windowMs = 0`       | 立即 `onEvict`                                           |
| P8   | `dropAll` / `forget` | 全量逐出；取消后的计时器不再触发；`forget` 幂等          |

### 7.2 单测（`imageTextureCache.test.ts` 改造 + 新增）

| 编号 | 场景                         | 断言                                                                                                                                |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| C1   | release 到 0                 | 纹理不销毁、source 不 release；`debug` 显示 `refs: 0, idle: true`                                                                   |
| C2   | 窗口内 re-acquire            | 同一纹理；`decode`/`createTexture`/`open` 不增加；URL 计数仍 1                                                                      |
| C3   | 窗口到期                     | `destroy(true)` 恰 1 次、source release 恰 1 次、entries 空                                                                         |
| C4   | 空闲时 dispose               | 计时器取消；销毁恰 1 次；之后再推进时间无二次销毁                                                                                   |
| C5   | pagehide（假 `EventTarget`） | 空闲条目销毁、在租条目保留；计时器取消                                                                                              |
| C6   | data/http 释放               | 立即销毁，不进入空闲池                                                                                                              |
| C7   | 预算集成（小 `maxBytes`）    | 第二条空闲触发第一条逐出；纹理/source 各释放 1 次                                                                                   |
| C8   | `windowMs: 0`                | 保持旧语义（release 即销毁）                                                                                                        |
| C9   | undo 路径（注入计数 codec）  | 删除→恢复不重复 decode；窗口后再次 acquire 才 decode 第 2 次                                                                        |
| C10  | 既有失败/并发/dispose 竞态   | 全部保留；仅「归零即销毁」两处改为假计时器推进后断言；另断言 acquire 后、release 前 `keepAlive.count === 0`（build 间隙不登记空闲） |

约束：单测不依赖真实 5s 计时器；构造时注入假计时器端口，测试结束 `dispose`，断言无待触发计时器。

### 7.3 E2E（`imageLifecycle.spec.ts` / `imageAsset.spec.ts`）

| 编号 | 用例                         | 变更                                                                                                                                                   |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1   | 纹理共享（现有）             | 第二次删除后：`refs=0 / idle=true` 且 URL 租约仍 1；轮询 8s 后 entries 空、租约 0（5s 窗口 + 余量）                                                    |
| E2   | 切 src 计数配平（现有）      | 切到 B 后：A 为空闲条目（`refs=0,idle=true`，租约 1）、B 在租（refs 1，租约 1）；8s 内 A 的租约归 0                                                    |
| E3   | **新增**：窗口内 undo 复用   | 删图后**立即** `ControlOrMeta+z`（undo 前不插轮询，避免 CI 停顿吃掉 5s 窗口）→ 同一 `textureUid`、refs 1、idle false、租约 1；uid 相同即证明未重新解码 |
| E4   | objectURL 配平（imageAsset） | 删图后先断言空闲持有 URL 1/1；轮询 8s 到期归零 0/0；undo 后重新 open 为 1/1（删去「200ms 内归零」断言）                                                |

探针扩展：`imageProbeE2e.ts` 的 entries 类型加 `idle`，返回 `keepAlive`；`projectFileE2e.ts` 的 `__debug` 类型同步。旧断言里「立即归零」全部改为「先 idle、后到期归零」。

E3 的 `idle` 状态由 E1/E2 与单测覆盖；E3 只验证「复用结果」，减少对时序的依赖。

### 7.4 手工验证

1. 两张图：删一张 → 立刻 undo → 无闪烁、无 loading 占位；控制台探针 uid 不变。
2. 等 6s 再 undo → 允许重新解码（占位/loading 一瞬），结果正确。
3. 连删 20 张图：空闲条目 ≤ 8、`keepAlive.bytes` ≤ 32 MiB；无报错。
4. 切后台 10s 回来：在租纹理仍在（hidden 不清理）；空闲条目按窗口到期（后台节流可能延后），滚动/缩放正常。
5. 离开页面（含 bfcache 往返）再回来：无 pageerror、无纹理已销毁的渲染异常。
6. 移动端（390px）：贴图/删图/undo 正常，内存无持续增长。

### 7.5 验收

- `pnpm verify` 全绿；`imageLifecycle.spec.ts` 定向通过后跑全量 E2E。
- 无计时器泄漏（单测假计时器待触发数为 0；`dispose` 后推进时间无回调）。
- 纹理与 URL 计数在「空闲前 / 空闲中 / 到期后」三态平衡：1/1 → 1/1 → 0/0。
- Yjs 数据面零改动；`BoardPublicApi`、`IBoardConfig` 零改动。

## 8. 文档同步（实施同批完成）

| 文件                             | 改动                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `docs/19-assets.md` §3           | 「归零才销毁」改为「归零进入保活窗口，窗口结束才销毁」；补双上限、pagehide、URL 租约持有 |
| `docs/19-assets.md` §5           | 说明保活期计入 GC 持活、孤儿最多留到下个会话的 GC                                        |
| `docs/16-performance.md` §6      | 「已落地」补纹理保活；「仍需关注」删去 1.2 待办                                          |
| `docs/13-roadmap.md` §1/§1.2/§2  | 勾选 1.2；同步测试计数与下一阶段入口；把「pagehide 清全部条目」修正为「清空闲条目」      |
| `docs/15-testing.md` §2          | 更新单测/E2E 计数与图片专项描述                                                          |
| `specs/assets-lifecycle.md` §3.2 | 备选表里「纹理保活」标注已落地并指向本文                                                 |
| `AGENTS.md` 当前状态             | 补一句纹理保活（按约定需人类确认后改）                                                   |

## 9. 实施步骤（每步独立可回退）

1. **纯重构**：新增 `imageKeepAlive.ts` + 池单测；`ImageTextureCache` 接入，**组合根与现有缓存单测都显式传** `{ keepAlive: { windowMs: 0 } }`（旧断言原样通过，行为零变化）。`pnpm verify`。
   提交：`refactor: 抽纹理保活池（默认关闭，行为零变化）`
2. **启用行为**：默认 5s/8/32MiB；组合根注入 `lifecycle`；缓存单测改造 + 新增；E2E 断言迁移 + 新增 undo 用例。
   提交：`feat: 纹理保活窗口（5s/双上限 LRU/pagehide）`
3. **文档同步**：§8 清单。
   提交：`docs: 同步纹理保活事实`

第 2 步必须带 E2E 改动一起提交（旧断言会红）。若审查希望更小步，可把第 1 步拆成「池」与「缓存接入」两笔，但不得让默认窗口与 E2E 断言分属不同提交。

## 10. 风险与回滚

| 风险                         | 处理                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| E2E 因 5s 窗口变慢/抖动      | 探针断言 idle，不猜时序；到期只在一个用例里等（8s 超时）；不并行睡眠    |
| 移动端保活内存压力           | 双上限 + 单条超限不保活 + pagehide 清理；真机 profiling 后可调小预算    |
| GC 孤儿延后清理              | 有界：最多留到下个会话启动；与任何在租资产同语义，不改 GC 算法          |
| bfcache 恢复后 undo 重新解码 | 可接受；正确性优先于一次复用                                            |
| 计时器/监听器泄漏            | 单一销毁入口 + 假计时器/假 EventTarget 断言；`dispose` 后推进时间无回调 |
| 误在 build 路径登记空闲      | 单测覆盖「build 完成前后不产生空闲计时器」                              |
| 后台定时器节流               | 5s 是尽力而为、非硬保证；上限兜底；回前台后计时继续或到期               |
| 紧急降级                     | 组合根把 `keepAlive.windowMs` 传 0，一笔提交恢复旧行为                  |

## 11. 决策状态（实施前）

| #   | 事项                                                                  | 状态                         |
| --- | --------------------------------------------------------------------- | ---------------------------- |
| 1   | 默认值 5s / 8 条 / 32 MiB                                             | 已拍板（接受）               |
| 2   | D1：保活期继续持 URL 租约（§4.1）                                     | 已拍板（接受）               |
| 3   | 配置面只在构造参数、不进 `IBoardConfig`                               | 已拍板（接受）               |
| 4   | E2E 因到期等待增加约 10–15s                                           | 已拍板（暂时接受，后续评估） |
| 5   | `pagehide` 只清空闲、不监听 `visibilitychange`（后台节流边界见 §4.5） | 已拍板（接受）               |

## 12. 设计自查（本次审查发现）

| 级别 | 发现                                                                                            | 处置                                                       |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| P1   | E2E 两处「删后立即 entries/租约归零」断言在本项落地后必红                                       | §7.3 已列迁移；与行为同一提交                              |
| P1   | roadmap「pagehide 清空全部定时器与条目」与 bfcache/在租纹理冲突                                 | D4 改为只清空闲；§8 要求同步修正 roadmap 措辞              |
| P1   | 首轮漏看 `imageAsset.spec.ts` 的 objectURL 配平用例：删图后 200ms 直接断言 URL 全 0，保活下必红 | 已补入 §2.3/§5.1/§7.3（E4），改为到期后归零                |
| P2   | `build()` 写入条目时 refs 暂为 0，若在此登记空闲会给尚未发出的租约装上计时器                    | 只在 release 到 0 的路径 `hold`（§6 第一行）               |
| P2   | `debug()` 注释与类型仍写「refs>0 存活」，接入后语义失真                                         | 类型加 `idle`，注释改「含保活空闲」                        |
| P2   | 计时器取消若散落在各销毁路径，dispose/逐出/到期三路会互相踩                                     | 统一收口到池 `remove` + 缓存 `destroyEntry → forget`       |
| P2   | 单条超大纹理若先登记再逐出，会产生一次无意义的计时器与销毁抖动                                  | `hold` 内先判 `bytes > maxBytes`，直接 `onEvict`           |
| P2   | E3 若在 undo 前插轮询，CI 停顿可能拖过 5s 窗口导致假红                                          | E3 改为删除后立即 undo，用 uid 证复用；idle 状态交给 E1/E2 |
| P2   | 预算字段传 `NaN`/负数会让比较恒假、永不逐出                                                     | 构造时钳制（§4.4 末条）                                    |
| P3   | 探针类型分布在 `debugSnapshot` 与两个 E2E helper，漏改会导致类型漂移                            | §5.1/§7.3 一并列出                                         |
| P3   | 现有单测默认不注入计时器，接入后每个 release 都会留下 5s 句柄                                   | 单测统一注入假计时器或 `windowMs: 0`，结束 `dispose`       |
| P3   | `maxBytes` 不含 URL 编码字节，容易被误解为总内存上限                                            | §4.4 写明口径与兜底约束                                    |

## 13. 实施审查（复审）

结论：**通过**。实现与 §5 契约一致，未发现生产缺陷。

验证：`pnpm verify` 0 退出；单测 998（core 909 + react 51 + app 38）；Playwright `--list` 44 spec / 212 例（主配置 206 + pwa 6）；定向 `imageLifecycle` + `imageAsset` 9/9 通过；coverage 阈值通过。全量 E2E 本次未重跑，按 `--list` 计数与定向结果复核。

| 级别       | 发现                                                                                                                                                                              | 建议                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P2         | E2E 空闲态断言有 5s 窗口竞态：`imageLifecycle.spec.ts:57` 在 idle 轮询后单独读 URL 租约；`imageAsset.spec.ts:298-301` 先等 modelCount=0 再直接断言 1/1。CI 停顿跨过到期点会假红。 | 把 lease/URL 条件并进同一个 poll（切 src 用例已是此法）；`imageAsset` 删图后直接 poll 1/1，去掉中间 count 等待。 |
| P3         | `clampBudget` 的 NaN/负数回退与 `estimateTextureBytes` 的 source 尺寸分支无直接单测（§4.4/§12 已列）。                                                                            | 补 2 个 cache 级用例；fake texture 带 `source.width/height`。                                                    |
| P3         | `docs/19-assets.md` §3「窗口结束或被预算逐出才 destroy」未把 dispose/pagehide 收进主句（下一句虽补）。                                                                            | 改为「窗口结束、预算逐出或生命周期结束（dispose/pagehide）才…」。                                                |
| P3         | `132fd6b` 把 495 行 spec 与池重构同笔提交，审查面偏大。                                                                                                                           | 后续方案入库单独 `docs:` 一笔；本次不影响行为。                                                                  |
| P3（观察） | `ImageVm.setImageTextures` 重注入先释放旧租约再换 controller；当前只在 VM 创建时调用一次，不可达；方法注释的「幂等」略超前。                                                      | 若未来重注入，先 `destroySprite` 或把旧租约持有到新图提交。非本批引入。                                          |

另：`AGENTS.md` 的当前状态已由本批更新（998/212）；按仓库约定该文件改动需人类确认，若未确认请回退该段。

### 13.1 返工处置（复审后收口）

| 发现 | 处置                                                                                                                           | 提交     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| P2   | E1 空闲判定与租约断言并入同一次探针往返；E4 的 count=0 与 refs/urls=1/1 合并为单一 poll（count 条件保留，防未删除的 1/1 假绿） | bfeb790  |
| P3   | 补 3 个 cache 级用例：windowMs NaN 回退默认 5s、maxEntries 负值回退默认 8、estimateTextureBytes 的 source 尺寸优先分支         | bfeb790  |
| P3   | docs/19 §3 主句改为「窗口结束、预算逐出或生命周期结束（dispose 全量 / pagehide 清空闲）才销毁」                                | 返工笔 2 |
| P3   | 提交粒度：历史提交不可拆；后续方案文档单独 `docs:` 一笔入库（流程遵循，无回溯动作）                                            | —        |
| P3   | `imageVm.setImageTextures` 注释改写为当前事实（仅创建期注入一次）+ 重注入前置条件（先 destroySprite）                          | 返工笔 2 |
| 确认 | `AGENTS.md` 计数经用户确认保留，并随新增单测更新为 1001 单测（core 912）/ 212 E2E                                              | bfeb790  |

验证：返工后 `pnpm verify` 0 退出（1001 单测）；定向 `imageLifecycle` + `imageAsset` 9/9 通过。生产代码零改动（仅测试断言组织、注释与文档）。

## 13.2 返工后复审

结论：返工有效，P2 已收口；新增 3 个单测后 core 912 / 总 1001，`pnpm verify` 0 退出，定向图片 E2E 9/9，E2E `--list` 212 不变。无生产回归。

残留（均 P3，不阻塞）：

- 预算合同不一致：`IImageKeepAliveBudget.windowMs` 与 `IImageTextureCacheOptions` 注释写「<=0 = 关闭」，但 `clampBudget` 把负数回退默认 5s；§4.4 与 §5.2 也互相矛盾。建议统一为「0 = 关闭；负数/非有限回退默认」，并补负数 windowMs 用例。
- `docs/15-testing.md` 的 coverage 基线未随本批更新：实测 67.56 / 59.19 / 69.46 / 58.07（语句/分支/行/函数）。
- 新增「windowMs NaN」用例的注释把 windowMs 与 maxEntries/maxBytes 的失效模式混写：windowMs 为 NaN 时真实 `setTimeout` 是立即到期，不是「逐出比较恒假」。
- §6「重复 setImageTextures」行未写 `destroySprite` 前置条件，但 `imageVm.ts` 注释已引用该行；建议补一句「重注入前先 destroySprite」。
- `maxBytes` 的 NaN/负数钳制分支仍无单测（windowMs NaN / maxEntries 负值已覆盖）。
- E4 的复合 poll 仍含两次 `page.evaluate`（count 与 refs/urls）；窗口已缩到毫秒级，可接受；若要严格原子可合并为一次 evaluate。

### 13.3 残留收口处置

| 残留              | 处置                                                                                                                             | 提交     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 预算契约不一致    | `imageKeepAlive.ts` / `imageTextureCache.ts` / §5.2 契约注释统一为「0 = 关闭；负数/非有限钳回默认」，与 §4.4 一致                | 收口笔 B |
| windowMs 负值用例 | NaN 用例扩为 NaN+负值双段（同一 pick 分支）：负数回退默认 5s、不立即销毁                                                         | d8541b8  |
| maxBytes 钳制用例 | 新增 NaN 用例：3000×3000（36MB）刻意越过回退后的 32MiB 默认——NaN 直传比较恒假（永不逐出）与回退默认（立即销毁）可区分            | d8541b8  |
| NaN 注释混写      | 改为分模式写准：windowMs NaN 直传 = `setTimeout(fn, NaN)` 视为 0 立即到期；maxEntries/maxBytes NaN 直传 = 逐出比较恒假           | d8541b8  |
| §6 重注入行       | 期望行为列补前置「先 destroySprite（sprite 引用与租约解耦）」                                                                    | 收口笔 B |
| coverage 漂移     | docs/15 按收口后实测更新为 67.56 / 59.17 / 69.46 / 58.07（语句/分支/行/函数）                                                    | 收口笔 B |
| E4 两次 evaluate  | 采纳复审结论「毫秒级窗口可接受」，不合并（合并需把 count 探针与 assetStore 私有 Map 读数塞进同一段页内脚本，可读性换不来可靠性） | —        |

验证：`pnpm verify` 0 退出（1002 单测，core 913）；`pnpm test:coverage` 阈值通过。生产代码零逻辑改动（源码仅注释）。

## 13.4 复审三（收口后）

结论：收口项已落地，`pnpm verify` 0 退出；无生产逻辑改动。

残留（P3）：

- coverage 基准：本机两次 `pnpm test:coverage` 均为 67.56 / 59.17 / 69.46 / 58.07（语句/分支/行/函数）；`docs/15-testing.md:67` 与 §13.3 仍写 59.19。请按最新实测同步，或注明该值随运行有 0.0x 抖动。
- `imageKeepAlive.ts:5-6` 注释「直传池的 windowMs 恒为非负」只对经 `clampBudget` 的缓存构造成立；池本身仍接受负数并按 <=0 关闭。建议改为「经缓存构造后传入池的 windowMs 恒为非负」。
- `maxBytes` 负值分支仍无直接用例（NaN 已覆盖同一 pick 分支）；可选补一条 36MB 纹理 + `maxBytes: -1` 的断言，非必须。

### 13.5 复审三收口

| 残留              | 处置                                                                                 | 提交    |
| ----------------- | ------------------------------------------------------------------------------------ | ------- |
| coverage 基准     | docs/15 与 §13.3 更新为 67.56 / 59.17 / 69.46 / 58.07（语句/分支/行/函数；本机实测） | 本笔    |
| windowMs 注释措辞 | 改为「经缓存构造后传入池的 windowMs 恒为非负，<=0 即 ===0」                          | 4620928 |
| maxBytes 负值     | maxBytes 用例扩为 NaN/负值双段：两者都按回退默认 32MiB 判定，36MB 单条不保活         | c9162f7 |

验证：`pnpm verify` 0 退出（1002 单测，core 913）；coverage 阈值通过。源码仅注释改动。
