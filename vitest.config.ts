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
      // 只统计 TS/TSX：先前的 'src/**' 会把 README.md 当源码解析，coverage 输出
      // 里出现 PARSE_ERROR 噪声（2026-10-20 修复）。
      include: [
        'packages/core/src/**/*.ts',
        'packages/react/src/**/*.ts',
        'packages/react/src/**/*.tsx',
      ],
      exclude: ['**/__tests__/**', '**/*.test.*', '**/index.ts', '**/*.md'],
      // 回退门禁：2026-10-20 实测 Stmts 62.95 / Branch 52.21 / Funcs 54.39 /
      // Lines 64.81，阈值在基线下方留余量——只降不升即红。
      // 只在 coverage 启用时生效；CI 也跑 pnpm test:coverage（.github/workflows/ci.yml）。
      thresholds: {
        statements: 61,
        branches: 51,
        lines: 63,
        functions: 52,
      },
    },
  },
});
