/**
 * 项目导入编排（docs/20 §7）。不变量：**所有校验通过之前，不写资产、不写
 * 文档库、不触碰当前 Y.Doc**——当前画布的唯一影响是导入成功后的导航前
 * flush（best-effort warning，不阻塞结果）。
 */

import * as Y from 'yjs';
import { DocExistsError } from '../dataEngine/dbProvider';
import type { AssetStore } from '../dataEngine/assetStore';
import {
  DEFAULT_PROJECT_FILE_LIMITS,
  type IProjectImportOptions,
  type IProjectImportResult,
  type IProjectStats,
  type IProjectWarning,
  type ProjectAssetEntry,
  type ProjectFileLimits,
  type ProjectManifest,
} from '../../types/projectFile';
import { ProjectFileError, throwIfProjectAborted } from './projectFileError';
import { unzipProject } from './projectArchive';
import { ensureProjectCrypto, hashProjectBytes, parseProjectManifest } from './projectManifest';
import { collectProjectAssetRefs } from './projectAssetRefs';

/** 导航前 flush 的 best-effort 上限（§5.5：建议最多等 2s） */
const FLUSH_TIMEOUT_MS = 2000;
/** 新 docId 生成尝试上限（§7.2 步骤 7：冲突换 id 重试 5 次） */
const DOC_ID_ATTEMPTS = 5;

export interface IProjectImportDeps {
  /** 完整 AssetStore（设计 §5.2 deps；put 之外的方法供测试/调用方观察写入结果） */
  assetStore: AssetStore;
  createDoc: (docId: string, update: Uint8Array) => Promise<void>;
  flushCurrentDoc?: () => Promise<void>;
  randomDocId?: () => string;
  limits?: Partial<ProjectFileLimits>;
}

function defaultRandomDocId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!cryptoRef || typeof cryptoRef.randomUUID !== 'function') {
    // §8：crypto 不可用则失败，不退回弱随机
    throw new ProjectFileError('PROJECT_CRYPTO_UNAVAILABLE', '当前环境不支持安全随机 id');
  }
  return cryptoRef.randomUUID().slice(0, 8);
}

/** manifest 与解包内容逐条交叉校验（§7.2 步骤 4）；返回 manifest 声明的资产映射 */
async function verifyArchiveAgainstManifest(
  manifest: ProjectManifest,
  documentBytes: Uint8Array,
  archiveAssets: Map<string, Uint8Array>,
): Promise<void> {
  if (documentBytes.length !== manifest.document.bytes) {
    throw new ProjectFileError('PROJECT_DOCUMENT_INVALID', 'document.yjs 字节数与 manifest 不符');
  }
  const docHash = await hashProjectBytes(documentBytes);
  if (docHash !== manifest.document.sha256) {
    throw new ProjectFileError('PROJECT_DOCUMENT_INVALID', 'document.yjs 哈希与 manifest 不符');
  }
  for (const entry of manifest.assets) {
    const bytes = archiveAssets.get(entry.id);
    if (!bytes) {
      throw new ProjectFileError('PROJECT_ASSET_MISSING', '压缩包缺少 manifest 声明的资产', {
        assets: [entry.id],
      });
    }
    if (bytes.length !== entry.size) {
      throw new ProjectFileError('PROJECT_ASSET_INVALID', '资产字节数与 manifest 不符', {
        assets: [entry.id],
      });
    }
    const hash = await hashProjectBytes(bytes);
    if (hash !== entry.id) {
      throw new ProjectFileError('PROJECT_ASSET_INVALID', '资产内容哈希与 id 不符', {
        assets: [entry.id],
      });
    }
  }
}

/** 临时文档重建（§4.3）：apply 失败或顶层 widgets 非 Y.Array → DOCUMENT_INVALID */
function rebuildTempDoc(documentBytes: Uint8Array): { tempDoc: Y.Doc; yWidgets: Y.Array<unknown> } {
  const tempDoc = new Y.Doc();
  try {
    Y.applyUpdate(tempDoc, documentBytes);
  } catch (err) {
    tempDoc.destroy();
    throw new ProjectFileError('PROJECT_DOCUMENT_INVALID', 'document.yjs 无法应用', undefined, {
      cause: err,
    });
  }
  try {
    return { tempDoc, yWidgets: tempDoc.getArray('widgets') };
  } catch (err) {
    tempDoc.destroy();
    throw new ProjectFileError('PROJECT_DOCUMENT_INVALID', '顶层 widgets 不是 Y.Array', undefined, {
      cause: err,
    });
  }
}

