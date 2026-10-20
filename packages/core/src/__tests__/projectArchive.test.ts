import { describe, expect, it } from 'vitest';
import { Zip, ZipPassThrough, zipSync } from 'fflate';
import { DEFAULT_PROJECT_FILE_LIMITS, type ProjectFileLimits } from '../types/projectFile';
import { ProjectFileError } from '../platform/projectFile/projectFileError';
import {
  DOCUMENT_ENTRY,
  MANIFEST_ENTRY,
  unzipProject,
  zipProject,
} from '../platform/projectFile/projectArchive';

const LIMITS: ProjectFileLimits = { ...DEFAULT_PROJECT_FILE_LIMITS };
const id = (n: number): string => n.toString(16).padStart(64, '0') as string;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function baseEntries(): Array<{ name: string; data: Uint8Array; level?: 0 | 6 }> {
  return [
    { name: MANIFEST_ENTRY, data: enc('{"format":"spinth-project"}'), level: 6 },
    { name: DOCUMENT_ENTRY, data: new Uint8Array([1, 2, 3]), level: 6 },
    { name: `assets/${id(1)}`, data: new Uint8Array([9, 9]), level: 0 },
  ];
}

/** 流式原始打包（允许重复条目名——测试专用 fixture 构造器，store 模式） */
function zipRaw(entries: Array<{ name: string; data: Uint8Array }>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        reject(err);
        return;
      }
      if (chunk) {
        chunks.push(chunk);
        total += chunk.length;
      }
      if (final) {
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        resolve(out);
      }
    });
    for (const e of entries) {
      const file = new ZipPassThrough(e.name);
      zip.add(file);
      file.push(e.data, true);
    }
    zip.end();
  });
}

async function expectUnzipCode(
  zipBytes: Uint8Array,
  limits: ProjectFileLimits,
  code: string,
): Promise<void> {
  try {
    await unzipProject(zipBytes, limits);
    expect.unreachable('应当抛错');
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectFileError);
    expect((err as ProjectFileError).code).toBe(code);
  }
}

describe('zipProject / unzipProject round-trip', () => {
  it('打包 → 解包：字节一致；manifest 是第一条目（§4.1）', async () => {
    const zipBytes = await zipProject(baseEntries());
    // 首个本地文件头（30 字节固定头后）即 manifest.json
    const firstEntryName = new TextDecoder().decode(zipBytes.subarray(30, 30 + 13));
    expect(firstEntryName.startsWith(MANIFEST_ENTRY)).toBe(true);

    const unzipped = await unzipProject(zipBytes, LIMITS);
    expect([...unzipped.manifestBytes!]).toEqual([...enc('{"format":"spinth-project"}')]);
    expect([...unzipped.documentBytes!]).toEqual([1, 2, 3]);
    expect([...unzipped.assets.get(id(1))!]).toEqual([9, 9]);
    expect(unzipped.unknownEntryCount).toBe(0);
  });
});

