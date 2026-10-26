#!/usr/bin/env node
/* global process, console */

/**
 * Linux 视觉基线执行器（specs/linux-visual §7）。
 *
 * 在固定容器环境（docker/visual.Dockerfile，官方 Playwright 镜像 + Noto Sans CJK SC）
 * 里安装、预检并运行 @visual 用例，校验/生成 5 张 -linux.png 基线。
 * 宿主源码只读（work 是副本）；只有 update 模式把 PNG 显式复制回基线目录。
 *
 * 源码用 docker cp 拷入容器本地 fs 而非卷挂载：macOS 容器运行时的卷透传
 * 对 vite 冷启动是 IO 瓶颈，拷贝编排与挂载语义等价（specs §14.4 偏差记录）。
 *
 * 用法：
 *   pnpm visual:linux                 构建镜像（如需）+ 校验当前 Linux 基线
 *   pnpm visual:linux --update        生成并回写 5 张基线，随后立即复验
 *   pnpm visual:linux --stability     两次独立生成比对 SHA-256（不写宿主基线）
 *   pnpm visual:linux --rebuild       强制重建镜像
 *   pnpm visual:linux --debug         保留容器与工作区、打印完整输出
 *
 * 退出码（specs §7.4）：0 通过；1 视觉比较失败；2 环境/预检失败；3 基线/护栏失败。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'visual-linux');
const WORK_SRC = path.join(CACHE, 'work', 'src');
const SNAPSHOTS_REL = 'packages/app/e2e/visual.spec.ts-snapshots';
const DOCKERFILE = path.join(ROOT, 'docker', 'visual.Dockerfile');
const STORE_VOLUME = 'spinth-visual-store';
const COREPACK_VOLUME = 'spinth-visual-corepack';

// noble 的 fonts-noto-cjk 固定版本（specs §5.1：构建时 apt-cache policy 实测写死）
const NOTO_CJK_VERSION = '1:20230817+repack1-3';

// 可选代理（弱网本地环境加速 apt/npm；CI 不设）。仅注入 build-arg 与容器 env，
// 不进镜像配置、不进仓库文档；容器内 localhost 恒走 no_proxy
const PROXY = process.env.VISUAL_LINUX_PROXY ?? '';

const MODE = {
  update: process.argv.includes('--update'),
  stability: process.argv.includes('--stability'),
  rebuild: process.argv.includes('--rebuild'),
  debug: process.argv.includes('--debug'),
};

if (MODE.update && MODE.stability) {
  console.error('[visual-linux] --update 与 --stability 互斥');
  process.exitCode = 2;
} else {
  await main();
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
}

function log(...msgs) {
  console.log(`[visual-linux] ${msgs.join(' ')}`);
}

function die(code, ...msgs) {
  for (const m of msgs) console.error(`[visual-linux] ${m}`);
  process.exit(code);
}

function readPlaywrightVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const spec = pkg.devDependencies['@playwright/test'];
  if (!spec || /^[\^~>]/.test(spec)) {
    die(
      2,
      `package.json 的 @playwright/test 必须是精确版本（当前 "${spec}"）——specs/linux-visual §5.1`,
    );
  }
  return spec;
}

function readDockerfileVersion() {
  // Dockerfile 用 ARG 变量引用 base tag（构建时由脚本显式注入），版本核对读
  // ARG 默认值——它必须与 package.json 一致；FROM 未引用变量则直接拒绝
  const dockerfile = fs.readFileSync(DOCKERFILE, 'utf8');
  if (!/FROM mcr\.microsoft\.com\/playwright:v\$\{PLAYWRIGHT_VERSION\}-noble/.test(dockerfile)) {
    die(2, 'Dockerfile 的 FROM 必须引用 ${PLAYWRIGHT_VERSION} 变量（版本单源，specs §4）');
  }
  const m = dockerfile.match(/^ARG PLAYWRIGHT_VERSION=(\S+)/m);
  if (!m) die(2, 'Dockerfile 未找到 ARG PLAYWRIGHT_VERSION 默认值');
  return m[1];
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildImage(version) {
  const tag = `spinth-visual:${version}`;
  let needBuild = MODE.rebuild;
  if (!needBuild) {
    try {
      sh('docker', ['image', 'inspect', tag], { capture: true });
    } catch {
      needBuild = true;
    }
  }
  if (!needBuild) {
    log(`镜像已存在：${tag}（--rebuild 可强制重建）`);
    return tag;
  }
  log(`构建镜像 ${tag}（linux/amd64，fonts-noto-cjk=${NOTO_CJK_VERSION}）……`);
  // 可选构建代理（本地弱网环境）：VISUAL_LINUX_PROXY 只影响 build-arg 与容器
  // env，不写入镜像配置；localhost 固定 no_proxy（webServer 就绪探测不走代理）
  const proxyArgs = [];
  if (PROXY)
    proxyArgs.push(
      '--build-arg',
      `http_proxy=${PROXY}`,
      '--build-arg',
      `https_proxy=${PROXY}`,
      '--build-arg',
      'no_proxy=localhost,127.0.0.1',
    );
  try {
    sh('docker', [
      'build',
      '--platform',
      'linux/amd64',
      '-f',
      'docker/visual.Dockerfile',
      '--build-arg',
      `PLAYWRIGHT_VERSION=${version}`,
      '--build-arg',
      `NOTO_CJK_VERSION=${NOTO_CJK_VERSION}`,
      ...proxyArgs,
      '-t',
      tag,
      'docker/',
    ]);
  } catch {
    die(2, '镜像构建失败（构建期 fc 断言或网络问题）——详见上方 docker 输出');
  }
  return tag;
}

function rsyncWork() {
  fs.mkdirSync(WORK_SRC, { recursive: true });
  sh('rsync', [
    '-a',
    '--delete',
    '--exclude',
    'node_modules',
    '--exclude',
    'dist',
    '--exclude',
    '.git',
    '--exclude',
    'test-results',
    '--exclude',
    'playwright-report',
    '--exclude',
    'coverage',
    '--exclude',
    '.cache',
    './',
    `${WORK_SRC}/`,
  ]);
}

function chownVolumes(tag) {
  // docker volume 初建属 root；只 chown 顶层让非 root 用户可写（不走 -R，store 大时递归太慢）
  sh('docker', [
    'run',
    '--rm',
    '-v',
    `${STORE_VOLUME}:/s`,
    '-v',
    `${COREPACK_VOLUME}:/c`,
    tag,
    'chown',
    `${process.getuid()}:${process.getgid()}`,
    '/s',
    '/c',
  ]);
}

function containerCreate(name, tag) {
  const runArgs = [
    'run',
    '-d',
    '--name',
    name,
    '--platform',
    'linux/amd64',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '-v',
    `${STORE_VOLUME}:/work/store`,
    '-v',
    `${COREPACK_VOLUME}:/work/corepack`,
    '-e',
    'HOME=/tmp/home',
    '-e',
    'COREPACK_HOME=/work/corepack',
  ];
  if (PROXY) {
    // corepack/pnpm 走代理加速；localhost 除外（playwright webServer 就绪探测）
    runArgs.push(
      '-e',
      `http_proxy=${PROXY}`,
      '-e',
      `https_proxy=${PROXY}`,
      '-e',
      'no_proxy=localhost,127.0.0.1',
      '-e',
      `HTTP_PROXY=${PROXY}`,
      '-e',
      `HTTPS_PROXY=${PROXY}`,
      '-e',
      'NO_PROXY=localhost,127.0.0.1',
    );
  }
  runArgs.push(tag, 'sleep', 'infinity');
  sh('docker', runArgs);
  sh('docker', ['exec', '-u', '0:0', name, 'mkdir', '-p', '/work/src', '/tmp/home']);
  sh('docker', [
    'exec',
    '-u',
    '0:0',
    name,
    'chown',
    `${process.getuid()}:${process.getgid()}`,
    '/work/src',
    '/tmp/home',
  ]);
  log(`拷入源码副本 → ${name}:/work/src ……`);
  sh('docker', ['cp', `${WORK_SRC}/.`, `${name}:/work/src`]);
}

function execIn(name, script, env = {}) {
  const args = ['exec', '-w', '/work/src'];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(name, 'bash', '-lc', script);
  return sh('docker', args, { capture: true });
}

function makeCleanup(name) {
  return () => {
    if (MODE.debug) {
      log(`--debug：保留容器 ${name}（手动清理：docker rm -f ${name}）`);
    } else {
      try {
        sh('docker', ['rm', '-f', name], { capture: true });
      } catch {
        /* 清理失败不掩盖主结果 */
      }
    }
  };
}

