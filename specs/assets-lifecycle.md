# 资产/图片生命周期：spec

> 本文件随仓库提交（`specs/`，实现方案与实施记录）。
> 角色划分：方案设计与最终审查由设计人负责；实现由另一个 agent 按 §10 顺序执行。
> 实施前先读：`AGENTS.md`、`docs/19-assets.md`、`docs/13-roadmap.md`、`docs/15-testing.md`、
> `docs/21-multi-tab.md §4`、`packages/core/src/widgets/image/`、`packages/core/src/platform/dataEngine/`。

## 0. 一句话目标

把 IMAGE 的**加载所有权**、**纹理所有权**、**失败重试**、**资产 GC 启动成本**四件事，
从「VM 里各管各的散装状态」收口为「一控制器 + 一纹理缓存 + 一可中断的维护链」，
并保持 Yjs 数据面、`spinth-asset:` 引用格式、单写者/只读语义不变。

## 1. 范围（roadmap P1 四条）

| 编号 | 事项                          | 本方案                                       |
| ---- | ----------------------------- | -------------------------------------------- |
| L1   | 快速切换 src 时的在途加载竞态 | §4 加载会话 + 租约所有权                     |
| L2   | 同图多实例纹理共享            | §5 ImageTextureCache                         |
| L3   | 图片加载失败后的重试策略      | §6 自动重试 + 双击手动重试                   |
| L4   | GC 全库扫描的启动成本         | §7 批量删除 + 时间预算 + 协作让出 + 空库短路 |

### 非目标（本批不做）

- 跨设备/服务端资产端点；跨标签纹理共享（浏览器进程内做不到）。
- GPU 显存上限、LRU 淘汰、缩略图/重编码、动图逐帧、图片编辑。
- 协同态（`wsState !== 'off'`）下的资产语义变更；GC 仍整轮跳过。
- GC 增量索引/落盘引用表（可作为后续优化，不在本批）。
- 其他控件的重试/错误态抽象（只做 IMAGE）。
- 保活缓存（VM 删除后保留纹理 N 秒）：undo 恢复会重新解码，先接受。

## 2. 现状与事实（实施前必须核对的代码）

| 位置                              | 事实                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `widgets/image/imageVm.ts:96-129` | `loadSrc`：`loadingSrc` 只防同 src 重入；`failedSrc` 永久拒载；解码后校验 `state.src === src`       |
| `imageVm.ts:134-147`              | `resolveSrcUrl` 在 await 前释放上一持有，await 后按 `state.src` 归还，再写 `heldAssetId`            |
| `imageVm.ts:149-155`              | `releaseHeldAsset` 只认单一 `heldAssetId`，不认归属                                                 |
| `imageVm.ts:110-113 / 123-125`    | **过期分支无条件 `releaseHeldAsset()`（缺陷根因，见 §2.1）**                                        |
| `imageVm.ts:211-233`              | `dispose` 释放持有；`destroySprite` 里 `tex.destroy(true)`（纹理与 sprite 同生命周期，无法共享）    |
| `boardComposition.ts:75-112`      | assetStore 先于 `engine.initialize` 创建；`onVmCreated$` 里 `setAssetResolver/setAssetRelease` 注入 |
| `boardComposition.ts:431-459`     | 维护链 idle 调度（3s timeout），只读/关闭开关闸门                                                   |
| `app.ts` 的 `dispose()`           | `assetStore.close()` **早于** `vmEngine.dispose()`；`vmEngine` 只退订，不逐 VM dispose              |
| `assetStore.ts:121-160`           | `objectURL` 引用计数 + in-flight 去重；`releaseObjectURL` 归零 revoke                               |
| `assetStore.ts:198-210`           | `deleteIfOlderThan`：每行一次读 tx + 一次写 tx                                                      |
| `assetGc.ts:50-103`               | 全量 mark（逐文档 `getAll` + 重建 Y.Doc）→ 全量 sweep（逐行 tx）                                    |
| `assetMigration.ts:41-69`         | 逐 widget `put`，无让出/无中断                                                                      |
| `debugSnapshot.ts:104-123`        | `vmStates` 已带 `hasSprite`；探针是 E2E 的唯一数据入口                                              |

### 2.1 已确认缺陷：在途加载误释放（L1 的实证）

场景：VM 当前显示 A，src 被改成 B；A 的 `img.decode()` 比 B 的解析更晚完成。

| 时刻 | 事件                                                   | heldAssetId | 结果                                     |
| ---- | ------------------------------------------------------ | ----------- | ---------------------------------------- |
| t0   | A 解析完成，解码开始                                   | A           | A 的 objectURL 计数 +1                   |
| t1   | src 改 B：`resolveSrcUrl(B)` 先 `releaseHeldAsset()`   | null        | A 的计数 -1（ok）                        |
| t2   | B 解析完成，写 held                                    | B           | B 的计数 +1                              |
| t3   | A 解码完成，`state.src !== 'A'` → `releaseHeldAsset()` | null        | **误释放 B 的计数**                      |
| t4   | B 解码完成，`state.src === 'B'` → 建 sprite            | null        | B 显示中但无持有；计数错位/可能被 revoke |

结论：`heldAssetId` 是「每 VM 一个槽位」，但生命周期是「每加载会话一份」。
新会话会覆盖旧槽位，旧会话迟到时释放的是新会话的持有。
现有 6 个 image E2E 全绿也测不到：竞态需要「A 解码慢于 B 解析」，且没有计数探针。

### 2.2 纹理现状

- 每个 VM 各自 `new Image()` + `Texture.from(img)`，同图 N 份 = N 次解码 + N 份 GPU 纹理。
- `destroySprite` 主动 `tex.destroy(true)`；改为共享前必须先拆掉「sprite 销毁 = 纹理销毁」。
- `AssetStore` 只按 id 复用 objectURL，不复用纹理；VM 各自持一份 URL 计数。

### 2.3 重试现状

- `failedSrc` 一旦命中，src 不变就永不重试；坏链/断网只能改 src 或刷新。
- 占位框只有「灰框 + 对角线」，没有失败/缺失的区分，也没有用户可操作的恢复入口。

### 2.4 GC 现状与成本模型

启动 idle 后：迁移（若有）→ compact → `listDocIds` → 逐文档读 updates 全集并重建 Y.Doc
→ `listIds` → 逐孤儿两次事务删除。成本 ≈ 全库已落盘字节数 + 2×孤儿数事务；
文档多/资产多时占用启动后主线程周边 I/O，且没有中断点（页面隐藏/卸载只能等它跑完）。

安全不变量（**本批不得改变**）：

