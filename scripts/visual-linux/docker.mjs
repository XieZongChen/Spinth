/* global process */

/**
 * Docker 编排层：版本契约、镜像构建（环境指纹 tag）、work 副本同步、
 * 容器生命周期（创建/exec/清理注册）。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COREPACK_VOLUME,
  DOCKERFILE,
  MODE,
  NOTO_CJK_VERSION,
  PROXY,
  ROOT,
  STORE_VOLUME,
  WORK_SRC,
} from './config.mjs';
import { CLEANUPS, die, log, sh } from './util.mjs';

export function readPlaywrightVersion() {
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

export function readDockerfileVersion() {
  // Dockerfile 用 ARG 变量引用 base tag（构建时由脚本显式注入），版本核对读
  // ARG 默认值——它必须与 package.json 一致；FROM 未引用变量也未 digest pin 则拒绝
  const dockerfile = fs.readFileSync(DOCKERFILE, 'utf8');
  const usesVar = /FROM mcr\.microsoft\.com\/playwright:v\$\{PLAYWRIGHT_VERSION\}-noble/.test(
    dockerfile,
  );
  const usesDigest = /FROM mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}/.test(dockerfile);
  if (!usesVar && !usesDigest) {
    die(
      2,
      'Dockerfile 的 FROM 必须引用 ${PLAYWRIGHT_VERSION} 变量或 digest pin（版本单源，specs §4）',
    );
  }
  const m = dockerfile.match(/^ARG PLAYWRIGHT_VERSION=(\S+)/m);
  if (!m) die(2, 'Dockerfile 未找到 ARG PLAYWRIGHT_VERSION 默认值');
  return m[1];
}

/** 环境指纹：字体版本 + Dockerfile + fonts.conf 任一变动 → 新 tag → 自动重建 */
function imageFingerprint() {
  const parts = [
    NOTO_CJK_VERSION,
    fs.readFileSync(DOCKERFILE, 'utf8'),
    fs.readFileSync(path.join(ROOT, 'docker', 'visual-fonts.conf'), 'utf8'),
  ];
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12);
}

export function buildImage(version) {
  const tag = `spinth-visual:${version}-${imageFingerprint()}`;
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

export function rsyncWork() {
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

/**
 * 生成轮前置：删掉 work 副本带入的旧 `-linux.png`（保留 darwin）。
 * rsync 会把宿主已提交的 linux 基线带进容器——若某用例被 skip，旧图会顶替
 * 「本轮应生成」的产物，集合/计数断言与双跑哈希全部假绿。清空后容器内
 * 只会留下本轮真实生成的文件，skip 即缺张，断言才能红。
 * 只用于 update/stability 生成轮；校验轮与 update 复验轮需要宿主基线，禁止调用。
 */
export function stripLinuxBaselines() {
  const snapDir = path.join(WORK_SRC, 'packages/app/e2e/visual.spec.ts-snapshots');
  if (!fs.existsSync(snapDir)) return;
  for (const f of fs.readdirSync(snapDir)) {
    if (f.endsWith('-linux.png')) fs.rmSync(path.join(snapDir, f));
  }
}

export function chownVolumes(tag) {
  // docker volume 初建属 root；只 chown 顶层让非 root 用户可写（不走 -R，store 大时递归太慢）
  sh('docker', [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
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

export function containerCreate(name, tag) {
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

export function execIn(name, script, env = {}) {
  const args = ['exec', '-w', '/work/src'];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(name, 'bash', '-lc', script);
  return sh('docker', args, { capture: true });
}

export function makeCleanup(name) {
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    const i = CLEANUPS.indexOf(cleanup);
    if (i >= 0) CLEANUPS.splice(i, 1);
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
  CLEANUPS.push(cleanup);
  return cleanup;
}
