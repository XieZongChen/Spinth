/**
 * ProjectFileService（docs/20 §5.2）：依赖注入的导出/导入门面。
 * 不注册 ServiceRegistry 单例；由 boardComposition 构造并赋 sdk.projectFile
 * （@internal）。dispose 后一切调用返回 PROJECT_NOT_READY。
 */

import type * as Y from 'yjs';
import type { AssetStore } from '../dataEngine/assetStore';
import type {
  IProjectExportOptions,
  IProjectExportResult,
  IProjectImportOptions,
  IProjectImportResult,
  ProjectFileLimits,
} from '../../types/projectFile';
import { ProjectFileError } from './projectFileError';
import { exportProject, type IProjectExportDeps } from './projectExport';
import { importProject, type IProjectImportDeps } from './projectImport';

export interface IProjectFileServiceDeps {
  getDoc: () => { yDoc: Y.Doc; yWidgets: Y.Array<unknown>; docId: string } | null;
  assetStore: AssetStore;
  appVersion: string;
  createDoc: (docId: string, update: Uint8Array) => Promise<void>;
  flushCurrentDoc?: () => Promise<void>;
  randomDocId?: () => string;
  now?: () => Date;
  limits?: Partial<ProjectFileLimits>;
}

export class ProjectFileService {
  private disposed = false;

  constructor(private readonly deps: IProjectFileServiceDeps) {}

  /** 导出当前画布（纯读，§6）。async 保证门卫异常以拒绝而非同步抛出 */
  async exportProject(opts?: IProjectExportOptions): Promise<IProjectExportResult> {
    this.assertReady();
    const exportDeps: IProjectExportDeps = {
      getDoc: this.deps.getDoc,
      assetStore: this.deps.assetStore,
      appVersion: this.deps.appVersion,
      now: this.deps.now,
      limits: this.deps.limits,
    };
    return exportProject(exportDeps, opts);
  }

  /** 导入项目文件为**新**本地画布（§7：校验全部通过后才写库）。导入虽不读当前
   *  文档，但按设计 §5.2 契约：画布未 synced（初始化失败/未就绪）时一并拒绝 */
  async importProject(file: Blob, opts?: IProjectImportOptions): Promise<IProjectImportResult> {
    this.assertReady();
    if (!this.deps.getDoc()) {
      throw new ProjectFileError('PROJECT_NOT_READY', '画布未就绪（未同步或已释放）');
    }
    const importDeps: IProjectImportDeps = {
      assetStore: this.deps.assetStore,
      createDoc: this.deps.createDoc,
      flushCurrentDoc: this.deps.flushCurrentDoc,
      randomDocId: this.deps.randomDocId,
      limits: this.deps.limits,
    };
    return importProject(importDeps, file, opts);
  }

  dispose(): void {
    this.disposed = true;
  }

  private assertReady(): void {
    if (this.disposed) {
      throw new ProjectFileError('PROJECT_NOT_READY', '项目文件服务已释放');
    }
  }
}