1. `canUndo` 时整轮跳过；
2. 只删 `t < olderThan`（默认会话启动基线）；
3. 删除前重采当前 doc 引用（`collectCurrentRefs`）；
4. 持活 objectURL 引用计数 > 0 的行不删；
5. Web Locks `spinth-asset-gc` 单写者，其他标签跳过；
6. 只读/维护开关关闭时不跑（app 壳 + composeBoard 双重闸门）。

## 3. 目标架构

```text
render(next)                                 // 数据变化
   └─ ImageVm                               // 只做 PIXI：sprite / placeholder / 几何
        └─ ImageLoadController              // 会话 token、重试策略、当前租约
             └─ IImageTexturePort
                  └─ ImageTextureCache      // key=assetId 引用计数、in-flight 去重
                       ├─ IImageCodec       // decode(Image.decode) + createTexture(Texture.from)
                       └─ IImageSourcePort  // src → {url, release}；asset 走 AssetStore.objectURL
```

职责边界：

- **ImageVm**：几何、占位视觉、sprite 的创建/销毁、探针；不持有 URL 计数、不做重试决策。
- **ImageLoadController**：一次 src 变化 = 一个 token；**每个成功会话持有一个纹理租约**；
  过期完成只释放自己的局部租约；重试计时与取消。
- **ImageTextureCache**：同 assetId 只解码/建纹一次；引用归零才 `texture.destroy(true)`
  并归还 URL 租约；无 key（data/http）走不缓存分支。
- **AssetStore**：不变（objectURL 计数语义、GC 安全闸）。
- **组合根**：创建/注入/销毁三者顺序（§9）。

### 3.1 不变量（实现与审查逐条核对）

1. 每个成功加载会话恰好持有一个纹理租约；释放幂等。
2. 过期会话（token 失配 / disposed / src 变化）**只释放自己拿到的租约**，绝不触碰当前租约。
3. src 切换期间旧 sprite 可继续显示；新图提交后才销毁旧 sprite 并释放旧租约。
4. 纹理销毁只能由缓存引用归零触发；sprite/dispose 不得直接销毁纹理。
5. 重试有上限；src 变化或 dispose 后不再有计时器回调。
6. 自动重试只针对 http(s) 的 `decode` 失败；`missing` 与 data URL 失败不自动重试。
7. GC mark 阶段被预算/取消打断 → **一个都不删**；sweep 阶段可部分完成。
8. GC 六条安全不变量原样保留；单写者锁覆盖整轮（含让出）。
9. 不引入全局单例；缓存经 composeBoard 注入；`BoardPublicApi` 不新增字段。
10. Yjs 数据面零改动：`src` 仍是 string，`spinth-asset:<sha256>` 不变。

### 3.2 备选方案与取舍

| 备选                                               | 放弃原因                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 只修 `heldAssetId` 槽位（按 assetId 比对后再释放） | 能止住误释放，但每 VM 仍各自解码/建纹，L2/L3 无从落地；旧槽位模型继续扩散           |
| 共享 PIXI `TextureSource`、每 VM 独立 `Texture`    | 生命周期更细但收益与共享 Texture 相同，PIXI v8 的 source/frame 组合增加审查面；不选 |
| 重试交给 PIXI Assets 管线                          | P0 已证实无扩展名 blob URL 推断不出 parser（docs/19 §3）；继续用 `Image.decode`     |
| GC 改为写盘引用索引                                | 正确但数据层改动大、迁移成本高；本批先用「批量 + 软预算」拿到 80% 收益              |
| 纹理保活（VM 删除后 N 秒再销毁）                   | 省一次重新解码，但新增定时器与内存上限策略；列为后续优化                            |

### 3.3 预期收益（审查时按此核对）

- 同图 N 实例：N 次 `decode`/N 份 GPU 纹理 → 1 次/1 份（URL 计数 1 份）。
- 快速切 src：计数不再错位；迟到结果不覆盖新纹理。
- 坏链：用户无需刷新/改 src，自动 2 次 + 双击手动。
- GC：空资产库零文档扫描；孤儿删除从 2N 事务降到 2×ceil(N/64)；单轮有 1.5s 上限且可中断。

## 4. 设计 A：加载会话与租约（L1）

### 4.1 文件

新增 `packages/core/src/widgets/image/imageLoadController.ts`（目标 < 200 行）。

### 4.2 契约

```ts
export type ImageLoadState = 'idle' | 'loading' | 'loaded' | 'failed' | 'missing';
export type ImageFailureKind = 'decode' | 'missing';

export interface IImageTextureLease {
  readonly texture: Texture; // import type { Texture } from 'pixi.js'
  release(): void; // 幂等
}

export type ImageTextureResult =
  | { kind: 'ok'; lease: IImageTextureLease }
  | { kind: 'missing' } // 资产行不存在/无解析器
  | { kind: 'error'; error: unknown; retryable: boolean }; // retryable 由失败阶段决定

export interface IImageTexturePort {
  acquire(src: string): Promise<ImageTextureResult>;
}

export interface IImageLoadHost {
  onLoading(src: string): void; // 旧 sprite 保持可见（防闪烁）
  onLoaded(src: string, texture: Texture): void; // 先换 sprite，控制器随后释放旧租约
  onFailed(src: string, kind: ImageFailureKind): void; // 先销毁 sprite，控制器随后释放旧租约
  onEmpty(): void; // src 清空
}

export interface IImageTimerPort {
  set(fn: () => void, ms: number): () => void; // 返回取消函数
}
```

`ImageLoadController` 对外：

```ts
class ImageLoadController {
  constructor(
    textures: IImageTexturePort,
    host: IImageLoadHost,
    timers?: IImageTimerPort, // 默认 setTimeout/clearTimeout
    policy?: IImageRetryPolicy, // §6，默认实现可直接内联
  );
  setSrc(src: string): void;
  retry(): void; // 手动重试：重置 attempts，清除 failedSrc 语义
  dispose(): void;
  get debug(): { src: string; state: ImageLoadState; attempts: number };
}
```

### 4.3 状态机

