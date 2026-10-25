import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { buildPrecacheManifest, type IPrecacheFile } from './src/pwa/precacheManifest';

/**
 * SW 构建（specs/pwa.md D13，两步构建的第二步）：扫 dist 实算预缓存清单，
 * `define` 注入 sw.js，并在包根写侧车 `.sw-manifest.json` 供 check-pages-build
 * 校验（纯 Node 脚本不能 import TS，侧车免复制算法，D5）。
 * 顺序铁律：主构建（vite build）先产出 dist，本配置启动时缺 index.html 直接抛错
 * ——禁止产出「没有 SW 的绿色构建」。SW 运行时 base 从自身脚本位置推导（§6.1），
 * 本配置不注入 base。
 */

const DIST_DIR = fileURLToPath(new URL('./dist', import.meta.url));

/** 递归收集 dist 全量文件（'/' 分隔相对路径；跳过 dotfile）。 */
function listDistFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listDistFiles(full, out);
    else out.push(relative(DIST_DIR, full).split('\\').join('/'));
  }
  return out;
}

if (!existsSync(join(DIST_DIR, 'index.html'))) {
  throw new Error(
    '[vite.sw] 缺少 dist/index.html——请先运行主构建（vite build），SW 构建必须在主构建之后（specs/pwa.md D13）',
  );
}

const files: IPrecacheFile[] = listDistFiles(DIST_DIR).map((rel) => ({
  url: rel,
  sha256: createHash('sha256')
    .update(readFileSync(join(DIST_DIR, rel)))
    .digest('hex'),
  size: statSync(join(DIST_DIR, rel)).size,
}));
const manifest = buildPrecacheManifest(files, (s) => createHash('sha256').update(s).digest('hex'));

function writeSidecar(): Plugin {
  const sidecarPath = fileURLToPath(new URL('./.sw-manifest.json', import.meta.url));
  return {
    name: 'spinth-sw-manifest-sidecar',
    closeBundle() {
      writeFileSync(sidecarPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  // SW 不产出 html/asset URL，base 不参与；publicDir 禁止二次拷贝
  publicDir: false,
  plugins: [writeSidecar()],
  define: {
    __SPINTH_PRECACHE__: JSON.stringify(manifest),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/pwa/sw/sw.ts', import.meta.url)),
      formats: ['iife'],
      name: 'spinthSw',
      fileName: () => 'sw.js',
    },
  },
});
