import { describe, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import {
  ImageTextureCache,
  type IImageCodec,
  type IImageSourceHandle,
  type IImageSourcePort,
} from '../widgets/image/imageTextureCache';

/** fake 纹理：uid 自增 + destroy spy（断言「归零才销毁且只一次」） */
type FakeTexture = { uid: number; destroy: ReturnType<typeof vi.fn> };

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
    const t = { uid: textures.length + 1, destroy: vi.fn() };
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

const SRC = 'spinth-asset:' + 'a'.repeat(64);
const SRC_GONE = 'spinth-asset:' + 'gone'.padEnd(64, '0');

describe('ImageTextureCache（fake source + fake codec）', () => {
  it('同 assetId 两次 acquire：createTexture 只一次、同一纹理、refs=2', async () => {
    const { source } = makeSource();
    const { codec, createTexture, textures } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
    const r1 = await cache.acquire(SRC);
    const r2 = await cache.acquire(SRC);
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(r1.lease.texture).toBe(r2.lease.texture);
    expect(cache.debug()).toEqual({
      entries: [{ key: 'a'.repeat(64), refs: 2, uid: 1 }],
      pending: 0,
    });
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
  });

  it('release 一个：refs=1 纹理存活；release 第二个：destroy(true) 一次 + source 归还一次；重复 release 幂等', async () => {
    const { source, releases } = makeSource();
    const { codec, textures } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
    const r1 = await cache.acquire(SRC);
    const r2 = await cache.acquire(SRC);
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    r1.lease.release();
    expect(cache.debug().entries[0]!).toEqual({ key: 'a'.repeat(64), refs: 1, uid: 1 });
    expect(textures[0]!.destroy).not.toHaveBeenCalled();
    r1.lease.release(); // 幂等：重复 release 只减一次
    r1.lease.release();
    expect(cache.debug().entries[0]!.refs).toBe(1);
    r2.lease.release(); // 归零 → 销毁
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(textures[0]!.destroy).toHaveBeenCalledWith(true);
    expect(releases[0]!).toHaveBeenCalledTimes(1); // 同 key 只 open 一次
    expect(cache.debug().entries).toHaveLength(0);
  });

  it('并发 acquire（首个未完成）：共享同一 pending，createTexture 一次，两者都成功', async () => {
    const { source, open, releases } = makeSource();
    const { codec, createTexture } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
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
    const release = vi.fn();
    releases.push(release);
    releaseOpen({ url: 'blob:x', release });
    const [r1, r2] = await Promise.all([p1, p2]);
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(r1.lease.texture).toBe(r2.lease.texture);
    expect(cache.debug().entries[0]!.refs).toBe(2);
  });

  it('open 返回 null：missing；codec 不调用；无条目残留', async () => {
    const { source } = makeSource();
    const { codec, decode, createTexture } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
    const r = await cache.acquire(SRC_GONE);
    expect(r).toEqual({ kind: 'missing' });
    expect(decode).not.toHaveBeenCalled();
    expect(createTexture).not.toHaveBeenCalled();
    expect(cache.debug()).toEqual({ entries: [], pending: 0 });
  });

  it('decode 失败：error+retryable=true；createTexture 失败：retryable=false；均归还 source、pending 清零、可再试', async () => {
    let fail = false;
    const { source, releases } = makeSource();
    // fail=false → decode 失败（retryable=true）；fail=true → createTexture 失败（false）
    const { codec } = makeCodec({ failDecode: () => !fail, failCreate: () => fail });
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
    const r1 = await cache.acquire(SRC);
    expect(r1).toMatchObject({ kind: 'error', retryable: true });
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().pending).toBe(0);
    fail = true; // 换成 createTexture 失败
    const r2 = await cache.acquire(SRC); // 失败后可再次 acquire（pending 不留 rejected）
    expect(r2).toMatchObject({ kind: 'error', retryable: false });
    expect(releases[1]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().entries).toHaveLength(0);
  });

  it('data/http（无 key）：不共享——两次 acquire 两次建纹，各自 release 独立销毁', async () => {
    const { source } = makeSource();
    const { codec, createTexture, textures } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
    const r1 = await cache.acquire('data:image/png;base64,xxx');
    const r2 = await cache.acquire('data:image/png;base64,xxx');
    if (r1.kind !== 'ok' || r2.kind !== 'ok') throw new Error('expect ok');
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(r1.lease.texture).not.toBe(r2.lease.texture);
    expect(cache.debug().entries).toHaveLength(0); // 不入缓存表
    r1.lease.release();
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(textures[1]!.destroy).not.toHaveBeenCalled();
    r2.lease.release();
    expect(textures[1]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('dispose：全部条目销毁 + source 归还；之后 acquire 返回 error 不泄漏', async () => {
    const { source, releases } = makeSource();
    const { codec, textures } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
    const r = await cache.acquire(SRC);
    if (r.kind !== 'ok') throw new Error('expect ok');
    cache.dispose(); // refs=1 仍强制销毁（SDK 生命周期结束）
    expect(textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(releases[0]!).toHaveBeenCalledTimes(1);
    expect(cache.debug().entries).toHaveLength(0);
    const after = await cache.acquire(SRC);
    expect(after).toMatchObject({ kind: 'error', retryable: false });
  });

  it('debug()：pending 期间 pending=1，完成后归零', async () => {
    const { source, open } = makeSource();
    const { codec } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
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
  });

  it('dispose 竞态：key 在途 build 于 dispose 之后完成 → 返回 missing 不发租约', async () => {
    const { source, open } = makeSource();
    const { codec, textures } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
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
    const { source, releases } = makeSource();
    const { codec, decode, textures } = makeCodec();
    const cache = new ImageTextureCache(source, codec, { keepAlive: { windowMs: 0 } });
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
});
