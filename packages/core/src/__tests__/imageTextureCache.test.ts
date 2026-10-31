import { describe, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import {
  ImageTextureCache,
  type IImageCodec,
  type IImageSourceHandle,
  type IImageSourcePort,
  type IImageTextureCacheOptions,
} from '../widgets/image/imageTextureCache';
import type { IImageKeepAliveTimers } from '../widgets/image/imageKeepAlive';

/** fake 纹理：uid 自增 + destroy spy（断言「归零才销毁且只一次」）。
 *  带宽高（100×100 → 估算 40000B）让字节预算路径可测（estimateTextureBytes 无 source 时回 texture.width） */
type FakeTexture = {
  uid: number;
  width: number;
  height: number;
  destroy: ReturnType<typeof vi.fn>;
};

function makeCodec(opts: { failDecode?: () => boolean; failCreate?: () => boolean } = {}): {
  codec: IImageCodec;
  decode: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  textures: FakeTexture[];
} {
  const textures: FakeTexture[] = [];
  const decode = vi.fn(async (): Promise<HTMLImageElement> => {
    if (opts.failDecode?.()) throw new Error('decode fail');
    return {} as HTMLImageElement;
  });
  const createTexture = vi.fn((): Texture => {
    if (opts.failCreate?.()) throw new Error('create fail');
    const t = { uid: textures.length + 1, width: 100, height: 100, destroy: vi.fn() };
    textures.push(t);
    return t as unknown as Texture;
  });
  return { codec: { decode, createTexture }, decode, createTexture, textures };
}

/** fake 源端口：非 asset 直返（release spy 记账）；'spinth-asset:gone' → null */
function makeSource(): {
  source: IImageSourcePort;
  open: ReturnType<typeof vi.fn<(src: string) => Promise<IImageSourceHandle | null>>>;
  releases: Array<ReturnType<typeof vi.fn>>;
} {
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  const open = vi.fn<(src: string) => Promise<IImageSourceHandle | null>>(async (src) => {
    if (src.includes('gone')) return null;
    const release = vi.fn();
    releases.push(release);
    return { url: `blob:${src}`, release };
  });
  return { source: { open }, open, releases };
}

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

/** 默认注入假计时器的组装器（默认 5s 保活窗口；用例可覆盖 cache 选项） */
function makeCache(
  cacheOptions: IImageTextureCacheOptions = {},
  codecOptions: { failDecode?: () => boolean; failCreate?: () => boolean } = {},
): {
  cache: ImageTextureCache;
  fake: ReturnType<typeof makeFakeTimers>;
  open: ReturnType<typeof vi.fn>;
  releases: Array<ReturnType<typeof vi.fn>>;
  decode: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  textures: FakeTexture[];
} {
  const made = makeSource();
  const codec = makeCodec(codecOptions);
  const fake = makeFakeTimers();
  const cache = new ImageTextureCache(made.source, codec.codec, {
    timers: fake.timers,
    ...cacheOptions,
  });
  return { cache, fake, open: made.open, releases: made.releases, ...codec };
}

/** pagehide 假 EventTarget（可数监听、手动 dispatch） */
class FakeLifecycle implements EventTarget {
  private readonly handlers = new Set<() => void>();
  addEventListener(_type: string, fn: () => void): void {
    this.handlers.add(fn);
  }
  removeEventListener(_type: string, fn: () => void): void {
    this.handlers.delete(fn);
  }
  /** EventTarget 接口要求（本测试不派发 Event 对象） */
  dispatchEvent(): boolean {
    return true;
  }
  dispatch(): void {
    for (const fn of [...this.handlers]) fn();
  }
  get size(): number {
    return this.handlers.size;
  }
}

const SRC = 'spinth-asset:' + 'a'.repeat(64);
const SRC_B = 'spinth-asset:' + 'b'.repeat(64);
const SRC_GONE = 'spinth-asset:' + 'gone'.padEnd(64, '0');

describe('ImageTextureCache（fake source + fake codec + 假计时器）', () => {
  it('同 assetId 两次 acquire：createTexture 只一次、同一纹理、refs=2；build 路径不登记空闲', async () => {
    const { cache, fake, createTexture, textures } = makeCache();
    const r1 = await cache.acquire(SRC);
    const r2 = await cache.acquire(SRC);
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(r1.lease.texture).toBe(r2.lease.texture);
    // C10：acquire 后、release 前 keepAlive.count === 0（build/pending 路径不产生空闲计时器）
    expect(cache.debug()).toEqual({
      entries: [{ key: 'a'.repeat(64), refs: 2, uid: 1, idle: false }],
      pending: 0,
      keepAlive: { count: 0, bytes: 0 },
    });
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    expect(fake.pendingCount()).toBe(0);
    cache.dispose();
  });

  it('C1/C3：归零进入保活（纹理与租约保留、idle=true）→ 窗口到期才 destroy 一次 + source 归还；重复 release 幂等', async () => {
    const { cache, fake, textures, releases } = makeCache();
    const r1 = await cache.acquire(SRC);
    const r2 = await cache.acquire(SRC);
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    r1.lease.release();
    expect(cache.debug().entries[0]!).toMatchObject({ refs: 1, idle: false });
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    r1.lease.release(); // 幂等：重复 release 只减一次
    r1.lease.release();
    expect(cache.debug().entries[0]!.refs).toBe(1);
    r2.lease.release(); // 归零 → 进入保活窗口（不立即销毁）
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    expect(releases[0]!).not.toHaveBeenCalled(); // URL 租约随条目保留（GC 持活闸门）
    expect(cache.debug()).toEqual({
      entries: [{ key: 'a'.repeat(64), refs: 0, uid: 1, idle: true }],
      pending: 0,
      keepAlive: { count: 1, bytes: 40_000 },
    });
    expect(fake.pendingCount()).toBe(1); // 空闲计时器在跑
    fake.tick(4_999);
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    fake.tick(1); // 窗口到期 → 销毁
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(textures[0]!.destroy).toHaveBeenCalledWith(true);
    expect(releases[0]!).toHaveBeenCalledTimes(1); // 同 key 只 open 一次
    expect(cache.debug().entries).toHaveLength(0);
    expect(fake.pendingCount()).toBe(0);
    cache.dispose();
  });

  it('C2：窗口内 re-acquire 复用同一纹理——decode/createTexture/open 计数不增、URL 计数仍 1', async () => {
    const { cache, fake, open, decode, createTexture, textures, releases } = makeCache();
    const r1 = await cache.acquire(SRC);
    if (r1.kind !== 'ok') throw new Error('expect ok');
    r1.lease.release(); // → idle
    fake.tick(3_000); // 窗口内
    const r2 = await cache.acquire(SRC); // wake 复用
    if (r2.kind !== 'ok') throw new Error('expect ok');
    expect(r2.lease.texture).toBe(r1.lease.texture);
    expect(open).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    expect(releases[0]!).not.toHaveBeenCalled();
    expect(cache.debug().entries[0]!).toMatchObject({ refs: 1, idle: false });
    expect(cache.debug().keepAlive.count).toBe(0);
    expect(fake.pendingCount()).toBe(0); // wake 已取消空闲计时器
    r2.lease.release();
    fake.tick(5_000);
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    cache.dispose();
  });

  it('并发 acquire（首个未完成）：共享同一 pending，createTexture 一次，两者都成功', async () => {
    const { cache, releases, open, createTexture } = makeCache();
    // 挂起首个 open：精确观测 pending 窗口
    let releaseOpen!: (h: IImageSourceHandle) => void;
    open.mockImplementationOnce(
      () =>
        new Promise((res) => {
          releaseOpen = (h): void => res(h);
        }),
    );
    const p1 = cache.acquire(SRC);
    const p2 = cache.acquire(SRC);
    expect(cache.debug().pending).toBe(1);
    expect(cache.debug().keepAlive.count).toBe(0); // build 在途不登记空闲
    const release = vi.fn();
    releases.push(release);
    releaseOpen({ url: 'blob:x', release });
    const [r1, r2] = await Promise.all([p1, p2]);
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(r1.lease.texture).toBe(r2.lease.texture);
    expect(cache.debug().entries[0]!.refs).toBe(2);
    cache.dispose();
  });

  it('open 返回 null：missing；codec 不调用；无条目残留', async () => {
    const { cache, decode, createTexture } = makeCache();
    const r = await cache.acquire(SRC_GONE);
    expect(r).toEqual({ kind: 'missing' });
    expect(decode).not.toHaveBeenCalled();
    expect(createTexture).not.toHaveBeenCalled();
    expect(cache.debug()).toEqual({ entries: [], pending: 0, keepAlive: { count: 0, bytes: 0 } });
    cache.dispose();
  });

  it('decode 失败：error+retryable=true；createTexture 失败：retryable=false；均归还 source、pending 清零、可再试', async () => {
    let fail = false;
    // fail=false → decode 失败（retryable=true）；fail=true → createTexture 失败（false）
    const { cache, releases } = makeCache(
      {},
      {
        failDecode: () => !fail,
        failCreate: () => fail,
      },
    );
    const r1 = await cache.acquire(SRC);
    expect(r1).toMatchObject({ kind: 'error', retryable: true });
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().pending).toBe(0);
    fail = true; // 换成 createTexture 失败
    const r2 = await cache.acquire(SRC); // 失败后可再次 acquire（pending 不留 rejected）
    expect(r2).toMatchObject({ kind: 'error', retryable: false });
    expect(releases[1]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().entries).toHaveLength(0);
    cache.dispose();
  });

  it('C6：data/http（无 key）释放即销毁、不进入保活池——两次 acquire 两次建纹，各自独立', async () => {
    const { cache, fake, createTexture, textures } = makeCache();
    const r1 = await cache.acquire('data:image/png;base64,xxx');
    const r2 = await cache.acquire('data:image/png;base64,xxx');
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(r1.lease.texture).not.toBe(r2.lease.texture);
    expect(cache.debug().entries).toHaveLength(0); // 不入缓存表
    r1.lease.release();
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1); // 立即销毁（无保活计时器）
    expect(cache.debug().keepAlive.count).toBe(0);
    expect(fake.pendingCount()).toBe(0);
    expect(textures[1]!.destroy).not.toHaveBeenCalled();
    r2.lease.release();
    expect(textures[1]!.destroy).toHaveBeenCalledTimes(1);
    cache.dispose();
  });

  it('dispose：全部条目销毁 + source 归还；之后 acquire 返回 error 不泄漏', async () => {
    const { cache, fake, textures, releases } = makeCache();
    const r = await cache.acquire(SRC);
    if (r.kind !== 'ok') throw new Error('expect ok');
    cache.dispose(); // refs=1 仍强制销毁（SDK 生命周期结束）
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().entries).toHaveLength(0);
    const after = await cache.acquire(SRC);
    expect(after).toMatchObject({ kind: 'error', retryable: false });
    expect(fake.pendingCount()).toBe(0);
  });

  it('debug()：pending 期间 pending=1，完成后归零', async () => {
    const { cache, open } = makeCache();
    let releaseOpen!: (h: IImageSourceHandle | null) => void;
    open.mockImplementationOnce(
      () =>
        new Promise((res) => {
          releaseOpen = res;
        }),
    );
    const p = cache.acquire(SRC);
    expect(cache.debug().pending).toBe(1);
    releaseOpen({ url: 'blob:x', release: () => {} });
    await p;
    expect(cache.debug().pending).toBe(0);
    cache.dispose();
  });

  it('dispose 竞态：key 在途 build 于 dispose 之后完成 → 返回 missing 不发租约', async () => {
    const { cache, open, textures } = makeCache();
    let releaseOpen!: (h: IImageSourceHandle) => void;
    open.mockImplementationOnce(
      () =>
        new Promise((res) => {
          releaseOpen = res;
        }),
    );
    const p = cache.acquire(SRC);
    cache.dispose(); // open 在途时 dispose 先到
    releaseOpen({ url: 'blob:x', release: vi.fn() });
    // dispose 的 then 兜底会销毁该 entry；acquire 续体不得再发租约
    await expect(p).resolves.toEqual({ kind: 'missing' });
    expect(textures[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it('dispose 回收无 key 条目：data 在租/在途的纹理都被销毁 + source 归还', async () => {
    const { cache, releases, decode, textures } = makeCache();
    // 在租：acquire 成功未 release
    const held = await cache.acquire('data:image/png;base64,xxx');
    expect(held.kind).toBe('ok');
    // 在途：第二个 data URL 的 decode 挂起（open 已归还 handle）
    let releaseDecode!: (img: HTMLImageElement) => void;
    decode.mockImplementationOnce(
      () =>
        new Promise((res) => {
          releaseDecode = res;
        }),
    );
    const inflight = cache.acquire('data:image/png;base64,yyy');
    await new Promise((r) => setTimeout(r, 0)); // 让 acquire 走到 decode 挂起点
    expect(typeof releaseDecode).toBe('function');
    cache.dispose();
    releaseDecode({} as HTMLImageElement); // 建纹于 dispose 之后 → 不得逃逸销毁链
    await expect(inflight).resolves.toEqual({ kind: 'missing' });
    expect(textures[0]?.destroy).toHaveBeenCalledTimes(1); // 在租条目被无条件回收
    expect(textures[1]?.destroy).toHaveBeenCalledTimes(1); // 建纹后即时销毁
    expect(releases.length).toBeGreaterThanOrEqual(2);
    for (const r of releases) expect(r).toHaveBeenCalledTimes(1);
  });

  it('C4：空闲时 dispose——取消计时、销毁恰一次，之后再推进时间无二次销毁', async () => {
    const { cache, fake, textures, releases } = makeCache();
    const r = await cache.acquire(SRC);
    if (r.kind !== 'ok') throw new Error('expect ok');
    r.lease.release(); // → idle（计时器在跑）
    expect(fake.pendingCount()).toBe(1);
    cache.dispose();
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(fake.pendingCount()).toBe(0);
    fake.tick(60_000); // 计时器已取消——无回调、无二次销毁
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(releases[0]!).toHaveBeenCalledTimes(1);
  });

  it('C5：pagehide 清空闲条目、在租保留；dispose 摘除监听（假 EventTarget 可数）', async () => {
    const lifecycle = new FakeLifecycle();
    const { cache, fake, textures, releases } = makeCache({ lifecycle });
    const a = await cache.acquire(SRC);
    const b = await cache.acquire(SRC_B);
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expect ok');
    a.lease.release(); // a → idle
    expect(fake.pendingCount()).toBe(1);
    lifecycle.dispatch(); // pagehide
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1); // 空闲条目销毁
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(textures[1]!.destroy).not.toHaveBeenCalled(); // 在租条目保留（sprite 仍引用）
    expect(cache.debug().entries).toHaveLength(1);
    expect(fake.pendingCount()).toBe(0);
    cache.dispose();
    expect(lifecycle.size).toBe(0); // 监听已摘除（StrictMode 双挂载防泄漏）
    lifecycle.dispatch(); // 摘除后 dispatch 无副作用
    expect(textures[1]!.destroy).toHaveBeenCalledTimes(1); // 仅 dispose 销毁这一次
  });

  it('C7：预算集成（小 maxBytes）——第二条空闲触发第一条逐出，纹理/source 各释放一次', async () => {
    const { cache, fake, textures, releases } = makeCache({ keepAlive: { maxBytes: 40_000 } });
    const a = await cache.acquire(SRC);
    const b = await cache.acquire(SRC_B);
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expect ok');
    a.lease.release(); // 40000B ≤ 上限 → 入池
    expect(cache.debug().keepAlive).toEqual({ count: 1, bytes: 40_000 });
    b.lease.release(); // 40000 + 40000 > 40000 → 逐出最久空闲的 a
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().keepAlive).toEqual({ count: 1, bytes: 40_000 }); // b 仍空闲
    expect(fake.pendingCount()).toBe(1); // 只剩 b 的计时器
    fake.tick(5_000);
    expect(textures[1]!.destroy).toHaveBeenCalledTimes(1); // b 到期销毁
    expect(releases[1]!).toHaveBeenCalledTimes(1);
    expect(fake.pendingCount()).toBe(0);
    cache.dispose();
  });

  it('C8：windowMs=0 关闭保活——release 即销毁（旧语义降级开关）', async () => {
    const { cache, fake, textures, releases } = makeCache({ keepAlive: { windowMs: 0 } });
    const r = await cache.acquire(SRC);
    if (r.kind !== 'ok') throw new Error('expect ok');
    r.lease.release();
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1); // 立即销毁
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().entries).toHaveLength(0);
    expect(cache.debug().keepAlive.count).toBe(0);
    expect(fake.pendingCount()).toBe(0); // 未登记任何计时器
    cache.dispose();
  });

  it('预算钳制：windowMs NaN/负值回退默认 5s 窗口（不立即销毁、不关闭）', async () => {
    // 失效模式区分：windowMs 直传 NaN 时 setTimeout(fn, NaN) 视为 0 立即到期
    // （窗口形同虚设）；maxEntries/maxBytes 直传 NaN 才是逐出比较恒假、永不逐出。
    // 两种非法输入都由 clampBudget 的同一 pick 分支回退默认。
    const nan = makeCache({ keepAlive: { windowMs: Number.NaN } });
    const r1 = await nan.cache.acquire(SRC);
    if (r1.kind !== 'ok') throw new Error('expect ok');
    r1.lease.release();
    expect(nan.textures[0]!.destroy).not.toHaveBeenCalled(); // NaN 未被当作 <=0 关闭保活
    nan.fake.tick(4_999);
    expect(nan.textures[0]!.destroy).not.toHaveBeenCalled(); // 默认窗口仍在跑（直传则已立即到期销毁）
    nan.fake.tick(1);
    expect(nan.textures[0]!.destroy).toHaveBeenCalledTimes(1); // 5s 到期——钳制回退默认生效
    expect(nan.fake.pendingCount()).toBe(0);
    nan.cache.dispose();

    const neg = makeCache({ keepAlive: { windowMs: -1 } });
    const r2 = await neg.cache.acquire(SRC);
    if (r2.kind !== 'ok') throw new Error('expect ok');
    r2.lease.release();
    expect(neg.textures[0]!.destroy).not.toHaveBeenCalled(); // 负数回退默认 5s（未被当作关闭开关）
    neg.fake.tick(4_999);
    expect(neg.textures[0]!.destroy).not.toHaveBeenCalled();
    neg.fake.tick(1);
    expect(neg.textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(neg.fake.pendingCount()).toBe(0);
    neg.cache.dispose();
  });

  it('预算钳制：maxBytes NaN 回退默认 32MiB——超大纹理单条不保活', async () => {
    const { cache, textures } = makeCache({ keepAlive: { maxBytes: Number.NaN } });
    const r = await cache.acquire(SRC);
    if (r.kind !== 'ok') throw new Error('expect ok');
    // 3000×3000=36MB 估算刻意越过回退后的默认 32MiB——NaN 直传时比较恒假
    // （永不逐出）与本用例的「立即销毁」可区分，断言才有区分度
    (textures[0] as unknown as { source: { width: number; height: number } }).source = {
      width: 3_000,
      height: 3_000,
    };
    r.lease.release();
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1); // 回退默认上限生效：单条超限不保活
    expect(cache.debug().keepAlive).toEqual({ count: 0, bytes: 0 });
    cache.dispose();
  });

  it('预算钳制：maxEntries 负值回退默认 8——两条空闲共存不误逐', async () => {
    const { cache, fake, textures } = makeCache({ keepAlive: { maxEntries: -1 } });
    const a = await cache.acquire(SRC);
    const b = await cache.acquire(SRC_B);
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expect ok');
    a.lease.release();
    b.lease.release(); // 若 -1 直传会令 size > -1 恒真、插入即逐出
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    expect(textures[1]!.destroy).not.toHaveBeenCalled();
    expect(cache.debug().keepAlive.count).toBe(2);
    expect(fake.pendingCount()).toBe(2);
    fake.tick(5_000);
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(textures[1]!.destroy).toHaveBeenCalledTimes(1);
    cache.dispose();
  });

  it('显存估算：texture.source 宽高优先于 texture.width（PIXI v8 source 是尺寸真相源）', async () => {
    const { cache, textures } = makeCache();
    const r = await cache.acquire(SRC);
    if (r.kind !== 'ok') throw new Error('expect ok');
    // fake 纹理与条目 texture 是同一对象引用：补 source 尺寸模拟真实 Texture
    // （50×60=12000B 应优先于 width/height=100 的 40000B 估算）
    (textures[0] as unknown as { source: { width: number; height: number } }).source = {
      width: 50,
      height: 60,
    };
    r.lease.release();
    expect(cache.debug().keepAlive).toEqual({ count: 1, bytes: 50 * 60 * 4 });
    cache.dispose();
  });

  it('C9：undo 复用——窗口内恢复不重新 decode；窗口到期后再 acquire 才第二次 decode', async () => {
    const { cache, fake, decode, createTexture, textures } = makeCache();
    const r1 = await cache.acquire(SRC);
    if (r1.kind !== 'ok') throw new Error('expect ok');
    r1.lease.release(); // 删除 → idle（= undo 前的 5s 窗口）
    const r2 = await cache.acquire(SRC); // 窗口内恢复（= undo）
    if (r2.kind !== 'ok') throw new Error('expect ok');
    expect(decode).toHaveBeenCalledTimes(1); // 未重新解码
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(r2.lease.texture).toBe(r1.lease.texture); // 同一份 GPU 纹理
    r2.lease.release(); // 再删 → 窗口重新起算
    fake.tick(5_000); // 窗口外才 undo
    const r3 = await cache.acquire(SRC);
    if (r3.kind !== 'ok') throw new Error('expect ok');
    expect(decode).toHaveBeenCalledTimes(2); // 重新解码（允许，非错误）
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(r3.lease.texture).not.toBe(textures[0]); // 新纹理
    r3.lease.release();
    fake.tick(5_000);
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(textures[1]!.destroy).toHaveBeenCalledTimes(1);
    expect(fake.pendingCount()).toBe(0);
    cache.dispose();
  });
});