| 当前           | 事件                        | 下一状态               | 副作用                                                         |
| -------------- | --------------------------- | ---------------------- | -------------------------------------------------------------- |
| any            | `setSrc('')`                | idle                   | token++、取消计时、host.onEmpty、释放当前租约                  |
| any            | `setSrc(X)`（X ≠ 当前 src） | loading                | token++、取消计时、attempts=0、host.onLoading（不动旧 sprite） |
| loading        | acquire 成功且 token 匹配   | loaded                 | 提交租约 → host.onLoaded → 释放旧租约                          |
| loading        | acquire 成功但 token 失配   | loading/loaded（不变） | **只 release 自己拿到的 lease**                                |
| loading        | `missing`                   | missing                | host.onFailed('missing') → 释放旧租约                          |
| loading        | `error`                     | failed                 | host.onFailed('decode') → 释放旧租约 → 按策略排重试            |
| failed/missing | `retry()`                   | loading                | token++、attempts=0、取消计时、host.onLoading                  |
| any            | `dispose()`                 | idle                   | token++、取消计时、释放当前租约                                |

### 4.4 关键伪代码

```ts
setSrc(next: string): void {
  if (next === this.src) return; // 同 src 不重入（含失败后：只能 retry()）
  this.src = next;
  const token = ++this.token;
  this.cancelTimer?.();
  this.cancelTimer = null;
  this.attempts = 0;
  if (!next) {
    this.state = 'idle';
    this.host.onEmpty();          // 先让 sprite 销毁
    this.releaseCurrent();        // 再销毁纹理
    return;
  }
  this.state = 'loading';
  this.host.onLoading(next);      // 旧 sprite 继续显示
  void this.run(token);
}

private async run(token: number): Promise<void> {
  let r: ImageTextureResult;
  try {
    r = await this.textures.acquire(this.src); // port 抛错也归入 decode 失败
  } catch (error) {
    r = { kind: 'error', error, retryable: false };
  }
  if (this.disposed || token !== this.token) {
    if (r.kind === 'ok') r.lease.release(); // 只认自己这一份
    return;
  }
  if (r.kind === 'missing') return this.fail('missing', token, false);
  if (r.kind === 'error') return this.fail('decode', token, r.retryable);
  const prev = this.lease;
  this.lease = r.lease;
  this.state = 'loaded';
  this.attempts = 0;
  this.host.onLoaded(this.src, r.lease.texture);
  prev?.release();
}

private fail(kind: ImageFailureKind, token: number, retryable: boolean): void {
  if (token !== this.token) return;
  this.state = kind === 'missing' ? 'missing' : 'failed';
  this.host.onFailed(this.src, kind); // 先销毁 sprite
  this.releaseCurrent();              // 再销毁纹理
  const delay = this.retryDelay(kind, retryable, this.attempts);
  if (delay === null) return;
  this.attempts++;
  this.cancelTimer = this.timers.set(() => {
    if (this.disposed || token !== this.token) return;
    this.state = 'loading';
    this.host.onLoading(this.src);
    void this.run(token);
  }, delay);
}
```

要点：

- `releaseCurrent()` 是**唯一**释放当前租约的地方；只在 commit/fail/empty/dispose 调用。
- 迟到完成永远不调用它，只释放 `r.lease`。
- token 在 `setSrc` / `retry` / `dispose` 自增；计时器闭包捕获 token。
- 失败时旧图不能继续显示（否则「显示 A、数据是 B」），必须换成错误占位。

### 4.5 ImageVm 改造

- 删除 `assetResolver` / `assetRelease` / `heldAssetId` / `loadingSrc` / `failedSrc`。
- 新增 `setImageTextures(port: IImageTexturePort): void`：创建 controller 并 `setSrc(this.state.src)`。
  幂等：重复注入先 dispose 旧 controller。未注入时 VM 不加载任何 src（保持占位）——
  `BoardSDK.initialize()` 必经 `composeBoard`，宿主不直接 new VM，因此不构成回归。
- 实现 `IImageLoadHost` 的四个回调（私有方法或适配对象）：

```ts
onLoaded(_src, texture) {
  this.destroySprite();            // 只销毁 sprite，不碰纹理
  this.sprite = new Sprite(texture);
  this.sprite.width = this.state.width;
  this.sprite.height = this.state.height;
  this.root.addChild(this.sprite);
  this.placeholder.visible = false;
  this.mode = 'loaded';
  markRender();
}
```

- `destroySprite()` 改为 **只 `sprite.destroy()`**；删掉 `tex.destroy(true)` 与防御 catch 里的纹理销毁。
  注释写清：纹理归缓存租约所有。
- `render()`：几何照旧；仅当 `next.src !== this.currentSrc` 时调 `loader.setSrc(next.src)`；
  占位图按 `mode` 绘制（empty/loading/failed/missing 四套颜色/线型）。
- `dispose()`：先 `destroySprite()`（sprite 不再引用纹理），再 `loader.dispose()`。
- 探针：`get hasSprite()` 保留；新增 `get loadDebug(): { src, state, attempts, textureUid }`
  （textureUid 供 E2E 断言「两张图同一个纹理」）。
- `retry(): void` 转发 controller；未注入 port 时 no-op。

### 4.6 注入时序（重要）

`boardComposition.ts` 的 `onVmCreated$` 在 `setModel` 之后同步触发，而首帧 render 在微任务里；
现有 resolver 注入依赖这一点。新注入同样必须在 `onVmCreated$` 内完成：

```ts
sdk.vmEngine.onVmCreated$.subscribe((vm) => {
  if (vm instanceof ImageVm && sdk.imageTextures) vm.setImageTextures(sdk.imageTextures);
  // 其余横切订阅不变
});
```

`vm instanceof ImageVm` 取代现有两处 `as unknown as {...}` 双断言（import ImageVm 无循环依赖）。

## 5. 设计 B：纹理共享（L2）

### 5.1 文件

- 新增 `widgets/image/imageTextureCache.ts`（< 220 行，只 import type PIXI）。
- 新增 `widgets/image/imageCodec.ts`（浏览器实现：`Image` + `Texture.from`）。
- 缓存单元测试用注入 codec，不碰 WebGL/DOM。

### 5.2 契约

```ts
export interface IImageSourceHandle {
  url: string;
  release(): void; // 与 open 配对；asset 路径 = AssetStore.releaseObjectURL(id)
}

export interface IImageSourcePort {
  open(src: string): Promise<IImageSourceHandle | null>; // null = 资产缺失/无解析器
}

export interface IImageCodec {
  decode(url: string): Promise<HTMLImageElement>; // 生产：new Image + decode()
  createTexture(img: HTMLImageElement): Texture; // 生产：Texture.from(img)
}

export class ImageTextureCache implements IImageTexturePort {
  constructor(source: IImageSourcePort, codec: IImageCodec);
  acquire(src: string): Promise<ImageTextureResult>;
  dispose(): void;
  debug(): { entries: Array<{ key: string; refs: number; uid: number }>; pending: number };
}
```

### 5.3 键与条目

