import type { Texture } from 'pixi.js';

/** 保活预算：只约束空闲条目（在租纹理不受限——保活是回收策略，不是渲染准入） */
export interface IImageKeepAliveBudget {
  /** 空闲窗口；0 = 关闭保活（release 即销毁）。负数/非有限由缓存构造侧
   *  clampBudget 钳回默认——经缓存构造后传入池的 windowMs 恒为非负，<=0 即 ===0 */
  windowMs: number;
  /** 空闲条目数上限 */
  maxEntries: number;
  /** 空闲纹理估算显存上限（字节）；只核纹理估算，URL 租约的编码字节不计入 */
  maxBytes: number;
}

/** 默认预算（specs/texture-keepalive §4.4）：8 张 ≈ 6-56MB 量级，32MiB 上限挡 12MP 原图 */
export const DEFAULT_IMAGE_KEEP_ALIVE: IImageKeepAliveBudget = {
  windowMs: 5_000,
  maxEntries: 8,
  maxBytes: 32 * 1024 * 1024,
};

/** 计时器端口（与 ImageLoadController 的 IImageTimerPort 同形，但独立定义——两个模块互不依赖） */
export interface IImageKeepAliveTimers {
  /** 返回取消函数 */
  set(fn: () => void, ms: number): () => void;
}

/** 默认计时器实现（缓存直接复用；单测注入假端口） */
export const systemTimers: IImageKeepAliveTimers = {
  set: (fn, ms): (() => void) => {
    const h = setTimeout(fn, ms);
    return (): void => clearTimeout(h);
  },
};

const noop = (): void => {};

/** 非有限正数回 0（fake 纹理无宽高 → 记账 0 字节，预算只受条目数约束） */
function finitePositive(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** 纹理估算显存：宽×高×4（RGBA；不含 mipmap/驱动开销，估算而非精确核算） */
export function estimateTextureBytes(texture: Texture): number {
  const source = (texture as { source?: { width?: number; height?: number } }).source;
  const w = finitePositive(source?.width ?? texture.width);
  const h = finitePositive(source?.height ?? texture.height);
  return w * h * 4;
}

interface IPoolSlot {
  bytes: number;
  cancel: () => void;
}

/**
 * 空闲保活池：窗口 + 双上限 + LRU 的完整状态机（specs/texture-keepalive §5）。
 * 池只回答「还能留多久、留多少」；条目的销毁经 onEvict 交还调用方，且回调
 * 总在条目移出池**之后**触发——避免 onEvict → destroyEntry → forget 的重入环。
 * Map 的插入序即 LRU 序（重新 hold 会移到队尾）。
 */
export class ImageKeepAlivePool<T extends object> {
  private readonly items = new Map<T, IPoolSlot>();
  private totalBytes = 0;

  constructor(
    private readonly budget: IImageKeepAliveBudget,
    private readonly timers: IImageKeepAliveTimers,
    /** 逐出/到期回调：条目已移出池，调用方负责销毁 */
    private readonly onEvict: (item: T) => void,
    /** 估算字节数（缓存传纹理估算；池本身不认识 PIXI） */
    private readonly bytesOf: (item: T) => number,
  ) {}

  /** refs→0：登记 + 计时 + 预算逐出；不满足保活条件（窗口关/单条超预算）时同步 onEvict */
  hold(item: T): void {
    if (this.items.has(item)) return; // 幂等
    const bytes = this.bytesOf(item);
    if (this.budget.windowMs <= 0 || bytes > this.budget.maxBytes) {
      this.onEvict(item); // 不入池，直接交还销毁（避免「插入即逐出」抖动）
      return;
    }
    const slot: IPoolSlot = { bytes, cancel: noop };
    this.items.set(item, slot);
    this.totalBytes += bytes;
    slot.cancel = this.timers.set(() => this.expire(item), this.budget.windowMs);
    while (this.items.size > this.budget.maxEntries || this.totalBytes > this.budget.maxBytes) {
      const first = this.items.keys().next().value;
      if (first === undefined) break; // 类型防御（size>0 时不会走到）
      this.remove(first);
      this.onEvict(first); // 先移出再回调，防重入
    }
  }

  /** 复用：取消计时并移出；不在池中返回 false（live 条目直接 acquire 的常态） */
  wake(item: T): boolean {
    if (!this.items.has(item)) return false;
    this.remove(item);
    return true;
  }

  /** 销毁路径：取消计时并移出（幂等；条目可能已被到期/逐出摘走） */
  forget(item: T): void {
    this.remove(item);
  }

  /** 探针用（debug 的 entries[].idle） */
  has(item: T): boolean {
    return this.items.has(item);
  }

  /** pagehide/dispose：逐出全部（回调按 LRU 序触发） */
  dropAll(): void {
    for (const item of [...this.items.keys()]) {
      this.remove(item);
      this.onEvict(item);
    }
  }

  get stats(): { count: number; bytes: number } {
    return { count: this.items.size, bytes: this.totalBytes };
  }

  private expire(item: T): void {
    if (!this.items.has(item)) return; // 已被 wake/forget/dropAll 摘走
    this.remove(item);
    this.onEvict(item);
  }

  /** 只做记账（取消计时 + 移出），不回调——销毁由调用方收口 */
  private remove(item: T): void {
    const slot = this.items.get(item);
    if (!slot) return;
    slot.cancel();
    this.items.delete(item);
    this.totalBytes -= slot.bytes;
  }
}
