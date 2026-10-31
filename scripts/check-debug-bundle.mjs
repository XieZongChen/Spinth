#!/usr/bin/env node
/* global process, console */
/**
 * 产物调试面扫描（specs/runtime-narrowing §3.9）：
 * - 所有构建：core DEV 调试入口标记 `spinth:core-dev-debug` 必须 0 处
 *   （BOARD_DEBUG_ENTRY = Symbol.for 的唯一字符串）。E2E 只读探针也叫
 *   __spinthDebug 但不带该标记——据此区分，不拿 __spinthDebug 当唯一判据。
 * - SPINTH_E2E=1 构建：`__spinth` 只读探针必须存在（pwa.spec 的
 *   ready/modelCount 依赖 e2eProbe）。
 * 用法：node scripts/check-debug-bundle.mjs [distDir]（默认 packages/app/dist）。
 * 退出码：0 通过 / 1 校验失败（含 dist 缺失）。纯 Node，不 import TS。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CORE_ENTRY_MARKER = 'spinth:core-dev-debug';
/** `__spinth` 不把 `__spinthDebug` 误算（负向先行） */
const PROBE_RE = /__spinth(?!Debug)/g;

function walkJs(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkJs(full, root, out);
    else if (name.endsWith('.js')) out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

const distDir = process.argv[2] ?? 'packages/app/dist';
const failures = [];
const fail = (msg) => failures.push(msg);

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`[check-debug-bundle] dist 目录不存在：${distDir}`);
  process.exit(1);
}

const files = walkJs(distDir, distDir);
if (files.length === 0) fail(`dist 内没有任何 .js 产物：${distDir}`);

let probeTotal = 0;
for (const rel of files) {
  const text = readFileSync(join(distDir, rel), 'utf8');
  const markerHits = text.split(CORE_ENTRY_MARKER).length - 1;
  if (markerHits > 0) {
    fail(`${rel}: ${markerHits} 处 ${CORE_ENTRY_MARKER}（core DEV 调试入口泄漏）`);
  }
  probeTotal += (text.match(PROBE_RE) ?? []).length;
}

if (process.env.SPINTH_E2E === '1' && probeTotal === 0) {
  fail('SPINTH_E2E=1 构建缺少 __spinth 只读探针（e2eProbe 应在位）');
}

if (failures.length > 0) {
  for (const f of failures) console.error(`[check-debug-bundle] ${f}`);
  process.exit(1);
}
console.log(`[check-debug-bundle] OK：${files.length} 个 JS 产物，调试面扫描通过`);