- key：`isAssetSrc(src) ? assetIdOf(src) : null`。
- 只有 asset 引用共享；data URL/http 走 **不缓存** 分支（每次 acquire 独立条目，lease 释放即销毁）。
  理由：data URL 可能很长，不能当 Map key；http 内容可变，共享语义不成立。
- 条目：`{ key, refs, texture, source, destroyed }`；`pending: Map<key, Promise<Entry>>` 做 in-flight 去重。
- `build` 必须有外层 `try/finally` 清 `pending`：`source.open` 自身抛错（IDB 故障）时
  也不能把 rejected Promise 留在 map 里（否则同 key 永久失败）。
- acquire 流程：

```ts
async acquire(src): Promise<ImageTextureResult> {
  const key = keyOf(src);
  if (key === null) return this.acquireUncached(src);
  let p = this.pending.get(key);
  if (!p) {
    p = this.build(key, src);
    this.pending.set(key, p);
  }
  try {
    const entry = await p;
    if (entry.destroyed) return { kind: 'missing' }; // dispose 竞态
    entry.refs++;
    return { kind: 'ok', lease: this.leaseOf(entry) };
  } catch (err) {
    if (err instanceof MissingAssetError) return { kind: 'missing' };
    if (err instanceof TextureBuildError) {
      return { kind: 'error', error: err.cause, retryable: err.retryable };
    }
    return { kind: 'error', error: err, retryable: false }; // open 自身故障
  }
}

private async build(key, src): Promise<Entry> {
  try {
    const source = await this.source.open(src);
    if (!source) throw new MissingAssetError();
    let img: HTMLImageElement;
    try {
      img = await this.codec.decode(source.url);
    } catch (err) {
      source.release();
      throw new TextureBuildError(true, err); // 解码失败：按 src 策略重试
    }
    let texture: Texture;
    try {
      texture = this.codec.createTexture(img);
    } catch (err) {
      source.release();
      throw new TextureBuildError(false, err); // 建纹失败：不自动重试
    }
    const entry = { key, refs: 0, texture, source, destroyed: false };
    this.entries.set(key, entry);
    return entry;
  } finally {
    this.pending.delete(key); // 成功/失败都不留 rejected Promise
  }
}
```

`missing` 与 `error` 的区分：`open` 返回 null → missing；`decode` 失败 → error + retryable=true；
`createTexture` 失败或 `open` 自身抛错 → error + retryable=false。无 key 的 `acquireUncached`
同样分阶段给出 retryable（不写 entries，lease 释放即销毁）。

### 5.4 引用计数与销毁

```ts
private leaseOf(entry): IImageTextureLease {
  let released = false;
  return {
    texture: entry.texture,
    release: () => {
      if (released || entry.destroyed) return;
      released = true;
      entry.refs--;
      if (entry.refs <= 0) this.destroyEntry(entry);
    },
  };
}

private destroyEntry(entry) {
  if (entry.destroyed) return; // dispose 与 lease 归零可能先后到达
  entry.destroyed = true;
  if (entry.key !== null && this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  try { entry.texture.destroy(true); } catch { /* 防御：缓存销毁链不得中断 */ }
  entry.source.release();
}
```

- `entry.refs` 在 acquire 成功后才 +1；build 期间 refs=0，若所有 await 方放弃，
  控制器仍会在拿到 lease 后立即 release（token 失配路径），归零销毁——无泄漏。
- `dispose()`：`disposed=true`；对 entries **无条件** destroyEntry（忽略 refs——SDK 生命周期结束）；
  对每个 pending 挂 `.then(destroyEntry).catch(() => {})`，acquire 侧用 `entry.destroyed` 兜底。
  UI 生命周期结束不再复用。
- `debug()`：返回条目 key/refs/texture.uid，供 E2E 断言「两张图一个纹理」。

### 5.5 PIXI 规则（审查重点）

- `sprite.destroy()` 不得带 `{ texture: true }`，本机也不得再单独 `texture.destroy`；
  纹理只由 `destroyEntry` 销毁。
- `texture.destroy(true)` 只在 refs 归零时调用一次；重复释放由 lease 幂等 + entry.destroyed 兜住。
- 共享纹理不改变 sprite 的 `width/height` 拉伸语义（纹理像素不变）。
- 不引入 PIXI 全局 Cache 依赖；`Texture.from(img)` 每条目只调一次。

### 5.6 与资产 GC 的关系

缓存条目在存活期间**持有 URL 租约**（`source.release` 直到 `destroyEntry`），
因此 GC 的「持活 objectURL 不删」闸门仍然生效；同一纹理多个 VM 只占 1 份计数，
比现状更省。

### 5.7 组合根接线

```ts
sdk.assetStore = new AssetStore();
sdk.imageTextures = new ImageTextureCache(
  {
    open: async (src) => {
      if (!isAssetSrc(src)) return { url: src, release: () => {} };
      const id = assetIdOf(src);
      const url = await sdk.assetStore!.objectURL(id);
      return url ? { url, release: () => sdk.assetStore!.releaseObjectURL(id) } : null;
    },
  },
  browserImageCodec, // imageCodec.ts
);
```

- 创建位置：`assetStore` 之后、`engine.initialize` 之前（恢复期创建的 VM 才能拿到）。
- `BoardSDK` 增加内部字段 `imageTextures: ImageTextureCache | null = null`；
  `index.ts` 的 `BoardPublicApi` Omit 列表加 `'imageTextures'`（公开面不变）。
- 销毁顺序（见 §9.1）。

## 6. 设计 C：失败重试（L3）

### 6.1 分类表

| 失败来源                                  | kind    | 自动重试      | 说明                           |
| ----------------------------------------- | ------- | ------------- | ------------------------------ |
| `open` 返回 null（资产行缺失/无解析器）   | missing | 否            | 可能他端稍后写入；提供手动重试 |
| `img.decode()` 拒绝，src 为 http(s)       | decode  | 是，最多 2 次 | 断网/超时/服务抖动             |
| `img.decode()` 拒绝，src 为 data:/blob:   | decode  | 否            | 内容损坏，重试无意义           |
| `img.decode()` 拒绝，src 为 spinth-asset: | decode  | 否            | 本地 blob 损坏/被清            |
| `createTexture` 抛错                      | decode  | 否            | 渲染环境问题，重试易放大       |

### 6.2 纯函数（新增 `imageRetry.ts`）

```ts
export const IMAGE_AUTO_RETRY_DELAYS_MS = [600, 1800] as const;

export function isHttpSrc(src: string): boolean;

export function autoRetryDelay(
  src: string,
  kind: 'decode' | 'missing',
  retryable: boolean, // 来自 ImageTextureResult.error
  attempts: number, // 已安排过的自动重试次数
): number | null;
```

