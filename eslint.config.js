// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * spinth ESLint flat config
 *
 * 包边界铁律（详见 AGENTS.md 与 docs/01-conventions.md）：
 *  - packages/core   框架无关 SDK：禁止 import 任何 UI 框架 / 状态库
 *  - packages/react  胶水层：禁止直接操作 PIXI / Yjs，只能消费 @spinth/core 的 API
 *  - packages/app    应用壳：只消费 @spinth/react，禁止触碰 PIXI / Yjs
 */
export default tseslint.config(
  // .cache/**：本地工具工作区（如 visual-linux 执行器的源码副本），不是仓库代码
  { ignores: ['**/dist/**', '**/node_modules/**', '**/public/__spinth-recorder.js', '.cache/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // 钩子参数约定：下划线前缀 = 有意忽略
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---- packages/core：框架无关 SDK ----
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react-*', '@spinth/react', 'zustand', 'jotai'],
              message:
                '@spinth/core 是框架无关 SDK，禁止依赖任何 UI 框架/状态库（见 docs/01-conventions.md）',
            },
          ],
        },
      ],
    },
  },

  // ---- packages/react：胶水层 ----
  {
    files: ['packages/react/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi-*', 'yjs', 'y-*'],
              message:
                '@spinth/react 是胶水层，禁止直接操作渲染引擎与数据引擎（见 docs/12-ui-layer.md）',
            },
            {
              group: ['lucide-react'],
              message:
                '图标统一经 components/Icon.tsx 的语义名注册表引入，禁止直接 import 图标库（见 docs/12-ui-layer.md §4）',
            },
          ],
        },
      ],
    },
  },

  // 图标注册表本身是唯一的例外（Icon.tsx）
  {
    files: ['packages/react/src/components/Icon.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ---- packages/app：应用壳 ----
  {
    files: ['packages/app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi-*', 'yjs', 'y-*', '@spinth/core'],
              message:
                '@spinth/app 只消费 @spinth/react，禁止越层触碰 SDK 内部（见 docs/01-conventions.md）',
            },
          ],
        },
      ],
    },
  },

  // ---- Service Worker：独立全局（specs/pwa.md D1/D2）----
  // SW 无 DOM、无框架、无 Node——只允许相对导入纯函数（cachePolicy 等）。
  // 包内相对导入不受 patterns 限制，被禁的是框架/SDK/Node 内建。
  {
    files: ['packages/app/src/pwa/sw/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@spinth/*', 'react', 'react-dom', 'react-*', 'node:*'],
              message:
                'Service Worker 是独立全局：禁止依赖框架 / SDK / Node 内建（specs/pwa.md D1/D2）',
            },
          ],
        },
      ],
    },
  },
);
