import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSwController,
  DISMISS_STORAGE_KEY,
  SW_RELOAD_FALLBACK_MS,
  SW_UPDATE_RETRY_MS,
  SW_UPDATE_THROTTLE_MS,
  type ISwInstallingWorker,
  type ISwRegistration,
  type IServiceWorkerDeps,
  type SwWorkerState,
} from '../serviceWorker';

/**
 * SW 控制器桩测（specs/pwa §11.1）：端口注入零浏览器依赖，
 * 覆盖 waiting 首帧 / updatefound / 首装不提示 / 单次守卫 / 3s 兜底 / 吞错。
 */

function fakeInstallingWorker(): ISwInstallingWorker & { setState(s: SwWorkerState): void } {
  const listeners: Array<() => void> = [];
  const worker = {
    state: 'installing' as SwWorkerState,
    addEventListener: (_type: 'statechange', listener: () => void) => {
      listeners.push(listener);
    },
    setState(next: SwWorkerState) {
      worker.state = next;
      for (const listener of listeners) listener();
    },
  };
  return worker;
}

interface IHarness {
  deps: IServiceWorkerDeps;
  posted: unknown[];
  reloads: number[];
  storage: Map<string, string>;
  setWaiting(on: boolean): void;
  setHasController(on: boolean): void;
  setUpdateFails(on: boolean): void;
  advanceNow(ms: number): void;
  emitUpdatefound(): void;
  installing: ReturnType<typeof fakeInstallingWorker>;
  fireControllerChange(): void;
  updateCalls: () => number;
}

function harness(waitingAtStart = false): IHarness {
  const posted: unknown[] = [];
  const reloads: number[] = [];
  const storage = new Map<string, string>();
  const installing = fakeInstallingWorker();
  let waiting: { postMessage(message: unknown): void } | null = waitingAtStart
    ? { postMessage: (m: unknown) => posted.push(m) }
    : null;
  let hasController = false;
  let fakeNow = 1_000_000;
  let updatefoundListener: (() => void) | undefined;
  let controllerChangeListener: (() => void) | undefined;
  let updateCallCount = 0;
  let updateFails = false;

  const registration: ISwRegistration = {
    get waiting() {
      return waiting;
    },
    get installing() {
      return installing;
    },
    update: async () => {
      updateCallCount += 1;
      if (updateFails) throw new Error('offline');
    },
    addEventListener: (type: 'updatefound', listener: () => void) => {
      if (type === 'updatefound') updatefoundListener = listener;
    },
  };

  const deps: IServiceWorkerDeps = {
    register: async () => registration,
    getController: () => (hasController ? ({} as object) : null),
    addControllerChangeListener: (listener: () => void) => {
      controllerChangeListener = listener;
    },
    reload: () => {
      reloads.push(1);
    },
    now: () => fakeNow,
    storage: {
      get: (key: string) => storage.get(key) ?? null,
      set: (key: string, value: string) => storage.set(key, value),
    },
  };

  return {
    deps,
    posted,
    reloads,
    storage,
    installing,
    updateCalls: () => updateCallCount,
    setWaiting(on: boolean) {
      waiting = on ? { postMessage: (m: unknown) => posted.push(m) } : null;
    },
    setHasController(on: boolean) {
      hasController = on;
    },
    setUpdateFails(on: boolean) {
      updateFails = on;
    },
    advanceNow(ms: number) {
      fakeNow += ms;
    },
    emitUpdatefound() {
      updatefoundListener?.();
    },
    fireControllerChange() {
      controllerChangeListener?.();
    },
  };
}

