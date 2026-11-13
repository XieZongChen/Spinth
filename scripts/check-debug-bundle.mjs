#!/usr/bin/env node
/* global process, console */
/**
 * 产物调试面扫描（specs/runtime-narrowing §3.9 / S6 收紧版）：
 * - 普通构建（SPINTH_E2E !== '1'）：`__spinth`（不含 __spinthDebug）、
 *   `__spinthDebug`、`__debug`、core 入口标记 `spinth:core-dev-debug`
 *   全部必须 0 处——DEV 双句柄与调试快照代码经常量折叠 + DCE 剥离，
 *   字节级零残留。
 * - SPINTH_E2E=1 构建：`__spinth`、`__spinthDebug`、`__debug` 必须存在
 *   （e2eProbe 只读探针在位，pwa.spec 的 ready/modelCount 依赖）；
 *   `spinth:core-dev-debug` 仍必须 0（E2E 探针不带 core 入口标记）。
 * - 探针字面量 `lastRouteObstacles`（specs/flowchart-closeout §18.2）：只允许
 *   存在于 dev 入口（debugSnapshot 快照键，DCE 剥离）——任何构建产物必须 0 处
 *   （生产侧 getter 走中性名 routeObstaclesProbe，字段 recentObstacles）。
 * 用法：node scripts/check-debug-bundle.mjs [distDir]（默认 packages/app/dist）。
 * 退出码：0 通过 / 1 校验失败（含 dist 缺失）。纯 Node，不 import TS。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CORE_ENTRY_MARKER = 'spinth:core-dev-debug';
/** `__spinth` 不把 `__spinthDebug` 误算（负向先行） */
const PUBLIC_RE = /__spinth(?!Debug)/g;
const DEBUG_GLOBAL_RE = /__spinthDebug/g;
const DEBUG_BAG_RE = /__debug/g;
/** 避障探针路径名（flowchart-closeout §18.2：lastRouteObstacles 不泄漏） */
const OBSTACLES_PROBE = 'lastRouteObstacles';
const IS_E2E = process.env.SPINTH_E2E === '1';

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

const totals = { public: 0, debugGlobal: 0, debugBag: 0 };
for (const rel of files) {
  const text = readFileSync(join(distDir, rel), 'utf8');
  const markerHits = text.split(CORE_ENTRY_MARKER).length - 1;
  if (markerHits > 0) {
    fail(`${rel}: ${markerHits} 处 ${CORE_ENTRY_MARKER}（core DEV 调试入口泄漏）`);
  }
  const probeHits = text.split(OBSTACLES_PROBE).length - 1;
  if (probeHits > 0) {
    fail(`${rel}: ${probeHits} 处 ${OBSTACLES_PROBE}（避障探针路径泄漏——只允许 dev 入口）`);
  }
  const pub = (text.match(PUBLIC_RE) ?? []).length;
  const dbgGlobal = (text.match(DEBUG_GLOBAL_RE) ?? []).length;
  const dbgBag = (text.match(DEBUG_BAG_RE) ?? []).length;
  if (!IS_E2E && (pub > 0 || dbgGlobal > 0 || dbgBag > 0)) {
    fail(
      `${rel}: 普通构建残留调试面（__spinth=${pub} __spinthDebug=${dbgGlobal} __debug=${dbgBag}）`,
    );
  }
  totals.public += pub;
  totals.debugGlobal += dbgGlobal;
  totals.debugBag += dbgBag;
}

if (IS_E2E) {
  if (totals.public === 0) fail('SPINTH_E2E=1 构建缺少 __spinth 只读探针（e2eProbe 应在位）');
  if (totals.debugGlobal === 0) fail('SPINTH_E2E=1 构建缺少 __spinthDebug 只读探针');
  if (totals.debugBag === 0) fail('SPINTH_E2E=1 构建缺少 __debug 只读字段');
}

if (failures.length > 0) {
  for (const f of failures) console.error(`[check-debug-bundle] ${f}`);
  process.exit(1);
}
console.log(
  `[check-debug-bundle] OK：${files.length} 个 JS 产物，${IS_E2E ? 'E2E' : '普通'}构建调试面扫描通过`,
);
