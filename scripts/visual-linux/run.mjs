/* global console */

/**
 * 运行层：容器内安装/预检、@visual 执行、失败现场导出、
 * 单轮校验或生成（runOnce）与双跑稳定性（runStability）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ROOT, SNAPSHOTS_REL, SPEC, WORK_SRC } from './config.mjs';
import {
  containerCreate,
  execIn,
  makeCleanup,
  readPnpmVersion,
  rsyncWork,
  stripLinuxBaselines,
} from './docker.mjs';
import { collectEnvironment, printPngHashes, writeArtifact } from './artifact.mjs';
import { extractVisualStems } from './stems.mjs';
import { die, log, registerCleanup, sh, tailOf, unregisterCleanup } from './util.mjs';

// 镜像内 pnpm 版本单源（根 package.json 的 packageManager）：installDeps 的
// 工具链预检按它等值断言（exit 26）
const PNPM_VERSION = readPnpmVersion();

/** 镜像内 Node 大版本期望（随 pinned digest 固定）：工具链预检与预检四关共用
 *  同一常量，换 digest 必须改这里并复核渲染字节（等值断言，不放宽） */
const NODE_MAJOR = '26';

/** 工具链预检：装依赖之前先证镜像内 node 主版本 = NODE_MAJOR、pnpm 在位且
 *  版本等于 package.json 的 packageManager（pnpm bake 进镜像层；base 的
 *  Node ≥25 无 corepack，此前「corepack: command not found」被误报为网络
 *  问题即由此缺）。容器内断言不符即 exit 26，宿主 CLI 统一 die(2) 并打印
 *  该断言输出；与预检四关 21–25 的语义连续 */
export function probeToolchain(name, pnpmVersion) {
  log('工具链预检（node / pnpm）……');
  try {
    const out = execIn(
      name,
      [
        'set -e',
        'node -v',
        `node_major=$(node -p 'process.versions.node.split(".")[0]')`,
        `test "$node_major" = "${NODE_MAJOR}" || { echo "node=$node_major want=${NODE_MAJOR}"; exit 26; }`,
        'pnpm -v',
        `test "$(pnpm -v)" = "${pnpmVersion}" || { echo "pnpm=$(pnpm -v) want=${pnpmVersion}"; exit 26; }`,
      ].join('\n'),
    ).trim();
    log(`工具链预检通过：${out.split('\n').join(' / ')}`);
  } catch (err) {
    console.error(tailOf(String(err.stdout ?? '') + String(err.stderr ?? ''), 30));
    die(
      2,
      '容器内工具链预检失败（node/pnpm 缺失或版本不符）——检查 docker/visual.Dockerfile 的 pnpm 安装层',
    );
  }
}

/** 容器内依赖安装（pnpm 已 bake 进镜像层，全局可执行；store 走持久卷）。
 *  首行工具链预检在 try 之外：工具链缺失 ≠ 安装失败，归因不能混 */
export function installDeps(name, pnpmVersion) {
  probeToolchain(name, pnpmVersion);
  log('容器内 pnpm install（store 走持久卷）……');
  try {
    const out = execIn(
      name,
      ['set -e', 'pnpm install --frozen-lockfile --store-dir /work/store'].join('\n'),
    );
    console.log(tailOf(out, 4));
  } catch (err) {
    const tail = tailOf(String(err.stdout ?? '') + String(err.stderr ?? ''), 30);
    console.error(tail);
    const lastLine = tail.trim().split('\n').pop() ?? '';
    die(
      2,
      /command not found|not found in \$PATH/i.test(lastLine)
        ? `容器内工具链缺失（${lastLine}）——检查 docker/visual.Dockerfile 的 pnpm 安装层`
        : `容器内依赖安装失败：${lastLine}`,
    );
  }
}

/** 预检四关（specs §5.5）：node 主版本 / playwright 版本 ×2 / CJK 字体。
 *  node 大版本期望取自 NODE_MAJOR（随 pinned digest 固定）；工具链预检已在装
 *  依赖前拦过一次，这里是同一期望的第二道等值断言（不放宽） */
