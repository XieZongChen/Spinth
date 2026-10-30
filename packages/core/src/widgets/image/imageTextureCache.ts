import type { Texture } from 'pixi.js';
import type { IImageTexturePort, ImageTextureResult } from './imageLoadController';
import { textureUidOf } from './imageLoadController';
import {
  DEFAULT_IMAGE_KEEP_ALIVE,
  type IImageKeepAliveBudget,
  type IImageKeepAliveTimers,
  ImageKeepAlivePool,
  estimateTextureBytes,
  systemTimers,
} from './imageKeepAlive';
import { assetIdOf, isAssetSrc } from '../../platform/dataEngine/assetStore';

/** 已解析的加载源（asset 路径 = AssetStore.objectURL 的引用计数租约） */
export interface IImageSourceHandle {
  url: string;
  /** 与 open 配对；asset 路径 = AssetStore.releaseObjectURL(id) */
  release(): void;
}

/** src → 可解码 URL 端口：null = 资产缺失/无解析器（终态 missing） */
export interface IImageSourcePort {
  open(src: string): Promise<IImageSourceHandle | null>;
}

/** 解码/建纹端口（组合根注入浏览器实现；单测注入 fake） */
export interface IImageCodec {
  decode(url: string): Promise<HTMLImageElement>;
  createTexture(img: HTMLImageElement): Texture;
}

/** open 返回 null（资产行不存在）——映射为 missing 终态 */
export class MissingAssetError extends Error {
  constructor() {
    super('asset row missing');
  }
}

/** 建纹链失败：retryable 标记失败阶段（解码 true / 建纹与存储层 false） */
export class TextureBuildError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly reason: unknown, // 不用 cause——避免覆盖 ES2022 Error.cause
  ) {
    super('texture build failed');
  }
}

interface ICacheEntry {
  /** assetId（可共享）；data/http 无 key 条目为 null（lease 归零即销毁） */
  key: string | null;
  refs: number;
  texture: Texture;
  source: IImageSourceHandle;
  destroyed: boolean;
}

/** 构造可选项（组合根可调；不进 IBoardConfig、不从 index.ts 导出） */
export interface IImageTextureCacheOptions {
  /** 保活预算；windowMs<=0 = 关闭保活（release 即销毁，等价旧行为） */
  keepAlive?: Partial<IImageKeepAliveBudget>;
  /** 计时器端口（单测注入假实现） */
  timers?: IImageKeepAliveTimers;
  /** pagehide 来源；组合根传 window，Node 单测不传（默认 null = 不监听） */
  lifecycle?: EventTarget | null;
}

/**
 * 纹理缓存（L2 同图共享）：同 assetId 只解码/建纹一次，多 VM 各持一份
 * 租约（引用计数）；refs 归零进入保活窗口（默认 5s/8 条/32MiB，LRU 逐出，
 * specs/texture-keepalive），窗口内重新 acquire 直接复用，窗口结束或被
 * 预算逐出才 texture.destroy(true) 并归还 URL 租约。缓存条目在存活（含
 * 保活窗口）期间持有 objectURL 租约——资产 GC 的「持活不删」闸门因此
 * 覆盖保活期（同图 N 实例只占 1 份计数，比每 VM 各持一份更省）。
 *
 * data URL / http 走不缓存分支：data URL 可能超长不能当 Map key；http
 * 内容可变，共享语义不成立；二者释放即销毁，不进入保活池。
 */
export class ImageTextureCache implements IImageTexturePort {
  private readonly entries = new Map<string, ICacheEntry>();
  /** in-flight 去重：同 key 并发 acquire 共享同一次 build */
  private readonly pending = new Map<string, Promise<ICacheEntry>>();
  /** data/http（无 key）的在租条目：不共享但仍需被 dispose 兜底回收 */
  private readonly transient = new Set<ICacheEntry>();
  private disposed = false;
  /** keyed 条目归零后的空闲保活池（到期/逐出经 onEvict → destroyEntry 销毁） */
  private readonly keepAlive: ImageKeepAlivePool<ICacheEntry>;
  /** pagehide 摘除函数；未注册监听时为 no-op */
  private readonly offLifecycle: () => void;

