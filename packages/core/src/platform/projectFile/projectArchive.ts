/**
 * fflate 封装（docs/20 §5.2/S1/D1）：打包/解包/条目校验。
 * 模块内必须 `await import('fflate')`——禁止顶层静态 import，确保 ZIP 库
 * 拆成按需异步 chunk、不进首屏（验收 A13）。
 *
 * 解包安全（§11.2）：流式逐条目解压，按**实际解压字节**计数限额（防 zip
 * bomb——声明大小只做预检）；未知条目不解压（fflate 未 start() 的条目只
 * 跳过原始压缩字节，D4），也不计入解压后总字节上限（§4.5）。
 */

import type { ProjectFileLimits } from '../../types/projectFile';
import { ProjectFileError } from './projectFileError';
import { isAssetEntryName } from './projectManifest';

export const MANIFEST_ENTRY = 'manifest.json';
export const DOCUMENT_ENTRY = 'document.yjs';
const ASSETS_DIR = 'assets/';

export interface IZipEntryInput {
  name: string;
  data: Uint8Array;
  /** 0 = 不压缩（图片已压缩）；默认 6 = deflate（§4.1 压缩策略）。fflate 的
   *  level 是 0-9 字面量联合，此处对齐避免类型漂移 */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** 异步打包（fflate zip 走 Worker，不阻塞主线程）；条目顺序按入参（manifest 第一） */
export async function zipProject(entries: IZipEntryInput[]): Promise<Uint8Array> {
  const { zip } = await import('fflate');
  const files: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};
  for (const e of entries) {
    if (e.name in files) {
      throw new ProjectFileError('PROJECT_ARCHIVE_INVALID', `打包条目重名：${e.name}`);
    }
    files[e.name] = [e.data, { level: e.level ?? 6 }];
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (err, data) => {
      if (err || !data) {
        reject(
          new ProjectFileError('PROJECT_ARCHIVE_INVALID', 'ZIP 打包失败', undefined, {
            cause: err,
          }),
        );
        return;
      }
      resolve(data);
    });
  });
}

export interface IUnzippedProject {
  manifestBytes: Uint8Array | null;
  documentBytes: Uint8Array | null;
  /** assets/<sha256> 的 id → 原始字节 */
  assets: Map<string, Uint8Array>;
  /** 未知条目数（§4.5：忽略 + warning；不解压） */
  unknownEntryCount: number;
}

/** 条目名路径安全（§11.2）：拒绝 `..`/反斜杠/NUL/绝对路径/盘符 */
function isSafeEntryName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes('\\') || name.includes('\0')) return false;
  if (name.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return !name.split('/').includes('..');
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * 解包并做条目级校验：压缩包大小/条目数/单条大小/总解压大小限额、条目名安全、
 * 已知条目（manifest.json / document.yjs / assets/<64hex>）去重。缺 manifest/
 * document 在此判定为 ARCHIVE_INVALID（§13.1）。
 */
export async function unzipProject(
  archive: Uint8Array,
  limits: ProjectFileLimits,
): Promise<IUnzippedProject> {
  // 压缩包大小限额下沉到解包入口（评审 P2-10）：导入层调用前虽已检查 file.size，
  //  直接调用本 API 也必须受同一限额保护
  if (archive.length > limits.archiveBytes) {
    throw new ProjectFileError(
      'PROJECT_ARCHIVE_LIMIT',
      `压缩包超过大小上限（${limits.archiveBytes} 字节）`,
    );
  }
  const { Unzip, UnzipInflate } = await import('fflate');
  const result: IUnzippedProject = {
    manifestBytes: null,
    documentBytes: null,
    assets: new Map(),
    unknownEntryCount: 0,
  };
  let entryTotal = 0;
  let totalUncompressed = 0;
  let failure: ProjectFileError | null = null;
  const fail = (err: ProjectFileError): void => {
    failure ??= err;
  };

  const unzipper = new Unzip();
  unzipper.onfile = (file) => {
    if (failure) return;
    entryTotal++;
    if (entryTotal > limits.entryCount) {
      fail(new ProjectFileError('PROJECT_ARCHIVE_LIMIT', `ZIP 条目数超过 ${limits.entryCount}`));
      return;
    }
    if (!isSafeEntryName(file.name)) {
      fail(new ProjectFileError('PROJECT_ARCHIVE_INVALID', `不安全的条目名：${file.name}`));
      return;
    }
    // 目录条目（§4.1：可有可无，导入方忽略）——不算未知条目、不解压
    if (file.name.endsWith('/')) return;

    const isManifest = file.name === MANIFEST_ENTRY;
    const isDocument = file.name === DOCUMENT_ENTRY;
    const isAsset = isAssetEntryName(file.name);
    if (!isManifest && !isDocument && !isAsset) {
      result.unknownEntryCount++;
      return; // 不 start()：不解压未知条目（D4）
    }
    const assetId = isAsset ? file.name.slice(ASSETS_DIR.length) : null;
    if (
      (isManifest && result.manifestBytes !== null) ||
      (isDocument && result.documentBytes !== null) ||
      (assetId !== null && result.assets.has(assetId))
    ) {
      fail(new ProjectFileError('PROJECT_ARCHIVE_INVALID', `已知条目重复：${file.name}`));
      return;
    }
    // 声明大小预检（originalSize 缺省的流式档案跳过；实际字节仍以 ondata 计数为准）
    const declared = file.originalSize;
    const singleLimit = isManifest
      ? limits.manifestBytes
      : isDocument
        ? limits.documentBytes
        : limits.assetBytes;
    if (declared !== undefined && declared > singleLimit) {
      fail(new ProjectFileError('PROJECT_ARCHIVE_LIMIT', `条目 ${file.name} 声明大小超限`));
      return;
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        fail(new ProjectFileError('PROJECT_ARCHIVE_INVALID', `条目解压失败：${file.name}`));
        return;
      }
      size += chunk.length;
      if (size > singleLimit) {
        fail(new ProjectFileError('PROJECT_ARCHIVE_LIMIT', `条目 ${file.name} 解压后超限`));
        return;
      }
      if (totalUncompressed + size > limits.totalUncompressedBytes) {
        fail(new ProjectFileError('PROJECT_ARCHIVE_LIMIT', 'ZIP 总解压字节超限'));
        return;
      }
      if (chunk.length > 0) chunks.push(chunk);
      if (final) {
        totalUncompressed += size;
        const data = concatBytes(chunks, size);
        if (isManifest) result.manifestBytes = data;
        else if (isDocument) result.documentBytes = data;
        else if (assetId !== null) result.assets.set(assetId, data);
      }
    };
    file.start();
  };
  unzipper.register(UnzipInflate);
  try {
    unzipper.push(archive, true);
  } catch (err) {
    throw new ProjectFileError('PROJECT_ARCHIVE_INVALID', 'ZIP 数据损坏', undefined, {
      cause: err,
    });
  }
  if (failure) throw failure;
  if (result.manifestBytes === null || result.documentBytes === null) {
    throw new ProjectFileError('PROJECT_ARCHIVE_INVALID', '缺少 manifest.json 或 document.yjs');
  }
  return result;
}