返回 null = 不重试。attempts 只在控制器里维护；手动 `retry()` 重置为 0（手动不限次数）。

### 6.3 计时器纪律

- 计时器句柄保存在 controller，`setSrc` / `retry` / `dispose` 一律先取消。
- 计时器回调先查 `token` 与 `disposed`，再发起加载。
- 单元测试注入假 timer port（记录回调与延迟），**不得用真实定时器**。
- 日志：只在**终态失败**（不再自动重试 / 手动失败）时 `console.warn` 一次，
  内容含 src 截断（data URL 不能整串打印）与 kind；重试中间过程不打印，避免噪声。

### 6.4 占位视觉

| 状态            | 视觉                                             |
| --------------- | ------------------------------------------------ |
| empty / loading | 现状：灰底 `0xf1f5f9`、描边 `0xcbd5e1`、单对角线 |
| failed          | 灰底 + 红色描边 `0xdc2626` + 叉号（两条对角线）  |
| missing         | 灰底 + 琥珀描边 `0xd97706` + 叉号                |

只用 Graphics 绘制，不引入图标资源/字体。颜色常量放 imageVm 顶部并注释「错误态不是主题色」。

### 6.5 手动重试（双击）

- `ImageService` 增加构造依赖 `vmEngine: IVmEngineService`（组合根传 `sdk.vmEngine`）。
- 监听 `window` 的 `dblclick`（capture），模式与 `lineService.onLineDblClick` 对齐：

```ts
private onDblClick = (e: MouseEvent): void => {
  if (!(e.target instanceof HTMLCanvasElement)) return; // 排除 DOM 控件双击
  if (this.viewport.cursorMode$.value !== 'cursor') return; // 画笔/连线等工具期不接管
  const world = this.viewport.clientToWorld(e.clientX, e.clientY);
  for (const vm of this.vmEngine.getVmByPoint(world)) {
    if (vm instanceof ImageVm) {
      vm.retry();
      return;
    }
  }
};
```

- 只读标签允许重试（纯本地渲染，不写文档）；不做 editable 闸门。
- 不新增右键菜单项（避免改 ContextMenu 面）；若后续要做，另开任务。
- 重试期间显示 loading 占位；成功/再次失败按 §6.4 切换。

## 7. 设计 D：资产 GC 启动成本（L4）

### 7.1 分两步：先批量，再分片

**D1 批量删除**（`AssetStore`）：

```ts
export interface IAssetSweepResult { removed: number; kept: number; gone: number }

/** 一段孤儿 id：一次读 tx 取行/判宽限/判持活，一次写 tx 删除。
 *  kept = 宽限内或持活；gone = 行已不存在（并发删除）。 */
async sweepOrphans(ids: readonly string[], beforeEpoch: number): Promise<IAssetSweepResult>;
```

- 单批上限 64（常量 `ASSET_SWEEP_BATCH`），由 GC 侧切块。
- `deleteIfOlderThan` 保留（现有测试/语义），内部可委托 `sweepOrphans([id])`；
  返回 `removed > 0 || gone > 0`。
- 保持「持活 objectURL 不删」：读 tx 结果回来后、写 tx 开始前同步复核 `objectUrlRefs`。

**D2 分片/预算/取消**（`runAssetGc`）：

```ts
export interface IAssetGcOptions {
  // 既有字段不变
  shouldContinue?: () => boolean; // false = 停止（页面销毁/切页），默认 () => true
  budgetMs?: number; // 默认 1500；Infinity = 不限（0 表示零预算，不是不限）
  now?: () => number; // 测试注入
  yieldToMain?: () => Promise<void>; // 默认 scheduler.yield ?? setTimeout(0)
  batchSize?: number; // 默认 64
}

export interface IAssetGcResult {
  docs: number;
  assets: number;
  orphans: number;
  removed: number;
  skipped: boolean;
  partial: 'none' | 'budget' | 'cancelled';
  ms: number;
}
```

执行顺序：

1. **空库短路**：先 `listIds()`；为空直接返回（不 `listDocIds`、不扫任何文档）。
   注意必须在迁移之后调用（迁移会新建资产）。
2. mark：逐文档扫描；每篇前检查 `shouldContinue` / 预算；每篇后 `await yieldToMain()`。
3. 若 mark 被打断 → **直接返回，removed=0**（部分引用集绝不能用于删除）。
4. 删除前重采当前 doc 引用（保留现有逻辑）。
5. sweep：按 `batchSize` 切块调用 `sweepOrphans`；每块后检查预算/取消；
   被打断时返回已删除数 + `partial`。
6. `ms` = now() - start；`docs` 为已扫描文档数。

预算默认值：`ASSET_GC_BUDGET_MS = 1500`。为什么是软预算：只影响本轮清理完整度，
不影响正确性；下一会话继续清。

### 7.2 迁移链协同让出

`migrateDataUrls(engine, store, opts?)` 增加：

```ts
{
  shouldContinue?: () => boolean;
  yieldToMain?: () => Promise<void>;
  batchSize?: number; // 默认 8
}
```

- 每批后让出；`shouldContinue` 为 false 立即返回 `{ migrated, failed, cancelled: true }`。
- 迁移幂等，中断安全；已迁移的不会重做。
- `runAssetMaintenance` 把 `shouldContinue: () => !sdk.disposed` 传给迁移与 GC。

### 7.3 探针与统计

`sdk.lastAssetMaintenance` 从 `{ migrated, removed, when }` 扩展为：

```ts
{
  migrated: number;
  removed: number;
  when: number;
  docs?: number;
  assets?: number;
  partial?: 'none' | 'budget' | 'cancelled';
  ms?: number;
}
```

- 字段全部可选/追加，`multiTab.spec` 现有断言不破。
- `partial`/预算是否触发可作为单测断言；E2E 只看 `migrated/removed` 不变。

### 7.4 不做的事

- 不释放 GC 锁中途让别的标签接棒（锁覆盖整轮；其他标签本就 skip）。
- 不引入「上次 GC 时间」节流（产品决策，另开）。
- 不把引用索引写进文档库（后续优化）。

## 8. 接口清单（实现顺序：先契约后实现）

新增/修改的公开面：