describe('unzipProject 校验路径', () => {
  it('坏 ZIP（随机字节，无可识别条目）→ PROJECT_ARCHIVE_INVALID', async () => {
    await expectUnzipCode(new Uint8Array(128).fill(7), LIMITS, 'PROJECT_ARCHIVE_INVALID');
  });

  it('缺 manifest / 缺 document → PROJECT_ARCHIVE_INVALID', async () => {
    const noManifest = await zipProject([baseEntries()[1]!, baseEntries()[2]!]);
    await expectUnzipCode(noManifest, LIMITS, 'PROJECT_ARCHIVE_INVALID');
    const noDocument = await zipProject([baseEntries()[0]!, baseEntries()[2]!]);
    await expectUnzipCode(noDocument, LIMITS, 'PROJECT_ARCHIVE_INVALID');
  });

  it('已知条目重复（同名 manifest 两份）→ PROJECT_ARCHIVE_INVALID', async () => {
    const dup = await zipRaw([
      { name: MANIFEST_ENTRY, data: enc('{}') },
      { name: DOCUMENT_ENTRY, data: new Uint8Array([1]) },
      { name: MANIFEST_ENTRY, data: enc('{}') },
    ]);
    await expectUnzipCode(dup, LIMITS, 'PROJECT_ARCHIVE_INVALID');
  });

  it('路径穿越 / 反斜杠 / 绝对路径 / 盘符 / NUL → PROJECT_ARCHIVE_INVALID', async () => {
    for (const evil of ['../evil.txt', 'a\\b.txt', '/abs.txt', 'C:/x.txt', 'assets/../../x']) {
      const zipBytes = zipSync({
        [MANIFEST_ENTRY]: enc('{}'),
        [DOCUMENT_ENTRY]: new Uint8Array([1]),
        [evil]: new Uint8Array([1]),
      });
      await expectUnzipCode(zipBytes, LIMITS, 'PROJECT_ARCHIVE_INVALID');
    }
  });

  it('未知条目忽略 + 计数（不解压，D4）；目录条目忽略不计入未知', async () => {
    const zipBytes = zipSync({
      [MANIFEST_ENTRY]: enc('{}'),
      [DOCUMENT_ENTRY]: new Uint8Array([1]),
      'readme.txt': enc('unknown'),
      'assets/': new Uint8Array(0),
      'nested/deep.bin': new Uint8Array([2]),
    });
    const unzipped = await unzipProject(zipBytes, LIMITS);
    expect(unzipped.unknownEntryCount).toBe(2); // readme.txt + nested/deep.bin
  });

  it('单条解压超限（manifestBytes / assetBytes）→ PROJECT_ARCHIVE_LIMIT', async () => {
    const zipBytes = zipSync({
      [MANIFEST_ENTRY]: enc('x'.repeat(64)),
      [DOCUMENT_ENTRY]: new Uint8Array(16).fill(1),
    });
    await expectUnzipCode(zipBytes, { ...LIMITS, manifestBytes: 8 }, 'PROJECT_ARCHIVE_LIMIT');
    const assetId = id(3);
    const withAsset = zipSync({
      [MANIFEST_ENTRY]: enc('{}'),
      [DOCUMENT_ENTRY]: new Uint8Array([1]),
      [`assets/${assetId}`]: new Uint8Array(64).fill(2),
    });
    await expectUnzipCode(withAsset, { ...LIMITS, assetBytes: 8 }, 'PROJECT_ARCHIVE_LIMIT');
  });

  it('总解压字节超限 → PROJECT_ARCHIVE_LIMIT（按实际解压字节计数）', async () => {
    const zipBytes = zipSync({
      [MANIFEST_ENTRY]: enc('x'.repeat(32)),
      [DOCUMENT_ENTRY]: new Uint8Array(64).fill(3),
    });
    await expectUnzipCode(
      zipBytes,
      { ...LIMITS, manifestBytes: 1024, totalUncompressedBytes: 64 },
      'PROJECT_ARCHIVE_LIMIT',
    );
  });

  it('条目总数超限 → PROJECT_ARCHIVE_LIMIT（未知条目计入条目数，§4.5）', async () => {
    const zipBytes = zipSync({
      [MANIFEST_ENTRY]: enc('{}'),
      [DOCUMENT_ENTRY]: new Uint8Array([1]),
      'a.txt': new Uint8Array([1]),
      'b.txt': new Uint8Array([1]),
    });
    await expectUnzipCode(zipBytes, { ...LIMITS, entryCount: 3 }, 'PROJECT_ARCHIVE_LIMIT');
  });

  it('zip bomb 防线：高压缩比条目触发总解压限额（声明值正常也拦截）', async () => {
    // 4KB 全零高压缩比内容——声明 originalSize 正确；防线是实际解压计数
    const zipBytes = zipSync({
      [MANIFEST_ENTRY]: enc('{}'),
      [DOCUMENT_ENTRY]: new Uint8Array(4096).fill(0),
    });
    await expectUnzipCode(
      zipBytes,
      { ...LIMITS, documentBytes: 64 * 1024 * 1024, totalUncompressedBytes: 128 },
      'PROJECT_ARCHIVE_LIMIT',
    );
  });

  it('声明 originalSize 超限 → 提前拒绝（不解压即失败）', async () => {
    const zipBytes = zipSync({
      [MANIFEST_ENTRY]: enc('x'.repeat(1024)),
      [DOCUMENT_ENTRY]: new Uint8Array([1]),
    });
    await expectUnzipCode(zipBytes, { ...LIMITS, manifestBytes: 64 }, 'PROJECT_ARCHIVE_LIMIT');
  });
});
