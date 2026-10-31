import { useSpinthStore } from '@spinth/react';

/**
 * E2E 只读探针（specs/pwa §11.2、runtime-narrowing §3.7）：`?e2e=1` 时把
 * zustand 镜像桥成测试 helper 读取的 window 形状——`__spinth` 只镜像公开面
 * 字段（docState$/persistState$/modelCount），`__spinthDebug.__debug` 只有
 * modelCount；不暴露 engine/viewport/assetStore 等内部面（与 DEV 双句柄形状
 * 对齐：公开只读子集 + 调试入口；生产普通构建两者均零残留）。
 *
 * 双重门控（§17.4 P2-4）：构建期 `__E2E_PROBE__`（仅 SPINTH_E2E=1 的构建为
 * true，Pages 产物经常量折叠零残留）+ 查询参数 `?e2e=1`（按 URL 精确挂载）。
 */

let attached = false;

export function attachE2eProbe(): void {
  if (!__E2E_PROBE__) return;
  if (attached) return; // StrictMode 双调用只挂一次
  if (new URLSearchParams(window.location.search).get('e2e') !== '1') return;
  attached = true;
  const write = () => {
    (window as unknown as Record<string, unknown>).__spinth = {
      docState$: { getValue: () => useSpinthStore.getState().docState },
      persistState$: { getValue: () => useSpinthStore.getState().persistState },
      get modelCount() {
        return useSpinthStore.getState().modelCount;
      },
    };
    (window as unknown as Record<string, unknown>).__spinthDebug = {
      __debug: {
        get modelCount() {
          return useSpinthStore.getState().modelCount;
        },
      },
    };
  };
  write();
  useSpinthStore.subscribe(write);
}
