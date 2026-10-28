#!/usr/bin/env node
/* global process, console */

/**
 * 视觉基线齐全护栏（specs/linux-visual §6.2）。
 *
 * 从 visual.spec.ts 提取 toHaveScreenshot('...') 字面量得到期望 stem 清单（单一
 * 来源，避免双维护），断言每个 stem 的 -darwin.png 与 -linux.png 都存在、非空、
 * PNG 头正确；拒绝目录里的未知平台文件与 -actual/-expected/-diff 残留。
 * 不依赖 Docker，可在 gate 与 pnpm verify 里跑。
 *
 * 退出码：0 通过；1 基线/护栏失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractVisualStems } from './visual-linux/stems.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC = path.join(ROOT, 'packages/app/e2e/visual.spec.ts');
const SNAP_DIR = path.join(ROOT, 'packages/app/e2e/visual.spec.ts-snapshots');
const PLATFORMS = ['darwin', 'linux'];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const failures = [];
const fail = (msg) => failures.push(msg);

// 1. 从测试源码提取名称（specs D11：不维护第二份列表，提取逻辑与执行器共享）
const { stems, error: stemsError } = extractVisualStems(SPEC);
if (stemsError) fail(stemsError);
if (stems.length === 0) fail('visual.spec.ts 未提取到任何 toHaveScreenshot 字面量');

// 2. 每 stem × 每平台：存在、非空、PNG 头
const missing = { darwin: [], linux: [] };
for (const stem of stems) {
  for (const platform of PLATFORMS) {
    const file = path.join(SNAP_DIR, `${stem}-${platform}.png`);
    let ok = false;
    try {
      const buf = fs.readFileSync(file);
      ok = buf.length > 8 && PNG_MAGIC.every((b, i) => buf[i] === b);
    } catch {
      /* 缺文件走下面统一报缺 */
    }
    if (!ok) {
      fail(`缺失或损坏：${path.relative(ROOT, file)}`);
      missing[platform].push(stem);
    }
  }
}

// 3. 目录内不得有白名单之外的文件（未知平台 / -actual / -expected / -diff / 空文件）
const allowed = new Set(stems.flatMap((s) => PLATFORMS.map((p) => `${s}-${p}.png`)));
const unknown = [];
for (const name of fs.readdirSync(SNAP_DIR)) {
  if (!allowed.has(name)) {
    fail(`基线目录出现未纳管文件：${path.join(path.relative(ROOT, SNAP_DIR), name)}`);
    unknown.push(name);
  }
}

if (failures.length > 0) {
  console.error(`[visual-baselines] 发现 ${failures.length} 个基线问题：`);
  for (const f of failures) console.error(`  - ${f}`);
  // 修复指引按缺失平台给（specs §6.1；勿提交 -actual 改名文件）
  if (missing.linux.length > 0) {
    console.error(`  指引：缺 linux 基线 ${missing.linux.length} 张 → pnpm visual:linux --update`);
  }
  if (missing.darwin.length > 0) {
    console.error(
      `  指引：缺 darwin 基线 ${missing.darwin.length} 张 → macOS 宿主执行 ` +
        'npx playwright test --grep @visual --update-snapshots',
    );
  }
  if (unknown.length > 0) {
    console.error('  指引：目录内未纳管文件（-actual 等）请删除，勿改名顶替基线');
  }
  process.exitCode = 1;
} else {
  console.log(
    `[visual-baselines] OK（${stems.length} 个 stem × ${PLATFORMS.length} 平台 = ${stems.length * PLATFORMS.length} 张基线齐全）`,
  );
}
