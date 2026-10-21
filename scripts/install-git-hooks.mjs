#!/usr/bin/env node
/* global process, console */
/**
 * 安装仓库自带的 pre-commit 钩子（package.json prepare）。
 * 已有自定义 pre-commit 不会被覆盖。
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MARKER = '# spinth-hygiene';

let hooksPath;
try {
  hooksPath = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  process.exit(0); // 非 git 环境（CI 打包等）不安装
}

const hookFile = resolve(hooksPath, 'pre-commit');
if (existsSync(hookFile)) {
  const current = readFileSync(hookFile, 'utf8');
  if (!current.includes(MARKER)) {
    console.warn(`[hooks] 已存在自定义 pre-commit，未覆盖：${hookFile}`);
    process.exit(0);
  }
}

mkdirSync(hooksPath, { recursive: true });
writeFileSync(
  hookFile,
  `#!/bin/sh
${MARKER}
node scripts/check-hygiene.mjs --staged || exit 1
`,
);
chmodSync(hookFile, 0o755);
console.log(`[hooks] 已安装 pre-commit：${hookFile}`);
