import type { ITabLockHandle, ITabLockPort } from '../../types/tabSession';

/** 浏览器 Web Locks 端口（docs/21 §2）。不可用（老浏览器/受限环境）返回 null，
 *  由调用方降级 solo——与资产 GC 的降级口径一致（docs/19 §5）。 */

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

export function createBrowserLockPort(): ITabLockPort | null {
  const locks = (
    navigator as unknown as {
      locks?: {
        request(
          name: string,
          opts: unknown,
          cb: (lock: unknown | null) => Promise<void> | void,
        ): Promise<unknown>;
      };
    }
  ).locks;
  if (!locks || typeof locks.request !== 'function') return null;

  return {
    tryAcquire(name: string): Promise<ITabLockHandle | null> {
      return new Promise((resolve) => {
        void locks
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
          .catch(() => resolve(null));
      });
    },

    wait(name: string): Promise<ITabLockHandle> {
      return new Promise((resolve, reject) => {
        void locks
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
