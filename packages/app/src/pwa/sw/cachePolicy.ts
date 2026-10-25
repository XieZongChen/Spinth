/**
 * SW 请求路由分类与键归一化（specs/pwa.md §6.2，纯函数——SW 与单测共用）。
 *
 * 判定顺序不可交换：先短路（非 GET / Range / 跨源 / scope 外），后分类
 * （导航 → 预缓存 → 字体 SWR → 直通）。latin 字体在清单内会先命中
 * `precached` 走 cache-first；`runtime-revalidate` 只兜其余子集。
 */

export type CacheRoute = 'navigation' | 'precached' | 'runtime-revalidate' | 'passthrough';

export interface IClassifyInput {
  url: string;
  method: string;
  mode: string;
  hasRange: boolean;
  origin: string;
  /** 以 '/' 结尾的站点基路径（如 '/spinth/'；根部署为 '/'） */
  basePath: string;
  /** 预缓存 pathname 集合（已含 base 前缀） */
  precached: ReadonlySet<string>;
}

export function classifyRequest(input: IClassifyInput): CacheRoute {
  if (input.method !== 'GET' || input.hasRange) return 'passthrough';
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return 'passthrough';
  }
  if (url.origin !== input.origin) return 'passthrough';
  if (!url.pathname.startsWith(input.basePath)) return 'passthrough';
  if (input.mode === 'navigate') return 'navigation';
  if (input.precached.has(url.pathname)) return 'precached';
  if (/\.woff2?$/.test(url.pathname)) return 'runtime-revalidate';
  return 'passthrough';
}

/** 导航回退键：去 query、保证尾斜杠——`?doc=` 多文档共享同一份 shell。 */
export function navigationKey(base: string, origin: string): string {
  return new URL(base, origin).href;
}

/** 缓存键（绝对 URL）→ 清单 url（相对 base、无前导 '/'）。不在 base 下时原样返回。 */
export function toManifestPath(basePath: string, url: string): string {
  const pathname = new URL(url).pathname;
  if (!pathname.startsWith(basePath)) return pathname;
  return pathname.slice(basePath.length);
}
