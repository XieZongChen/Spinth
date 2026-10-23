import type { Texture } from 'pixi.js';
import type { IImageTexturePort, ImageTextureResult } from './imageLoadController';
import { textureUidOf } from './imageLoadController';
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

/**
 * 纹理缓存（L2 同图共享）：同 assetId 只解码/建纹一次，多 VM 各持一份
 * 租约（引用计数）；refs 归零才 texture.destroy(true) 并归还 URL 租约。
 * 缓存条目在存活期间持有 objectURL 租约——资产 GC 的「持活不删」闸门
 * 因此仍然生效（同图 N 实例只占 1 份计数，比每 VM 各持一份更省）。
 *
 * data URL / http 走不缓存分支：data URL 可能超长不能当 Map key；http
 * 内容可变，共享语义不成立。
 */
export class ImageTextureCache implements IImageTexturePort {
  private readonly entries = new Map<string, ICacheEntry>();
  /** in-flight 去重：同 key 并发 acquire 共享同一次 build */
  private readonly pending = new Map<string, Promise<ICacheEntry>>();
  private disposed = false;

  constructor(
    private readonly source: IImageSourcePort,
    private readonly codec: IImageCodec,
  ) {}

  async acquire(src: string): Promise<ImageTextureResult> {
    if (this.disposed) {
      return { kind: 'error', error: new Error('image texture cache disposed'), retryable: false };
    }
    const key = isAssetSrc(src) ? assetIdOf(src) : null;
    if (key === null) return this.acquireUncached(src);
    const live = this.entries.get(key);
    if (live && !live.destroyed) {
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
      if (entry.destroyed) return { kind: 'missing' }; // dispose 竞态兜底
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
   *  build 在途的 pending 挂销毁兜底，acquire 侧用 entry.destroyed 拦截 */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    for (const p of this.pending.values()) {
      void p.then(
        (entry) => this.destroyEntry(entry),
        () => {}, // build 失败路径已自行 source.release
      );
    }
    this.pending.clear();
  }

  /** 探针（E2E 断言「同图一份纹理 / refs 计数」） */
  debug(): { entries: Array<{ key: string; refs: number; uid: number }>; pending: number } {
    return {
      entries: Array.from(this.entries.values()).map((e) => ({
        key: e.key ?? '',
        refs: e.refs,
        uid: textureUidOf(e.texture),
      })),
      pending: this.pending.size,
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
        if (entry.refs <= 0) this.destroyEntry(entry);
      },
    };
  }

  private destroyEntry(entry: ICacheEntry): void {
    if (entry.destroyed) return; // dispose 与 lease 归零可能先后到达
    entry.destroyed = true;
    if (entry.key !== null && this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    try {
      entry.texture.destroy(true); // true = 连 textureSource 释放 GPU
    } catch {
      // 防御：缓存销毁链不得中断（source.release 必须执行）
    }
    entry.source.release();
  }
}
