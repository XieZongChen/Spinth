import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type { Point } from 'pixi.js';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import { AssetStore, type IAssetRef } from '../../platform/dataEngine/assetStore';
import { ImageVm } from './imageVm';

/** 图片长边上限（视觉规格：粘贴/拖入大图先缩到可操作尺寸） */
const MAX_IMAGE_EDGE = 480;
/** 字节上限（Batch 1 · 1.18）：data URL 原文进 Yjs——超限拒绝（防单文档
 *  撑爆同步帧/持久化体积；资产服务（blob 存储+引用）是 Batch 2 方向） */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 超限守卫（粘贴/拖放共用）：返回 false = 已拒绝并告警 */
function rejectOversized(blob: Blob): boolean {
  if (blob.size <= MAX_IMAGE_BYTES) return true;
  console.warn(
    `[spinth:image] 图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限已拒绝 (${Math.round(blob.size / 1024 / 1024)}MB)`,
  );
  return false;
}

/**
 * 图片交互层（Phase 2 尾）：拖放文件到画布创建 + 粘贴系统剪贴板图片
 * （ClipboardService 检出 image blob 后经组合根接线调 pasteImage）。
 * 无工具栏文件选择入口（app 壳需要时经 BoardSDK 扩展接入，本类已提供
 * addImageAt 命令面——core 组合根暂未导出该命令，接入时补）。
 */
export class ImageService extends Disposable {
  /** 资产层（Batch 2 资产服务首版）：blob 入库、文档只存 spinth-asset:<hash>
   *  引用（data URL 不再进 Yjs——同步帧/快照/持久化体积塌缩）。可注入 null
   *  （无 IDB 环境）退化 data URL 旧路径 */
  private readonly assets: AssetStore | null;

  constructor(
    private viewport: IViewportService,
    private engine: IDataEngineService,
    private history: IHistoryService,
    private selector: ISelectorService,
    assetStore: AssetStore | null = null,
    /** 双击手动重试需要按命中点找 IMAGE VM（组合根传 sdk.vmEngine） */
    private vmEngine: IVmEngineService | null = null,
  ) {
    super();
    this.assets = assetStore;
  }

  initialize(): void {
    const el = this.viewport.container;
    if (!el) return;
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault(); // 允许 drop
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      if (!this.viewport.editable$.value) return;
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file || !rejectOversized(file)) return;
      const world = this.viewport.clientToWorld(e.clientX, e.clientY);
      void this.storeAndAdd(file, { x: world.x, y: world.y });
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    this.addDisposable(
      () => el.removeEventListener('dragover', onDragOver),
      () => el.removeEventListener('drop', onDrop),
    );
    if (typeof window !== 'undefined') {
      // 双击失败/缺失图手动重试（docs/19 §4）：模式与 lineService.onLineDblClick
      // 对齐——capture 相 window 监听，只认画布 target，工具期不接管
      window.addEventListener('dblclick', this.onDblClick, true);
      this.addDisposable(() => window.removeEventListener('dblclick', this.onDblClick, true));
    }
  }

  /** 双击画布上的 IMAGE → 手动重试加载（仅终态失败态生效，loaded no-op）。
   *  只读标签允许重试（纯本地渲染，不写文档）；不加 editable 闸门 */
  private onDblClick = (e: MouseEvent): void => {
    if (!this.vmEngine) return;
    if (!(e.target instanceof HTMLCanvasElement)) return; // 排除 DOM 控件双击
    if (this.viewport.cursorMode$.value !== 'cursor') return; // 画笔/连线等工具期不接管
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    for (const vm of this.vmEngine.getVmByPoint({ x: world.x, y: world.y } as Point)) {
      if (vm instanceof ImageVm) {
        vm.retry();
        return;
      }
    }
  };

  /** 粘贴系统剪贴板图片（组合根由 ClipboardService.onPasteImage 接入） */
  pasteImage(blob: Blob): void {
    if (!this.viewport.editable$.value || !rejectOversized(blob)) return;
    const b = this.viewport.vpBounds$.value;
    void this.storeAndAdd(blob, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }

  /** blob 入库（资产引用）→ 建件；协同态退 data URL 旧路径（P0 修复：
   *  spinth-asset 引用指向本机 IndexedDB，他端无 blob 且无 server 资产端点
   *  （二期）——协同文档写引用 = 他端永久灰框。单机态才资产化）；
   *  资产层写入失败（配额满/隐私模式/IDB 禁用——第三轮审查：曾静默无图
   *  无提示）回退 data URL 旧路径 */
  private async storeAndAdd(blob: Blob, at: { x: number; y: number }): Promise<string | null> {
    if (this.assets && this.engine.wsState$.value === 'off') {
      try {
        const size = await this.measureBlob(blob);
        const ref: IAssetRef = await this.assets.put(blob);
        return this.addImageWithSize(ref.src, size, at);
      } catch (err) {
        console.warn('[spinth:image] 资产入库失败，回退 data URL 路径', err);
      }
    }
    const src = await this.blobToDataUrl(blob);
    return this.addImageAt(src, at);
  }

  /** blob 原始尺寸解码（不经 URL——资产路径省一次串行化） */
  private async measureBlob(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = (): void => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = (): void => {
        resolve({ width: MAX_IMAGE_EDGE / 2, height: MAX_IMAGE_EDGE / 3 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async addImageAt(src: string, at: { x: number; y: number }): Promise<string | null> {
    if (!src) return null;
    const size = await this.measure(src);
    return this.addImageWithSize(src, size, at);
  }

  /** 尺寸已知路径的建件（资产/旧路径共用） */
  private addImageWithSize(
    src: string,
    size: { width: number; height: number },
    at: { x: number; y: number },
  ): string | null {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(size.width, size.height) || 1);
    const width = Math.max(Math.round(size.width * scale), 1);
    const height = Math.max(Math.round(size.height * scale), 1);
    const id = genId();
    this.engine.add({
      id,
      type: 'IMAGE',
      zOrder: this.engine.genInitialOrder(),
      src,
      x: Math.round(at.x - width / 2),
      y: Math.round(at.y - height / 2),
      width,
      height,
    } as never);
    this.history.stopCapturing();
    this.selector.setSelected([id]);
    return id;
  }

  private measure(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = (): void => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = (): void => resolve({ width: MAX_IMAGE_EDGE / 2, height: MAX_IMAGE_EDGE / 3 });
      img.src = src;
    });
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => resolve(String(reader.result));
      reader.onerror = (): void => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}