/** 尾部输出摘要（playwright 结果行；失败时给足排障信息而不刷屏） */
function tailOf(text, lines = 15) {
  return String(text).trimEnd().split('\n').slice(-lines).join('\n');
}

async function main() {
  if (process.platform === 'win32') die(2, 'Windows 宿主不支持（基线只维护 darwin/linux）');
  const started = Date.now();
  const pkgVersion = readPlaywrightVersion();
  const dfVersion = readDockerfileVersion();
  if (pkgVersion !== dfVersion) {
    die(
      2,
      `版本契约失败：package.json=${pkgVersion}，Dockerfile base=${dfVersion}——`,
      '版本升级必须原子完成（specs §5.1 / 附录 C），不允许只改一处',
    );
  }
  if (NOTO_CJK_VERSION.startsWith('__')) {
    die(
      2,
      'NOTO_CJK_VERSION 未固化：先在基础镜像里 apt-cache policy fonts-noto-cjk 取值写死（specs §5.1）',
    );
  }
  try {
    sh('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true });
  } catch {
    die(2, 'docker daemon 不可用——本地需先启动容器运行时（如 colima start）');
  }

  const tag = buildImage(pkgVersion);
  rsyncWork();
  chownVolumes(tag);

  if (MODE.stability) {
    await runStability(tag, pkgVersion);
  } else {
    const code = await runOnce(tag, pkgVersion, { update: MODE.update });
    if (code !== 0) process.exitCode = code;
  }
  log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`);
}

/** 容器内依赖安装（corepack 由镜像内 node 24 自带；shim 装进 HOME/bin 供 webServer 用 pnpm） */
function installDeps(name) {
  log('容器内 pnpm install（store 走持久卷）……');
  try {
    const out = execIn(
      name,
      [
        'set -e',
        'mkdir -p "$HOME/bin"',
        'corepack enable --install-directory "$HOME/bin"',
        'corepack pnpm install --frozen-lockfile --store-dir /work/store',
      ].join('\n'),
    );
    console.log(tailOf(out, 4));
  } catch (err) {
    console.error(tailOf(String(err.stdout ?? '') + String(err.stderr ?? ''), 30));
    die(2, '容器内依赖安装失败（网络或 lockfile 问题）');
  }
}

/** 预检四关（specs §5.5）：node 主版本 / playwright 版本 ×2 / CJK 字体 */
function preflight(name, pkgVersion) {
  log('预检（specs §5.5）……');
  const out = execIn(
    name,
    [
      'set -e',
      `node_major=$(node -p 'process.versions.node.split(".")[0]')`,
      'test "$node_major" = "24" || { echo "node=$node_major"; exit 21; }',
      `pw_ver=$(corepack pnpm exec playwright --version | grep -oE '[0-9][0-9.]+' | head -1)`,
      `test "$pw_ver" = "${pkgVersion}" || { echo "playwright=$pw_ver"; exit 22; }`,
      `dep_ver=$(node -p 'require("/work/src/node_modules/@playwright/test/package.json").version')`,
      `test "$dep_ver" = "${pkgVersion}" || { echo "dep=$dep_ver"; exit 23; }`,
      'fc_match=$(fc-match sans-serif)',
      `echo "$fc_match" | grep -q 'Noto Sans CJK SC' || { echo "fc-match=$fc_match"; exit 24; }`,
      `zh=$(fc-list :lang=zh family | grep 'Noto Sans CJK SC' | head -1)`,
      'test -n "$zh" || exit 25',
      'echo "node=$(node -v) playwright=$pw_ver fc-match=$fc_match zh=$zh"',
    ].join('\n'),
  ).trim();
  log(`预检通过：${out.split('\n').pop()}`);
}

/** 运行 @visual。返回 0/1/2（2 = 环境断言失败，1 = 视觉比较失败） */
// 失败现场导出：CI（specs §8）与本地排查都从 last-failure/ 取 expected/actual/diff
function exportFailure(name) {
  const dest = path.join(CACHE, 'last-failure');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const dir of ['test-results', 'playwright-report']) {
    try {
      sh('docker', ['cp', `${name}:/work/src/${dir}`, path.join(dest, dir)], {
        capture: true,
      });
      log(`失败现场已导出：${dir}/ → .cache/visual-linux/last-failure/`);
    } catch {
      // 目录不存在（失败发生在报告生成前）则跳过
    }
  }
}

function playwrightRun(name, update) {
  log(update ? '生成基线（--update-snapshots）……' : '校验基线……');
  const script = [
    'set -e',
    'export PATH="$HOME/bin:$PATH"',
    `corepack pnpm exec playwright test --grep @visual --workers=1 --retries=0${update ? ' --update-snapshots' : ''}`,
  ].join('\n');
  try {
    const out = execIn(name, script, { CI: '1', E2E_VISUAL_CHANNEL: 'bundled' });
    console.log(tailOf(out, 6));
    log(update ? '生成轮通过' : '校验通过');
    return 0;
  } catch (err) {
    const out = String(err.stdout ?? '') + String(err.stderr ?? '');
    console.error(tailOf(out, 40));
    exportFailure(name);
    if (out.includes('视觉环境断言失败')) {
      console.error(
        '[visual-linux] 环境断言失败（WebGL/DPR/字体）——检查容器 flags（specs §5.4–§5.5）',
      );
      return 2;
    }
    console.error(
      '[visual-linux] playwright 视觉比较失败——diff 见上方输出（--debug 可保留容器现场）',
    );
    return 1;
  }
}

/**
 * 单轮容器运行。update=false 纯校验；update=true 生成并回写基线后以宿主状态复验。
 * 返回退出码（0/1/2/3）。
 */
async function runOnce(tag, pkgVersion, { update }) {
  const name = `spinth-visual-${update ? 'update' : 'verify'}-${Date.now()}`;
  containerCreate(name, tag);
  const cleanup = makeCleanup(name);
  const fail = (code, ...msgs) => {
    cleanup();
    die(code, ...msgs);
  };
  try {
    installDeps(name);
    preflight(name, pkgVersion);
    const runCode = playwrightRun(name, update);
    if (runCode !== 0) return runCode;
    if (!update) {
      printPngHashes(path.join(WORK_SRC, SNAPSHOTS_REL), 'linux');
      return 0;
    }

    // ---- update：回写 5 张 -linux.png，再以宿主状态复验（specs §7.2 step 8）----
    const hostSnap = path.join(ROOT, SNAPSHOTS_REL);
    const staged = path.join(CACHE, 'update-staged');
    fs.rmSync(staged, { recursive: true, force: true });
    fs.mkdirSync(staged, { recursive: true });
    sh('docker', ['cp', `${name}:${path.posix.join('/work/src', SNAPSHOTS_REL)}/.`, `${staged}/`]);
    const linuxPngs = fs.readdirSync(staged).filter((f) => f.endsWith('-linux.png'));
    if (linuxPngs.length !== 5) {
      fail(3, `update 产物异常：期望 5 张 -linux.png，实际 ${linuxPngs.length} 张`);
    }
    const trackedBefore = new Map(
      linuxPngs.map((f) => {
        try {
          sh('git', ['ls-files', '--error-unmatch', path.join(SNAPSHOTS_REL, f)], {
            capture: true,
          });
          return [f, 'tracked'];
        } catch {
          return [f, 'new'];
        }
      }),
    );
    for (const f of linuxPngs) fs.copyFileSync(path.join(staged, f), path.join(hostSnap, f));
    log(`已回写 ${linuxPngs.length} 张基线到 ${SNAPSHOTS_REL}/，开始复验……`);

    // 复验用全新 work + 新容器：确保读的是宿主回写后的基线
    rsyncWork();
    const verifyName = `spinth-visual-reverify-${Date.now()}`;
    containerCreate(verifyName, tag);
    const verifyCleanup = makeCleanup(verifyName);
    try {
      installDeps(verifyName);
      preflight(verifyName, pkgVersion);
      if (playwrightRun(verifyName, false) !== 0) {
        for (const [f, state] of trackedBefore) {
          const target = path.join(hostSnap, f);
          if (state === 'tracked') sh('git', ['checkout', '--', target]);
          else fs.rmSync(target, { force: true });
        }
        fail(3, '复验失败：已回滚本次回写的基线——先排查环境或截图稳定性，再重试 update');
      }
    } finally {
      verifyCleanup();
    }

    writeArtifact(pkgVersion);
    printPngHashes(hostSnap, 'linux');
    log('update 完成：人工审图（3 张含中文）后方可提交（specs §9 纪律）');
    return 0;
  } finally {
    cleanup();
  }
}

async function runStability(tag, pkgVersion) {
  const rounds = {};
  for (const round of [1, 2]) {
    log(`── stability 第 ${round}/2 轮（fresh work + 新容器）──`);
    rsyncWork();
    const name = `spinth-visual-stab${round}-${Date.now()}`;
    containerCreate(name, tag);
    const cleanup = makeCleanup(name);
    const outDir = path.join(CACHE, 'stability', `round${round}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    try {
      installDeps(name);
      preflight(name, pkgVersion);
      const code = playwrightRun(name, true);
      if (code !== 0) {
        cleanup();
        die(code === 2 ? 2 : 1, `stability 第 ${round} 轮失败`);
      }
      fs.mkdirSync(outDir, { recursive: true });
      sh('docker', [
        'cp',
        `${name}:${path.posix.join('/work/src', SNAPSHOTS_REL)}/.`,
        `${outDir}/`,
      ]);
      rounds[round] = printPngHashes(outDir, 'linux');
    } finally {
      cleanup();
    }
  }
  const files = Object.keys(rounds[1]);
  const mismatch = files.filter((f) => rounds[1][f] !== rounds[2][f]);
  if (mismatch.length > 0) {
    for (const f of mismatch) {
      console.error(`[visual-linux] SHA-256 不一致 ${f}：`);
      console.error(`  round1=${rounds[1][f]}`);
      console.error(`  round2=${rounds[2][f]}`);
    }
    die(
      3,
      `两次生成 ${mismatch.length} 张不一致——产物保留在 .cache/visual-linux/stability/，`,
      '按 specs §10.3 排查（不得提交基线）',
    );
  }
  log(`stability 通过：${files.length} 张 SHA-256 逐字节全等`);
}

function printPngHashes(dir, platform) {
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

/** CI update 模式的可审计产物（specs §8.2）：PNG + environment.txt + sha256sum.txt */
function writeArtifact(pkgVersion) {
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
  const imageId = sh(
    'docker',
    ['image', 'inspect', `spinth-visual:${pkgVersion}`, '--format', '{{.Id}}'],
    {
      capture: true,
    },
  ).trim();
  fs.writeFileSync(
    path.join(dir, 'environment.txt'),
    [
      `playwright=${pkgVersion}`,
      `noto_cjk=${NOTO_CJK_VERSION}`,
      `image=${imageId}`,
      `git=${gitSha || '(unknown)'}`,
      ...lines,
      '',
    ].join('\n'),
  );
  log(`update 产物已写入 ${path.relative(ROOT, dir)}/（PNG + environment.txt + sha256sum.txt）`);
}
