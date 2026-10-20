/**
 * 项目文件（.spinth.zip）公共契约（docs/20 §5.1，格式 v1 定稿 2026-10-21）。
 * 格式规则见 §4；限额见 §11.1。zod schema 是文件边界的唯一运行时校验源——
 * 导入路径不得把 manifest 字段当可信类型直接使用。
 */

import { z } from 'zod';

/** 容器内 manifest.json 的 `format` 字面量（§4.2） */
export const PROJECT_FORMAT = 'spinth-project' as const;
/** 当前格式版本（S7：新增必需字段/改变语义必须升版本；旧版导入方拒绝更高版本） */
export const PROJECT_FORMAT_VERSION = 1 as const;

export const ProjectAssetEntrySchema = z.object({
  /** 小写 64 位十六进制 SHA-256，且必须与文件内容一致（§4.4 交叉校验） */
  id: z.string().regex(/^[0-9a-f]{64}$/),
  /** 必须等于 `assets/<id>`（构建时生成，解析时交叉校验） */
  path: z.string(),
  /** v1 仅允许 image/*；空 MIME 导出时归一为 image/png */
  mime: z.string().min(1).max(128),
  size: z.number().int().positive(),
});

export const ProjectManifestSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_FORMAT_VERSION),
  /** ISO 8601；仅诊断/展示，不参与恢复 */
  createdAt: z.string().min(1).max(64),
  generator: z.object({
    name: z.literal('spinth'),
    version: z.string().min(1).max(64),
  }),
  /** 导出时的 docId；仅标识来源，导入不沿用为本地 docId */
  sourceDocId: z.string().min(1).max(128),
  document: z.object({
    kind: z.literal('yjs-update'),
    path: z.literal('document.yjs'),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  assets: z.array(ProjectAssetEntrySchema),
});

export type ProjectAssetEntry = z.infer<typeof ProjectAssetEntrySchema>;
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

/** 结果警告（§5.1）：不阻断导出/导入，UI 按需提示 */
export type ProjectWarningCode =
  | 'EXTERNAL_IMAGES_SKIPPED'
  | 'DATA_URL_IMAGES_INCLUDED'
  | 'EMPTY_PROJECT'
  | 'UNKNOWN_ARCHIVE_ENTRIES_IGNORED'
  | 'UNREFERENCED_ASSETS_IGNORED'
  | 'CURRENT_DOC_FLUSH_FAILED';

export interface IProjectWarning {
  code: ProjectWarningCode;
  count?: number;
}

export interface IProjectStats {
  widgets: number;
  documentBytes: number;
  assetCount: number;
  assetBytes: number;
  archiveBytes: number;
}

export interface IProjectExportResult {
  blob: Blob;
  fileName: string;
  manifest: ProjectManifest;
  stats: IProjectStats;
  warnings: IProjectWarning[];
}

export interface IProjectImportResult {
  docId: string;
  sourceDocId: string;
  stats: IProjectStats;
  warnings: IProjectWarning[];
}

export interface IProjectExportOptions {
  signal?: AbortSignal;
}

export interface IProjectImportOptions {
  signal?: AbortSignal;
}

/** 安全与限额（§11.1，默认值集中常量化；测试可注入更小值） */
export interface ProjectFileLimits {
  /** 压缩包文件本身大小上限 */
  archiveBytes: number;
  manifestBytes: number;
  documentBytes: number;
  /** 单个资产解压后大小上限 */
  assetBytes: number;
  /** 全部资产解压后总字节上限 */
  totalAssetBytes: number;
  /** ZIP 全部条目解压后总字节上限（zip bomb 防线） */
  totalUncompressedBytes: number;
  assetCount: number;
  entryCount: number;
}

export const DEFAULT_PROJECT_FILE_LIMITS: ProjectFileLimits = {
  archiveBytes: 160 * 1024 * 1024,
  manifestBytes: 1 * 1024 * 1024,
  documentBytes: 64 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  totalAssetBytes: 128 * 1024 * 1024,
  totalUncompressedBytes: 200 * 1024 * 1024,
  assetCount: 256,
  entryCount: 512,
};
