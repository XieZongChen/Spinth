/**
 * 页面侧 SW 控制器（specs/pwa.md §6.4/D12）：注册、更新检测、刷新守卫。
 * 全部浏览器能力经端口注入——单测用桩即可覆盖状态机，不依赖真实 SW。
 *
 * 更新语义（D9/D11）：waiting → 横幅 → 用户点击 → SKIP_WAITING →
 * controllerchange → 仅点击方 reload（单次守卫）；其他标签只转「已就绪」状态。
 */
import { publicAsset, SITE_BASE } from '../siteBase';

export type SwWorkerState = 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';

export interface ISwInstallingWorker {
  state: SwWorkerState;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface ISwRegistration {
  readonly waiting: { postMessage(message: unknown): void } | null;
  readonly installing: ISwInstallingWorker | null;
  update(): Promise<void>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/** 「稍后」= 本会话不再提示（D-Q2）；waiting 不清、下次打开仍提示 */
export const DISMISS_STORAGE_KEY = 'spinth.pwa.update-dismissed';

/** visibilitychange 触发 update() 的节流下限（§6.4） */
export const SW_UPDATE_THROTTLE_MS = 60 * 60 * 1000;
/** update() 失败后的重试间隔（§17.4 P2-6）：离线/抖动恰是最该重试的时候，
 * 不与成功节流同档——否则一次失败要空等整整一小时 */
export const SW_UPDATE_RETRY_MS = 5 * 60 * 1000;
/** 点击后无 controllerchange 的兜底 reload（§6.4：避免用户点了没反应） */
export const SW_RELOAD_FALLBACK_MS = 3000;

export interface IServiceWorkerDeps {
  register(url: string, opts: { scope: string; updateViaCache: 'none' }): Promise<ISwRegistration>;
  getController(): unknown | null;
  addControllerChangeListener(listener: () => void): void;
  reload(): void;
  now(): number;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
}

export interface ISwState {
  available: boolean;
  applying: boolean;
  /** 他页已激活新版本：横幅转「已就绪」，apply 直接 reload（D11） */
  ready: boolean;
  dismissed: boolean;
}

export interface ISwController {
  getState(): ISwState;
  subscribe(listener: () => void): () => void;
  init(): void;
  apply(): void;
  dismiss(): void;
  /** visibilitychange（转可见）调用；成功后节流 ≥ SW_UPDATE_THROTTLE_MS，
   * 上次失败 SW_UPDATE_RETRY_MS 后即重试 */
  checkForUpdate(): void;
}

const INITIAL_STATE: ISwState = {
  available: false,
  applying: false,
  ready: false,
  dismissed: false,
};

export function createSwController(deps: IServiceWorkerDeps): ISwController {
  let state: ISwState = { ...INITIAL_STATE, dismissed: readDismissed(deps) };
  const listeners = new Set<() => void>();
  let registration: ISwRegistration | null = null;
  let warned = false;
  let pendingReload = false;
  let reloaded = false;
  let lastUpdateAt = Number.NEGATIVE_INFINITY;
  let lastUpdateFailed = false;

  function readDismissed(d: IServiceWorkerDeps): boolean {
    try {
      return d.storage.get(DISMISS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function set(patch: Partial<ISwState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function doReload(): void {
    if (reloaded) return; // controllerchange 重入 / 3s 兜底同受单次守卫（D11）
    reloaded = true;
    deps.reload();
  }

  function markAvailable(): void {
    if (!state.available) set({ available: true });
  }

  function onWaitingNow(): void {
    if (registration?.waiting) markAvailable();
  }

  function onInstallProgress(worker: ISwInstallingWorker): void {
    worker.addEventListener('statechange', () => {
      // installed + 已受控（有 controller）= 新版本在 waiting（§6.4）；
      // 首装无 controller，不算「更新可用」
      if (worker.state === 'installed' && deps.getController()) markAvailable();
    });
  }

  const controller: ISwController = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    init() {
      // 首装 claim() 也会触发 controllerchange（页面从无控→受控）——
      // 必须与「他页激活新版本」区分（D11），否则每次首装都误弹横幅
      let hadController = deps.getController() !== null;
      deps.addControllerChangeListener(() => {
        if (pendingReload) doReload();
        else if (!hadController)
          hadController = true; // 首装接管：静默
        else if (!reloaded) set({ available: true, ready: true }); // 他页激活：不自动刷新
      });
      deps
        .register(publicAsset('sw.js'), { scope: SITE_BASE, updateViaCache: 'none' })
        .then((reg) => {
          registration = reg;
          // 返回访客：上次会话已下载的新版本在 waiting → 直接提示
          onWaitingNow();
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            if (worker) onInstallProgress(worker);
            onWaitingNow();
          });
        })
        .catch((err: unknown) => {
          // CSP / 隐私模式 / 无 SW：吞掉，应用照常在线运行（§6.4）
          if (!warned) {
            warned = true;
            console.warn('[spinth-pwa] Service Worker 注册失败（降级为在线使用）', err);
          }
        });
    },

    apply() {
      if (!state.available || state.applying || reloaded) return;
      const waiting = registration?.waiting;
      if (!waiting) {
        // 他页已激活（ready）：无 waiting 可唤，直接刷新即新版本
        doReload();
        return;
      }
      pendingReload = true;
      set({ applying: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => doReload(), SW_RELOAD_FALLBACK_MS);
    },

    dismiss() {
      try {
        deps.storage.set(DISMISS_STORAGE_KEY, '1');
      } catch {
        // 隐私模式极端配置：本会话内存态仍生效
      }
      set({ dismissed: true });
    },

    checkForUpdate() {
      if (!registration) return;
      // 成功后 60min 节流；上次失败 5min 即重试（横幅只在 waiting 时出现，失败静默）
      const gap = lastUpdateFailed ? SW_UPDATE_RETRY_MS : SW_UPDATE_THROTTLE_MS;
      const now = deps.now();
      if (now - lastUpdateAt < gap) return;
      lastUpdateAt = now;
      void registration
        .update()
        .then(() => {
          lastUpdateFailed = false;
        })
        .catch(() => {
          lastUpdateFailed = true;
        });
    },
  };

  return controller;
}

// —— 浏览器接线（宿主适配层；单测全部走 createSwController 桩端口）——

function browserDeps(): IServiceWorkerDeps {
  return {
    // ServiceWorkerRegistration 的 installing.state 是更宽的 ServiceWorkerState——
    // 运行时语义一致，桩接口收窄只为可测（结构差异经 unknown 断言）
    register: (url, opts) =>
      navigator.serviceWorker.register(url, opts) as unknown as Promise<ISwRegistration>,
    getController: () => navigator.serviceWorker.controller,
    addControllerChangeListener: (listener) =>
      navigator.serviceWorker.addEventListener('controllerchange', listener),
    reload: () => window.location.reload(),
    now: () => Date.now(),
    storage: {
      get: (key) => {
        try {
          return sessionStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          sessionStorage.setItem(key, value);
        } catch {
          /* 上层已兜内存态 */
        }
      },
    },
  };
}

let singleton: ISwController | null = null;

/** 页面侧控制器单例（注册只发生一次；未 init 时永不可用——dev 不注册） */
export function getPwaController(): ISwController {
  singleton ??= createSwController(browserDeps());
  return singleton;
}

/** app 壳启动注册（main.tsx，仅 PROD——dev 不注册 SW，specs/pwa D2/D6） */
export function registerAppServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  getPwaController().init();
}
