#!/usr/bin/env node
/* global console, process */
/**
 * 生成 / 校验 THIRD_PARTY_NOTICES.md。
 *
 * `--check` 用于 pnpm verify：声明文件与依赖树不一致时红，
 * 防止升级依赖后忘记同步第三方许可。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, renderNotices } from './lib/dependency-licenses.mjs';

const TARGET = path.join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md');
const checkOnly = process.argv.includes('--check');
const content = renderNotices();

if (checkOnly) {
  if (!existsSync(TARGET)) {
    console.error(
      '[notices] 缺少 THIRD_PARTY_NOTICES.md，请跑 node scripts/gen-third-party-notices.mjs',
    );
    process.exit(1);
  }
  const current = readFileSync(TARGET, 'utf8');
  if (current !== content) {
    console.error('[notices] THIRD_PARTY_NOTICES.md 与依赖树不一致，请重新生成后提交');
    process.exit(1);
  }
  console.log('[notices] OK（与依赖树一致）');
  process.exit(0);
}

writeFileSync(TARGET, content);
console.log(`[notices] 已写入 ${path.relative(REPO_ROOT, TARGET)}`);
