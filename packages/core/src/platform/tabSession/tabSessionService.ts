import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import {
  INITIAL_TAB_SESSION_STATE,
  type ITabLockHandle,
  type ITabLockPort,
  type ITabSessionState,
} from '../../types/tabSession';

/** 写者锁名前缀（docs/21 §2）：按 docId 排他——不同文档的两个标签都可写 */
export const TAB_LOCK_PREFIX = 'spinth-doc-write:';
/** 接管延迟（docs/21 §5）：① 刷新/跳转的 leader 新页面在此窗口排进锁队列，
 *  刷新完成后优先拿回锁；② 覆盖 pagehide 时 100ms 写聚合窗口的 flush */
export const PROMOTION_DELAY_MS = 300;
/** 接管回调未导航（页面仍存活）的兜底窗口：释放锁、回 follower，防陈旧写者 */
export const PROMOTION_FALLBACK_MS = 1000;
/** fallback 回 follower 后的自愈重排延迟：回调失效场景的低频重试——不做
 *  1s 级（会与失效的 onPromoted 组成无限「授予→刷新失败→释放」循环） */
export const RETRY_AFTER_FALLBACK_MS = 30_000;

export interface ITabSessionOptions {
  docId: string;
  locks: ITabLockPort | null;
  /** 接管回调：实现方必须导航（app 传 location.reload） */
  onPromoted: () => void;
  promotionDelayMs?: number;
}

/**
 * 标签角色会话（docs/21 §2/§5）：Web Locks 排他锁是写者唯一事实来源。
 * 实例由调用方持有（app 壳页面级单例）；本类无模块级可变状态。
 */
export class TabSessionService extends Disposable {
  readonly state$ = new BehaviorSubject<ITabSessionState>(INITIAL_TAB_SESSION_STATE);

  private readonly opts: ITabSessionOptions;
  private started = false;
  private disposed = false;
  /** pagehide 已让锁（或已 dispose）：此后到达的授予一律丢弃 */
  private released = false;
  private handle: ITabLockHandle | null = null;
  private promotionTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ITabSessionOptions) {
    super();
    this.opts = opts;
  }

  /** 申请锁并定角色。幂等：重复调用 / dispose 后调用直接返回。 */
  start(): Promise<void> {
    if (this.started || this.disposed) return Promise.resolve();
    this.started = true;
    if (this.opts.locks === null) {
      this.emit({ role: 'solo', writable: true });
      return Promise.resolve();
    }
    const name = TAB_LOCK_PREFIX + this.opts.docId;
    return this.opts.locks
      .tryAcquire(name)
      .then((handle) => {
        if (this.disposed || this.released) {
          handle?.release(); // 等待期间页面已让锁——立即归还，不回调
          return;
        }
        if (handle) {
          this.handle = handle;
          this.emit({ role: 'leader', writable: true });
          return;
        }
        this.emit({ role: 'follower', writable: false });
        this.queueWait(name);
      })
      .catch((err: unknown) => {
        if (this.disposed) return;
        console.warn('[spinth:tab] 写者锁申请失败，降级单标签可写', err);
        this.emit({ role: 'solo', writable: true });
      });
  }

  /** pagehide 让锁：清定时器、释放 handle；不发状态（页面即将消失）。
   *  之后排队授予到达时也会被丢弃（released 置位）。 */
  release(): void {
    this.released = true;
    this.clearTimers();
    this.releaseHandle();
  }

  override dispose(): void {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
    this.state$.complete();
    super.dispose();
  }

  private queueWait(name: string): void {
    const locks = this.opts.locks;
    if (!locks) return;
    void locks
      .wait(name)
      .then((handle) => {
        // dispose/pagehide 之后才授予：立即放锁、不回调（防陈旧写者）
        if (this.disposed || this.released) {
          handle.release();
          return;
        }
        this.handle = handle;
        this.promotionTimer = setTimeout(() => {
          this.promotionTimer = null;
          if (this.disposed || this.released) return;
          this.opts.onPromoted();
          // 接管回调没导航（页面仍存活）→ 释放锁、回 follower、warn；
          // 不自动重新排队——回调失效下重排会造成无限刷新循环
          this.fallbackTimer = setTimeout(() => {
            this.fallbackTimer = null;
            if (this.disposed || this.released) return;
            console.warn('[spinth:tab] 接管回调未导航，释放写者锁并回到只读');
            this.releaseHandle();
            this.emit({ role: 'follower', writable: false });
            // 自愈：30s 后重新排队等锁（若写者已离开仍可接管；回调持续失效
            // 则每 30s 至多重试一轮，不构成刷新风暴）
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              if (this.disposed || this.released) return;
              this.queueWait(name);
            }, RETRY_AFTER_FALLBACK_MS);
          }, PROMOTION_FALLBACK_MS);
        }, this.opts.promotionDelayMs ?? PROMOTION_DELAY_MS);
      })
      .catch((err: unknown) => {
        if (this.disposed) return;
        // 能走到排队说明 tryAcquire 已返回 null——确实存在别的写者；wait 失败
        // 不允许降级 solo（否则出现第二个写者），保持 follower 只读
        console.warn('[spinth:tab] 写者锁等待失败，保持只读', err);
        this.emit({ role: 'follower', writable: false });
      });
  }

  private emit(state: ITabSessionState): void {
    if (this.disposed) return;
    this.state$.next(state);
  }

  private releaseHandle(): void {
    this.handle?.release();
    this.handle = null;
  }

  private clearTimers(): void {
    if (this.promotionTimer !== null) {
      clearTimeout(this.promotionTimer);
      this.promotionTimer = null;
    }
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
