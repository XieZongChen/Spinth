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

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC = path.join(ROOT, 'packages/app/e2e/visual.spec.ts');
const SNAP_DIR = path.join(ROOT, 'packages/app/e2e/visual.spec.ts-snapshots');
const PLATFORMS = ['darwin', 'linux'];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const failures = [];
const fail = (msg) => failures.push(msg);

// 1. 从测试源码提取名称（specs D11：不维护第二份列表）
const source = fs.readFileSync(SPEC, 'utf8');
const callCount = [...source.matchAll(/toHaveScreenshot\(/g)].length;
const literalMatches = [...source.matchAll(/toHaveScreenshot\(\s*'([^']+)'/g)];
if (callCount !== literalMatches.length) {
  fail(
    `visual.spec.ts 存在 ${callCount - literalMatches.length} 处非字面量（动态）快照名称——` +
      '本脚本无法推导基线清单，请改为字面量或更新脚本（specs/linux-visual §6.2）',
  );
}
const stems = [...new Set(literalMatches.map((m) => m[1].replace(/\.png$/, '')))];
if (stems.length === 0) fail('visual.spec.ts 未提取到任何 toHaveScreenshot 字面量');

// 2. 每 stem × 每平台：存在、非空、PNG 头
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
    if (!ok) fail(`缺失或损坏：${path.relative(ROOT, file)}`);
  }
}

// 3. 目录内不得有白名单之外的文件（未知平台 / -actual / -expected / -diff / 空文件）
const allowed = new Set(stems.flatMap((s) => PLATFORMS.map((p) => `${s}-${p}.png`)));
for (const name of fs.readdirSync(SNAP_DIR)) {
  if (!allowed.has(name))
    fail(`基线目录出现未纳管文件：${path.join(path.relative(ROOT, SNAP_DIR), name)}`);
}

if (failures.length > 0) {
  console.error(`[visual-baselines] 发现 ${failures.length} 个基线问题：`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '修复指引：缺 linux 基线跑 pnpm visual:linux --update；勿提交 -actual 改名文件（specs §6.1）',
  );
  process.exitCode = 1;
} else {
  console.log(
    `[visual-baselines] OK（${stems.length} 个 stem × ${PLATFORMS.length} 平台 = ${stems.length * PLATFORMS.length} 张基线齐全）`,
  );
}
