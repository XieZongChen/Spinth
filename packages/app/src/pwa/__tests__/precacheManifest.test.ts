import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPrecacheManifest, isPrecacheExcluded, type IPrecacheFile } from '../precacheManifest';

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

const file = (url: string, content: string, size = content.length): IPrecacheFile => ({
  url,
  sha256: sha256hex(content),
  size,
});

const DIST_SNAPSHOT: IPrecacheFile[] = [
  file('index.html', '<html>v1</html>'),
  file('assets/index-DUgTQv.js', 'js-body'),
  file('assets/index-Bxj3kq.css', 'css-body'),
  file('assets/nunito-latin-wght-normal.1.woff2', 'latin-woff2'),
  file('assets/nunito-latin-ext-wght-normal.1.woff2', 'latin-ext-woff2'),
  file('assets/nunito-cyrillic-wght-normal.1.woff2', 'cyr-woff2'),
  file('assets/nunito-vietnamese-wght-normal.1.woff2', 'vn-woff2'),
  file('assets/compactWorker-C19X.js', 'worker-js'),
  file('manifest.webmanifest', '{}'),
  file('icons/icon-192.png', 'png192'),
  file('spinth-mark.png', 'mark'),
  // 排除项
  file('spinth-logo.png', 'logo'),
  file('sw.js', 'sw-body'),
  file('assets/index-DUgTQv.js.map', 'sourcemap'),
];

describe('isPrecacheExcluded（D4 排除规则）', () => {
  it('排除 sw.js / spinth-logo.png / *.map', () => {
    expect(isPrecacheExcluded('sw.js')).toBe(true);
    expect(isPrecacheExcluded('spinth-logo.png')).toBe(true);
    expect(isPrecacheExcluded('assets/index-DUgTQv.js.map')).toBe(true);
  });

  it('只保留 latin 字体子集——latin-ext / cyrillic / vietnamese 走运行时 SWR', () => {
    expect(isPrecacheExcluded('assets/nunito-latin-wght-normal.1.woff2')).toBe(false);
    expect(isPrecacheExcluded('assets/nunito-latin-ext-wght-normal.1.woff2')).toBe(true);
    expect(isPrecacheExcluded('assets/nunito-cyrillic-wght-normal.1.woff2')).toBe(true);
    expect(isPrecacheExcluded('assets/nunito-vietnamese-wght-normal.1.woff2')).toBe(true);
  });

  it('普通产物不排除', () => {
    expect(isPrecacheExcluded('index.html')).toBe(false);
    expect(isPrecacheExcluded('assets/compactWorker-C19X.js')).toBe(false);
    expect(isPrecacheExcluded('manifest.webmanifest')).toBe(false);
  });
});

describe('buildPrecacheManifest', () => {
  it('排除规则生效：排除项不进清单，懒加载 chunk（compactWorker）在清单内', () => {
    const { entries } = buildPrecacheManifest(DIST_SNAPSHOT, sha256hex);
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('assets/compactWorker-C19X.js');
    expect(urls).not.toContain('sw.js');
    expect(urls).not.toContain('spinth-logo.png');
    expect(urls).not.toContain('assets/index-DUgTQv.js.map');
    expect(urls).not.toContain('assets/nunito-cyrillic-wght-normal.1.woff2');
    expect(urls).toContain('assets/nunito-latin-wght-normal.1.woff2');
  });

  it('按 url 字典序排序，输出确定（无序输入同清单）', () => {
    const a = buildPrecacheManifest(DIST_SNAPSHOT, sha256hex);
    const b = buildPrecacheManifest([...DIST_SNAPSHOT].reverse(), sha256hex);
    expect(a.entries.map((e) => e.url)).toEqual([...a.entries.map((e) => e.url)].sort());
    expect(a).toEqual(b);
  });

  it('无变更重建版本不变（D4：内容 hash 而非构建时间）', () => {
    const a = buildPrecacheManifest(DIST_SNAPSHOT, sha256hex);
    const again = buildPrecacheManifest(
      DIST_SNAPSHOT.map((f) => ({ ...f })),
      sha256hex,
    );
    expect(again.version).toBe(a.version);
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('任一清单内文件内容变化 → 版本变化；仅排除项变化 → 版本不变', () => {
    const base = buildPrecacheManifest(DIST_SNAPSHOT, sha256hex);
    const touched = buildPrecacheManifest(
      DIST_SNAPSHOT.map((f) =>
        f.url === 'assets/index-DUgTQv.js' ? file(f.url, 'js-body-v2') : f,
      ),
      sha256hex,
    );
    expect(touched.version).not.toBe(base.version);
    const excludedOnly = buildPrecacheManifest(
      DIST_SNAPSHOT.map((f) => (f.url === 'spinth-logo.png' ? file(f.url, 'logo-v2') : f)),
      sha256hex,
    );
    expect(excludedOnly.version).toBe(base.version);
  });

  it('revision = sha256 前 8 位；size 透传供预算断言', () => {
    const { entries } = buildPrecacheManifest(DIST_SNAPSHOT, sha256hex);
    const html = entries.find((e) => e.url === 'index.html')!;
    expect(html.revision).toBe(sha256hex('<html>v1</html>').slice(0, 8));
    expect(html.size).toBe(15);
  });
});
