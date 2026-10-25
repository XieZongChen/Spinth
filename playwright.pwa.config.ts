import { defineConfig } from '@playwright/test';
import mainConfig from './playwright.config';

/**
 * PWA 专用配置（specs/pwa.md D14、§17.2 偏差 8）：webServer 是全局配置，
 * 挂主配置会让 nightly（visual/timing/multitab）各多付一次 ~25s 的子路径
 * 构建——故 pwa project 独立成配置。跑法：主配置 + 本配置双命令
 * （pnpm test:e2e / ci.yml gate），见 docs/15 §2。
 *
 * 经 spread 继承自主配置：testDir / timeout / workers / reporter / use
 * （channel·viewport·launchOptions·trace）/ expect 快照容差——主配置改这些
 * 会作用到本配置；projects 与 webServer 完全覆盖；retries 显式归零
 * （P5/P6 做多次真重建，重试会掩盖真 flake，对齐 multitab 压力的 --retries=0 精神）。
 */
const PWA_PORT = 5198;

export default defineConfig({
  ...mainConfig,
  retries: 0,
  projects: [
    {
      name: 'pwa',
      testMatch: '**/pwa.spec.ts',
      use: { baseURL: `http://localhost:${PWA_PORT}/spinth/` },
    },
  ],
  webServer: [
    {
      // 真实 Pages 形态：先按子路径构建再 preview（D14）。
      // SPINTH_E2E=1 让构建携带只读探针（§17.4 P2-4）；命令行内联 env
      // 而不用 webServer.env——后者整体替换会丢 PATH；
      // reuse 恒 false：本地常驻 preview 会端着旧 dist 造成假结果
      command: `SPINTH_E2E=1 SPINTH_BASE=/spinth/ pnpm --filter @spinth/app build && SPINTH_BASE=/spinth/ pnpm --filter @spinth/app preview --port ${PWA_PORT} --strictPort`,
      url: `http://localhost:${PWA_PORT}/spinth/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
