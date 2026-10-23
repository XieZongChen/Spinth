#!/usr/bin/env node
/* global process, console */
/**
 * 安装仓库自带的 git 钩子（package.json prepare）：
 * - pre-commit：staged 卫生检查（毫秒级，防交接/隐私文件入库）；
 * - pre-push：pnpm verify 全量门禁（防红提交推到远端）。
 * 已有自定义钩子不会被覆盖：只跳过没有本仓库 marker 的那一个。
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOKS = [
  {
    name: 'pre-commit',
    marker: '# spinth-hygiene',
    body: 'node scripts/check-hygiene.mjs --staged || exit 1',
  },
  {
    name: 'pre-push',
    marker: '# spinth-pre-push',
    body: 'pnpm verify || exit 1',
  },
];

let hooksPath;
try {
  hooksPath = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  process.exit(0); // 非 git 环境（CI 打包等）不安装
}

mkdirSync(hooksPath, { recursive: true });
for (const hook of HOOKS) {
  const hookFile = resolve(hooksPath, hook.name);
  if (existsSync(hookFile)) {
    const current = readFileSync(hookFile, 'utf8');
    if (!current.includes(hook.marker)) {
      console.warn(`[hooks] 已存在自定义 ${hook.name}，未覆盖：${hookFile}`);
      continue;
    }
  }
  writeFileSync(
    hookFile,
    `#!/bin/sh
${hook.marker}
${hook.body}
`,
  );
  chmodSync(hookFile, 0o755);
  console.log(`[hooks] 已安装 ${hook.name}：${hookFile}`);
}
