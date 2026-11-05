#!/usr/bin/env node
/* global process, console */

/**
 * 字号单位护栏（specs/rem-typography §4.8；策略见 docs/12 §5「字号单位策略」）。
 *
 * 铬件字号只允许 rem：px 字号不跟随浏览器「默认字号」偏好（WCAG 1.4.4），且与
 * 已是 rem 的文本混排时放大会层级反转。扫描 packages/{core,react,app}/src 下的
 * .ts/.tsx/.css（不含单测）与 packages/app/index.html，拦截三类写法：
 *   1. Tailwind 任意值 px 字号（text-[13px]，含变体前缀与 length: 类型提示）；
 *   2. CSS 声明 font-size 取 px 值；
 *   3. JS 字号赋值为 px 串（引号串，或以 px 结尾的模板串）。
 * 白名单是文件级并硬编码理由：DOM 文本编辑层必须与画布 px 逐像素对齐（规格 §4.7）。
 * 不提供行内豁免——要豁免就进白名单并写理由，强制走审查。
 *
 * 每次运行先跑内置夹具自检（护栏自身的区分验证），自检不过直接失败；
 * --self-test 只跑自检并逐条打印。纯 node stdlib，零安装可跑（CI 先于 install）。
 *
 * 退出码：0 通过；1 发现 px 字号或自检失败。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCAN_DIRS = ['packages/core/src', 'packages/react/src', 'packages/app/src'];
const EXTRA_FILES = ['packages/app/index.html'];
const EXTS = new Set(['.ts', '.tsx', '.css']);

/** 文件级白名单：路径（仓库相对、posix）→ 理由 */
const ALLOWLIST = new Map([
  [
    'packages/core/src/platform/textEngine/richTextEditor.ts',
    'DOM 富文本编辑层字号必须与 PIXI 画布逐像素对齐（WYSIWYG），rem 会随根字号漂移',
  ],
  [
    'packages/core/src/platform/textEngine/plainTextKernel.ts',
    '编辑层屏幕像素 = 世界字号 × 缩放，必须是 px 才能与画布对齐',
  ],
]);

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const RULES = [
  {
    id: 'tailwind-px',
    re: new RegExp(String.raw`\btext-\[(?:length:)?\s*${NUM}px\s*\]`, 'gi'),
    hint: '改用 rem 令牌（text-3xs / text-2xs / text-md / text-brand）或精确 rem 任意值（px ÷ 16，如 0.75rem）',
  },
  {
    id: 'css-px',
    re: new RegExp(String.raw`font-size\s*:\s*${NUM}px`, 'gi'),
    hint: 'CSS 字号写 rem（px ÷ 16 的精确小数，不四舍五入）',
  },
  {
    id: 'js-px',
    re: new RegExp(
      String.raw`\bfontSize\s*[:=]\s*(?:(['"])\s*${NUM}px\s*\1|\x60[^\x60]*px\x60)`,
      'g',
    ),
    hint: 'DOM 字号赋值写 rem；画布/编辑层确需 px 的文件进白名单并写理由',
  },
];

/** 单测文件不在扫描面：测试可合法断言编辑层的 px 字号（规格 §8 R5） */
function isTestFile(rel) {
  return /(^|\/)__tests__\//.test(rel) || /\.test\.[cm]?[jt]sx?$/.test(rel);
}

/** 扫描一段文本 → 命中列表（白名单文件恒为空） */
function scanText(rel, text) {
  if (ALLOWLIST.has(rel)) return [];
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const m of line.matchAll(rule.re)) {
        hits.push({ rel, line: i + 1, snippet: m[0], rule: rule.id });
      }
    }
  });
  return hits;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  for (const f of EXTRA_FILES) files.push(path.join(ROOT, f));
  return files
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join('/'))
    .filter((rel) => !isTestFile(rel))
    .sort();
}

