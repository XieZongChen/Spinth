import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMOTION_DELAY_MS,
  PROMOTION_FALLBACK_MS,
  RETRY_AFTER_FALLBACK_MS,
  TAB_LOCK_PREFIX,
  TabSessionService,
} from '../platform/tabSession/tabSessionService';
import type { ITabLockHandle, ITabLockPort } from '../types/tabSession';

/** 内存 ITabLockPort 桩（docs/21 §7）：held 集合 + FIFO 排队授予（对齐 Web Locks
 *  行为——持锁者 release 时队首 wait 者立即获得锁） */
class MemoryLockPort implements ITabLockPort {
  private readonly held = new Map<string, ITabLockHandle>();
  private readonly waiters = new Map<string, Array<(h: ITabLockHandle) => void>>();
  tryAcquireCalls = 0;

  tryAcquire(name: string): Promise<ITabLockHandle | null> {
    this.tryAcquireCalls += 1;
    return Promise.resolve(this.held.has(name) ? null : this.acquire(name));
  }

  wait(name: string): Promise<ITabLockHandle> {
    if (!this.held.has(name)) return Promise.resolve(this.acquire(name));
    return new Promise((resolve) => {
      const queue = this.waiters.get(name) ?? [];
      queue.push(resolve);
      this.waiters.set(name, queue);
    });
  }

  private acquire(name: string): ITabLockHandle {
    let released = false;
    const handle: ITabLockHandle = {
      release: (): void => {
        if (released) return;
        released = true;
        this.held.delete(name);
        const next = this.waiters.get(name)?.shift();
        if (next) next(this.acquire(name));
      },
    };
    this.held.set(name, handle);
    return handle;
  }
}

function makeService(
  port: ITabLockPort | null,
  overrides?: { promotionDelayMs?: number; onPromoted?: () => void },
): TabSessionService {
  return new TabSessionService({
    docId: 'test-doc',
    locks: port,
    onPromoted: overrides?.onPromoted ?? vi.fn(),
    promotionDelayMs: overrides?.promotionDelayMs,
  });
}