export function preflight(name, pkgVersion) {
  log('预检（specs §5.5）……');
  const out = execIn(
    name,
    [
      'set -e',
      `node_major=$(node -p 'process.versions.node.split(".")[0]')`,
      `test "$node_major" = "${NODE_MAJOR}" || { echo "node=$node_major want=${NODE_MAJOR}"; exit 21; }`,
      `pw_ver=$(pnpm exec playwright --version | grep -oE '[0-9][0-9.]+' | head -1)`,
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

/** 运行 @visual。返回 0/1/2（2 = 环境断言失败，1 = 视觉比较失败） */
export function playwrightRun(name, update) {
  log(update ? '生成基线（--update-snapshots）……' : '校验基线……');
  const script = [
    'set -e',
    `pnpm exec playwright test --grep @visual --workers=1 --retries=0${update ? ' --update-snapshots' : ''}`,
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
export async function runOnce(tag, pkgVersion, { update }) {
  // 生成轮前置：清掉 work 副本带入的旧 linux 基线（见 docker.mjs 注释）；
  // 校验轮与后续复验轮需要宿主基线，不 strip
  if (update) stripLinuxBaselines();
  const name = `spinth-visual-${update ? 'update' : 'verify'}-${Date.now()}`;
  containerCreate(name, tag);
  const cleanup = makeCleanup(name);
  const fail = (code, ...msgs) => {
    cleanup();
    die(code, ...msgs);
  };
  try {
    installDeps(name, PNPM_VERSION);
    preflight(name, pkgVersion);
    const runCode = playwrightRun(name, update);
    if (runCode !== 0) return runCode;
    if (!update) {
      printPngHashes(path.join(WORK_SRC, SNAPSHOTS_REL), 'linux');
      return 0;
    }

    // ---- update：回写全部 -linux.png，再以宿主状态复验（specs §7.2 step 8）----
    const hostSnap = path.join(ROOT, SNAPSHOTS_REL);
    const staged = path.join(CACHE, 'update-staged');
    fs.rmSync(staged, { recursive: true, force: true });
    fs.mkdirSync(staged, { recursive: true });
    sh('docker', ['cp', `${name}:${path.posix.join('/work/src', SNAPSHOTS_REL)}/.`, `${staged}/`]);
    const linuxPngs = fs.readdirSync(staged).filter((f) => f.endsWith('-linux.png'));
    const { stems, error: stemsError } = extractVisualStems(SPEC);
    if (stemsError) fail(3, stemsError);
    const expectedCount = stems.length;
    if (linuxPngs.length !== expectedCount) {
      fail(3, `update 产物异常：期望 ${expectedCount} 张 -linux.png，实际 ${linuxPngs.length} 张`);
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

    // 回写后任何一步失败（copy 自身 / rsync / 复验容器 / 安装预检 / 环境采集 /
    // artifact）都回滚宿主基线；rollback 同时注册进 CLEANUPS，installDeps/
    // preflight 的 die 也能触发，不允许「基线已改而产物/复验缺失」的半成品。
    let rolledBack = false;
    const rollback = () => {
      if (rolledBack) return;
      rolledBack = true;
      for (const [f, state] of trackedBefore) {
        const target = path.join(hostSnap, f);
        try {
          if (state === 'tracked') sh('git', ['checkout', '--', target]);
          else fs.rmSync(target, { force: true });
        } catch (err) {
          console.error(
            `[visual-linux] 回滚失败 ${f}：${String(err?.message ?? err)}（请人工检查 git status）`,
          );
        }
      }
    };
    registerCleanup(rollback);

    try {
      for (const f of linuxPngs) fs.copyFileSync(path.join(staged, f), path.join(hostSnap, f));
      log(`已回写 ${linuxPngs.length} 张基线到 ${SNAPSHOTS_REL}/，开始复验……`);

      // 复验用全新 work + 新容器：确保读的是宿主回写后的基线
      rsyncWork();
      const verifyName = `spinth-visual-reverify-${Date.now()}`;
      containerCreate(verifyName, tag);
      const verifyCleanup = makeCleanup(verifyName);
      let env;
      try {
        installDeps(verifyName, PNPM_VERSION);
        preflight(verifyName, pkgVersion);
        if (playwrightRun(verifyName, false) !== 0) {
          fail(3, '复验失败：已回滚本次回写的基线——先排查环境或截图稳定性，再重试 update');
        }
        env = collectEnvironment(verifyName);
      } finally {
        verifyCleanup();
      }

      writeArtifact(tag, pkgVersion, env);
      printPngHashes(hostSnap, 'linux');
      log('update 完成：人工审图（3 张含中文）后方可提交（specs §9 纪律）');
      unregisterCleanup(rollback);
      return 0;
    } catch (err) {
      rollback();
      die(3, `update 失败：已回滚本次回写的基线（${String(err?.message ?? err)}）`);
    }
  } finally {
    cleanup();
  }
}

export async function runStability(tag, pkgVersion) {
  const { stems, error } = extractVisualStems(SPEC);
  if (error) die(3, error);
  const expected = stems.map((s) => `${s}-linux.png`).sort();
  const rounds = {};
  for (const round of [1, 2]) {
    log(`── stability 第 ${round}/2 轮（fresh work + 新容器）──`);
    rsyncWork();
    stripLinuxBaselines(); // 生成轮：容器内只留本轮真实产物（skip 即缺张）
    const name = `spinth-visual-stab${round}-${Date.now()}`;
    containerCreate(name, tag);
    const cleanup = makeCleanup(name);
    const outDir = path.join(CACHE, 'stability', `round${round}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    try {
      installDeps(name, PNPM_VERSION);
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
  // 集合断言：两轮产物恰好覆盖 spec 全部 stem——防用例被 skip 时少比一张也绿
  for (const round of [1, 2]) {
    const names = Object.keys(rounds[round]).sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      die(
        3,
        `第 ${round} 轮产物集合与 spec 不符（期望 ${expected.length} 张：${expected.join(', ')}；`,
        `实际 ${names.length} 张：${names.join(', ') || '(空)'}）——检查是否有用例被 skip`,
      );
    }
  }
  const mismatch = expected.filter((f) => rounds[1][f] !== rounds[2][f]);
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
  log(`stability 通过：${expected.length} 张 SHA-256 逐字节全等`);
}