export async function importProject(
  deps: IProjectImportDeps,
  file: Blob,
  opts?: IProjectImportOptions,
): Promise<IProjectImportResult> {
  const limits: ProjectFileLimits = { ...DEFAULT_PROJECT_FILE_LIMITS, ...deps.limits };
  throwIfProjectAborted(opts?.signal);
  ensureProjectCrypto();

  // 1. 压缩包大小检查（§7.2 步骤 1）
  if (file.size > limits.archiveBytes) {
    throw new ProjectFileError('PROJECT_ARCHIVE_LIMIT', '项目文件超过大小限制');
  }
  const archiveBytes = new Uint8Array(await file.arrayBuffer());

  // 2-3. 解包 + manifest 解析（版本预判在 parse 内先于 schema，§7.2 步骤 3）
  const unzipped = await unzipProject(archiveBytes, limits);
  throwIfProjectAborted(opts?.signal);
  const manifest = parseProjectManifest(new TextDecoder().decode(unzipped.manifestBytes!), limits);

  // 4. manifest 与压缩包逐条哈希/字节交叉校验
  await verifyArchiveAgainstManifest(manifest, unzipped.documentBytes!, unzipped.assets);
  throwIfProjectAborted(opts?.signal);

  // 5. 临时文档重建（隔离区机制在打开时生效——导入层不逐件校验 widget schema）
  const { tempDoc, yWidgets } = rebuildTempDoc(unzipped.documentBytes!);
  const warnings: IProjectWarning[] = [];
  let tempWidgetsCount = 0;
  try {
    // 6. 引用收集：文档引用必须全部在 manifest；未引用资产忽略 + warning
    const refs = collectProjectAssetRefs(yWidgets);
    tempWidgetsCount = yWidgets.length;
    if (refs.externalCount > 0) {
      warnings.push({ code: 'EXTERNAL_IMAGES_SKIPPED', count: refs.externalCount });
    }
    if (refs.dataUrlCount > 0) {
      warnings.push({ code: 'DATA_URL_IMAGES_INCLUDED', count: refs.dataUrlCount });
    }
    const manifestById = new Map<string, ProjectAssetEntry>(manifest.assets.map((a) => [a.id, a]));
    const missing = [...refs.assetIds].filter((id) => !manifestById.has(id));
    if (missing.length > 0) {
      throw new ProjectFileError('PROJECT_ASSET_MISSING', '文档引用的资产不在项目文件中', {
        assets: missing,
      });
    }
    const unreferenced = manifest.assets.filter((a) => !refs.assetIds.has(a.id));
    if (unreferenced.length > 0) {
      warnings.push({ code: 'UNREFERENCED_ASSETS_IGNORED', count: unreferenced.length });
    }
    if (tempWidgetsCount === 0) warnings.push({ code: 'EMPTY_PROJECT' });
    if (unzipped.unknownEntryCount > 0) {
      warnings.push({ code: 'UNKNOWN_ARCHIVE_ENTRIES_IGNORED', count: unzipped.unknownEntryCount });
    }

    // 8. 写资产（只写被引用的；内容寻址——已存在同 id 幂等命中）
    const referencedAssets = manifest.assets
      .filter((a) => refs.assetIds.has(a.id))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    let assetBytes = 0;
    for (const entry of referencedAssets) {
      throwIfProjectAborted(opts?.signal);
      const bytes = unzipped.assets.get(entry.id)!;
      assetBytes += bytes.length;
      // 解包产物是精确长度普通 ArrayBuffer 视图——收窄满足 BlobPart
      const bytesView = bytes as Uint8Array<ArrayBuffer>;
      try {
        const ref = await deps.assetStore.put(new Blob([bytesView], { type: entry.mime }));
        if (ref.id !== entry.id) {
          // 内容寻址不变量被破坏（库返回 id ≠ 内容哈希）——视为写入失败
          throw new Error(`assetStore.put 返回 id 不符：${ref.id} ≠ ${entry.id}`);
        }
      } catch (err) {
        throw new ProjectFileError(
          'PROJECT_STORAGE_WRITE_FAILED',
          '资产写入本地库失败',
          {
            phase: 'assets',
            assets: [entry.id],
          },
          { cause: err },
        );
      }
    }

    // 7/9. 新 docId + 写新文档（DOC_EXISTS 换 id 重试至多 5 次）
    const randomDocId = deps.randomDocId ?? defaultRandomDocId;
    let newDocId: string | null = null;
    for (let attempt = 0; attempt < DOC_ID_ATTEMPTS; attempt++) {
      const candidate = randomDocId();
      throwIfProjectAborted(opts?.signal);
      try {
        await deps.createDoc(candidate, unzipped.documentBytes!);
        newDocId = candidate;
        break;
      } catch (err) {
        if (err instanceof DocExistsError) continue; // 换 id 重试
        throw new ProjectFileError(
          'PROJECT_STORAGE_WRITE_FAILED',
          '新文档库写入失败',
          {
            phase: 'document',
          },
          { cause: err },
        );
      }
    }
    if (newDocId === null) {
      throw new ProjectFileError('PROJECT_DOC_ID_COLLISION', '多次生成的新画布 id 均已存在');
    }

    // 10. 导航前 flush（best-effort + 2s 上限）：失败仅 warning，不阻塞导入结果。
    //  persistState 检查由注入的 flushCurrentDoc 承担（boardComposition 包装：
    //  flush 后 persistState==='failed' 即 reject——§5.5）
    if (deps.flushCurrentDoc) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const flushed = await Promise.race([
          deps.flushCurrentDoc().then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS);
          }),
        ]).catch(() => false);
        if (!flushed) warnings.push({ code: 'CURRENT_DOC_FLUSH_FAILED' });
      } finally {
        clearTimeout(timer);
      }
    }

    const stats: IProjectStats = {
      widgets: tempWidgetsCount,
      documentBytes: unzipped.documentBytes!.length,
      assetCount: referencedAssets.length,
      assetBytes,
      archiveBytes: file.size,
    };
    return { docId: newDocId, sourceDocId: manifest.sourceDocId, stats, warnings };
  } finally {
    tempDoc.destroy();
  }
}
