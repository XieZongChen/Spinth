/**
 * 项目文件门面（specs/api-surface §3.6）——exportProject / importProject 与
 * NOT_READY 守卫自 app.ts 迁出。判定与错误类型不变
 * （ProjectFileError('PROJECT_NOT_READY', '画布未初始化或已释放')）。
 */
import type {
  IProjectExportOptions,
  IProjectExportResult,
  IProjectImportOptions,
  IProjectImportResult,
} from './types/projectFile';
import { ProjectFileError } from './platform/projectFile/projectFileError';
import type { ProjectFileService } from './platform/projectFile/projectFileService';
import type { IBoardProjectHost } from './boardHost';

/** 组装前/释放后调用项目文件门面 → 统一 NOT_READY（与 getDoc 判空同源） */
function expectProjectFile(host: IBoardProjectHost): ProjectFileService {
  if (!host.projectFile) {
    throw new ProjectFileError('PROJECT_NOT_READY', '画布未初始化或已释放');
  }
  return host.projectFile;
}

/** 导出当前画布为 .spinth.zip（docs/20 §5.3：门面仅委托） */
export async function exportProject(
  host: IBoardProjectHost,
  opts?: IProjectExportOptions,
): Promise<IProjectExportResult> {
  return expectProjectFile(host).exportProject(opts);
}

/** 导入项目文件为新的本地画布（docs/20 §7：校验全通过才写库，不触碰当前画布） */
export async function importProject(
  host: IBoardProjectHost,
  file: Blob,
  opts?: IProjectImportOptions,
): Promise<IProjectImportResult> {
  return expectProjectFile(host).importProject(file, opts);
}
