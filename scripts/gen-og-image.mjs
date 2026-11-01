#!/usr/bin/env node
/* global URL, console, document */
/**
 * 生成社交预览图 packages/app/public/og-image.png（1200×630）。
 *
 * 为什么用 Playwright 而不是图像库：卡片排版走 CSS 最快，且能直接复用站内
 * Nunito 字体与品牌色；一张一次性渲染的静态图不值得引入 sharp/canvas 依赖。
 *
 * 依赖：Chromium（`pnpm exec playwright install chromium`），或本机 Chrome。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'packages/app/public/og-image.png');

const FONT_PREFIX = '@fontsource-variable+nunito@';
function findFontFile() {
  const store = path.join(ROOT, 'node_modules', '.pnpm');
  const entry = readdirSync(store).find((name) => name.startsWith(FONT_PREFIX));
  if (!entry) throw new Error('未找到 @fontsource-variable/nunito，先 pnpm install');
  return path.join(
    store,
    entry,
    'node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2',
  );
}

const logo = readFileSync(path.join(ROOT, 'packages/app/public/spinth-mark.png')).toString(
  'base64',
);
const font = readFileSync(findFontFile()).toString('base64');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: Nunito;
    src: url(data:font/woff2;base64,${font}) format('woff2');
    font-weight: 200 1000;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    font-family: Nunito, system-ui, sans-serif;
    background: #0b0d12;
    color: #f4f5f9;
    position: relative;
  }
  .grid {
    position: absolute; inset: 0;
    background-image: radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px);
    background-size: 26px 26px;
  }
  .glow-a {
    position: absolute; width: 720px; height: 720px; left: -220px; top: -300px;
    background: radial-gradient(circle, rgba(109,94,252,0.42), transparent 62%);
  }
  .glow-b {
    position: absolute; width: 640px; height: 640px; right: -260px; bottom: -320px;
    background: radial-gradient(circle, rgba(79,209,197,0.16), transparent 64%);
  }
  .card {
    position: relative; height: 100%; padding: 76px 84px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: 38px; }
  .brand img { height: 214px; filter: drop-shadow(0 18px 40px rgba(109,94,252,0.45)); }
  h1 { font-size: 128px; font-weight: 800; letter-spacing: -5px; line-height: 0.95; }
  .tagline { font-size: 33px; font-weight: 500; color: #a6adbe; margin-top: 18px; letter-spacing: 0.2px; }
  .chips { display: flex; gap: 14px; }
  .chip {
    font-size: 22px; font-weight: 600; color: #c3c9d6;
    border: 1px solid rgba(255,255,255,0.14); border-radius: 999px;
    padding: 11px 22px; background: rgba(255,255,255,0.03);
  }
  .chip b { color: #8f7dff; font-weight: 700; }
</style></head>
<body>
  <div class="grid"></div><div class="glow-a"></div><div class="glow-b"></div>
  <div class="card">
    <div class="brand">
      <img src="data:image/png;base64,${logo}" alt="">
      <div>
        <h1>spinth</h1>
        <div class="tagline">Local-first whiteboard &amp; mind map editor</div>
      </div>
    </div>
    <div class="chips">
      <div class="chip"><b>Offline</b> by default</div>
      <div class="chip">No account</div>
      <div class="chip">MIT licensed</div>
    </div>
  </div>
</body></html>`;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // CI/未安装 Playwright 浏览器时退回本机 Chrome，避免为了发一张图去下载浏览器
    return chromium.launch({ channel: 'chrome' });
  }
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const buffer = await page.screenshot();
  writeFileSync(OUT, buffer);
  console.log(`[og] 已写入 ${path.relative(ROOT, OUT)}（${Math.round(buffer.length / 1024)}KB）`);
} finally {
  await browser.close();
}
