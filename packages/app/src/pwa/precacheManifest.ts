/**
 * 预缓存清单生成（specs/pwa.md D4/§6.1，纯函数——vite.sw.config 与单测共用）。
 *
 * - `revision` = 文件内容 sha256 前 8 位；`version` = 各 `url@revision`
 *   排序拼接后的 sha256 前 12 位——无变更重建不产生新版本、不弹更新提示。
 * - sha256 经参数注入：模块保持纯函数（SW 全局禁 Node 内建，构建侧传 node:crypto）。
 * - 排除规则与 scripts/check-pages-build.mjs 内的副本必须同步（D4 单源两份）。
 */

export interface IPrecacheEntry {
  /** 相对 site base，无前导 '/'，如 'assets/index-DUgTQvjI.js' */
  url: string;
  /** 内容 sha256 前 8 位 */
  revision: string;
  /** 字节，仅用于预算断言与排障 */
  size: number;
}

export interface IPrecacheManifest {
  /** 12 位 hex */
  version: string;
  /** 按 url 字典序，保证确定性 */
  entries: IPrecacheEntry[];
}

/** dist 内一个待判定文件的摘要（hash 由构建侧完成） */
export interface IPrecacheFile {
  /** 相对 dist 根的路径（'/' 分隔，无前导 '/'） */
  url: string;
  /** 内容 sha256（完整 hex；revision 截取由此完成） */
  sha256: string;
  size: number;
}

/** latin 子集白名单：fontsource 命名 `*-latin-wght-normal.*.woff2`；
 * `-latin-` 字面量会误含 `-latin-ext-`，负向前瞻排除之。 */
const LATIN_WOFF2 = /-latin-(?!ext)/;

/** D4 排除项：*.map、sw.js 自身、spinth-logo.png（图标源非运行时资源）、非 latin 字体。 */
export function isPrecacheExcluded(relPath: string): boolean {
  if (relPath === 'sw.js' || relPath === 'spinth-logo.png') return true;
  if (relPath.endsWith('.map')) return true;
  if (relPath.endsWith('.woff2')) return !LATIN_WOFF2.test(relPath);
  return false;
}

export type Sha256Hex = (input: string) => string;

export function buildPrecacheManifest(
  files: readonly IPrecacheFile[],
  sha256hex: Sha256Hex,
): IPrecacheManifest {
  const entries = files
    .filter((f) => !isPrecacheExcluded(f.url))
    .map((f) => ({ url: f.url, revision: f.sha256.slice(0, 8), size: f.size }))
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const fingerprint = entries.map((e) => `${e.url}@${e.revision}`).join('|');
  return { version: sha256hex(fingerprint).slice(0, 12), entries };
}
