import { describe, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import {
  ImageLoadController,
  textureUidOf,
  type IImageLoadHost,
  type IImageTextureLease,
  type IImageTexturePort,
  type IImageTimerPort,
  type ImageTextureResult,
} from '../widgets/image/imageLoadController';

/** fake 租约：release 是 spy（幂等语义归缓存层测试；此处断言配对次数） */
type FakeLease = { texture: Texture; release: ReturnType<typeof vi.fn> };

function fakeLease(uid: number): FakeLease {
  return { texture: { uid } as unknown as Texture, release: vi.fn() };
}

function ok(lease: FakeLease): ImageTextureResult {
  return { kind: 'ok', lease: lease as unknown as IImageTextureLease };
}

function decodeError(retryable: boolean): ImageTextureResult {
  return { kind: 'error', error: new Error('boom'), retryable };
}

/** 可脚本化端口：mockImplementationOnce 挂 deferred，测试手动 resolve 定序 */
function makePort(): {
  port: IImageTexturePort;
  acquire: ReturnType<typeof vi.fn<(src: string) => Promise<ImageTextureResult>>>;
} {
  const acquire = vi.fn<(src: string) => Promise<ImageTextureResult>>();
  return { port: { acquire: (src) => acquire(src) }, acquire };
}

/** 假计时器端口：记录回调与延迟；fire 触发并移除（真实 timer 只触发一次） */
function fakeTimers(): {
  port: IImageTimerPort;
  slots: Array<{ fn: () => void; ms: number }>;
  fire(): void;
} {
  const slots: Array<{ fn: () => void; ms: number }> = [];
  const port: IImageTimerPort = {
    set: (fn, ms): (() => void) => {
      const slot = { fn, ms };
      slots.push(slot);
      return (): void => {
        const i = slots.indexOf(slot);
        if (i >= 0) slots.splice(i, 1);
      };
    },
  };
  return { port, slots, fire: (): void => void slots.shift()?.fn() };
}

interface HostEvent {
  kind: 'loading' | 'loaded' | 'failed' | 'empty';
  src?: string;
  failKind?: string;
  uid?: number;
}

function fakeHost(): { host: IImageLoadHost; events: HostEvent[] } {
  const events: HostEvent[] = [];
  return {
    events,
    host: {
      onLoading: (src): void => void events.push({ kind: 'loading', src }),
      onLoaded: (src, texture): void =>
        void events.push({ kind: 'loaded', src, uid: textureUidOf(texture) }),
      onFailed: (src, failKind): void => void events.push({ kind: 'failed', src, failKind }),
      onEmpty: (): void => void events.push({ kind: 'empty' }),
    },
  };
}

/** 微任务+宏任务边界 flush（真实 timer 只用于 flush，不用于被测计时） */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const SRC_A = 'spinth-asset:' + 'a'.repeat(64);
const SRC_B = 'spinth-asset:' + 'b'.repeat(64);
const URL_HTTP = 'https://a.test/x.png';

function setup() {
  const { port, acquire } = makePort();
  const { host, events } = fakeHost();
  const timers = fakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const controller = new ImageLoadController(port, host, timers.port);
  return { acquire, events, timers, controller, warn, info };
}

describe('ImageLoadController（fake port + fake timer）', () => {
  it('setSrc 成功：loading → loaded，onLoaded 收到 texture，租约保持', async () => {
    const { acquire, events, controller } = setup();
    acquire.mockResolvedValueOnce(ok(fakeLease(1)));
    controller.setSrc(SRC_A);
    expect(controller.debug.state).toBe('loading');
    await flush();
    expect(controller.debug.state).toBe('loaded');
    expect(controller.debug.textureUid).toBe(1);
    expect(events).toEqual([
      { kind: 'loading', src: SRC_A },
      { kind: 'loaded', src: SRC_A, uid: 1 },
    ]);
  });

  it('A 成功后切 B：loading 期间 A 租约不释放；B 提交后 A 恰好释放一次', async () => {
    const { acquire, controller } = setup();
    const leaseA = fakeLease(1);
    const leaseB = fakeLease(2);
    acquire.mockImplementationOnce(async () => ok(leaseA));
    controller.setSrc(SRC_A);
    await flush();
    acquire.mockImplementationOnce(async () => ok(leaseB));
    controller.setSrc(SRC_B);
    expect(controller.debug.state).toBe('loading');
    await flush();
    expect(leaseA.release).toHaveBeenCalledTimes(1); // B 提交后才释放 A
    expect(leaseB.release).not.toHaveBeenCalled();
    expect(controller.debug.textureUid).toBe(2);
  });

  it('迟到成功（竞态核心）：A 在途切 B，B 先完成 A 后完成——只释放 A 自己的租约', async () => {
    const { acquire, events, controller } = setup();
    const leaseA = fakeLease(1);
    const leaseB = fakeLease(2);
    let dA!: (v: ImageTextureResult) => void;
    let dB!: (v: ImageTextureResult) => void;
    acquire
      .mockImplementationOnce(
        () =>
          new Promise<ImageTextureResult>((res) => {
            dA = res;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ImageTextureResult>((res) => {
            dB = res;
          }),
      );
    controller.setSrc(SRC_A); // A 开始加载（在途）
    controller.setSrc(SRC_B); // 切走——A 的 token 失效
    dB(ok(leaseB)); // B 先完成
    await flush();
    expect(controller.debug.state).toBe('loaded');
    dA(ok(leaseA)); // A 迟到完成
    await flush();
    expect(leaseA.release).toHaveBeenCalledTimes(1); // 只归还自己拿到的
    expect(leaseB.release).not.toHaveBeenCalled(); // 绝不触碰当前租约
    expect(events.filter((e) => e.kind === 'loaded')).toHaveLength(1); // 不覆盖 B
    expect(controller.debug.textureUid).toBe(2);
  });

  it('迟到失败：A 迟到 error 不把 B 标 failed、不释放 B、不触发 onFailed', async () => {
    const { acquire, events, controller } = setup();
    const leaseB = fakeLease(2);
    let dA!: (v: ImageTextureResult) => void;
    acquire
      .mockImplementationOnce(
        () =>
          new Promise<ImageTextureResult>((res) => {
            dA = res;
          }),
      )
      .mockResolvedValueOnce(ok(leaseB));
    controller.setSrc(SRC_A);
    controller.setSrc(SRC_B);
    await flush(); // B 完成
    dA(decodeError(true)); // A 迟到失败——被 token 校验吞掉
    await flush();
    expect(controller.debug.state).toBe('loaded');
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(0);
    expect(leaseB.release).not.toHaveBeenCalled();
  });

  it('missing：状态 missing、onFailed("missing")、无自动重试、终态 info（非 warn）', async () => {
    const { acquire, events, timers, controller, warn, info } = setup();
    acquire.mockResolvedValueOnce({ kind: 'missing' });
    controller.setSrc(SRC_A);
    await flush();
    expect(controller.debug.state).toBe('missing');
    expect(events).toContainEqual({ kind: 'failed', src: SRC_A, failKind: 'missing' });
    expect(timers.slots).toHaveLength(0);
    expect(info).toHaveBeenCalledTimes(1); // 降级 info：缺资产可能他端稍后写入
    expect(warn).not.toHaveBeenCalled();
  });

  it('http 解码失败：按 600/1800 排两次自动重试，第三次失败终态（attempts=2）', async () => {
    const { acquire, timers, controller, warn } = setup();
    acquire.mockImplementation(async () => decodeError(true));
    controller.setSrc(URL_HTTP);
    await flush();
    expect(timers.slots.map((s) => s.ms)).toEqual([600]);
    timers.fire();
    await flush();
    expect(timers.slots.map((s) => s.ms)).toEqual([1800]);
    timers.fire();
    await flush();
    expect(timers.slots).toHaveLength(0); // 上限 2 次
    expect(controller.debug.attempts).toBe(2);
    expect(controller.debug.acquires).toBe(3); // 初次 + 两次自动重试
    expect(controller.debug.state).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1); // 只在终态打一次
  });

  it('data URL 解码失败：不排自动重试（内容本地确定）', async () => {
    const { acquire, timers, controller } = setup();
    acquire.mockResolvedValueOnce(decodeError(true));
    controller.setSrc('data:image/png;base64,xxx');
    await flush();
    expect(controller.debug.state).toBe('failed');
    expect(timers.slots).toHaveLength(0);
  });

  it('retryable=false（建纹/IDB 故障）：http 也不自动重试', async () => {
    const { acquire, timers, controller } = setup();
    acquire.mockResolvedValueOnce(decodeError(false));
    controller.setSrc(URL_HTTP);
    await flush();
    expect(controller.debug.state).toBe('failed');
    expect(timers.slots).toHaveLength(0);
  });

  it('重试排定后 setSrc 切走：计时器取消、回调不再发起 acquire', async () => {
    const { acquire, timers, controller } = setup();
    acquire.mockResolvedValueOnce(decodeError(true)).mockResolvedValueOnce({ kind: 'missing' });
    controller.setSrc(URL_HTTP);
    await flush();
    expect(timers.slots).toHaveLength(1);
    controller.setSrc('https://a.test/other.png'); // 切走即取消（新 src 各自计数）
    expect(timers.slots).toHaveLength(0);
    expect(acquire).toHaveBeenCalledTimes(2); // 失败 1 次 + 新 src 1 次；无重试第三次
  });

  it('retry() 手动：attempts 归零重新 acquire；missing → 成功后清终态', async () => {
    const { acquire, events, controller } = setup();
    acquire.mockResolvedValueOnce({ kind: 'missing' });
    controller.setSrc(SRC_A);
    await flush();
    expect(controller.debug.state).toBe('missing');
    const lease = fakeLease(7);
    acquire.mockResolvedValueOnce(ok(lease));
    expect(controller.debug.acquires).toBe(1); // 双击前：初次加载一次
    controller.retry();
    expect(controller.debug.state).toBe('loading');
    expect(controller.debug.attempts).toBe(0);
    await flush();
    expect(controller.debug.state).toBe('loaded');
    expect(controller.debug.acquires).toBe(2); // 双击重试真实发起了 acquire
    expect(events.at(-1)).toEqual({ kind: 'loaded', src: SRC_A, uid: 7 });
  });

  it('loaded/idle 态 retry() 是 no-op（不重复发起）', async () => {
    const { acquire, controller } = setup();
    acquire.mockResolvedValueOnce(ok(fakeLease(1)));
    controller.setSrc(SRC_A);
    await flush();
    controller.retry();
    await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('dispose：释放当前租约、取消计时器；之后 setSrc/retry 全 no-op', async () => {
    const { acquire, timers, controller } = setup();
    // 场景 1：failed + 计时器 pending 时 dispose
    acquire.mockImplementation(async () => decodeError(true));
    controller.setSrc(URL_HTTP);
    await flush();
    expect(timers.slots).toHaveLength(1);
    controller.dispose();
    expect(timers.slots).toHaveLength(0);
    expect(controller.debug.state).toBe('idle');
    // 场景 2：dispose 后任何入口不再发起
    controller.setSrc(SRC_B);
    controller.retry();
    await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('setSrc("")：onEmpty、释放当前租约、回 idle', async () => {
    const { acquire, events, controller } = setup();
    const lease = fakeLease(1);
    acquire.mockResolvedValueOnce(ok(lease));
    controller.setSrc(SRC_A);
    await flush();
    controller.setSrc('');
    expect(events.at(-1)).toEqual({ kind: 'empty' });
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(controller.debug.state).toBe('idle');
    expect(controller.debug.src).toBe('');
  });
});
