/**
 * 依赖许可证收集（THIRD_PARTY_NOTICES 与 check-licenses 共用）。
 *
 * 为什么不用现成工具：pnpm 的隔离布局把依赖放在 `<pkg>/node_modules/<dep>`，
 * 直接读 package.json / LICENSE 文件即可，避免为一次清仓引入第三方扫描器；
 * 运行时闭包与"全量安装面"必须分开——devDependencies 不随产物分发，
 * 不能按同一把尺子卡许可白名单。
 */

/* global URL */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WORKSPACE_ROOT_PKG = path.join(REPO_ROOT, 'package.json');

/** 随产物分发的 workspace 包；@spinth/app 只做静态站点，不发 npm 但同样进 bundle。 */
const WORKSPACE_PACKAGE_DIRS = ['packages/core', 'packages/react', 'packages/app'];

const LICENSE_FILE = /^(licen[cs]e|copying|copyright|unlicense)(\.(md|txt|markdown|rst))?$/i;

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readWorkspacePackages() {
  return WORKSPACE_PACKAGE_DIRS.map((dir) => {
    const abs = path.join(REPO_ROOT, dir);
    return { dir: abs, pkg: readJson(path.join(abs, 'package.json')) };
  });
}

/**
 * 依赖目录解析：优先同级 node_modules 链接（pnpm 保证直接依赖一定存在），
 * 退回到从该包位置发起的 require.resolve，兼容被提升到顶层的布局。
 */
function resolveDependencyDir(fromDir, name) {
  // 一律返回真实路径：pnpm 的 node_modules 是符号链接，相对路径会在上溯时
  // 丢掉 store 位置，导致传递依赖被静默漏扫。
  const toReal = (dir) => {
    try {
      return realpathSync(dir);
    } catch {
      return null;
    }
  };
  const direct = path.join(fromDir, 'node_modules', name);
  if (existsSync(path.join(direct, 'package.json'))) return toReal(direct);
  try {
    const requireFrom = createRequire(path.join(fromDir, 'package.json'));
    return toReal(path.dirname(requireFrom.resolve(`${name}/package.json`)));
  } catch {
    /* 不少包 exports 不暴露 ./package.json，继续走目录上溯 */
  }
  let cursor = fromDir;
  while (cursor.startsWith(REPO_ROOT) && cursor !== REPO_ROOT) {
    const candidate = path.join(cursor, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return toReal(candidate);
    cursor = path.dirname(cursor);
  }
  return null;
}

export function normalizeSpdx(pkg) {
  const raw = pkg.license ?? pkg.licenses ?? null;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean)
      .join(' OR ');
  }
  if (raw && typeof raw === 'object' && typeof raw.type === 'string') return raw.type.trim();
  return 'UNKNOWN';
}

