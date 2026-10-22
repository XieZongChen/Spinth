import { describe, expect, it } from 'vitest';
import { createBrowserLockPort, type ILocksLike } from '../platform/tabSession/browserLockPort';

/**
 * Web Locks 端口单测（docs/21 §7）：locks 为注入参数（生产 = navigator.locks，
 * 此处 = 内存桩；注意 node 24 自带全局 navigator.locks，故 undefined 走默认
 * 参数的分支行为依赖宿主，不在单测断言）。核心语义：ifAvailable 被占时
 * callback 收 null 必须显式判空、锁占住到 release、release 幂等、request
 * 出错 reject 传播（不吞成 null）。
 */

/** 内存锁管理器：对齐浏览器语义——锁的持有期 = callback 返回 promise 的
 *  pending 期，settle（即 handle.release）后自动释放 */
class FakeLocks implements ILocksLike {
  private readonly held = new Set<string>();
  releaseCount = 0;
  failMode = false;

  request(
    name: string,
    opts: unknown,
    cb: (lock: unknown | null) => Promise<void> | void,
  ): Promise<unknown> {
    if (this.failMode) return Promise.reject(new Error('SecurityError'));
    const ifAvailable = (opts as { ifAvailable?: boolean } | undefined)?.ifAvailable === true;
    if (ifAvailable && this.held.has(name)) {
      // 对齐真实 Web Locks：被占时 ifAvailable 仍调用 callback，传 null
      return Promise.resolve(cb(null));
    }
    if (!ifAvailable && this.held.has(name)) {
      // wait 语义的简化：被占即挂起（排队授予路径由 tabSessionService.test 覆盖）
      return new Promise(() => {});
    }
    this.held.add(name);
    const result = cb({ name });
    return Promise.resolve(result).finally(() => {
      if (this.held.delete(name)) this.releaseCount += 1;
    });
  }
}

describe('createBrowserLockPort', () => {
  it('显式无 locks（null / 缺 request）→ 返回 null', () => {
    expect(createBrowserLockPort(null)).toBeNull();
    expect(createBrowserLockPort({} as ILocksLike)).toBeNull();
  });

  it('锁被占：ifAvailable 仍回调 callback（传 null）→ tryAcquire resolve null', async () => {
    const locks = new FakeLocks();
    const port = createBrowserLockPort(locks)!;
    const first = await port.tryAcquire('spinth-doc-write:d1');
    expect(first).not.toBeNull();
    // 坑位验证：被占时不得拿到第二个 handle（曾因不判 null 导致锁形同虚设）
    expect(await port.tryAcquire('spinth-doc-write:d1')).toBeNull();
  });

  it('持 handle 期间锁被占住（另一端口/标签视角不可获取）', async () => {
    const locks = new FakeLocks();
    const portA = createBrowserLockPort(locks)!;
    const portB = createBrowserLockPort(locks)!;
    const handle = await portA.tryAcquire('spinth-doc-write:d2');
    expect(handle).not.toBeNull();
    expect(await portB.tryAcquire('spinth-doc-write:d2')).toBeNull();
    handle!.release();
    await new Promise((r) => setTimeout(r, 0)); // 等释放的微任务链（finally）走完
    expect(await portB.tryAcquire('spinth-doc-write:d2')).not.toBeNull(); // 释放后可获取
  });

  it('release 幂等且只释放一次', async () => {
    const locks = new FakeLocks();
    const port = createBrowserLockPort(locks)!;
    const handle = (await port.tryAcquire('spinth-doc-write:d3'))!;
    handle.release();
    handle.release(); // 第二次必须是 no-op
    await new Promise((r) => setTimeout(r, 0));
    expect(locks.releaseCount).toBe(1);
  });

  it('request 出错 → tryAcquire / wait 均 reject（不吞成 null）', async () => {
    const locks = new FakeLocks();
    locks.failMode = true;
    const port = createBrowserLockPort(locks)!;
    await expect(port.tryAcquire('spinth-doc-write:d4')).rejects.toThrow('SecurityError');
    await expect(port.wait('spinth-doc-write:d4')).rejects.toThrow('SecurityError');
  });
});
