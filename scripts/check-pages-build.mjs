#!/usr/bin/env node
/* global process, console */
/**
 * Pages 子路径构建校验：SPINTH_BASE 构建产物必须全量带 base 前缀。
 * Vite 会重写 index.html 的 assets/favicon/worker 引用，但不会重写 JS 字符串
 * ——运行时路径已收口到 packages/app/src/siteBase.ts，本脚本守住两类回归：
 * index.html 前缀丢失（base 未生效）、JS 重新出现写死根路径。
 * PWA 断言（specs/pwa.md §7.2）：sw.js 产物、manifest link、SW 注册路径、
 * 侧车清单与 dist 双向一致、版本内嵌、预缓存预算。
 * 用法：node scripts/check-pages-build.mjs [distDir] <base>
 *   distDir 默认 packages/app/dist；base 必填且不为 '/'（根路径无需校验），
 *   自动补首尾斜杠，与 vite.config.ts 的 resolveBase 规则一致。
 * 退出码：0 通过；1 校验失败；2 参数非法。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

function normalizeBase(raw) {
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

// ---- D4 排除规则副本：与 packages/app/src/pwa/precacheManifest.ts 保持同步 ----
// （校验脚本是纯 Node，不能 import TS；两份规则任何一侧改动都要同步另一侧）
const LATIN_WOFF2 = /-latin-(?!ext)/;
function isPrecacheExcluded(relPath) {
  if (relPath === 'sw.js' || relPath === 'spinth-logo.png') return true;
  if (relPath.endsWith('.map')) return true;
  if (relPath.endsWith('.woff2')) return !LATIN_WOFF2.test(relPath);
  return false;
}

function walkDist(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkDist(full, root, out);
    else out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

const PRECACHE_BUDGET_BYTES = 3 * 1024 * 1024;

function main(distDir, rawBase) {
  const base = normalizeBase(rawBase.trim());
  if (base === '/') {
    console.error('[pages] base 不能为 /（根路径部署无需本校验）');
    process.exitCode = 2;
    return;
  }

  const failures = [];
  const fail = (msg) => failures.push(msg);

  const htmlPath = join(distDir, 'index.html');
  let html = '';
  if (!existsSync(htmlPath)) {
    fail(`缺少 ${htmlPath}——请先 SPINTH_BASE=... pnpm build`);
  } else {
    html = readFileSync(htmlPath, 'utf8');
    if (!html.includes(`${base}assets/`))
      fail(`index.html 资源引用未带 base（期望 ${base}assets/）`);
    if (!html.includes(`${base}favicon-32.png`))
      fail(`index.html favicon 未带 base（期望 ${base}favicon-32.png）`);
    if (!html.includes('http-equiv="Content-Security-Policy"'))
      fail('index.html 缺少 CSP meta（cspInject 未生效）');
    if (html.includes('src="/assets/')) fail('index.html 存在未加 base 的 src="/assets/…"');
    if (html.includes('href="/assets/')) fail('index.html 存在未加 base 的 href="/assets/…"');
    if (html.includes('href="/favicon-32.png"')) fail('index.html favicon 写死根路径');
    // PWA：manifest link 必须带 base（Vite 对 link[rel=manifest] 的 base 重写）
    if (!html.includes(`href="${base}manifest.webmanifest"`))
      fail(`index.html manifest link 未带 base（期望 href="${base}manifest.webmanifest"）`);
  }

  const assetsDir = join(distDir, 'assets');
  const jsFiles = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
    : [];
  if (jsFiles.length === 0) fail(`缺少 ${assetsDir}/*.js 产物`);
  // 引号边界（单/双/反引号开头）匹配字符串字面量起始，避免误伤带 base 的拼接结果
  const rootAssetLiteral = /["'`]\/spinth-mark\.png/;
  const rootDocLiteral = /["'`]\/\?doc=/;
  const rootWorkerLiteral = /new Worker\(new URL\(["']\/assets\/compactWorker-/;
  // PWA：SW 注册 URL 不得写死根路径（必须经 publicAsset() 拼 base，specs/pwa D3）
  const rootSwLiteral = /["'`]\/sw\.js/;
  for (const f of jsFiles) {
    const code = readFileSync(join(assetsDir, f), 'utf8');
    if (rootAssetLiteral.test(code)) fail(`assets/${f}: JS 写死根路径 /spinth-mark.png`);
    if (rootDocLiteral.test(code)) fail(`assets/${f}: JS 写死根路径 /?doc=`);
    if (rootWorkerLiteral.test(code)) fail(`assets/${f}: worker URL 写死根路径`);
    if (rootSwLiteral.test(code)) fail(`assets/${f}: SW 注册 URL 写死根路径 /sw.js`);
  }

  // ---- PWA 产物与侧车（specs/pwa.md §7.2 断言 1/3/4/5/6）----
  const swPath = join(distDir, 'sw.js');
  const manifestPath = join(distDir, 'manifest.webmanifest');
  const sidecarPath = join(dirname(distDir), '.sw-manifest.json');

  if (!existsSync(manifestPath)) fail('缺少 dist/manifest.webmanifest（public 静态产物）');
  if (html.includes('href="/sw.js"') || html.includes('src="/sw.js"'))
    fail('index.html 写死根路径 /sw.js');

  if (!existsSync(swPath)) {
    fail('缺少 dist/sw.js——SW 构建未运行（vite build --config vite.sw.config.ts）');
  } else if (statSync(swPath).size === 0) {
    fail('dist/sw.js 为空文件');
  }

  if (!existsSync(sidecarPath)) {
    fail(`缺少侧车清单 ${sidecarPath}（SW 构建应产出）`);
  } else {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    if (existsSync(swPath)) {
      const swCode = readFileSync(swPath, 'utf8');
      // 内嵌清单与侧车漂移防护：版本串必须出现在 sw.js 文本中
      if (!swCode.includes(sidecar.version))
        fail(`sw.js 未包含侧车版本 ${sidecar.version}（内嵌清单与侧车漂移）`);
      if (rootSwLiteral.test(swCode)) fail('sw.js 内出现写死根路径 /sw.js');
    }
    // 侧车条目集合 == dist 实际文件集合 − 排除项（漏缓存/多缓存双向报错）
    const distFiles = walkDist(distDir, distDir).filter((f) => !isPrecacheExcluded(f));
    const sidecarUrls = sidecar.entries.map((e) => e.url);
    const missing = distFiles.filter((f) => !sidecarUrls.includes(f));
    const extra = sidecarUrls.filter((u) => !distFiles.includes(u));
    for (const m of missing) fail(`侧车清单漏掉 dist 文件 ${m}（离线会缺该资源）`);
    for (const e of extra) fail(`侧车清单多出 dist 不存在的条目 ${e}`);
    // 预算：> 3MB 直接失败（防误把字体全集/大图塞进清单，specs/pwa §8）
    const totalBytes = sidecar.entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
    if (totalBytes > PRECACHE_BUDGET_BYTES)
      fail(`预缓存总量 ${(totalBytes / 1048576).toFixed(2)} MB 超过 3 MB 预算`);
  }

  if (failures.length > 0) {
    console.error(`[pages] 子路径产物校验失败（base=${base}）：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[pages] Pages 构建校验通过：base=${base}，${jsFiles.length} chunks`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.length > 2) {
  console.error('[pages] 用法：node scripts/check-pages-build.mjs [distDir] <base>');
  process.exitCode = 2;
} else {
  // 单参数视为 base（distDir 用默认值）；双参数为 [distDir, base]
  const [distDir, base] = args.length === 2 ? args : ['packages/app/dist', args[0]];
  main(distDir, base);
}