/** 夹具：命中三类各至少一条、各类不该命中的近邻写法、白名单——护栏自身的区分验证 */
const FIXTURES = [
  {
    name: 'Tailwind 任意值 px',
    rel: 'x.tsx',
    text: 'className="flex text-[13px] font-bold"',
    expect: ['tailwind-px'],
  },
  {
    name: '变体前缀 + length 提示',
    rel: 'x.tsx',
    text: 'className="max-[379px]:text-[length:12px]"',
    expect: ['tailwind-px'],
  },
  { name: 'CSS px 字号', rel: 'x.css', text: '.label { font-size: 13px; }', expect: ['css-px'] },
  { name: 'JS 引号 px 串', rel: 'x.tsx', text: "style={{ fontSize: '12px' }}", expect: ['js-px'] },
  {
    name: 'JS 模板串以 px 结尾',
    rel: 'x.ts',
    text: 'el.style.fontSize = `${size}px`;',
    expect: ['js-px'],
  },
  { name: 'rem 任意值', rel: 'x.tsx', text: 'className="text-[0.75rem] leading-4"', expect: [] },
  {
    name: '字号令牌',
    rel: 'x.tsx',
    text: 'className="text-3xs text-2xs text-md text-brand text-xs"',
    expect: [],
  },
  {
    name: '非字号的 px（宽/高/断点）',
    rel: 'x.tsx',
    text: 'className="w-[216px] min-h-[2.125rem] max-[379px]:hidden"',
    expect: [],
  },
  {
    name: 'PIXI 数值字号',
    rel: 'x.ts',
    text: 'new TextStyle({ fontSize: 16, fill: 0x111111 })',
    expect: [],
  },
  { name: 'CSS 百分比根字号', rel: 'x.css', text: 'html { font-size: 100%; }', expect: [] },
  {
    name: '白名单文件（编辑层 px）',
    rel: 'packages/core/src/platform/textEngine/richTextEditor.ts',
    text: 'this.dom.style.fontSize = `${style.fontSize}px`;',
    expect: [],
  },
];

function runSelfTest(verbose) {
  const failures = [];
  for (const f of FIXTURES) {
    const got = scanText(f.rel, f.text).map((h) => h.rule);
    const ok = got.length === f.expect.length && got.every((r, i) => r === f.expect[i]);
    if (verbose) console.log(`  ${ok ? '✓' : '✗'} ${f.name}：期望 [${f.expect}]，实际 [${got}]`);
    if (!ok) failures.push(`${f.name}：期望 [${f.expect}]，实际 [${got}]`);
  }
  return failures;
}

const selfTestOnly = process.argv.includes('--self-test');
if (selfTestOnly) console.log(`[font-units] 自检 ${FIXTURES.length} 条夹具：`);
const selfFailures = runSelfTest(selfTestOnly);
if (selfFailures.length > 0) {
  console.error(`[font-units] 自检失败 ${selfFailures.length} 条（护栏规则失去区分能力）：`);
  for (const f of selfFailures) console.error(`  - ${f}`);
  process.exitCode = 1;
} else if (selfTestOnly) {
  console.log(`[font-units] 自检 OK（${FIXTURES.length} 条夹具）`);
} else {
  const files = collectFiles();
  const hits = files.flatMap((rel) => scanText(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  if (hits.length > 0) {
    console.error(
      `[font-units] 发现 ${hits.length} 处 px 字号（铬件字号只允许 rem，docs/12 §5）：`,
    );
    for (const h of hits) console.error(`  - ${h.rel}:${h.line}: ${h.snippet}  [${h.rule}]`);
    for (const rule of RULES.filter((r) => hits.some((h) => h.rule === r.id))) {
      console.error(`  指引（${rule.id}）：${rule.hint}`);
    }
    console.error('  豁免只能进脚本白名单并写理由（不支持行内豁免）');
    process.exitCode = 1;
  } else {
    console.log(
      `[font-units] OK（扫描 ${files.length} 个文件，白名单 ${ALLOWLIST.size} 个；自检 ${FIXTURES.length} 条夹具通过）`,
    );
  }
}