| 接口                                                              | 位置                                    | 备注                                                |
| ----------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `IImageTextureLease` / `ImageTextureResult` / `IImageTexturePort` | `widgets/image/imageLoadController.ts`  | 视图层内部契约，不进 `types/`（不跨包、不暴露宿主） |
| `IImageLoadHost` / `IImageTimerPort`                              | 同上                                    | 同上                                                |
| `IImageSourceHandle` / `IImageSourcePort` / `IImageCodec`         | `widgets/image/imageTextureCache.ts`    | codec 由组合根注入                                  |
| `IAssetSweepResult` / `AssetStore.sweepOrphans`                   | `platform/dataEngine/assetStore.ts`     | 数据层公共方法                                      |
| `IAssetGcOptions` / `IAssetGcResult.partial/ms`                   | `platform/dataEngine/assetGc.ts`        | 追加字段                                            |
| `IImageMigrationOptions`                                          | `platform/dataEngine/assetMigration.ts` | 追加                                                |
| `ImageVm.setImageTextures/retry/loadDebug`                        | `widgets/image/imageVm.ts`              | 内部 VM 契约                                        |
| `lastAssetMaintenance` 扩展                                       | `app.ts`                                | 公开探针字段，追加可选键                            |

## 9. 文件改动清单

### 9.1 组合根与销毁顺序

`composeBoard`：

1. `sdk.assetStore = new AssetStore()`
2. `sdk.imageTextures = new ImageTextureCache(sourcePort, browserImageCodec)`
3. `onVmCreated$` 注入 `setImageTextures`（`instanceof ImageVm`）
4. `ImageService` 构造参数追加 `sdk.vmEngine`

`BoardSDK.dispose`（`app.ts`）：

```text
...
this.imageService?.dispose();
...
this.vmEngine?.dispose();          // 现有：只退订
this.imageTextures?.dispose();     // 新增：无条件销毁全部缓存纹理 + URL 租约
this.assetStore?.close();          // 从上面的早位置移到这里
this.engine?.dispose();
this.viewport?.dispose();          // 最后销毁 renderer
```

理由：`VmEngineService` 不逐 VM dispose（`Disposable` 只释放订阅），
所以缓存销毁必须自洽；assetStore 的 close 必须晚于纹理/URL 租约归还。
移动前确认：`projectFile`/`storageStatus`/`imageService` 的 dispose 不依赖 assetStore 仍打开。

### 9.2 列表

| 文件                                                                                      | 动作                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `widgets/image/imageLoadController.ts`                                                    | 新增，< 200 行                                                  |
| `widgets/image/imageTextureCache.ts`                                                      | 新增，< 220 行                                                  |
| `widgets/image/imageCodec.ts`                                                             | 新增，< 40 行                                                   |
| `widgets/image/imageRetry.ts`                                                             | 新增，< 60 行                                                   |
| `widgets/image/imageVm.ts`                                                                | 重写加载/销毁段，删旧字段；几何/hitTest 保持                    |
| `widgets/image/imageService.ts`                                                           | 加 vmEngine 依赖 + dblclick 重试                                |
| `boardComposition.ts`                                                                     | 建缓存、注入、销毁顺序                                          |
| `app.ts`                                                                                  | `imageTextures` 字段、dispose 顺序、`lastAssetMaintenance` 类型 |
| `index.ts`                                                                                | `BoardPublicApi` Omit 加 `'imageTextures'`                      |
| `debugSnapshot.ts`                                                                        | 加 `imageTextures` / `assetLeases` / `vmStates.imageLoad`       |
| `platform/dataEngine/assetStore.ts`                                                       | `sweepOrphans` + `debugLeases`                                  |
| `platform/dataEngine/assetGc.ts`                                                          | 预检/分片/预算/取消/批量/结果字段                               |
| `platform/dataEngine/assetMigration.ts`                                                   | 让出/取消参数                                                   |
| `__tests__/imageRetry.test.ts`                                                            | 新增                                                            |
| `__tests__/imageLoadController.test.ts`                                                   | 新增                                                            |
| `__tests__/imageTextureCache.test.ts`                                                     | 新增                                                            |
| `__tests__/assetStore.test.ts`                                                            | 追加 sweep 用例                                                 |
| `__tests__/assetGc.test.ts`                                                               | 追加预算/取消/空库用例                                          |
| `__tests__/assetMigration.test.ts`                                                        | 追加让出/取消用例                                               |
| `packages/app/e2e/image.spec.ts`                                                          | 追加纹理共享/竞态泄漏/自动重试/手动重试                         |
| `packages/app/e2e/helpers/projectFileE2e.ts`                                              | `Debug` 类型补新探针字段                                        |
| `docs/19-assets.md`、`docs/13-roadmap.md`、`docs/15-testing.md`、`docs/16-performance.md` | 能力落地后同步（§15）                                           |

## 10. 实施顺序（每个 commit 独立可回退）

### Step 0：基线

`pnpm verify`；`pnpm test:e2e packages/app/e2e/image.spec.ts`；记录当前 820 单测/164 E2E。

### Step 1：重试策略纯函数（无行为变化）

- 新增 `imageRetry.ts` + `imageRetry.test.ts`。
- 覆盖：http(s) 的 attempts 0/1/2 延迟；data/asset/missing 返回 null；scheme 判定。
- 提交：`test: 图片加载重试策略与分类`。

### Step 2：控制器 + 纹理缓存 + 接线（修 L1，铺 L2）

- `imageLoadController.ts` / `imageTextureCache.ts` / `imageCodec.ts` + 两个单测。
- 改 `imageVm`（托管 owned lease、删旧字段、sprite 不再销毁纹理）。
- `composeBoard` 建缓存 + 注入；`app.ts` 字段/销毁顺序；`index.ts` Omit。
- 这一提交**先不接重试 UX**（controller 里策略可先用「不自动重试」的注入，或直接接 Step 1 策略）。
- 验证：现有 image E2E 6 例全绿；新增单测全绿；手动贴图/删图正常。
- 提交：`refactor: 图片加载会话与纹理租约（修在途竞态）`。

### Step 3：失败重试 + 双击手动重试 + 探针

- VM 占位四态；`ImageService` dblclick；`debugSnapshot` 扩 probe；E2E 三条。
- 提交：`feat: 图片加载失败重试与手动重试`（或拆 test）。

### Step 4：GC 批量/分片/预算

- `assetStore.sweepOrphans` + 单测；`assetGc` 改造 + 单测；`assetMigration` 让出 + 单测；
  `lastAssetMaintenance` 扩展。
- 验证：`assetGc.test.ts` / `assetStore.test.ts` / `multiTab.spec`（只读不跑维护链）全绿。
- 提交：`perf: 资产 GC 分片预算与批量删除`。

### Step 5：文档与全量验证

