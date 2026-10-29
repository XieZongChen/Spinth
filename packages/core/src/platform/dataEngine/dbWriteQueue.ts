import { BehaviorSubject } from 'rxjs';
import { type IAuditEntry, STORE_ALL, STORE_UPDATES } from './dbSchema';

/**
 * 写聚合队列（docs/16 P2#1，2026-09-28）：曾每个 Yjs 事务立即开 IDB 写事务
 * （笔画采样 60ms/次 ≈ 16-25 写/秒、文本节流 34ms/次），低端磁盘上有 jank 风险。
 * 小窗聚合：窗口内的 update 收集进缓冲，单事务批量落盘（顺序保持）。
 * 状态（缓冲/timer/退避）归本队列；落盘成功经 host.onFlushed 回调宿主
 * （pendingCount 累加 + compaction 调度归 DbProvider）。
 */

/** 写聚合窗口：窗口内的 update 收集进缓冲，单事务批量落盘 */
export const WRITE_FLUSH_MS = 100;
/** 写失败重试退避上限（docs/16 nit#2，2026-09-30 收口）：失败后延迟从
 *  WRITE_FLUSH_MS 起指数翻倍至此封顶，成功复位——持续失败（如配额满）不再
 *  100ms 热循环刷 console.error */
export const WRITE_RETRY_MAX_MS = 5000;

export interface IDbWriteQueueHost {
  getDb(): IDBDatabase | null;
  /** 批量落盘成功（count = 本批 update 条数；宿主累加 pendingCount 并调度 compaction） */
  onFlushed(count: number): void;
}

export class DbWriteQueue {
  private writeBuffer: Uint8Array[] = [];
  private auditBuffer: IAuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** flush 防重入 */
  private flushing = false;
  /** 下次失败重试延迟（指数退避；成功复位 WRITE_FLUSH_MS） */
  private nextRetryDelayMs = WRITE_FLUSH_MS;

  constructor(
    private readonly host: IDbWriteQueueHost,
    /** 落盘状态由宿主持有（saving=缓冲有未落盘 op / failed=退避重试中），构造注入 */
    private readonly persistState$: BehaviorSubject<'saved' | 'saving' | 'failed'>,
  ) {}

  /** 测试探针：与旧 DbProvider 字段同名语义（断言路径迁移用） */
  get retryDelayMs(): number {
    return this.nextRetryDelayMs;
  }
  /** 测试探针：写缓冲未落盘条数 */
  get buffered(): number {
    return this.writeBuffer.length;
  }

  /** 入队（守卫判定归宿主 onDocUpdate：skipOrigins / readOnly / db 就绪） */
  enqueue(update: Uint8Array): void {
    this.writeBuffer.push(update);
    this.auditBuffer.push({ u: update, t: Date.now() } satisfies IAuditEntry);
    this.persistState$.next('saving');
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, WRITE_FLUSH_MS);
    }
  }

  /**
   * 把写缓冲单事务批量落盘（顺序保持；写失败时批退回缓冲待下次重试）。
   * pagehide / visibilitychange(hidden) / dispose 均触发——「flush 必须在关库
   * 之前」经验族。
   */
  async flush(): Promise<void> {
    const db = this.host.getDb();
    if (!db || this.flushing || this.writeBuffer.length === 0) return;
    this.flushing = true;
    const updates = this.writeBuffer;
    const audit = this.auditBuffer;
    this.writeBuffer = [];
    this.auditBuffer = [];
    try {
      const tx = db.transaction([STORE_UPDATES, STORE_ALL], 'readwrite');
      for (const u of updates) tx.objectStore(STORE_UPDATES).add(u);
      for (const a of audit) tx.objectStore(STORE_ALL).add(a);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = (): void => resolve();
        tx.onerror = (): void => reject(tx.error);
      });
      this.nextRetryDelayMs = WRITE_FLUSH_MS; // 成功复位退避
      this.persistState$.next('saved');
      this.host.onFlushed(updates.length);
    } catch (err) {
      console.error('[spinth:db] 批量写入失败（批退回缓冲，指数退避重试）', err);
      this.persistState$.next('failed');
      this.writeBuffer = updates.concat(this.writeBuffer); // 失败批退回队首——顺序保持
      this.auditBuffer = audit.concat(this.auditBuffer);
      this.flushTimer ??= setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.nextRetryDelayMs);
      this.nextRetryDelayMs = Math.min(this.nextRetryDelayMs * 2, WRITE_RETRY_MAX_MS);
    } finally {
      this.flushing = false;
    }
  }

  /** 清 timer 后冲刷剩余缓冲（dispose 通道；宿主等 pending 完成后再关库） */
  dispose(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    return this.writeBuffer.length > 0 || this.auditBuffer.length > 0
      ? this.flush()
      : Promise.resolve();
  }
}
