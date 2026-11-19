#!/usr/bin/env node
// @ts-check
/* global console, process */
/**
 * 符号资产生成器（specs/symbol-widget §4.2/§4.3）：
 * 输入 packages/core/src/widgets/symbol/assets/*.svg，按 id 字典序输出
 * symbolGlyphs.generated.ts（内联字符串常量，运行时零网络请求零资产引用）。
 *
 * 生成期硬校验（资产约束，§4.3）：
 * - 根元素只有 viewBox="0 0 48 48"（+ xmlns 命名空间声明），不写 width/height；
 * - 元素白名单 g/path/circle/rect/line/polyline/polygon；
 * - 属性白名单 d/cx/cy/r/x/y/width/height/x1/y1/x2/y2/points/fill/fill-rule/
 *   clip-rule/stroke/stroke-width/stroke-linecap/stroke-linejoin；
 * - fill/stroke 只允许 none 或 currentColor（禁一切硬编码色）；
 * - 禁 style/class/id/href/xlink/use/image/text/defs/filter/gradient/mask/
 *   transform/注释（需要旋转就在设计稿里画正）；
 * - 单文件 ≤ 6 KB。
 *
 * currentColor 归一为纯白 #ffffff：PIXI 8 的 tint 是逐通道乘法
 * （multiplyHexColors：`c = a·b/255`，pixi.js 8.22 实测源码）——255×tint=tint、
 * 0×tint=0，白是唯一能让 tint 呈现目标色的乘法基色（spec §4.4 原文的
 * 「#000000 / 黑×色=色」与乘法语义矛盾，按实测定稿白基色，见 specs 记录）。
 *
 * 输出确定性：id 排序、空白归一、无时间戳无路径。
 * --check = 重算与磁盘比对，不一致退出码 1（提示跑 pnpm symbols:build）。
 */
import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(ROOT, 'packages/core/src/widgets/symbol/assets');
const TARGET = join(ROOT, 'packages/core/src/widgets/symbol/symbolGlyphs.generated.ts');

const MAX_BYTES = 6 * 1024;
const VIEWBOX = '0 0 48 48';
const TINT_BASE = '#ffffff';
const ALLOWED_ELEMENTS = new Set(['g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon']);
const ALLOWED_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'width',
  'height',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'fill',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
]);
/** 显式 token 扫描（元素/属性白名单之外的双保险，错误信息更直指） */
const FORBIDDEN_TOKENS = [
  '<!--',
  '<defs',
  '<filter',
  '<gradient',
  '<mask',
  '<use',
  '<image',
  '<text',
  '<style',
  'xlink',
  'transform',
  'class=',
  'id=',
  'href',
  'style=',
];

const errors = [];
const fail = (id, msg) => {
  errors.push(`${id}.svg: ${msg}`);
  return null;
};

/** 解析 `a="b"` 属性对（生成期校验专用，不追求 XML 完备性——白名单已收窄） */
function parseAttrs(text) {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1]] = m[2];
  return attrs;
}

/** 校验单个资产并归一为单行字符串；失败返回 null（错误已入 errors） */
function validateAsset(id, raw) {
  const src = raw.trim();
  if (Buffer.byteLength(src, 'utf8') > MAX_BYTES) return fail(id, '超过 6 KB 上限');
  for (const t of FORBIDDEN_TOKENS) {
    if (src.includes(t)) return fail(id, `禁用 token：${t}`);
  }
  const root = src.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!root) return fail(id, '根必须是单个 <svg>…</svg>');
  const rootAttrs = parseAttrs(root[1]);
  for (const name of Object.keys(rootAttrs)) {
    if (name !== 'viewBox' && name !== 'xmlns') {
      return fail(id, `根元素只允许 viewBox（+xmlns），发现 ${name}`);
    }
  }
  if (rootAttrs.viewBox !== VIEWBOX) return fail(id, `viewBox 必须为 "${VIEWBOX}"`);
  if (Object.keys(rootAttrs).length === 0) return fail(id, '缺 viewBox');

  const tagRe = /<\s*(\/)?\s*([a-zA-Z][\w:-]*)\b([^>]*?)(\/)?>/g;
  let t;
  while ((t = tagRe.exec(root[2]))) {
    const [, close, name, attrText] = t;
    if (close) continue;
    if (!ALLOWED_ELEMENTS.has(name)) return fail(id, `元素 <${name}> 不在白名单`);
    const attrs = parseAttrs(attrText);
    for (const [attr, value] of Object.entries(attrs)) {
      if (!ALLOWED_ATTRS.has(attr)) return fail(id, `属性 ${attr} 不在白名单`);
      if ((attr === 'fill' || attr === 'stroke') && value !== 'none' && value !== 'currentColor') {
        return fail(id, `${attr} 只允许 none/currentColor，发现 "${value}"`);
      }
    }
  }
  // 归一：空白折叠 + 标签间去空隙 + currentColor → tint 乘法基色
  return src.replace(/\s+/g, ' ').replace(/>\s+</g, '><').replaceAll('currentColor', TINT_BASE);
}

/** 生成目标文件内容（确定性）；任一资产校验失败返回 null */
function render() {
  if (!existsSync(ASSETS_DIR)) {
    console.error('[symbols] 资产目录缺失：', ASSETS_DIR);
    return null;
  }
  const files = readdirSync(ASSETS_DIR)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  if (files.length === 0) {
    console.error('[symbols] 资产目录为空（至少需要 1 个 SVG）');
    return null;
  }
  const entries = [];
  for (const f of files) {
    const id = f.replace(/\.svg$/, '');
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      fail(id, '文件名须为小写字母开头的 kebab-case');
      continue;
    }
    const svg = validateAsset(id, readFileSync(join(ASSETS_DIR, f), 'utf8'));
    if (svg) entries.push(`  '${id}': '${svg}',`);
  }
  if (errors.length > 0) return null;
  return [
    '// 本文件由 scripts/build-symbol-glyphs.mjs 自动生成——勿手改；改动 assets 后',
    '// 跑 `pnpm symbols:build` 重新生成（`pnpm symbols:check` 校验一致性）。',
    `// currentColor 已归一为纯白 ${TINT_BASE}——PIXI tint 是逐通道乘法，白是唯一能`,
    '// 让 tint 呈现目标色的乘法基色（specs/symbol-widget §4.4 及其勘误记录）。',
    'export const SYMBOL_GLYPHS = {',
    ...entries,
    '} as const;',
    '',
    '/** 符号种类 id（specs/symbol-widget §4.1）：新增符号 = 加 SVG + 重跑生成脚本 */',
    'export type SymbolKind = keyof typeof SYMBOL_GLYPHS;',
    '',
    'export const SYMBOL_KINDS: readonly SymbolKind[] = Object.keys(SYMBOL_GLYPHS) as readonly SymbolKind[];',
    '',
  ].join('\n');
}

const checkOnly = process.argv.includes('--check');
const content = render();
if (content === null) {
  for (const e of errors) console.error('[symbols] ' + e);
  process.exit(1);
}
if (checkOnly) {
  if (!existsSync(TARGET)) {
    console.error('[symbols] 生成文件缺失，请跑 pnpm symbols:build');
    process.exit(1);
  }
  if (readFileSync(TARGET, 'utf8') !== content) {
    console.error('[symbols] symbolGlyphs.generated.ts 与 assets 不一致，请跑 pnpm symbols:build');
    process.exit(1);
  }
  console.log('[symbols] OK（生成产物与 assets 一致）');
  process.exit(0);
}
writeFileSync(TARGET, content);
console.log('[symbols] 已生成', TARGET);
