import { defineConfig } from '@playwright/test';

/**
 * E2E 冒烟（docs/15 §3）：真实浏览器跑「创建→拖拽→undo→刷新恢复」全链路，
 * 作为 roadmap 人工验收清单的客观依据。
 *
 * - 复用系统 Chrome（channel: 'chrome'，免浏览器下载）；visual 基线固定环境
 *   经 E2E_VISUAL_CHANNEL=bundled 切 Playwright 自带 Chromium（prompt §2.3.4）；
 * - 端口可注入（E2E_PORT，默认 5199）+ baseURL：自托管/并发 runner 无固定端口冲突；
 *   本地 reuseExistingServer（调试连常驻 dev server）；
 * - 每次运行用随机 docId，IndexedDB 从零开始（用例间零耦合）；
 * - 用例 tag（CI 三层，prompt §2.2）：@timing（画笔/键盘缩放/时延）、@bench、
 *   @visual——gate 层 --grep-invert 排除、nightly 层 --grep 承接；
 * - **pwa.spec 不在本配置**（归 playwright.pwa.config.ts 的 preview 形态）——
 *   裸跑 `npx playwright test` 只有 205 例；pwa 6 例需另跑
 *   `npx playwright test --config playwright.pwa.config.ts`（`pnpm test:e2e` 已含双命令）。
 */

const PORT = Number(process.env.E2E_PORT ?? 5199);

// Linux 视觉基线 flags（specs/linux-visual §5.4）：只在 E2E_VISUAL_CHANNEL=bundled
// （容器/自带 Chromium）时追加——系统 Chrome 的 darwin 基线不受影响。色彩 profile、
// 灰度 AA、无 hinting 消除宿主渲染差异；ANGLE+SwiftShader 强制软件光栅消除有/无
// GPU 差异（不加 --disable-gpu：有断 WebGL 风险，specs D5）。
const VISUAL_BUNDLED = process.env.E2E_VISUAL_CHANNEL === 'bundled';
const VISUAL_FLAGS = [
  '--force-color-profile=srgb',
  '--disable-lcd-text',
  '--font-render-hinting=none',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
];

export default defineConfig({
  testDir: 'packages/app/e2e',
  timeout: 30_000,
  // retries=1：并发负载下时敏用例偶发（真回归重试仍红）；timing 层用
  // --workers=1 跑、flake 记录代替盲重试
  retries: 1,
  workers: 2,
  reporter: [['line']],
  // pwa.spec 只归 playwright.pwa.config.ts 的 pwa project（preview 形态，
  // specs/pwa D14/§17.2-8）——主配置 ignore 防止它打到 dev server 上跑
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/pwa.spec.ts',
    },
  ],
  // 视觉快照（docs/15 §4）：容差 2%；基线按平台分目录（darwin/linux 各自
  // 生成——prompt §2.3.4：macOS 基线不比 Linux 渲染）
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  // 基线固定放在 visual.spec.ts-snapshots 目录；按平台分文件，避免 macOS/Linux
  // 渲染差异互相污染。{arg} 已由 Playwright 剥离扩展名，拼回 {ext}。
  snapshotPathTemplate: '{testDir}/visual.spec.ts-snapshots/{arg}-{platform}{ext}',
  use: {
    browserName: 'chromium',
    // visual 固定环境：E2E_VISUAL_CHANNEL=bundled 时用自带 Chromium（版本随
    // @playwright/test pin），否则系统 Chrome
    channel: VISUAL_BUNDLED ? undefined : 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    // 视觉基线按 1x 像素生成（specs/linux-visual §10.1：默认即 1，显式声明意图）
    deviceScaleFactor: 1,
    baseURL: `http://localhost:${PORT}`,
    // 本环境有全局 HTTP_PROXY（会劫持 localhost 就绪探测）——浏览器直连；
    // bundled 时叠加视觉 flags（见上）
    launchOptions: { args: ['--no-proxy-server', ...(VISUAL_BUNDLED ? VISUAL_FLAGS : [])] },
    // 失败即留全量证据（retain：非 retry 也留——nightly flake 排障）
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `pnpm --filter @spinth/app dev --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // CI 每次全新起（复用会连到旧代码）；本地复用常驻 dev server 调试
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
