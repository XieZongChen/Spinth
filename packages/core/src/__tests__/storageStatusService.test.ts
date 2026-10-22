import { describe, expect, it } from 'vitest';
import { StorageStatusService } from '../platform/storage/storageStatusService';
import type { IStorageStatus } from '../types/storage';

/** 微任务排空（真实计时器，对齐 dbProvider.test 的 flush 手法） */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 订阅即收集（BehaviorSubject 首个元素是当前值） */
function collect(svc: StorageStatusService): IStorageStatus[] {
  const out: IStorageStatus[] = [];
  svc.status$.subscribe((v) => out.push(v));
  return out;
}

describe('StorageStatusService（docs/02 §6.1）', () => {
  it('unsupported：manager=null → supported=false、persistence=unsupported，refresh 无副作用', async () => {
    const svc = new StorageStatusService(null);
    expect(svc.status$.value).toMatchObject({
      supported: false,
      canPersist: false,
      persistence: 'unsupported',
    });
    const emissions = collect(svc);
    await svc.refresh();
    expect(emissions).toHaveLength(1); // 仅订阅时的初始值，无新发射
  });

  it('persisted 查询：true/false → persisted/not-persisted', async () => {
    const cases = [
      [true, 'persisted'],
      [false, 'not-persisted'],
    ] as const;
    for (const [ret, want] of cases) {
      const svc = new StorageStatusService({ persisted: async () => ret });
      await svc.refresh();
      expect(svc.status$.value.persistence).toBe(want);
      expect(svc.status$.value.persistedQueryFailed).toBe(false);
    }
  });

  it('estimate：成功更新 usage/quota/pressure；缺方法与 throw 保留上次值并置标志', async () => {
    const ok = new StorageStatusService({ estimate: async () => ({ usage: 80, quota: 100 }) });
    await ok.refresh();
    expect(ok.status$.value).toMatchObject({
      usage: 80,
      quota: 100,
      pressure: 'warn',
      estimateFailed: false,
    });

    // 缺方法（老浏览器）：usage/quota 保持 null
    const missing = new StorageStatusService({ persisted: async () => false });
    await missing.refresh();
    expect(missing.status$.value.estimateFailed).toBe(true);
    expect(missing.status$.value.usage).toBeNull();

    // 第二次 throw：保留第一次的值
    let calls = 0;
    const flaky = new StorageStatusService({
      estimate: async () => {
        calls += 1;
        if (calls === 1) return { usage: 10, quota: 100 };
        throw new Error('boom');
      },
    });
    await flaky.refresh();
    await flaky.refresh();
    expect(flaky.status$.value.estimateFailed).toBe(true);
    expect(flaky.status$.value.usage).toBe(10);
    expect(flaky.status$.value.quota).toBe(100);
  });

  it('persisted 查询 throw → persistedQueryFailed=true，保留上次 persistence', async () => {
    let calls = 0;
    const svc = new StorageStatusService({
      persisted: async () => {
        calls += 1;
        if (calls === 1) return true;
        throw new Error('boom');
      },
    });
    await svc.refresh();
    expect(svc.status$.value.persistence).toBe('persisted');
    await svc.refresh();
    expect(svc.status$.value.persistedQueryFailed).toBe(true);
    expect(svc.status$.value.persistence).toBe('persisted'); // 保留上次值
  });

  it('requestPersist：granted/denied/failed 三态（A5）', async () => {
    const granted = new StorageStatusService({ persist: async () => true });
    await granted.requestPersist();
    expect(granted.status$.value).toMatchObject({
      persistence: 'persisted',
      persistOutcome: 'granted',
      requestingPersist: false,
    });

    const denied = new StorageStatusService({ persist: async () => false });
    await denied.requestPersist();
    expect(denied.status$.value).toMatchObject({
      persistence: 'not-persisted',
      persistOutcome: 'denied',
    });

    const failed = new StorageStatusService({
      persist: () => Promise.reject(new Error('x')),
    });
    await failed.requestPersist();
    expect(failed.status$.value).toMatchObject({
      persistOutcome: 'failed',
      requestingPersist: false,
    });
  });

  it('requestPersist：无 persist 方法（canPersist=false）不申请不发射', async () => {
    const svc = new StorageStatusService({ persisted: async () => false });
    const emissions = collect(svc);
    await svc.requestPersist();
    expect(emissions).toHaveLength(1); // 仅初始值，未申请未发射
    expect(svc.status$.value.persistOutcome).toBeNull();
  });

  it('requestPersist 中间态：persist 未决期间 requestingPersist=true 可见', async () => {
    const gate = deferred<boolean>();
    const svc = new StorageStatusService({ persist: () => gate.promise });
    const p = svc.requestPersist();
    await flush();
    expect(svc.status$.value.requestingPersist).toBe(true);
    gate.resolve(true);
    await p;
    expect(svc.status$.value.requestingPersist).toBe(false);
    expect(svc.status$.value.persistOutcome).toBe('granted');
  });

  it('refresh 并发合并：重叠调用共享一次查询（A12）', async () => {
    const gate = deferred<boolean>();
    let calls = 0;
    const svc = new StorageStatusService({
      persisted: () => {
        calls += 1;
        return gate.promise;
      },
    });
    const p1 = svc.refresh();
    const p2 = svc.refresh();
    gate.resolve(true);
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(svc.status$.value.persistence).toBe('persisted');
  });

  it('dispose：流 complete；请求中状态收口为 false；此后不再发射（A12/复审 #3）', async () => {
    const gate = deferred<boolean>();
    const svc = new StorageStatusService({
      persist: () => gate.promise,
      persisted: async () => true,
    });
    const emissions = collect(svc);
    const p = svc.requestPersist();
    await flush(); // requestingPersist=true 已发射
    const before = emissions.length;
    svc.dispose();
    // complete 前补一帧 requestingPersist=false——消费者不停在中间态
    expect(emissions.length).toBe(before + 1);
    expect(emissions[emissions.length - 1]!.requestingPersist).toBe(false);
    gate.resolve(true);
    await p;
    await svc.refresh();
    expect(emissions.length).toBe(before + 1); // in-flight 完成与后续 refresh 均无新帧
    expect(svc.status$.value.requestingPersist).toBe(false);
  });

  it('initialize：已持久化不申请；未持久化申请一次（D4/A3）', async () => {
    let persistCalls = 0;
    const persistedSvc = new StorageStatusService({
      persisted: async () => true,
      persist: () => {
        persistCalls += 1;
        return Promise.resolve(true);
      },
    });
    await persistedSvc.initialize();
    expect(persistCalls).toBe(0);
    expect(persistedSvc.status$.value.persistence).toBe('persisted');

    let calls2 = 0;
    const notPersistedSvc = new StorageStatusService({
      persisted: async () => false,
      persist: () => {
        calls2 += 1;
        return Promise.resolve(false);
      },
    });
    await notPersistedSvc.initialize();
    expect(calls2).toBe(1);
    expect(notPersistedSvc.status$.value.persistOutcome).toBe('denied');
  });
});
