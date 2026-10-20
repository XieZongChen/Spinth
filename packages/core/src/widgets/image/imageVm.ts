import { Graphics, Point, Sprite, Texture, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { type IHostGeom, type IRect } from '../../common/geometry';
import type { ImageData } from '../../types';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';
import { isAssetSrc, assetIdOf } from '../../platform/dataEngine/assetStore';

/** 资产解析器（Batch 2 资产服务）：spinth-asset: 引用 → blob URL（组合根注入
 *  AssetStore.objectURL；vm 不持全局依赖）。null = 无资产层（引用格式图退化
 *  占位——data URL / http 路径不走此通道） */
export type IAssetResolver = (src: string) => Promise<string | null>;

/** 占位框颜色（视觉规格：加载中/无图灰框 + 对角线） */
const PLACEHOLDER_FILL = 0xf1f5f9;
const PLACEHOLDER_STROKE = 0xcbd5e1;

/**
 * 图片视图层：显式 Image 元素解码 → Texture.from（P0 修复：PIXI Assets 管线
 * 对无扩展名 blob: URL 推断不出 parser），加载前灰框占位。rect 型几何
 * （root=世界坐标，sprite 拉伸到 state 宽高——保持比例由 Model
 * capabilities.keepRatio 交给 RectEditor 语义层）。
 * src 三形态（Batch 2）：data URL / http(s) 直载；spinth-asset:<hash> 经注入
 * 解析器取 blob（objectURL 引用计数，加载完成/失败即释放）。
 */
export class ImageVm extends BaseWidgetVm<ImageData & IRect> {
  private readonly placeholder = new Graphics();
  private sprite: Sprite | null = null;
  private loadedSrc = '';
  private destroyed = false;
  /** 组合根注入（widgetFactories resolve）——无资产层保持 null */
  private assetResolver: IAssetResolver | null = null;
  /** 资产引用加载中持有的 objectURL 的 assetId（释放配对） */
  private heldAssetId: string | null = null;

  /** 资产解析注入（组合根接线；不注入 = 引用格式退化占位） */
  setAssetResolver(resolver: IAssetResolver): void {
    this.assetResolver = resolver;
  }

  constructor() {
    super({
      id: '',
      type: 'IMAGE',
      zOrder: '',
      src: '',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.addChild(this.placeholder);
  }

  override render(_prev: ImageData & IRect, next: ImageData & IRect): void {
    this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
    this.root.scale.set(1);

    this.placeholder.clear();
    this.placeholder
      .rect(0, 0, next.width, next.height)
      .fill({ color: PLACEHOLDER_FILL })
      .stroke({ width: 1, color: PLACEHOLDER_STROKE });
    // 对角线（图片语义的通用视觉惯例）
    this.placeholder
      .moveTo(0, 0)
      .lineTo(next.width, next.height)
      .stroke({ width: 1, color: PLACEHOLDER_STROKE });

    if (next.src && next.src !== this.loadedSrc) {
      void this.loadSrc(next.src);
    } else if (this.sprite) {
      this.sprite.width = next.width;
      this.sprite.height = next.height;
      this.sprite.visible = true;
      this.placeholder.visible = false;
      markRender();
    } else if (!next.src) {
      this.placeholder.visible = true;
      this.sprite = null;
      markRender();
    }
  }

  /** 在途加载的 src（重入守卫：加载完成前 render 可再触发同 src 加载——
   *  无守卫时同一 vm 对同 src 多次 objectURL 计数累加、dispose 只释放一次，
   *  计数泄漏让资产永不被 GC，第三轮审查 E2E 实证） */
  private loadingSrc: string | null = null;
  /** 已放弃重试的 src（坏链/断网——防 render 每帧重试 decode） */
  private failedSrc = '';

  private async loadSrc(src: string): Promise<void> {
    if (this.loadingSrc === src) return; // 同 src 在途——防重入计数累加
    if (this.failedSrc === src) return; // 已失败过——src 变化前不重试
    this.loadingSrc = src;
    try {
      const url = await this.resolveSrcUrl(src);
      if (url === null) return; // 引用格式无解析器/资产 miss——保持占位
      // 显式 Image 解码（P0 修复）：PIXI Assets 管线对无扩展名 blob: URL 推断
      // 不出 parser（"could not be loaded"被静默吞）——Image 元素 + Texture.from
      // 绕开管线与 blob worker；跨源 http 图需 CORS 头（img-src 已放行）
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await img.decode();
      if (this.destroyed || this.state.src !== src) {
        this.releaseHeldAsset(); // 此刻 held 必为本会话所有（resolve 原子归属）
        return;
      }
      this.destroySprite();
      this.sprite = new Sprite(Texture.from(img));
      this.sprite.width = this.state.width;
      this.sprite.height = this.state.height;
      this.loadedSrc = src;
      this.failedSrc = '';
      this.placeholder.visible = false;
      this.root.addChild(this.sprite);
      markRender();
    } catch {
      this.failedSrc = src; // 加载失败保持占位；src 变化前不重试（render 每帧触发）
      this.releaseHeldAsset();
    } finally {
      if (this.loadingSrc === src) this.loadingSrc = null;
    }
  }

  /** src 三形态分流：引用格式经注入解析器（objectURL 引用计数），其余直载。
   *  held 归属原子化：await 期间 src 被替换/vm 销毁 → 本次计数即刻归还、
   *  不写 heldAssetId（防在途会话覆盖新会话的持有——丢归属即泄漏） */
  private async resolveSrcUrl(src: string): Promise<string | null> {
    this.releaseHeldAsset(); // 上一引用的配对释放（复用 vm 生命周期内多次换图）
    if (!isAssetSrc(src)) return src;
    if (!this.assetResolver) return null;
    const assetId = assetIdOf(src);
    const url = await this.assetResolver(src);
    if (!url) return null;
    if (this.destroyed || this.state.src !== src) {
      this.assetRelease?.(assetId); // 自己拿的自己还
      return null;
    }
    this.heldAssetId = assetId;
    return url;
  }

  private releaseHeldAsset(): void {
    // 释放走 resolver 注入的 store（同一实例的计数语义）；无持有即 no-op
    if (this.heldAssetId && this.assetRelease) {
      this.assetRelease(this.heldAssetId);
    }
    this.heldAssetId = null;
  }

  /** 释放回调（与 resolver 成对注入；vm 不持有 store 引用） */
  private assetRelease: ((assetId: string) => void) | null = null;

  setAssetRelease(release: (assetId: string) => void): void {
    this.assetRelease = release;
  }

  hitTestPoint(p: Point): boolean {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return pointInRotatedRect(
      p,
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  override hitTestRect(r: Rectangle): boolean {
    return rotatedRectIntersectsRect(this.getLocalRect(), this.state.rotation ?? 0, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
  }

  /** 世界 AABB（docs/05 §8 拆分；θ=0 与旧实现逐字节等价） */
  override getBounds(): IRect {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return rotatedRectBounds(
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  /** 数据矩形（未旋转局部系，docs/05 §8） */
  override getLocalRect(): IRect {
    return { x: this.state.x, y: this.state.y, width: this.state.width, height: this.state.height };
  }
  /** 锚定链宿主几何（docs/05 §8）：「放平矩形」= 以视觉中心（root.position，
   *  预览感知）为心、视觉尺寸的轴对齐矩形 + θ——anchorOf(rect, dir, θ) 的
   *  边中点向量相对中心正确（首版 off=R·pivot 反推是局部原点世界位，θ≠0 错） */
  override getHostGeom(): IHostGeom {
    const w = this.state.width * this.root.scale.x;
    const h = this.state.height * this.root.scale.y;
    return {
      rect: { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      rotation: this.root.rotation,
    };
  }

  override dispose(): void {
    this.destroyed = true;
    this.releaseHeldAsset(); // 资产计数归还先行——下方销毁异常不得中断释放链
    this.destroySprite();
    super.dispose();
  }

  /** sprite 与纹理分离销毁。PIXI 的 sprite.destroy({texture:true}) 选项路径
   *  曾抛 "reading 'destroy' of null"（中断 dispose 后续释放——objectURL
   *  计数泄漏的根因，第三轮审查 E2E 实证）——分离调用 + 防御 catch 保证
   *  释放链完整，销毁细节异常不再外溢 */
  private destroySprite(): void {
    const sprite = this.sprite;
    this.sprite = null;
    if (!sprite) return;
    const tex = sprite.texture;
    try {
      sprite.destroy();
      tex.destroy(true); // true = 连 textureSource 释放 GPU
    } catch (err) {
      console.warn('[spinth:image] sprite 销毁异常（忽略）', err);
    }
  }

  /** 调试/E2E 探针：sprite 已建（真渲染完成） */
  get hasSprite(): boolean {
    return this.sprite !== null;
  }
}