function readLicenseText(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => LICENSE_FILE.test(entry))
    .filter((entry) => {
      try {
        return statSync(path.join(dir, entry)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (candidates.length === 0) return null;
  return readFileSync(path.join(dir, candidates[0]), 'utf8').replace(/\r\n/g, '\n').trim();
}

export function extractCopyright(text) {
  if (!text) return [];
  // 只认带年份的署名行：MIT/OFL 正文里 "COPYRIGHT HOLDERS BE LIABLE"、
  // "Copyright Holder." 这类条款句也以 copyright 开头，混进来会污染清单。
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => /^(copyright|©)/i.test(line))
    .filter((line) => /\b(19|20)\d{2}\b/.test(line))
    .filter((line) => line.length <= 200)
    .slice(0, 2);
}

function describePackage(dir, fallbackName) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const text = readLicenseText(dir);
  return {
    name: pkg.name ?? fallbackName,
    version: pkg.version ?? '0.0.0',
    license: normalizeSpdx(pkg),
    licenseText: text,
    copyright: extractCopyright(text),
  };
}

/**
 * 运行时闭包：从三个 workspace 包的 dependencies 出发做 BFS。
 * workspace:* 指向本项目自身，跳过（本项目的许可在 LICENSE）。
 */
export function collectRuntimeClosure() {
  const seen = new Map();
  const queue = [];

  for (const { dir, pkg } of readWorkspacePackages()) {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const depDir = resolveDependencyDir(dir, name);
      if (depDir) queue.push({ dir: depDir, name });
    }
  }

  const visitedDirs = new Set();

  while (queue.length > 0) {
    const { dir, name } = queue.pop();
    let realDir;
    try {
      realDir = realpathSync(dir);
    } catch {
      continue;
    }
    if (visitedDirs.has(realDir)) continue;
    visitedDirs.add(realDir);

    let described;
    try {
      described = describePackage(realDir, name);
    } catch {
      continue;
    }
    // 本项目自身的包走 LICENSE，不进第三方声明
    if (described.name.startsWith('@spinth/')) continue;
    const key = `${described.name}@${described.version}`;
    if (seen.has(key)) continue;
    seen.set(key, described);

    let pkg;
    try {
      pkg = readJson(path.join(realDir, 'package.json'));
    } catch {
      continue;
    }
    for (const child of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const childDir = resolveDependencyDir(realDir, child);
      if (childDir) queue.push({ dir: childDir, name: child });
    }
  }

  return [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/** 全量安装面（含 devDependencies）：供许可门禁区分"随产物分发"与"仅本地构建"。 */
export function collectInstalledPackages() {
  const store = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!existsSync(store)) throw new Error(`缺少 pnpm store：${store}（先 pnpm install）`);

  const found = [];
  for (const entry of readdirSync(store)) {
    const modules = path.join(store, entry, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const child of readdirSync(modules)) {
      if (child.startsWith('.')) continue;
      const dirs = child.startsWith('@')
        ? readdirSync(path.join(modules, child)).map((scoped) => path.join(modules, child, scoped))
        : [path.join(modules, child)];
      for (const dir of dirs) {
        if (!existsSync(path.join(dir, 'package.json'))) continue;
        try {
          found.push(describePackage(dir, child));
        } catch {
          /* 损坏的 store 条目不进门禁 */
        }
      }
    }
  }
  return found;
}

export function runtimeKey(pkg) {
  return `${pkg.name}@${pkg.version}`;
}

const ROOT_META = readJson(WORKSPACE_ROOT_PKG);

/** 生成 THIRD_PARTY_NOTICES.md 的内容（不含时间戳，保证 --check 可复现）。 */
export function renderNotices() {
  const packages = collectRuntimeClosure();
  const groups = new Map();
  for (const pkg of packages) {
    if (!groups.has(pkg.license)) groups.set(pkg.license, []);
    groups.get(pkg.license).push(pkg);
  }

  const sortedGroups = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const lines = [
    '# Third-Party Notices',
    '',
    '本文件由 `node scripts/gen-third-party-notices.mjs` 生成，禁止手改；',
    '内容覆盖 `pnpm build` 产物中随分发的运行时依赖闭包（不含 devDependencies）。',
    'spinth 自身以 MIT 许可发布，见 [LICENSE](./LICENSE)。',
    '',
    `运行时依赖共 ${packages.length} 个包，涉及 ${groups.size} 种许可。`,
    '',
    '| 许可 | 包数 |',
    '| ---- | ---- |',
    ...sortedGroups.map(([spdx, list]) => `| ${spdx} | ${list.length} |`),
    '',
    '## 包清单',
    '',
    '| 包 | 版本 | 许可 | 版权声明 |',
    '| --- | --- | --- | --- |',
    ...packages.map((pkg) => {
      const copyright =
        pkg.copyright.length > 0 ? pkg.copyright.join('<br>').replaceAll('|', '\\|') : '—';
      return `| ${pkg.name} | ${pkg.version} | ${pkg.license} | ${copyright} |`;
    }),
    '',
    '## 许可全文',
    ...sortedGroups.flatMap(([spdx, list]) => renderLicenseSection(spdx, list)),
    '',
  ];
  return lines.join('\n');
}

function renderLicenseSection(spdx, list) {
  const withText = list.filter((pkg) => pkg.licenseText);
  const text =
    pickCanonicalText(withText) ??
    '（该许可未随包分发全文，请以包内 LICENSE 文件与 SPDX 标识为准。）';
  return [
    '',
    `### ${spdx}`,
    '',
    `适用包：${list.map((pkg) => `${pkg.name}@${pkg.version}`).join('、')}`,
    '',
    '```text',
    text,
    '```',
  ];
}

/**
 * 同一 SPDX 下的全文可能只差版权行；取出现次数最多的一份作为代表，
 * 其余包的版权行已在上方清单中逐条列明。
 */
function pickCanonicalText(list) {
  const counts = new Map();
  for (const pkg of list) {
    const key = pkg.licenseText;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [text, count] of counts) {
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return best;
}

export { ROOT_META };
