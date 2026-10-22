/**
 * 存储状态服务（docs/02 §6.1）：组合 IStorageManager 注入端口，输出单一
 * status$ 流（persisted 授权 + estimate 配额）。不轮询——只在启动、面板
 * 打开、窗口可见、persistState 转 failed 时由宿主调 refresh()。
 *
 * 语义边界（D2）：persistState$ 是文档写 IndexedDB 的状态（DbProvider）；
 * 本服务是浏览器持久化授权 + 站点配额，两者不混同。
 */

import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import {
  INITIAL_STORAGE_STATUS,
  type IStorageManager,
  type IStorageStatus,
} from '../../types/storage';
import { normalizeBytes, storagePressure } from './storageMath';

export class StorageStatusService extends Disposable {
  readonly status$: BehaviorSubject<IStorageStatus>;

  private readonly manager: IStorageManager | null;
  private readonly canPersistFlag: boolean;
  private disposedFlag = false;
  private refreshPromise: Promise<void> | null = null;
  private persistPromise: Promise<void> | null = null;

  constructor(manager: IStorageManager | null) {
    super();
    this.manager = manager;
    this.canPersistFlag = typeof manager?.persist === 'function';
    if (manager === null) {
      this.status$ = new BehaviorSubject<IStorageStatus>({
        ...INITIAL_STORAGE_STATUS,
        supported: false,
        persistence: 'unsupported',
      });
    } else {
      this.status$ = new BehaviorSubject<IStorageStatus>({
        ...INITIAL_STORAGE_STATUS,
        canPersist: this.canPersistFlag,
      });
    }
  }

  /** 组合根启动：先刷新；未持久化才申请一次（D4——失败不抛、不阻塞初始化）。 */
  async initialize(): Promise<void> {
    await this.refresh();
    if (this.disposedFlag) return;
    const s = this.status$.value;
    if (this.canPersistFlag && s.persistence !== 'persisted') {
      await this.requestPersist();
    }
  }

  /** 并发合并：重叠调用共享同一次查询；失败保留上次值 + 置 failed 标志。 */
  refresh(): Promise<void> {
    this.refreshPromise ??= this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  /** 单飞：先等 in-flight refresh；requesting → granted/denied/failed。 */
  requestPersist(): Promise<void> {
    this.persistPromise ??= this.doRequestPersist().finally(() => {
      this.persistPromise = null;
    });
    return this.persistPromise;
  }

  override dispose(): void {
    if (this.disposedFlag) return;
    // 请求中状态收口（复审 #3）：complete 前补一帧 requestingPersist=false，
    // 消费者不停在中间态（A12：dispose 后无状态泄漏）
    if (this.status$.value.requestingPersist) {
      this.status$.next({ ...this.status$.value, requestingPersist: false });
    }
    this.disposedFlag = true;
    this.status$.complete();
    super.dispose();
  }

  private async doRefresh(): Promise<void> {
    if (!this.manager || this.disposedFlag) return;
    // Promise.resolve().then 包一层：老浏览器上方法访问同步 throw 也进 allSettled
    const [persistedRes, estimateRes] = await Promise.allSettled([
      Promise.resolve().then(() => this.manager!.persisted?.()),
      Promise.resolve().then(() => this.manager!.estimate?.()),
    ]);
    if (this.disposedFlag) return;
    const next: IStorageStatus = { ...this.status$.value };
    if (persistedRes.status === 'fulfilled' && typeof persistedRes.value === 'boolean') {
      next.persistence = persistedRes.value ? 'persisted' : 'not-persisted';
      next.persistedQueryFailed = false;
    } else {
      // 方法缺失或查询失败：保留上次 persistence，仅置标志（面板显示「无法读取」）
      next.persistedQueryFailed = true;
    }
    if (estimateRes.status === 'fulfilled' && estimateRes.value) {
      next.usage = normalizeBytes(estimateRes.value.usage);
      next.quota = normalizeBytes(estimateRes.value.quota);
      next.estimateFailed = false;
    } else {
      next.estimateFailed = true; // 保留上次 usage/quota
    }
    next.pressure = storagePressure(next.usage, next.quota);
    this.status$.next(next);
  }

  private async doRequestPersist(): Promise<void> {
    if (!this.manager || !this.canPersistFlag) return;
    await this.refreshPromise;
    if (this.disposedFlag) return;
    this.emit({ requestingPersist: true });
    try {
      const granted = await this.manager.persist!();
      if (this.disposedFlag) return;
      if (granted) {
        this.emit({
          requestingPersist: false,
          persistence: 'persisted',
          persistOutcome: 'granted',
        });
      } else {
        this.emit({
          requestingPersist: false,
          persistence: 'not-persisted',
          persistOutcome: 'denied',
        });
      }
    } catch {
      if (!this.disposedFlag) this.emit({ requestingPersist: false, persistOutcome: 'failed' });
    }
  }

  private emit(patch: Partial<IStorageStatus>): void {
    if (this.disposedFlag) return;
    const next: IStorageStatus = { ...this.status$.value, ...patch };
    next.pressure = storagePressure(next.usage, next.quota);
    this.status$.next(next);
  }
}

/**
 * 浏览器实现：无 navigator.storage（隐私模式/老浏览器/非安全上下文）→ null，
 * 服务侧降级为 unsupported 不影响画布保存；方法按存在性组装（箭头闭包绑定
 * storage，防 this 丢失）。
 */
export function createBrowserStorageManager(): IStorageManager | null {
  if (typeof navigator === 'undefined') return null;
  try {
    const storage = navigator.storage;
    if (!storage) return null;
    const manager: IStorageManager = {};
    if (typeof storage.persisted === 'function') {
      manager.persisted = () => storage.persisted();
    }
    if (typeof storage.persist === 'function') {
      manager.persist = () => storage.persist();
    }
    if (typeof storage.estimate === 'function') {
      manager.estimate = () => storage.estimate();
    }
    return manager;
  } catch {
    return null;
  }
}