/** flush register().then 链（微任务 + 一拍宏任务） */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createSwController 更新状态机', () => {
  it('返回访客：注册即有 waiting → 首帧 available（§6.4）', async () => {
    const h = harness(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    expect(c.getState().available).toBe(true);
  });

  it('updatefound → installed 且已受控 → available', async () => {
    const h = harness();
    h.setHasController(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    expect(c.getState().available).toBe(false);
    h.emitUpdatefound();
    h.installing.setState('installed');
    expect(c.getState().available).toBe(true);
  });

  it('首装（installed 但无 controller）不提示——只有更新才算「可用」', async () => {
    const h = harness();
    const c = createSwController(h.deps);
    c.init();
    await flush();
    h.emitUpdatefound();
    h.installing.setState('installed');
    expect(c.getState().available).toBe(false);
  });

  it('不点击 apply 就不 reload（不自动接管，D9）', async () => {
    const h = harness(true);
    h.setHasController(true); // 受控页面（claim 已完成，D11 语境）
    const c = createSwController(h.deps);
    c.init();
    await flush();
    h.fireControllerChange(); // 他页激活
    expect(h.reloads).toHaveLength(0);
    expect(c.getState().ready).toBe(true); // 只转「已就绪」状态
  });

  it('首装 claim 的 controllerchange 静默——不弹横幅（D11）', async () => {
    const h = harness();
    const c = createSwController(h.deps);
    c.init();
    await flush();
    h.fireControllerChange(); // claim()：页面从无控→受控
    expect(c.getState().available).toBe(false);
    expect(c.getState().ready).toBe(false);
    h.fireControllerChange(); // 之后他页激活新版本：才转「已就绪」
    expect(c.getState().ready).toBe(true);
  });

  it('apply 只发一次 SKIP_WAITING（重复点击幂等）', async () => {
    const h = harness(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    c.apply();
    c.apply();
    c.apply();
    expect(h.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(c.getState().applying).toBe(true);
  });

  it('controllerchange 重入只 reload 一次（单次守卫，D11）', async () => {
    const h = harness(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    c.apply();
    h.fireControllerChange();
    h.fireControllerChange();
    h.fireControllerChange();
    expect(h.reloads).toHaveLength(1);
  });

  it('点击后 3s 无 controllerchange → 兜底 reload，且仍只一次', async () => {
    vi.useFakeTimers();
    const h = harness(true);
    const c = createSwController(h.deps);
    c.init();
    await vi.advanceTimersByTimeAsync(0);
    c.apply();
    await vi.advanceTimersByTimeAsync(SW_RELOAD_FALLBACK_MS);
    expect(h.reloads).toHaveLength(1);
    h.fireControllerChange(); // 兜底后再来 controllerchange 不再刷
    expect(h.reloads).toHaveLength(1);
  });

  it('register 抛错：吞掉不外抛、warn 一次、状态不可用', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let controllerListener: (() => void) | undefined;
    const deps: IServiceWorkerDeps = {
      register: async () => {
        throw new Error('CSP blocked');
      },
      getController: () => null,
      addControllerChangeListener: (l) => {
        controllerListener = l;
      },
      reload: () => {
        throw new Error('不应 reload');
      },
      now: () => 0,
      storage: { get: () => null, set: () => {} },
    };
    const c = createSwController(deps);
    expect(() => c.init()).not.toThrow();
    await flush();
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(c.getState().available).toBe(false);
    // controllerchange 监听 inert：未受控页（首装语境）静默、绝不 reload
    controllerListener?.();
    expect(c.getState().ready).toBe(false);
    expect(c.getState().available).toBe(false);
  });

  it('dismiss：写 sessionStorage 标志 + 本会话不再可见', async () => {
    const h = harness(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    expect(c.getState().available && !c.getState().dismissed).toBe(true);
    c.dismiss();
    expect(h.storage.get(DISMISS_STORAGE_KEY)).toBe('1');
    expect(c.getState().dismissed).toBe(true);
    expect(c.getState().available).toBe(true); // waiting 仍在，只是本会话不提示
  });

  it('他页激活后 apply（无 waiting）→ 直接 reload（ready 语义）', async () => {
    const h = harness(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    h.fireControllerChange(); // 他页激活：waiting 仍挂旧引用？——真实场景 waiting 变 null
    h.setWaiting(false);
    c.apply();
    expect(h.posted).toHaveLength(0);
    expect(h.reloads).toHaveLength(1);
  });

  it('checkForUpdate 节流 ≥ 60min；窗口外静默、窗口内各一次', async () => {
    const h = harness();
    const c = createSwController(h.deps);
    c.init();
    await flush();
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(1);
    c.checkForUpdate();
    h.advanceNow(SW_UPDATE_THROTTLE_MS - 1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(1); // 60min 内不再查
    h.advanceNow(1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(2);
  });

  it('update 失败后 5min 即重试；成功后回到 60min 节流（§17.4 P2-6）', async () => {
    const h = harness();
    h.setUpdateFails(true);
    const c = createSwController(h.deps);
    c.init();
    await flush();
    c.checkForUpdate(); // 失败一次
    await flush(); // update() 的 catch 置 lastUpdateFailed（微任务）
    expect(h.updateCalls()).toBe(1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(1); // 节流窗内
    h.advanceNow(SW_UPDATE_RETRY_MS - 1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(1); // 5min 未到
    h.advanceNow(1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(2); // 失败窗口到点即重试
    await flush(); // 排空该次失败的 catch，避免与下一次成功链交叠翻转标志
    h.setUpdateFails(false);
    h.advanceNow(SW_UPDATE_RETRY_MS + 1);
    c.checkForUpdate(); // 这次成功
    await flush(); // then 清 lastUpdateFailed
    expect(h.updateCalls()).toBe(3);
    h.advanceNow(SW_UPDATE_THROTTLE_MS - 1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(3); // 成功后回到 60min 档
    h.advanceNow(1);
    c.checkForUpdate();
    expect(h.updateCalls()).toBe(4);
  });

  it('状态镜像通知 subscribe（useSyncExternalStore 数据源）', async () => {
    const h = harness(true);
    const c = createSwController(h.deps);
    const seen: boolean[] = [];
    c.subscribe(() => seen.push(c.getState().available));
    c.init();
    await flush();
    expect(seen).toContain(true);
  });
});
