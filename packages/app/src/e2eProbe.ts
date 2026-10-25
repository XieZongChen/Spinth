import { useSpinthStore } from '@spinth/react';

/**
 * E2E 只读探针（specs/pwa §11.2）：`?e2e=1` 时把 zustand 镜像桥成测试
 * helper 读取的 `window.__spinth` 形状。SDK 的 DEV 句柄生产剥离
 * （Board.tsx「生产构建剥离」约定不破）——生产 E2E（pwa.spec，preview 形态）
 * 需要等价的只读视图。
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
      engine: { persistState$: { getValue: () => useSpinthStore.getState().persistState } },
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
