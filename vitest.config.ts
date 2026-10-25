import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // react 双单元（Batch 2 组件渲染测试）：纯函数 node 环境（原样）+
    // 组件 jsdom 单元（*.render.test.tsx）——互不拖环境成本
    projects: [
      'packages/core',
      {
        root: 'packages/react',
        test: {
          name: 'react',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
        },
      },
      {
        root: 'packages/react',
        test: {
          name: 'react-dom',
          environment: 'jsdom',
          include: ['src/__tests__/*.render.test.tsx'],
        },
      },
      // app 单元（specs/pwa §11.1）：PWA 纯逻辑与 SW 控制器桩测（node 环境）。
      // 包内另有 vitest.config.ts 供 `pnpm --filter @spinth/app test` 单独运行。
      {
        root: 'packages/app',
        test: {
          name: 'app',
          environment: 'node',
          include: ['src/pwa/**/*.test.ts'],
        },
      },
    ],
    rootDir: '.',
    // coverage 仅由根 `pnpm test:coverage` 按需启用；日常 `pnpm test` 不付插桩成本。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 只统计 TS/TSX：先前的 'src/**' 会把 README.md 当源码解析，coverage 输出
      // 里出现 PARSE_ERROR 噪声（2026-10-20 修复）。
      include: [
        'packages/core/src/**/*.ts',
        'packages/react/src/**/*.ts',
        'packages/react/src/**/*.tsx',
        'packages/app/src/pwa/**/*.ts',
      ],
      exclude: ['**/__tests__/**', '**/*.test.*', '**/index.ts', '**/*.md'],
      // 回退门禁：2026-10-25 实测（并入 app pwa 单测后）Stmts 67.48 / Branch
      // 59.04 / Funcs 58.19 / Lines 69.4；按 specs/pwa §11.1 规则取实测下浮
      // 1.5% 且不低于旧阈值（61/51/63/52）。
      // 只在 coverage 启用时生效；CI 也跑 pnpm test:coverage（.github/workflows/ci.yml）。
      thresholds: {
        statements: 66,
        branches: 58,
        lines: 68,
        functions: 57,
      },
    },
  },
});
