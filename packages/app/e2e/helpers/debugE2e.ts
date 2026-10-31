import type { Page } from '@playwright/test';

/**
 * DEV 调试入口统一读取器（specs/runtime-narrowing §3.8）：
 * 只回快照字段（可结构化克隆的部分）；四个逃生口（engine / viewport /
 * assetStore / lastAssetMaintenance）是不可枚举 getter，序列化不保证带上——
 * 须在各自 evaluate 内直读 `__spinthDebug.__debug.<name>` 并只返回标量，
 * 不要整包返回。导航间隙（句柄未挂/换页中）返回 null，由调用方 poll 兜底。
 */
export function debugOf<T>(page: Page): Promise<T | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __spinthDebug?: { __debug?: unknown } };
    return (w.__spinthDebug?.__debug as T | undefined) ?? null;
  });
}
