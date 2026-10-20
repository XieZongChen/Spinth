/**
 * 项目文件错误模型（docs/20 §5.1/§10）：core 抛 `ProjectFileError`，app 只消费
 * `code` 映射中文提示，不解析 message。message 仅开发诊断（console.error 记录），
 * 不得塞入原始二进制/JSON 内容。
 */

export type ProjectFileErrorCode =
  | 'PROJECT_NOT_READY'
  | 'PROJECT_ABORTED'
  | 'PROJECT_CRYPTO_UNAVAILABLE'
  | 'PROJECT_ARCHIVE_INVALID'
  | 'PROJECT_ARCHIVE_LIMIT'
  | 'PROJECT_MANIFEST_INVALID'
  | 'PROJECT_VERSION_UNSUPPORTED'
  | 'PROJECT_DOCUMENT_INVALID'
  | 'PROJECT_DOCUMENT_LIMIT'
  | 'PROJECT_ASSET_MISSING'
  | 'PROJECT_ASSET_INVALID'
  | 'PROJECT_ASSET_LIMIT'
  | 'PROJECT_DOC_ID_COLLISION'
  | 'PROJECT_STORAGE_WRITE_FAILED';

/** 结构化细节（如 `{ assets: string[], phase: 'assets' | 'document' }`），
 *  只放 id/阶段等短事实，不放数据本体 */
export interface IProjectFileErrorDetails {
  assets?: string[];
  phase?: 'assets' | 'document';
  [key: string]: unknown;
}

export class ProjectFileError extends Error {
  readonly code: ProjectFileErrorCode;
  readonly details?: IProjectFileErrorDetails;

  constructor(
    code: ProjectFileErrorCode,
    message: string,
    details?: IProjectFileErrorDetails,
    options?: ErrorOptions,
  ) {
    super(`[${code}] ${message}`, options);
    this.name = 'ProjectFileError';
    this.code = code;
    this.details = details;
  }
}

/** 统一的中止检查：signal 已取消 → PROJECT_ABORTED（§10：静默处理，不弹提示） */
export function throwIfProjectAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ProjectFileError('PROJECT_ABORTED', '操作已被用户取消');
  }
}
