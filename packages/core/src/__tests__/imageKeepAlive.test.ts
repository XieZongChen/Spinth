import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE_KEEP_ALIVE,
  type IImageKeepAliveBudget,
  type IImageKeepAliveTimers,
  ImageKeepAlivePool,
} from '../widgets/image/imageKeepAlive';

/** 假计时器：手动 tick 推进、可数 pending（断言「无泄漏的待触发计时器」） */
function makeFakeTimers(): {
  timers: IImageKeepAliveTimers;
  tick(ms: number): void;
  pendingCount(): number;
} {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { id: number; at: number; fn: () => void }>();
  const timers: IImageKeepAliveTimers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { id, at: now + ms, fn });
      return (): void => {
        pending.delete(id);
      };
    },
  };
  const tick = (ms: number): void => {
    now += ms;
    // 到期按注册序触发；回调内可能再取消其他计时器（wake/forget），复制后遍历防抖动
    const due = [...pending.values()]
      .filter((s) => s.at <= now)
      .sort((a, b) => a.at - b.at || a.id - b.id);
    for (const s of due) {
      pending.delete(s.id);
      s.fn();
    }
  };
  return { timers, tick, pendingCount: (): number => pending.size };
}

function makePool(
  over: Partial<IImageKeepAliveBudget>,
  bytesOf: (tag: string) => number = () => 1,
): {
  pool: ImageKeepAlivePool<{ tag: string }>;
  evict: ReturnType<typeof vi.fn>;
  fake: ReturnType<typeof makeFakeTimers>;
} {
  const budget: IImageKeepAliveBudget = { ...DEFAULT_IMAGE_KEEP_ALIVE, ...over };
  const evict = vi.fn();
  const fake = makeFakeTimers();
  const pool = new ImageKeepAlivePool<{ tag: string }>(budget, fake.timers, evict, (item) =>
    bytesOf(item.tag),
  );
  return { pool, evict, fake };
}

describe('ImageKeepAlivePool（假计时器）', () => {
  it('P1 窗口到期：到期前 0 次逐出，到期恰好 1 次，stats 归零', () => {
    const { pool, evict, fake } = makePool({});
    pool.hold({ tag: 'a' });
    expect(evict).not.toHaveBeenCalled();
    fake.tick(DEFAULT_IMAGE_KEEP_ALIVE.windowMs - 1);
    expect(evict).not.toHaveBeenCalled();
    expect(pool.stats.count).toBe(1);
    fake.tick(1);
    expect(evict).toHaveBeenCalledTimes(1);
    expect(pool.stats).toEqual({ count: 0, bytes: 0 });
    expect(fake.pendingCount()).toBe(0);
  });

  it('P2 窗口内 wake：取消计时，推进整窗不再回调', () => {
    const { pool, evict, fake } = makePool({});
    const a = { tag: 'a' };
    pool.hold(a);
    fake.tick(1_000);
    expect(pool.wake(a)).toBe(true);
    fake.tick(60_000);
    expect(evict).not.toHaveBeenCalled();
    expect(fake.pendingCount()).toBe(0);
  });

  it('P3 wake 后重新 hold：窗口从最后一次归零重新起算', () => {
    const { pool, evict, fake } = makePool({});
    const a = { tag: 'a' };
    pool.hold(a);
    fake.tick(4_000);
    pool.wake(a);
    pool.hold(a);
    fake.tick(4_000); // 距重新 hold 仅 4s——仍存活（旧窗口已作废）
    expect(pool.has(a)).toBe(true);
    fake.tick(1_000); // 满 5s → 到期
    expect(evict).toHaveBeenCalledTimes(1);
  });

  it('P4 条目上限 LRU：超限逐出最久空闲者，顺序稳定', () => {
    const { pool, evict, fake } = makePool({ maxEntries: 2 });
    const a = { tag: 'a' };
    const b = { tag: 'b' };
    const c = { tag: 'c' };
    pool.hold(a);
    pool.hold(b);
    expect(evict).not.toHaveBeenCalled();
    pool.hold(c); // size 3 > 2 → 逐出最久空闲的 a
    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith(a);
    expect(pool.stats.count).toBe(2);
    expect(fake.pendingCount()).toBe(2); // a 的计时器已被取消
  });

  it('P5 字节上限 LRU：加入后超预算从最久者逐出直到回到上限内', () => {
    const { pool, evict } = makePool({ maxBytes: 100 }, (tag) => (tag === 'big' ? 80 : 60));
    const a = { tag: 'a' };
    const b = { tag: 'b' };
    pool.hold(a); // 60 ≤ 100
    pool.hold(b); // 60 + 60 = 120 > 100 → 逐出 a
    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith(a);
    expect(pool.stats).toEqual({ count: 1, bytes: 60 });
  });

  it('P6 单条超预算：立即 onEvict，不进入 stats', () => {
    const { pool, evict, fake } = makePool({ maxBytes: 100 }, () => 200);
    pool.hold({ tag: 'huge' });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(pool.stats).toEqual({ count: 0, bytes: 0 });
    expect(fake.pendingCount()).toBe(0); // 未登记计时器
  });

  it('P7 windowMs=0：立即 onEvict（降级开关语义）', () => {
    const { pool, evict } = makePool({ windowMs: 0 });
    pool.hold({ tag: 'a' });
    expect(evict).toHaveBeenCalledTimes(1);
    expect(pool.stats.count).toBe(0);
  });

  it('P8 dropAll/forget：全量逐出、计时器不再触发、forget 幂等', () => {
    const { pool, evict, fake } = makePool({});
    const a = { tag: 'a' };
    const b = { tag: 'b' };
    const c = { tag: 'c' };
    pool.hold(a);
    pool.hold(b);
    pool.forget(b); // 先摘走 b（取消其计时）
    expect(pool.has(b)).toBe(false);
    pool.forget(b); // 幂等：重复 forget 无副作用
    pool.hold(c);
    pool.dropAll();
    expect(evict).toHaveBeenCalledTimes(2); // a、c（b 已不在池中）
    expect(evict).toHaveBeenCalledWith(a);
    expect(evict).toHaveBeenCalledWith(c);
    expect(pool.stats).toEqual({ count: 0, bytes: 0 });
    expect(fake.pendingCount()).toBe(0);
    fake.tick(60_000); // 取消后的计时器不再触发
    expect(evict).toHaveBeenCalledTimes(2);
  });

  it('wake 不在池中的条目返回 false（live 条目直接 acquire 的常态）', () => {
    const { pool } = makePool({});
    expect(pool.wake({ tag: 'never' })).toBe(false);
  });
});
