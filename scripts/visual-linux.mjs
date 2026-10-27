#!/usr/bin/env node
/* global process, console */

/**
 * Linux 视觉基线执行器入口（specs/linux-visual §7）。
 *
 * 在固定容器环境（docker/visual.Dockerfile，官方 Playwright 镜像 + Noto Sans CJK SC）
 * 里安装、预检并运行 @visual 用例，校验/生成全部 -linux.png 基线（数量由
 * visual.spec.ts 的快照名称推导）。宿主源码只读（work 是副本）；只有 update
 * 模式把 PNG 显式复制回基线目录。
 *
 * 源码用 docker cp 拷入容器本地 fs 而非卷挂载：macOS 容器运行时的卷透传
 * 对 vite 冷启动是 IO 瓶颈，拷贝编排与挂载语义等价（specs §14.5 偏差记录）。
 *
 * 模块拆分（scripts/visual-linux/）：config 常量与模式 / util 子进程与清理 /
 * docker 镜像与容器编排 / run 安装预检与执行 / artifact 产物与审计 /
 * stems 基线清单单源。
 *
 * 用法：
 *   pnpm visual:linux                 构建镜像（如需）+ 校验当前 Linux 基线
 *   pnpm visual:linux --update        生成并回写基线，随后立即复验
 *   pnpm visual:linux --stability     两次独立生成比对 SHA-256（不写宿主基线）
 *   pnpm visual:linux --rebuild       强制重建镜像
 *   pnpm visual:linux --debug         保留容器与工作区、打印完整输出
 *
 * 退出码（specs §7.4）：0 通过；1 视觉比较失败；2 环境/预检失败；3 基线/护栏失败。
 */

import { MODE, NOTO_CJK_VERSION } from './visual-linux/config.mjs';
import {
  buildImage,
  chownVolumes,
  readDockerfileVersion,
  readPlaywrightVersion,
  rsyncWork,
} from './visual-linux/docker.mjs';
import { runOnce, runStability } from './visual-linux/run.mjs';
import { die, log, sh } from './visual-linux/util.mjs';

if (MODE.update && MODE.stability) {
  console.error('[visual-linux] --update 与 --stability 互斥');
  process.exitCode = 2;
} else {
  await main();
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
  try {
    sh('rsync', ['--version'], { capture: true });
  } catch {
    die(2, '宿主缺 rsync（源码副本同步依赖）——Linux 发行版用包管理器安装');
  }
  if (MODE.update) {
    log('update 模式：提交前须先过 --stability 双跑全等（specs §10.3 仪式，本命令不强制）');
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