  constructor(
    private readonly source: IImageSourcePort,
    private readonly codec: IImageCodec,
    options: IImageTextureCacheOptions = {},
  ) {
    const budget = clampBudget(options.keepAlive);
    this.keepAlive = new ImageKeepAlivePool<ICacheEntry>(
      budget,
      options.timers ?? systemTimers,
      (entry) => this.destroyEntry(entry),
      (entry) => estimateTextureBytes(entry.texture),
    );
    this.offLifecycle = options.lifecycle
      ? bindPageHide(options.lifecycle, () => this.dropIdle())
      : noop;
  }

  async acquire(src: string): Promise<ImageTextureResult> {
    if (this.disposed) {
      return { kind: 'error', error: new Error('image texture cache disposed'), retryable: false };
    }
    const key = isAssetSrc(src) ? assetIdOf(src) : null;
    if (key === null) return this.acquireUncached(src);
    const live = this.entries.get(key);
    if (live && !live.destroyed) {
      this.keepAlive.wake(live); // idle → live：取消保活计时（不在池中 no-op）
      live.refs++;
      return { kind: 'ok', lease: this.leaseOf(live) };
    }
    let p = this.pending.get(key);
    if (!p) {
      p = this.build(key, src);
      this.pending.set(key, p);
    }
    try {
      const entry = await p;
      // dispose 竞态双兜底：dispose 的 then 可能排在本次续体之后——此时
      // entry 尚未标 destroyed 但马上会被销毁，不能再发租约
      if (entry.destroyed || this.disposed) return { kind: 'missing' };
      entry.refs++;
      return { kind: 'ok', lease: this.leaseOf(entry) };
    } catch (err) {
      if (err instanceof MissingAssetError) return { kind: 'missing' };
      if (err instanceof TextureBuildError) {
        return { kind: 'error', error: err.reason, retryable: err.retryable };
      }
      return { kind: 'error', error: err, retryable: false }; // open 自身故障（IDB）
    }
  }

  /** 无条件销毁全部缓存条目与 URL 租约（SDK 生命周期结束；UI 不再复用）。
   *  build 在途的 pending 挂销毁兜底，acquire 侧用 disposed/destroyed 拦截；
   *  无 key 的 transient 条目（data/http）同样无条件回收 */
  dispose(): void {
    this.disposed = true;
    this.offLifecycle(); // 摘 pagehide 监听（StrictMode 双挂载防泄漏）
    this.keepAlive.dropAll(); // 空闲条目：取消计时 + 逐条销毁（在租的走下面统一销毁）
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    for (const entry of this.transient) this.destroyEntry(entry);
    this.transient.clear();
    for (const p of this.pending.values()) {
      void p.then(
        (entry) => this.destroyEntry(entry),
        () => {}, // build 失败路径已自行 source.release
      );
    }
    this.pending.clear();
  }

  /** pagehide 入口：只清空闲条目（在租条目仍被 sprite 引用，销毁会破画面） */
  dropIdle(): void {
    this.keepAlive.dropAll();
  }

  /** 探针（E2E 断言「同图一份纹理 / refs 计数」）；entries 含保活空闲条目
   *  （refs=0 + idle=true），keepAlive 汇报空闲条目数与估算字节（验预算） */
  debug(): {
    entries: Array<{ key: string; refs: number; uid: number; idle: boolean }>;
    pending: number;
    keepAlive: { count: number; bytes: number };
  } {
    return {
      entries: Array.from(this.entries.values()).map((e) => ({
        key: e.key ?? '',
        refs: e.refs,
        uid: textureUidOf(e.texture),
        idle: this.keepAlive.has(e),
      })),
      pending: this.pending.size,
      keepAlive: this.keepAlive.stats,
    };
  }

