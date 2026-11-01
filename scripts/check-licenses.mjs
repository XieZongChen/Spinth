#!/usr/bin/env node
/* global console, process */
/**
 * 依赖许可白名单门禁。
 *
 * 两把尺子：
 * - 运行时闭包（随 bundle 分发）必须落在白名单内，无例外；
 * - 全量安装面允许 devDependencies 里出现 MPL-2.0（文件级 copyleft 的构建期工具），
 *   一旦这类包进入运行时闭包立即报红。
 */

import { collectInstalledPackages, collectRuntimeClosure } from './lib/dependency-licenses.mjs';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  'OFL-1.1',
  'CC-BY-4.0',
]);

/** 仅允许出现在非运行时闭包（构建期）的许可。 */
const DEV_ONLY = new Set(['MPL-2.0']);

function isAllowed(expression) {
  const atoms = expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((atom) => atom.trim())
    .filter(Boolean);
  if (atoms.length === 0) return { ok: false, reason: '空许可表达式' };
  const denied = atoms.filter((atom) => !ALLOWED.has(atom));
  if (denied.length === 0) return { ok: true };
  const devOnly = denied.every((atom) => DEV_ONLY.has(atom));
  return { ok: false, devOnly, reason: denied.join(' / ') };
}

const runtime = collectRuntimeClosure();
const runtimeKeys = new Set(runtime.map((pkg) => `${pkg.name}@${pkg.version}`));
const installed = collectInstalledPackages();
const problems = [];

for (const pkg of runtime) {
  const verdict = isAllowed(pkg.license);
  if (!verdict.ok) {
    problems.push(`运行时依赖 ${pkg.name}@${pkg.version} 使用受限许可：${verdict.reason}`);
  }
}

for (const pkg of installed) {
  const verdict = isAllowed(pkg.license);
  if (verdict.ok) continue;
  const isRuntime = runtimeKeys.has(`${pkg.name}@${pkg.version}`);
  if (verdict.devOnly && !isRuntime) continue;
  problems.push(`${pkg.name}@${pkg.version} 使用受限许可：${verdict.reason}`);
}

if (problems.length > 0) {
  for (const line of problems) console.error(`[licenses] ${line}`);
  process.exit(1);
}

console.log(
  `[licenses] OK（运行时 ${runtime.length} 包 / 安装面 ${installed.length} 条，白名单 ${ALLOWED.size} 项 + 构建期 ${DEV_ONLY.size} 项）`,
);
