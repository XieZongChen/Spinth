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
    ],
    rootDir: '.',
    // coverage 仅由根 `pnpm test:coverage` 按需启用；日常 `pnpm test` 不付插桩成本。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/core/src/**', 'packages/react/src/**'],
      exclude: ['**/__tests__/**', '**/*.test.*', '**/index.ts'],
      // Batch 2 · 回退门禁（2026-10-18）：基线 2026-10-17 实测（Stmts 62.94/
      // Branch 53.19/Lines 64.8/Funcs 53.97）下浮 1.5% 防抖——只降不升即红。
      // 只在 coverage 启用时生效（pnpm test:coverage）；CI 未跑 coverage，
      // 挂账接入后即为硬门禁
      thresholds: {
        statements: 61,
        branches: 51,
        lines: 63,
        functions: 52,
      },
    },
  },
});
