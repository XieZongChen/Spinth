#!/usr/bin/env node
/* global process, console */
/**
 * Pages 子路径构建校验：SPINTH_BASE 构建产物必须全量带 base 前缀。
 * Vite 会重写 index.html 的 assets/favicon/worker 引用，但不会重写 JS 字符串
 * ——运行时路径已收口到 packages/app/src/siteBase.ts，本脚本守住两类回归：
 * index.html 前缀丢失（base 未生效）、JS 重新出现写死根路径。
 * 用法：node scripts/check-pages-build.mjs [distDir] <base>
 *   distDir 默认 packages/app/dist；base 必填且不为 '/'（根路径无需校验），
 *   自动补首尾斜杠，与 vite.config.ts 的 resolveBase 规则一致。
 * 退出码：0 通过；1 校验失败；2 参数非法。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0 || args.length > 2) {
  console.error('[pages] 用法：node scripts/check-pages-build.mjs [distDir] <base>');
  process.exitCode = 2;
} else {
  // 单参数视为 base（distDir 用默认值）；双参数为 [distDir, base]
  const [distDir, base] = args.length === 2 ? args : ['packages/app/dist', args[0]];
  main(distDir, base);
}

function normalizeBase(raw) {
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

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
  if (!existsSync(htmlPath)) {
    fail(`缺少 ${htmlPath}——请先 SPINTH_BASE=... pnpm build`);
  } else {
    const html = readFileSync(htmlPath, 'utf8');
    if (!html.includes(`${base}assets/`))
      fail(`index.html 资源引用未带 base（期望 ${base}assets/）`);
    if (!html.includes(`${base}favicon-32.png`))
      fail(`index.html favicon 未带 base（期望 ${base}favicon-32.png）`);
    if (!html.includes('http-equiv="Content-Security-Policy"'))
      fail('index.html 缺少 CSP meta（cspInject 未生效）');
    if (html.includes('src="/assets/')) fail('index.html 存在未加 base 的 src="/assets/…"');
    if (html.includes('href="/assets/')) fail('index.html 存在未加 base 的 href="/assets/…"');
    if (html.includes('href="/favicon-32.png"')) fail('index.html favicon 写死根路径');
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
  for (const f of jsFiles) {
    const code = readFileSync(join(assetsDir, f), 'utf8');
    if (rootAssetLiteral.test(code)) fail(`assets/${f}: JS 写死根路径 /spinth-mark.png`);
    if (rootDocLiteral.test(code)) fail(`assets/${f}: JS 写死根路径 /?doc=`);
    if (rootWorkerLiteral.test(code)) fail(`assets/${f}: worker URL 写死根路径`);
  }

  if (failures.length > 0) {
    console.error(`[pages] 子路径产物校验失败（base=${base}）：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[pages] Pages 构建校验通过：base=${base}，${jsFiles.length} chunks`);
}
