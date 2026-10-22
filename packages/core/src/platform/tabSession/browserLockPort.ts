import type { ITabLockHandle, ITabLockPort } from '../../types/tabSession';

/** 浏览器 Web Locks 端口（docs/21 §2）。不可用（老浏览器/受限环境）返回 null，
 *  由调用方降级 solo——与资产 GC 的降级口径一致（docs/19 §5）。
 *  locks 为注入参数：生产走 navigator.locks（不传），单测传内存桩。 */

/** Web Locks 管理器的最小形状（navigator.locks 的窄化） */
export interface ILocksLike {
  request(
    name: string,
    opts: unknown,
    cb: (lock: unknown | null) => Promise<void> | void,
  ): Promise<unknown>;
}

/** 用未决 Promise 占住锁：callback 返回的 promise resolve 前，浏览器不释放锁；
 *  handle.release() 即 resolve 该 promise。 */
function holdLock(): { promise: Promise<void>; done: () => void } {
  let done: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { promise, done };
}

function makeHandle(done: () => void): ITabLockHandle {
  let released = false;
  return {
    release(): void {
      if (released) return; // 幂等
      released = true;
      done();
    },
  };
}

export function createBrowserLockPort(locks?: ILocksLike | null): ITabLockPort | null {
  // undefined = 未提供 → 探测 navigator.locks；显式 null = 明确禁用（返回 null）
  const mgr =
    locks !== undefined
      ? locks
      : typeof navigator === 'undefined'
        ? undefined
        : ((navigator as unknown as { locks?: ILocksLike }).locks ?? undefined);
  if (!mgr || typeof mgr.request !== 'function') return null;

  return {
    // request 失败（SecurityError 等）必须 reject 传播——消费方（TabSessionService）
    // 靠它区分「被占」（resolve null）与「出错」（reject）；吞成 null 会把出错
    // 误判成「有别的写者」
    tryAcquire(name: string): Promise<ITabLockHandle | null> {
      return new Promise((resolve, reject) => {
        void mgr
          .request(name, { ifAvailable: true, mode: 'exclusive' }, (lock) => {
            // 坑：锁被占用时 ifAvailable 仍会调用 callback（传 null）——必须显式
            // 判空，否则锁形同虚设（与 assetGc.withAssetGcLock 同一个坑）
            if (!lock) {
              resolve(null);
              return;
            }
            const { promise, done } = holdLock();
            resolve(makeHandle(done));
            return promise;
          })
          .catch((err: unknown) => reject(err));
      });
    },

    wait(name: string): Promise<ITabLockHandle> {
      return new Promise((resolve, reject) => {
        void mgr
          .request(name, { mode: 'exclusive' }, (_lock) => {
            const { promise, done } = holdLock();
            resolve(makeHandle(done));
            return promise;
          })
          .catch((err: unknown) => reject(err));
      });
    },
  };
}
