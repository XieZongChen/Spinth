/* global console */

/**
 * 产物层：哈希清单打印、§8.2 审计环境采集、CI update 模式的可审计产物落盘。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execIn } from './docker.mjs';
import { CACHE, NOTO_CJK_VERSION, ROOT, SNAPSHOTS_REL } from './config.mjs';
import { log, sha256, sh } from './util.mjs';

export function printPngHashes(dir, platform) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(`-${platform}.png`))
    .sort();
  const map = {};
  for (const f of files) {
    map[f] = sha256(path.join(dir, f));
    console.log(`  ${map[f]}  ${f}`);
  }
  return map;
}

/** §8.2 审计字段：容器存活时采集运行时与字体事实（node/pnpm/fc-match/fc-list） */
export function collectEnvironment(name) {
  const out = execIn(
    name,
    [
      'set -e',
      'node_v=$(node -v)',
      'pnpm_v=$(corepack pnpm -v)',
      'fc_m=$(fc-match sans-serif)',
      'fc_zh=$(fc-list :lang=zh family | sort -u | paste -sd ";" -)',
      'echo "node_v=$node_v"',
      'echo "pnpm_v=$pnpm_v"',
      'echo "fc_m=$fc_m"',
      'echo "fc_zh=$fc_zh"',
    ].join('\n'),
  );
  const map = {};
  for (const line of out.trim().split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  return map;
}

/** CI update 模式的可审计产物（specs §8.2）：PNG + environment.txt + sha256sum.txt */
export function writeArtifact(tag, pkgVersion, env = {}) {
  const dir = path.join(CACHE, 'artifact');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const hostSnap = path.join(ROOT, SNAPSHOTS_REL);
  const pngs = fs
    .readdirSync(hostSnap)
    .filter((f) => f.endsWith('-linux.png'))
    .sort();
  const lines = [];
  for (const f of pngs) {
    fs.copyFileSync(path.join(hostSnap, f), path.join(dir, f));
    lines.push(`${sha256(path.join(hostSnap, f))}  ${f}`);
  }
  fs.writeFileSync(path.join(dir, 'sha256sum.txt'), `${lines.join('\n')}\n`);
  let gitSha = '';
  try {
    gitSha = sh('git', ['rev-parse', 'HEAD'], { capture: true }).trim();
  } catch {
    /* 非 git 环境留空 */
  }
  const imageId = sh('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], {
    capture: true,
  }).trim();
  let baseDigest = '';
  try {
    baseDigest = sh(
      'docker',
      [
        'image',
        'inspect',
        `mcr.microsoft.com/playwright:v${pkgVersion}-noble`,
        '--format',
        '{{json .RepoDigests}}',
      ],
      { capture: true },
    ).trim();
  } catch {
    /* base 元数据缺失留空 */
  }
  fs.writeFileSync(
    path.join(dir, 'environment.txt'),
    [
      `playwright=${pkgVersion}`,
      `node=${env.node_v || '(unknown)'}`,
      `pnpm=${env.pnpm_v || '(unknown)'}`,
      `noto_cjk=${NOTO_CJK_VERSION}`,
      `base_digest=${baseDigest || '(unknown)'}`,
      `image=${imageId}`,
      `fc_match=${env.fc_m || '(unknown)'}`,
      `fc_list_zh=${env.fc_zh || '(unknown)'}`,
      `git=${gitSha || '(unknown)'}`,
      ...lines,
      '',
    ].join('\n'),
  );
  log(`update 产物已写入 ${path.relative(ROOT, dir)}/（PNG + environment.txt + sha256sum.txt）`);
}
