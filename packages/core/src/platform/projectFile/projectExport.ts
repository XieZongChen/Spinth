/**
 * 项目导出编排（docs/20 §6，纯读）：只读 Y.Doc 与 AssetStore，不写 Yjs、
 * 不产生 undo。快照后用户继续编辑不影响本次导出——内容寻址资产不可变，
 * Yjs 状态快照取自单一时点。
 */

import * as Y from 'yjs';
import type { AssetStore } from '../dataEngine/assetStore';
import {
  DEFAULT_PROJECT_FILE_LIMITS,
  type IProjectExportOptions,
  type IProjectExportResult,
  type IProjectStats,
  type IProjectWarning,
  type ProjectFileLimits,
} from '../../types/projectFile';
import { ProjectFileError, throwIfProjectAborted } from './projectFileError';
import { buildProjectManifest, hashProjectBytes } from './projectManifest';
import { zipProject, type IZipEntryInput } from './projectArchive';
import { collectProjectAssetRefs } from './projectAssetRefs';

export interface IProjectExportDeps {
  getDoc: () => { yDoc: Y.Doc; yWidgets: Y.Array<unknown>; docId: string } | null;
  assetStore: Pick<AssetStore, 'get'>;
  appVersion: string;
  now?: () => Date;
  limits?: Partial<ProjectFileLimits>;
}

/** 导出文件名安全化（§4.1）：仅保留 [A-Za-z0-9_-]，最长 32；空则回退 'doc' */
function safeDocIdForFileName(docId: string): string {
  const safe = docId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return safe.length > 0 ? safe : 'doc';
}

/** 时间戳 YYYYMMDD-HHmmss（UTC——本机无关、测试可注入 clock 复现） */
function formatTimestamp(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export async function exportProject(
  deps: IProjectExportDeps,
  opts?: IProjectExportOptions,
): Promise<IProjectExportResult> {
  const limits: ProjectFileLimits = { ...DEFAULT_PROJECT_FILE_LIMITS, ...deps.limits };
  throwIfProjectAborted(opts?.signal);
  const doc = deps.getDoc();
  if (!doc) {
    throw new ProjectFileError('PROJECT_NOT_READY', '画布未就绪（未同步或已释放）');
  }

  // 单一时点快照：widget 数据 + tombstone 全量
  const documentBytes = Y.encodeStateAsUpdate(doc.yDoc);
  if (documentBytes.length > limits.documentBytes) {
    throw new ProjectFileError(
      'PROJECT_DOCUMENT_LIMIT',
      `文档快照超过 ${limits.documentBytes} 字节`,
    );
  }

  const refs = collectProjectAssetRefs(doc.yWidgets);
  const warnings: IProjectWarning[] = [];
  if (refs.externalCount > 0) {
    warnings.push({ code: 'EXTERNAL_IMAGES_SKIPPED', count: refs.externalCount });
  }
  if (refs.dataUrlCount > 0) {
    warnings.push({ code: 'DATA_URL_IMAGES_INCLUDED', count: refs.dataUrlCount });
  }

  const assetIds = [...refs.assetIds].sort();
  if (assetIds.length > limits.assetCount) {
    throw new ProjectFileError('PROJECT_ASSET_LIMIT', `资产条目数超过 ${limits.assetCount}`);
  }

  const assetEntries: Array<{ id: string; mime: string; size: number; bytes: Uint8Array }> = [];
  let assetBytes = 0;
  for (const id of assetIds) {
    throwIfProjectAborted(opts?.signal);
    const blob = await deps.assetStore.get(id);
    if (!blob) {
      throw new ProjectFileError('PROJECT_ASSET_MISSING', '资产库缺少被引用的图片', {
        assets: [id],
      });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > limits.assetBytes) {
      throw new ProjectFileError('PROJECT_ASSET_LIMIT', '单个资产超过大小上限', { assets: [id] });
    }
    assetBytes += bytes.length;
    if (assetBytes > limits.totalAssetBytes) {
      throw new ProjectFileError('PROJECT_ARCHIVE_LIMIT', '资产总字节超过上限');
    }
    // §4.4：导出前重算哈希并与 id 比对——不一致拒绝导出，避免产出自校验失败的备份
    const actualHash = await hashProjectBytes(bytes);
    if (actualHash !== id) {
      throw new ProjectFileError('PROJECT_ASSET_INVALID', '资产内容与 id 哈希不符', {
        assets: [id],
      });
    }
    assetEntries.push({ id, mime: blob.type, size: bytes.length, bytes });
  }

  const now = deps.now?.() ?? new Date();
  const { manifest, jsonBytes } = await buildProjectManifest({
    sourceDocId: doc.docId,
    appVersion: deps.appVersion,
    now,
    documentBytes,
    assets: assetEntries.map(({ id, mime, size }) => ({ id, mime, size })),
  });

  const entries: IZipEntryInput[] = [
    { name: 'manifest.json', data: jsonBytes, level: 6 },
    { name: 'document.yjs', data: documentBytes, level: 6 },
    ...assetEntries.map((a): IZipEntryInput => {
      return { name: `assets/${a.id}`, data: a.bytes, level: 0 };
    }),
  ];
  const zipBytes = await zipProject(entries);

  const widgetCount = doc.yWidgets.length;
  if (widgetCount === 0) warnings.push({ code: 'EMPTY_PROJECT' });

  const stats: IProjectStats = {
    widgets: widgetCount,
    documentBytes: documentBytes.length,
    assetCount: assetEntries.length,
    assetBytes,
    archiveBytes: zipBytes.length,
  };
  const fileName = `spinth-${safeDocIdForFileName(doc.docId)}-${formatTimestamp(now)}.spinth.zip`;
  // fflate 产物是精确长度的普通 ArrayBuffer 视图（无 SharedArrayBuffer 场景），
  //  收窄类型以满足 BlobPart
  const archiveView = zipBytes as Uint8Array<ArrayBuffer>;
  return {
    blob: new Blob([archiveView], { type: 'application/zip' }),
    fileName,
    manifest,
    stats,
    warnings,
  };
}
