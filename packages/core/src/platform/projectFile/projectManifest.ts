/**
 * manifest.json 构建/序列化/解析（docs/20 §4.2）。
 * 解析路径 = 版本预判（裸读 format/version，避免把「版本过新」误报成普通损坏）
 * → zod schema → 交叉校验（path/mime/createdAt/去重/条目上限）。
 */

import { z } from 'zod';
import { sha256Hex } from '../dataEngine/assetStore';
import {
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  ProjectManifestSchema,
  type ProjectAssetEntry,
  type ProjectFileLimits,
  type ProjectManifest,
} from '../../types/projectFile';
import { ProjectFileError } from './projectFileError';

const SHA256_RE = /^[0-9a-f]{64}$/;

/** crypto.subtle 可用性守卫（§11.3：不可用即失败，不做无校验导出/导入） */
export function ensureProjectCrypto(): void {
  const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (!subtle || typeof (subtle as { digest?: unknown }).digest !== 'function') {
    throw new ProjectFileError(
      'PROJECT_CRYPTO_UNAVAILABLE',
      '当前环境不支持 crypto.subtle 安全校验',
    );
  }
}

export async function hashProjectBytes(bytes: Uint8Array): Promise<string> {
  ensureProjectCrypto();
  const copy = new Uint8Array(bytes);
  return sha256Hex(copy.buffer as ArrayBuffer);
}

/** 导出侧构建 manifest（§6 步骤 5）：assets 由调用方按 id 升序传入；
 *  空 MIME 归一为 image/png；document 哈希/字节数由内容计算 */
export async function buildProjectManifest(input: {
  sourceDocId: string;
  appVersion: string;
  now: Date;
  documentBytes: Uint8Array;
  assets: Array<{ id: string; mime: string; size: number }>;
}): Promise<{ manifest: ProjectManifest; jsonBytes: Uint8Array }> {
  const assets: ProjectAssetEntry[] = input.assets.map((a) => ({
    id: a.id,
    path: `assets/${a.id}`,
    mime: a.mime.length > 0 ? a.mime : 'image/png',
    size: a.size,
  }));
  const manifest: ProjectManifest = {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    createdAt: input.now.toISOString(),
    generator: { name: 'spinth', version: input.appVersion },
    sourceDocId: input.sourceDocId,
    document: {
      kind: 'yjs-update',
      path: 'document.yjs',
      bytes: input.documentBytes.length,
      sha256: await hashProjectBytes(input.documentBytes),
    },
    assets,
  };
  return { manifest, jsonBytes: serializeProjectManifest(manifest) };
}

/** §4.2：JSON.stringify(manifest, null, 2) + 尾随换行（UTF-8，不写 BOM），便于人工检查 */
export function serializeProjectManifest(manifest: ProjectManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** 容忍 BOM 的 JSON 解析（§4.2：实现可容忍 BOM，但导出不写） */
function parseJsonLoose(text: string): unknown {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(stripped) as unknown;
}

/**
 * 解析并校验 manifest 文本。失败路径（按序短路）：
 * 1. JSON 语法坏 → PROJECT_MANIFEST_INVALID；
 * 2. format 匹配且 version > 当前 → PROJECT_VERSION_UNSUPPORTED（先于 schema，
 *    避免误报为普通损坏）；
 * 3. zod / 交叉校验失败 → PROJECT_MANIFEST_INVALID。
 */
export function parseProjectManifest(
  jsonText: string,
  limits: Pick<ProjectFileLimits, 'assetCount'>,
): ProjectManifest {
  let raw: unknown;
  try {
    raw = parseJsonLoose(jsonText);
  } catch {
    throw new ProjectFileError('PROJECT_MANIFEST_INVALID', 'manifest.json 不是合法 JSON');
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as { format?: unknown; version?: unknown };
    if (obj.format === PROJECT_FORMAT && typeof obj.version === 'number') {
      if (!Number.isInteger(obj.version)) {
        throw new ProjectFileError('PROJECT_MANIFEST_INVALID', 'manifest version 非整数');
      }
      if (obj.version > PROJECT_FORMAT_VERSION) {
        throw new ProjectFileError(
          'PROJECT_VERSION_UNSUPPORTED',
          `项目文件版本过新（v${obj.version}），当前 spinth 仅支持 v${PROJECT_FORMAT_VERSION}`,
        );
      }
    }
  }

  let manifest: ProjectManifest;
  try {
    manifest = ProjectManifestSchema.parse(raw);
  } catch (err) {
    throw new ProjectFileError(
      'PROJECT_MANIFEST_INVALID',
      `manifest 字段校验失败：${err instanceof z.ZodError ? err.issues.length : 1} 处问题`,
    );
  }

  // 交叉校验（§4.2 约束）
  if (Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new ProjectFileError('PROJECT_MANIFEST_INVALID', 'createdAt 不是可解析的 ISO 时间');
  }
  if (manifest.assets.length > limits.assetCount) {
    throw new ProjectFileError('PROJECT_MANIFEST_INVALID', 'manifest 资产条目数超上限', {
      phase: 'assets',
    });
  }
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const a of manifest.assets) {
    if (a.path !== `assets/${a.id}`) {
      throw new ProjectFileError('PROJECT_MANIFEST_INVALID', `资产 path 必须为 assets/<id>`, {
        assets: [a.id],
      });
    }
    if (!/^image\//i.test(a.mime)) {
      throw new ProjectFileError('PROJECT_MANIFEST_INVALID', `资产 MIME 必须为 image/*`, {
        assets: [a.id],
      });
    }
    if (seenIds.has(a.id) || seenPaths.has(a.path)) {
      throw new ProjectFileError('PROJECT_MANIFEST_INVALID', '资产 id/path 重复', {
        assets: [a.id],
      });
    }
    seenIds.add(a.id);
    seenPaths.add(a.path);
  }
  return manifest;
}

/** 资产 id 形状校验（导入侧对 manifest 外的条目名复用） */
export function isAssetEntryName(name: string): boolean {
  return name.startsWith('assets/') && SHA256_RE.test(name.slice('assets/'.length));
}
