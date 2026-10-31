import { createHash } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * 生产 CSP 注入（Batch 2 安全头，2026-10-18）：build 时对 index.html 内联的
 * 主题预置 script 计算 sha256 hash 注入 meta CSP——脚本变更 hash 自动跟随。
 * **dev 不注入**（Vite HMR / @react-refresh preamble 是 inline script，严格
 * CSP 即坏 dev）。frame-ancestors/report-uri meta 不支持——归宿主服务器头。
 */
function cspInject(): Plugin {
  return {
    name: 'spinth-csp-inject',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return; // dev 跳过
        // 提取全部 inline <script>（无 src）逐个算 hash
        const hashes: string[] = [];
        for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
          // 浏览器 hash 的是标签内容的原文（含首尾空白去除后按规范 UTF-8）
          const code = m[1]!.trim();
          hashes.push(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
        }
        const csp = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`,
          "style-src 'self' 'unsafe-inline'", // React inline style + Tailwind 注入
          "img-src 'self' data: blob: https: http:", // 画布图片可外链/data URL（现状语义）
          "connect-src 'self' ws: wss: data: blob:", // 协同中继 + 图片解码内联通道（P0 修复：data:/blob: fetch 曾被 CSP 拒）
          "worker-src 'self' blob:", // PIXI 图片解码 blob worker（P0 修复：缺失时 SecurityError）
          "font-src 'self' data:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; ');
        return html.replace(
          '</title>',
          `</title>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        );
      },
    },
  };
}

/**
 * 站点基路径（GitHub Pages 子路径部署）：SPINTH_BASE 注入，缺省 '/'（dev/自托管）。
 * Vite 由此重写 index.html 的 assets/favicon/worker URL；JS 内跳转走 src/siteBase.ts。
 */
function resolveBase(): string {
  const raw = process.env.SPINTH_BASE?.trim();
  if (!raw) return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * workspace 内部包以 TS 源码直引（main 指向 src/index.ts），
 * 通过 alias 让 dev 与 build 都直接编译源码，无需预构建步骤。
 */
export default defineConfig({
  base: resolveBase(),
  // 构建标记（specs/pwa §11.3）：E2E 用 SPINTH_BUILD_TAG 证明版本确实更替。
  // E2E 探针构建期开关（specs/pwa §17.4 P2-4）：仅 SPINTH_E2E=1 的构建携带
  // 只读探针，Pages 产物零暴露——与「SDK 调试句柄生产剥离」约定同向。
  define: {
    __BUILD_TAG__: JSON.stringify(process.env.SPINTH_BUILD_TAG ?? ''),
    __E2E_PROBE__: JSON.stringify(process.env.SPINTH_E2E === '1'),
  },
  plugins: [react(), tailwindcss(), cspInject()],
  resolve: {
    // 数组 + regex 精确匹配：`@spinth/core/dev` 必须先于根 alias，否则被
    // 前缀匹配到 index.ts（specs/runtime-narrowing §3.9 F3）
    alias: [
      {
        find: /^@spinth\/core\/dev$/,
        replacement: fileURLToPath(new URL('../core/src/dev.ts', import.meta.url)),
      },
      {
        find: /^@spinth\/core$/,
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
      {
        find: /^@spinth\/react$/,
        replacement: fileURLToPath(new URL('../react/src/index.ts', import.meta.url)),
      },
    ],
  },
  optimizeDeps: {
    exclude: ['@spinth/core', '@spinth/core/dev', '@spinth/react'],
  },
  build: {
    // Batch 2 · 分包（2026-10-18 审查 6.2）：1.41MB 主 chunk 拆三层 vendor——
    // 同源 SPA 加载行为不变，缓存分层（vendor 版本稳定可长缓存）+ 首包瘦身
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('pixi')) return 'pixi';
            if (
              id.includes('yjs') ||
              id.includes('lib0') ||
              id.includes('y-protocols') ||
              id.includes('y-websocket')
            )
              return 'yjs';
            if (id.includes('@tiptap') || id.includes('prosemirror')) return 'tiptap';
            if (id.includes('react') || id.includes('scheduler')) return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