- 按 §15 原地改写 docs（不写变更记录/日期）。
- `pnpm verify`；`pnpm test:e2e` 全量（或至少 fast 层 + image/multiTab 专项）；
  按实跑结果更新 docs/15 与 AGENTS 的数字。
- 提交：`docs: 资产生命周期与 GC 分片规格`。

每个 commit 前至少：`pnpm lint` + `pnpm typecheck` + 相关 vitest；
Step 2/3 之后跑 `pnpm test:e2e packages/app/e2e/image.spec.ts`。

## 11. 测试矩阵

### 11.1 单元（vitest）

`imageLoadController.test.ts`（fake port + fake timer，无 PIXI/DOM）：

1. `setSrc(A)` 成功：状态 loading→loaded，host.onLoaded 收到 texture。
2. A 成功后 `setSrc(B)`：loading 时旧租约不释放；B 提交后 A 租约恰好释放一次。
3. **迟到成功**：A 在途 → `setSrc(B)` → B 先完成 → A 后完成：
   A 的 lease 被释放，B 的租约保持，onLoaded 不覆盖 B。
4. **迟到失败**：A 迟到 reject 不得把 B 标成 failed，也不得释放 B。
5. `missing` 结果：状态 missing，host.onFailed('missing')，无自动重试。
6. `error` + retryable=true + http：按 600/1800 排两次，第三次失败不再排；总 attempts=2。
7. `error` + data URL，或 `retryable=false`（建纹/IDB 故障）：不排重试。
8. 重试前 `setSrc(C)`：计时器取消，回调不执行。
9. `retry()` 手动：attempts 归零，重新 acquire；成功后清理 failed 态。
10. `dispose()`：取消计时器、释放当前租约；再次回调 no-op。
11. lease 幂等：重复 release 只减一次。

`imageTextureCache.test.ts`（fake source + fake codec）：

1. 同 assetId 两次 acquire：codec.createTexture 只调一次，texture.uid 相同，refs=2。
2. release 一个：refs=1，texture 未销毁；release 第二个：destroy 一次 + source.release 一次。
3. 并发 acquire（首个未完成）：共享同一 pending，createTexture 一次，两者都成功。
4. open 返回 null：missing；codec 不调用；无条目残留。
5. decode reject：error + retryable=true；createTexture reject：error + retryable=false；
   两者都 source.release 一次、pending 清理、可再次 acquire。
6. data/http（key=null）：不共享，两次 acquire 两次 createTexture，各自 release 独立销毁。
7. dispose：所有条目销毁 + source 归还；之后 acquire 返回 error/missing，不泄漏。
8. debug()：entries/refs/uid 正确；pending 期间 pending=1。

`assetStore.test.ts` 追加：

1. `sweepOrphans`：混合「引用中/宽限内/可删/不存在」四类，只删可删；计数正确。
2. 持活 objectURL 的行不删（kept）。
3. 空数组 no-op。

`assetGc.test.ts` 追加（注入 now/yield/listDocIds/scanDoc）：

1. 资产库为空：`scanDoc` 零调用，直接返回。
2. `shouldContinue` 在第 2 篇后为 false：removed=0、partial='cancelled'、无删除事务。
3. 预算在 mark 阶段耗尽：removed=0、partial='budget'。
4. 预算在 sweep 阶段耗尽：已删批次保留、partial='budget'、removed>0。
5. 每篇扫描后调用一次 yield（顺序断言）。
6. 既有六条安全用例全绿。

`assetMigration.test.ts` 追加：

1. 每 8 条让出一次。
2. `shouldContinue` false：停止迁移、未迁移项保持 data URL、返回值 cancelled。

### 11.2 E2E（`packages/app/e2e/image.spec.ts`）

1. **纹理共享**：同一 PNG 连续粘贴两次（都走 `storeAndAdd` → 同 assetId）；
   `__debug.imageTextures.entries` 只有 1 条且 refs=2；删一张 → refs=1；删第二张 → 空。
   两张的 `vmStates[].imageLoad` 为 loaded，`imageLoad.textureUid` 相同且等于
   `entries[0].uid`。
2. **切换 src 无泄漏**：两张不同 PNG 资产 A/B；先显示 A，快速 `img.set('src', B)`；
   poll 到 src=B 且 hasSprite；`__debug.assetLeases[A]=0`、`[B]=1`；
   删图后 B 归零。（竞态本身由单测确定性覆盖，E2E 守计数不变式）
3. **自动重试**：`page.route('https://assets.spinth.test/dot.png')` 前两次 abort、
   第三次 fulfill PNG（带 `access-control-allow-origin: *` 与 `content-type: image/png`）；
   造 IMAGE src=该 URL；poll 到 hasSprite=true，且 route 命中 3 次、
   `imageLoad.attempts=0`（成功后清零）。
4. **手动重试**：构造唯一内容的 PNG（追加随机字节避免与既有资产同 id），
   在页面内 `crypto.subtle.digest('SHA-256', bytes)` 得 hash，造 IMAGE
   src=`spinth-asset:<hash>`（此时账本无此行）→ poll `imageLoad.state='missing'`、
   hasSprite=false；再 `__spinth.assetStore.put(blob)`（同内容 → 同 id）→ 双击画布 →
   poll hasSprite=true。
5. **只读标签可重试**：可选；在 multiTab.spec 加一条 follower 双击 missing 图不报错
   （不写文档）。若成本高可省，但要在 handoff 里说明。

E2E 纪律：不写死睡眠；全部 `expect.poll` + 探针；图片用内置 1×1 PNG；结束时清 doc 库。

### 11.3 手工抽查

- 贴图 → 缩放/旋转/删除/undo → 再 undo，图片正常。
- 断网状态贴外链图 → 失败占位 → 双击 → 恢复网络 → 加载成功。
- 刷新恢复引用图（已有 E2E 覆盖）。

## 12. 验收标准

- `pnpm verify` 全绿（hygiene/lint/prettier/typecheck/单测/build）。
- `pnpm test:e2e` 至少 fast 层全绿；image.spec 全绿；multiTab.spec 全绿。
- 新增单测覆盖 §11.1 全部用例；**竞态用例在旧实现语义下应为红**（审查时确认测试真能守住）。
- 探针：`__debug.imageTextures` / `assetLeases` / `vmStates[].imageLoad` 可从 E2E 读取。
- 单文件 < 400 行（新增文件按 §9.2 预算）。
- `pnpm test:coverage` 阈值 61/51/52/63 不破（新增控制器/缓存/重试模块要有单测覆盖）。
- `docs/19` 与实现一致；docs 只写当前事实，无日期/提交号/验收流水账。
- 公开 API 面不变：`BoardPublicApi` 不新增字段（内部字段加入 Omit）。
- 无新增 `any`；注入全走组合根；无全局单例。