describe('TabSessionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('锁空闲 → leader、writable true', async () => {
    const port = new MemoryLockPort();
    const s = makeService(port);
    await s.start();
    expect(s.state$.value).toEqual({ role: 'leader', writable: true });
    // 锁名按文档前缀 + docId
    expect(port.tryAcquireCalls).toBe(1);
  });

  it('锁被占 → follower、writable false，并排队等待', async () => {
    const port = new MemoryLockPort();
    const holder = await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'); // 模拟其他标签
    expect(holder).not.toBeNull();
    const s = makeService(port);
    await s.start();
    expect(s.state$.value).toEqual({ role: 'follower', writable: false });
  });

  it('follower 等到授予 → 延时后 onPromoted 恰好一次', async () => {
    const port = new MemoryLockPort();
    const holder = (await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'))!;
    const onPromoted = vi.fn();
    const s = makeService(port, { onPromoted });
    await s.start();
    expect(s.state$.value.role).toBe('follower');
    holder.release(); // 写者离开 → 授予排队者
    await vi.advanceTimersByTimeAsync(PROMOTION_DELAY_MS - 1);
    expect(onPromoted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onPromoted).toHaveBeenCalledTimes(1);
    // 授予后仍持锁（onPromoted 假装导航失败不影响持锁——回退定时器兜底）
    expect(await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc')).toBeNull();
  });

  it('promotionDelayMs 之前 dispose() → 不回调', async () => {
    const port = new MemoryLockPort();
    const holder = (await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'))!;
    const onPromoted = vi.fn();
    const s = makeService(port, { onPromoted });
    await s.start();
    holder.release();
    await vi.advanceTimersByTimeAsync(PROMOTION_DELAY_MS - 1);
    s.dispose();
    await vi.advanceTimersByTimeAsync(PROMOTION_FALLBACK_MS * 2);
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it('release() 后 handle 被释放，且不 emit', async () => {
    const port = new MemoryLockPort();
    const s = makeService(port);
    await s.start();
    const states: string[] = [];
    s.state$.subscribe((st) => states.push(st.role));
    const before = states.length;
    s.release(); // pagehide：让锁、不发状态
    expect(states.length).toBe(before);
    expect(await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc')).not.toBeNull(); // 锁已空闲
  });

  it('locks === null → solo', async () => {
    const s = makeService(null);
    await s.start();
    expect(s.state$.value).toEqual({ role: 'solo', writable: true });
  });

  it('tryAcquire 抛错 → solo + warn（不阻塞画布）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: ITabLockPort = {
      tryAcquire: () => Promise.reject(new Error('SecurityError')),
      wait: () => Promise.reject(new Error('SecurityError')),
    };
    const s = makeService(bad);
    await s.start();
    expect(s.state$.value).toEqual({ role: 'solo', writable: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('tryAcquire=null（确有写者）且 wait 失败 → 保持 follower，不降级 solo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const busyThenFail: ITabLockPort = {
      tryAcquire: () => Promise.resolve(null),
      wait: () => Promise.reject(new Error('SecurityError')),
    };
    const s = makeService(busyThenFail);
    await s.start();
    expect(s.state$.value).toEqual({ role: 'follower', writable: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('wait 失败后 30s 退避自愈：重排成功授予并可接管', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // wait 第一次 reject（SecurityError 类瞬时失败），第二次走真排队授予
    let waitCalls = 0;
    const real = new MemoryLockPort();
    const flaky: ITabLockPort = {
      tryAcquire: (name: string) => real.tryAcquire(name),
      wait: (name: string) => {
        waitCalls += 1;
        if (waitCalls === 1) return Promise.reject(new Error('boom'));
        return real.wait(name);
      },
    };
    const holder = (await real.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'))!;
    const onPromoted = vi.fn();
    const s = makeService(flaky, { onPromoted });
    await s.start();
    expect(s.state$.value).toEqual({ role: 'follower', writable: false }); // wait 失败保持只读
    holder.release(); // 写者离开
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_FALLBACK_MS - 1);
    expect(waitCalls).toBe(1); // 退避窗口内不重排
    await vi.advanceTimersByTimeAsync(1); // 30s 到：重排 → 锁空闲立即授予
    expect(waitCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(PROMOTION_DELAY_MS);
    expect(onPromoted).toHaveBeenCalledTimes(1); // 接管尝试发生
    s.dispose();
  });

  it('start() 幂等：调用两次只申请一次', async () => {
    const port = new MemoryLockPort();
    const s = makeService(port);
    await s.start();
    await s.start();
    expect(port.tryAcquireCalls).toBe(1);
    expect(s.state$.value.role).toBe('leader');
  });

  it('dispose 后授予 → handle 立即释放、不回调', async () => {
    const port = new MemoryLockPort();
    const holder = (await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'))!;
    const onPromoted = vi.fn();
    const s = makeService(port, { onPromoted });
    await s.start(); // follower 排队中
    s.dispose();
    holder.release(); // 排队授予到达——应被丢弃并立即放锁
    await vi.advanceTimersByTimeAsync(PROMOTION_DELAY_MS + PROMOTION_FALLBACK_MS);
    expect(onPromoted).not.toHaveBeenCalled();
    expect(await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc')).not.toBeNull(); // 锁空闲
  });

  it('PROMOTION_FALLBACK_MS 后仍存活 → 释放锁并回 follower', async () => {
    const port = new MemoryLockPort();
    const holder = (await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'))!;
    const s = makeService(port); // onPromoted 不导航（模拟宿主接线失效）
    await s.start();
    holder.release();
    await vi.advanceTimersByTimeAsync(PROMOTION_DELAY_MS); // onPromoted 已调但页面仍存活
    await vi.advanceTimersByTimeAsync(PROMOTION_FALLBACK_MS - 1);
    expect(s.state$.value.role).toBe('follower'); // 尚未回退（仍是默认 follower 态）
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state$.value).toEqual({ role: 'follower', writable: false });
    expect(await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc')).not.toBeNull(); // 锁已释放
  });

  it('dispose() 后 state$ completed', async () => {
    const s = makeService(new MemoryLockPort());
    await s.start();
    let completed = false;
    s.state$.subscribe({ complete: () => (completed = true) });
    s.dispose();
    expect(completed).toBe(true);
  });

  it('fallback 后 30s 自愈重排：重新授予并再次尝试接管', async () => {
    const port = new MemoryLockPort();
    const holder = (await port.tryAcquire(TAB_LOCK_PREFIX + 'test-doc'))!;
    const onPromoted = vi.fn();
    const s = makeService(port, { onPromoted });
    await s.start();
    holder.release();
    // 第一轮：授予 → onPromoted（不导航）→ fallback 释放回 follower
    await vi.advanceTimersByTimeAsync(PROMOTION_DELAY_MS + PROMOTION_FALLBACK_MS);
    expect(onPromoted).toHaveBeenCalledTimes(1);
    expect(s.state$.value).toEqual({ role: 'follower', writable: false });
    // 30s 后自愈重排：锁空闲 → 立即授予 → 延时后第二次接管尝试
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_FALLBACK_MS - 1);
    expect(onPromoted).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + PROMOTION_DELAY_MS);
    expect(onPromoted).toHaveBeenCalledTimes(2);
    s.dispose();
  });
});