  /** data/http：不共享（每次独立条目，lease 归零即销毁），失败分类与缓存路径一致 */
  private async acquireUncached(src: string): Promise<ImageTextureResult> {
    let source: IImageSourceHandle | null;
    try {
      source = await this.source.open(src);
    } catch (err) {
      return { kind: 'error', error: err, retryable: false };
    }
    if (!source) return { kind: 'missing' };
    if (this.disposed) {
      source.release(); // open 在途时 dispose 到达——拿到的租约即刻归还
      return { kind: 'missing' };
    }
    let img: HTMLImageElement;
    try {
      img = await this.codec.decode(source.url);
    } catch (err) {
      source.release();
      return { kind: 'error', error: err, retryable: true }; // 解码失败：按 src 策略重试
    }
    let texture: Texture;
    try {
      texture = this.codec.createTexture(img);
    } catch (err) {
      source.release();
      return { kind: 'error', error: err, retryable: false }; // 建纹失败：不自动重试
    }
    const entry: ICacheEntry = { key: null, refs: 1, texture, source, destroyed: false };
    this.transient.add(entry); // 登记：dispose 兜底能回收（无 key 不进 entries）
    if (this.disposed) {
      this.destroyEntry(entry); // 建纹期间 dispose 到达——纹理不得逃逸出销毁链
      return { kind: 'missing' };
    }
    return { kind: 'ok', lease: this.leaseOf(entry) };
  }

  private async build(key: string, src: string): Promise<ICacheEntry> {
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
      const entry: ICacheEntry = { key, refs: 0, texture, source, destroyed: false };
      this.entries.set(key, entry);
      return entry;
    } finally {
      this.pending.delete(key); // 成功/失败都不留 rejected Promise（否则同 key 永久失败）
    }
  }

  private leaseOf(entry: ICacheEntry): { texture: Texture; release(): void } {
    let released = false;
    return {
      texture: entry.texture,
      release: (): void => {
        if (released || entry.destroyed) return; // 幂等 + 销毁竞态兜底
        released = true;
        entry.refs--;
        if (entry.refs > 0) return;
        if (entry.key === null)
          this.destroyEntry(entry); // data/http：释放即销毁（不保活）
        else this.keepAlive.hold(entry); // keyed：进入保活窗口（可被预算同步逐出）
      },
    };
  }

  private destroyEntry(entry: ICacheEntry): void {
    if (entry.destroyed) return; // dispose 与 lease 归零可能先后到达
    entry.destroyed = true;
    this.keepAlive.forget(entry); // 先摘保活计时器，再进入销毁（防到期回调踩已销毁条目）
    if (entry.key !== null && this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.transient.delete(entry); // 无条件（keyed 条目不在集合内，delete 无害）
    try {
      entry.texture.destroy(true); // true = 连 textureSource 释放 GPU
    } catch {
      // 防御：缓存销毁链不得中断（source.release 必须执行）
    }
    entry.source.release();
  }
}

const noop = (): void => {};

/** 预算钳制：Partial 与默认合并；非有限/负值回退默认（防宿主误传导致永不逐出） */
function clampBudget(over: Partial<IImageKeepAliveBudget> | undefined): IImageKeepAliveBudget {
  const pick = (v: number | undefined, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  const raw = over ?? {};
  return {
    windowMs: pick(raw.windowMs, DEFAULT_IMAGE_KEEP_ALIVE.windowMs),
    maxEntries: pick(raw.maxEntries, DEFAULT_IMAGE_KEEP_ALIVE.maxEntries),
    maxBytes: pick(raw.maxBytes, DEFAULT_IMAGE_KEEP_ALIVE.maxBytes),
  };
}

/** 注册 pagehide → dropIdle；返回摘除函数（dispose 时调用，防 StrictMode 双挂载泄漏） */
function bindPageHide(target: EventTarget, onPageHide: () => void): () => void {
  target.addEventListener('pagehide', onPageHide);
  return (): void => {
    target.removeEventListener('pagehide', onPageHide);
  };
}
