/* global process */

/**
 * Linux 视觉基线执行器的共享常量与 CLI 模式（scripts/visual-linux.mjs 入口）。
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CACHE = path.join(ROOT, '.cache', 'visual-linux');
const WORK_SRC = path.join(CACHE, 'work', 'src');
const SPEC = path.join(ROOT, 'packages/app/e2e/visual.spec.ts');
const SNAPSHOTS_REL = 'packages/app/e2e/visual.spec.ts-snapshots';
const DOCKERFILE = path.join(ROOT, 'docker', 'visual.Dockerfile');
const STORE_VOLUME = 'spinth-visual-store';

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

export {
  ROOT,
  CACHE,
  WORK_SRC,
  SPEC,
  SNAPSHOTS_REL,
  DOCKERFILE,
  STORE_VOLUME,
  NOTO_CJK_VERSION,
  PROXY,
  MODE,
};
