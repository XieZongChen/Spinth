import { defineConfig } from 'vitest/config';

// app 单元（specs/pwa §11.1）：node 环境纯逻辑（cachePolicy / precacheManifest /
// serviceWorker 控制器桩测）。include 收窄到 src——默认模式会捞到 e2e/*.spec.ts
// （Playwright spec 不能进 vitest）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