## 13. 审查清单（设计人复核用）

### 架构与铁律

- [ ] 所有写操作仍只经 Yjs/Model；本批没有新增 Yjs 写入路径（迁移除外，沿用 MIGRATE_ORIGIN）。
- [ ] VM 不直接依赖 AssetStore；经 `IImageTexturePort` 注入。
- [ ] 缓存/控制器在 `composeBoard` 创建，`BoardSDK` 仅持字段；无模块级单例。
- [ ] 新文件职责单一、行数达标；几何/hitTest 代码未被无谓重排。

### L1 竞态

- [ ] 过期路径只释放自己拿到的 lease；不存在共享 `heldAssetId` 式槽位。
- [ ] `setSrc` 清除计时器；`dispose` 后无异步回调改状态。
- [ ] 失败时旧 sprite 被销毁，不会出现「新 src + 旧图」。

### L2 纹理

- [ ] `destroySprite` 不再销毁纹理（grep `texture.destroy` 只应出现在缓存）。
- [ ] 引用计数 +1/-1 配对；release 幂等；归零销毁且只销毁一次。
- [ ] 同图两实例只创建一个 Texture；refs 与 E2E 探针一致。
- [ ] 缓存条目在存活期持有 URL 租约，GC 闸门仍有效。

### L3 重试

- [ ] 只有 `retryable=true` 且 http(s) 的 decode 失败自动重试；上限 2 次；手动重置。
- [ ] 每次重试前检查 token；src 变化立即取消。
- [ ] 占位四态区分；只读标签可双击重试且不写文档。
- [ ] 双击监听只认 canvas，工具期不误触。

### L4 GC

- [ ] 空资产库短路在 listDocIds 之前。
- [ ] mark 阶段打断 = 零删除；sweep 阶段可部分。
- [ ] 批量删除仍是单 reader + 单 writer 事务；持活/宽限语义不变。
- [ ] 单写者锁覆盖整轮；只读标签仍不跑维护链。
- [ ] 统计字段追加而非替换；multiTab 现有断言不改。

### 测试与文档

- [ ] 单测用假 timer/codec/source，不依赖真实网络/计时器/WebGL。
- [ ] E2E 全 poll + 探针，无固定 sleep；新增用例结束清库。
- [ ] `docs/19 §3/§4/§5`、`docs/13`、`docs/15`、`docs/16` 已按实现改写。
- [ ] 文档数字是复跑后的真实值；无历史叙事。

### 命令

```bash
pnpm verify
pnpm test:e2e packages/app/e2e/image.spec.ts
pnpm test:e2e packages/app/e2e/multiTab.spec.ts
pnpm test:e2e --grep-invert "@timing|@bench|@visual"   # 最终回归
```

## 14. 风险与回退

| 风险                             | 影响                  | 缓解/回退                                                 |
| -------------------------------- | --------------------- | --------------------------------------------------------- |
| 共享纹理被早销毁                 | 其他实例黑图/花屏     | refs 单测 + 双实例 E2E；只允许缓存销毁纹理                |
| PIXI `Texture.from` 内部行为差异 | 同图仍建多份          | 用 fake codec 断言缓存层只调一次；真实环境用 uid 探针核验 |
| 重试定时器泄漏/闪回              | 异步改已销毁 VM       | fake timer 单测 + token/disposed 双检                     |
| GC mark 被打断后误删             | 数据丢失              | 设计上 mark 中断零删除；单测显式断言                      |
| 预算过小                         | 长期清不完            | 默认 1500ms；stats 暴露 partial；下轮继续                 |
| dispose 顺序调整                 | StrictMode 双挂载回归 | 现有 `dispose` 幂等；跑 smoke/multiTab；必要时回退顺序    |
| 双击与未来图片交互冲突           | 误触                  | 仅失败/缺失态才 retry；loaded 时 no-op                    |
| 探针字段变更                     | E2E 类型破裂          | 只追加可选字段；同步 helper 类型                          |

## 15. 文档同步（Step 5）

- `docs/19-assets.md`：
  - §3 增加「解析/解码两处校验」「纹理按 assetId 共享、引用归零销毁」「同图多实例一份纹理」；
  - §4 增加失败分类/自动重试/双击手动重试/四态占位；
  - §5 增加 GC 空库短路、批量删除、时间预算、partial 统计、mark 中断零删除。
- `docs/13-roadmap.md`：§2 P1 资产/图片生命周期四条按完成情况勾选/改写；
  §3 决策台账补「纹理按 assetId 共享、GC 软预算」。
- `docs/15-testing.md`：新增单测/E2E 锚点与实跑数字（复跑后填）。
- `docs/16-performance.md`：GC 成本条目改写为分片预算后的口径。
- `AGENTS.md`：仅在最终数字变化时更新「当前实测基线」。
- 禁止：日期、commit 哈希、PR 号、「此前/现在/已修复」叙事、验收清单。

## 16. 已定决策（实施前若有异议先反馈）

1. **共享范围**：只共享 `spinth-asset:`；data/http 不缓存。
2. **切换语义**：加载中保留旧图，提交/失败后才替换；失败显示错误占位（不显示旧图）。
3. **自动重试**：仅 http(s) 的 decode 失败，2 次，600ms/1800ms；手动不限次。
4. **手动入口**：画布双击（cursor 模式），不加右键菜单/工具栏按钮。
5. **GC 预算**：软预算 1500ms，mark 中断零删除，sweep 可部分，统计暴露 partial。
6. **销毁顺序**：`vmEngine.dispose → imageTextures.dispose → assetStore.close → engine.dispose → viewport.dispose`。
7. **接口位置**：图片视图层契约放 `widgets/image/`，不塞进 `types/`（不跨包、不构成宿主契约）；
   数据层契约（sweepOrphans）留在 `assetStore.ts`。
8. **VM 探针**：`imageLoad` 与 `imageTextures`/`assetLeases` 进 `__debug`（dev-only 面）。

## 17. 交付要求（给实施 agent）

- 回复里报告：每个 commit 的 hash/标题、`pnpm verify` 与 E2E 的实跑结果、
  新增/修改文件行数、探针输出样例、与本文档的偏差（有则说明理由）。
- 本 spec 文件随代码提交；不要修改 `.git/info/exclude` 之外的仓库忽略配置。
- 遇到设计冲突（例如 PIXI 行为与 §5.5 不符）先停下说明，不要自行扩大范围。
- 完成实现后交回设计人做 §13 审查；审查通过前不合并/不继续 P2。
