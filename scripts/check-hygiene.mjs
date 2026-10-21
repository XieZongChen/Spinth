#!/usr/bin/env node
/* global process, console */
/**
 * 仓库卫生检查（AGENTS: 文档迭代与仓库卫生）。
 *
 * 拦截三类问题：
 * 1. 交接/代理文件被跟踪：HANDOFF*、*handoff*、本地代理目录等；
 * 2. 本机隐私：绝对 home 路径、邮箱、疑似密钥；本地拒绝词可写 .hygiene.local.json；
 * 3. 文档历史记录：变更/历史/验收记录章节、PR 编号、带日期的“已实现/已修复”叙事、
 *    commit 哈希。docs 只写当前事实，历史由 git 提交信息承载。
 *
 * 用法：node scripts/check-hygiene.mjs [--staged]
 * 默认扫描 git 跟踪的全部文件；--staged 只扫描暂存内容（pre-commit 用）。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const STAGED = process.argv.includes('--staged');
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function isGitRepo() {
  try {
    return git(['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

function listFiles() {
  const out = STAGED
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

function readText(file) {
  try {
    const text = STAGED ? git(['show', `:${file}`]) : readFileSync(resolve(ROOT, file), 'utf8');
    if (text.length > MAX_TEXT_BYTES || text.includes('\0')) return null;
    return text;
  } catch {
    return null;
  }
}

const deniedPaths = [
  { re: /(^|\/)HANDOFF[^/]*$/i, reason: '交接文档不入库' },
  { re: /(^|\/)[^/]*handoff[^/]*$/i, reason: '交接文档不入库' },
  { re: /(^|\/)\.env(\.local)?$/i, reason: '.env 不入库' },
];

const genericRules = [
  {
    re: /(?:^|[\s"'`=([{<])\/(?:Users|home)\/[^/\s]+/m,
    reason: '本机绝对路径',
  },
  { re: /[A-Za-z]:\\Users\\/i, reason: '本机绝对路径（Windows）' },
  {
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    reason: '邮箱地址',
  },
  {
    re: /(?:ghp_|github_pat_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/,
    reason: '疑似密钥/私钥',
  },
];

const docsRules = [
  {
    re: /^\s*#{1,6}\s*(?:\d+[.、]\s*)?(?:变更记录|更新记录|历史记录|验收记录|实施记录)(?:\s|$|[（(：:])/m,
    reason: '文档不写历史/验收流水账',
  },
  { re: /\bPR[1-9][0-9]?\b/, reason: '文档不写 PR 编号' },
  {
    re: /已(?:实现|修复|完成|上线|冻结)（20\d{2}-/,
    reason: '文档不写带日期的历史状态',
  },
  { re: /\bcommit\s+[0-9a-f]{7,40}\b/i, reason: '文档不写提交哈希' },
];

function loadLocalRules() {
  const path = resolve(ROOT, '.hygiene.local.json');
  if (!existsSync(path)) return { patterns: [], paths: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      patterns: Array.isArray(raw.denyPatterns)
        ? raw.denyPatterns.filter((v) => typeof v === 'string' && v.length > 0)
        : [],
      paths: Array.isArray(raw.denyPaths)
        ? raw.denyPaths.filter((v) => typeof v === 'string' && v.length > 0)
        : [],
    };
  } catch {
    console.warn('[hygiene] .hygiene.local.json 解析失败，忽略本地拒绝词');
    return { patterns: [], paths: [] };
  }
}

function main() {
  if (!isGitRepo()) {
    console.log('[hygiene] 非 git 仓库，跳过');
    return;
  }

  const local = loadLocalRules();
  const localContentRules = local.patterns.map((p) => ({
    re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    reason: '命中本地拒绝词',
  }));
  const localPathRules = local.paths.map((p) => ({
    re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    reason: '命中本地拒绝路径',
  }));

  const findings = [];
  const seen = new Set();
  const add = (file, reason) => {
    const key = `${file}\0${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, reason });
  };

  for (const file of listFiles()) {
    // 扫描器自身包含规则字面量，跳过内容扫描以免自匹配。
    if (file === 'scripts/check-hygiene.mjs') continue;
    for (const rule of [...deniedPaths, ...localPathRules]) {
      if (rule.re.test(file)) add(file, rule.reason);
    }
    const text = readText(file);
    if (text === null) continue;
    const isDoc = file.startsWith('docs/') || file === 'AGENTS.md';
    const rules = [...genericRules, ...localContentRules, ...(isDoc ? docsRules : [])];
    for (const rule of rules) {
      if (rule.re.test(text)) add(file, rule.reason);
    }
  }

  if (findings.length === 0) {
    console.log(`[hygiene] OK (${STAGED ? 'staged' : 'tracked'} files)`);
    return;
  }

  console.error('[hygiene] 发现需要处理的仓库卫生问题：');
  for (const { file, reason } of findings) {
    console.error(`  - ${file}: ${reason}`);
  }
  console.error('[hygiene] 交接/代理文件请移到本机忽略目录；文档请改写为当前事实，不写历史。');
  process.exitCode = 1;
}

main();
