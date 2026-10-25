/// <reference lib="webworker" />
/**
 * spinth Service Worker 入口（specs/pwa.md §6.3）——只做装配；
 * 路由分类在 cachePolicy（纯函数，单测覆盖），清单由构建期实算注入。
 *
 * base 从自身脚本位置推导（§6.1）：注入的 base 与部署实际不一致时会静默
 * 缓存错 URL，脚本位置是唯一可信事实（dist/sw.js → '/spinth/'）。
 */
import { classifyRequest, navigationKey } from './cachePolicy';
import type { IPrecacheManifest } from '../precacheManifest';

declare const __SPINTH_PRECACHE__: IPrecacheManifest;
// lib 的 self 是通用 WorkerGlobalScope；SW 全局（clients/skipWaiting）需精确类型
declare const self: ServiceWorkerGlobalScope;

const MANIFEST = __SPINTH_PRECACHE__;
const BASE = new URL('./', self.location.href).href;
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname;
const SHELL_CACHE = `spinth-shell-${MANIFEST.version}`;
const RUNTIME_CACHE = 'spinth-runtime-v1';
/** 导航回退键：归一化（去 query、保证尾斜杠），?doc= 多文档共享一份 shell（D6）。 */
const NAV_KEY = navigationKey(BASE, ORIGIN);
const PRECACHED_PATHS = new Set(MANIFEST.entries.map((e) => new URL(e.url, BASE).pathname));
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(installShell());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(activateCleanup());
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const route = classifyRequest({
    url: event.request.url,
    method: event.request.method,
    mode: event.request.mode,
    hasRange: event.request.headers.has('range'),
    origin: ORIGIN,
    basePath: BASE_PATH,
    precached: PRECACHED_PATHS,
  });
  if (route === 'passthrough') return; // 跨源/非 GET/Range/scope 外：不 respondWith
  if (route === 'navigation') {
    event.respondWith(handleNavigation(event.request));
  } else if (route === 'precached') {
    event.respondWith(handlePrecached(event.request));
  } else {
    event.respondWith(handleRuntimeRevalidate(event.request));
  }
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting(); // 只由用户点击「刷新」触发（D9），不自动接管
  }
});

/** install：按清单全量填充 shell 缓存；任一失败即删半成品缓存再 throw——
 * 旧 SW 保留（§6.3），配额不留残骸（§17.4 P3-8）。 */
async function installShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  try {
    await Promise.all(
      MANIFEST.entries.map(async (entry) => {
        const url = new URL(entry.url, BASE).href;
        // index.html 强制绕 HTTP 缓存重取（防 Pages 600s 陈旧页）；其余资产带 hash
        // 天然 immutable，走默认缓存避免首装流量翻倍
        const res = await fetch(url, entry.url === 'index.html' ? { cache: 'reload' } : undefined);
        if (!res.ok) throw new Error(`[spinth-sw] 预缓存失败 ${entry.url}: HTTP ${res.status}`);
        if (entry.url === 'index.html') {
          // 同一份响应存两键（原件 + 归一化导航键）：put 消费响应体，先 clone 再存
          await cache.put(url, res.clone());
          await cache.put(NAV_KEY, res);
        } else {
          await cache.put(url, res);
        }
      }),
    );
  } catch (err) {
    await caches.delete(SHELL_CACHE); // 半成品不留配额；delete 对不存在的缓存安全返回 false
    throw err;
  }
}

/** activate：删除所有非当前版本的 spinth-* 缓存（D10 不做跨代保留）+ claim（D11）。 */
async function activateCleanup(): Promise<void> {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
  for (const name of await caches.keys()) {
    if (name.startsWith('spinth-') && !keep.has(name)) await caches.delete(name);
  }
  await self.clients.claim(); // 首装即受控（完成定义 2）
}

/** 导航 network-first（no-cache）→ 3s 超时 → shell 回退；网络响应不回写缓存（D6）。 */
async function handleNavigation(request: Request): Promise<Response> {
  // 超时即中断底层 fetch：继续跑完再丢弃是浪费，也可能与回退竞态（§17.4 P3-9）
  const abort = new AbortController();
  try {
    return await withTimeout(
      fetch(request, { cache: 'no-cache', signal: abort.signal }),
      NAV_TIMEOUT_MS,
      () => abort.abort(),
    );
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const shell = await cache.match(NAV_KEY);
    // shell 只由 install 填充——离线 HTML 与缓存 assets 永远同版本
    return shell ?? new Response('offline', { status: 504, statusText: 'Offline' });
  }
}

/** 预缓存资源 cache-first；命中失败（理论不可达）退网络。 */
async function handlePrecached(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  return fetch(request);
}

/** 字体 SWR（非 latin 子集，D7/D16）：命中即回、后台更新；未命中等网络并存缓存。 */
async function handleRuntimeRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request.url);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) void cache.put(request.url, res.clone()); // clone 后 put，响应体各自消费一次
      return res;
    })
    .catch(() => undefined);
  if (hit) return hit;
  return (await network) ?? new Response('', { status: 504, statusText: 'Offline' });
}

function withTimeout(p: Promise<Response>, ms: number, onTimeout: () => void): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout(); // 先中断底层 fetch 再拒绝（§17.4 P3-9）
      reject(new Error('navigation timeout'));
    }, ms);
    p.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
