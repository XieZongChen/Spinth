import { Graphics, Point, Sprite, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { type IHostGeom, type IRect } from '../../common/geometry';
import type { ImageData } from '../../types';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';
import {
  ImageLoadController,
  type IImageLoadHost,
  type IImageTexturePort,
  type ImageLoadState,
} from './imageLoadController';

/** 占位框颜色。empty/loading 是中性灰；failed/missing 是错误语义色——
 *  错误态不是主题色（不随主题切换），独立常量置顶 */
const PLACEHOLDER_FILL = 0xf1f5f9;
const PLACEHOLDER_STROKE = 0xcbd5e1;
/** 红：解码/建纹失败（自动重试耗尽后终态，可双击手动重试） */
const FAILED_STROKE = 0xdc2626;
/** 琥珀：资产行缺失（可双击手动重试——他端/异步稍后可能写入） */
const MISSING_STROKE = 0xd97706;

/**
 * 图片视图层：几何/占位/sprite 生命周期。加载会话与纹理租约全部委托
 * ImageLoadController（组合根经 setImageTextures 注入；未注入保持占位——
 * BoardSDK.initialize 必经 composeBoard，宿主不直接 new VM）。
 * 纹理归缓存租约所有：destroySprite 只销毁 sprite 自身，绝不销毁纹理
 * （同图多实例共享一份 GPU 纹理，docs/19 §3）。
 * rect 型几何（root=世界坐标，sprite 拉伸到 state 宽高——保持比例由
 * Model capabilities.keepRatio 交给 RectEditor 语义层）。
 */
export class ImageVm extends BaseWidgetVm<ImageData & IRect> {
  private readonly placeholder = new Graphics();
  private sprite: Sprite | null = null;
  private loader: ImageLoadController | null = null;
  private mode: 'empty' | ImageLoadState = 'empty';

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

  /** 纹理端口注入（组合根接线，onVmCreated$ 内同步完成——先于首帧 render）。
   *  幂等：重复注入先 dispose 旧 controller（租约全数归还） */
  setImageTextures(port: IImageTexturePort): void {
    this.loader?.dispose();
    this.loader = new ImageLoadController(port, this.hostCallbacks());
    this.loader.setSrc(this.state.src);
  }

  /** 手动重试（画布双击转发）：仅终态失败态生效；未注入端口时 no-op */
  retry(): void {
    if (this.mode !== 'failed' && this.mode !== 'missing') return;
    this.loader?.retry();
  }

  override render(_prev: ImageData & IRect, next: ImageData & IRect): void {
    this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
    this.root.scale.set(1);

    this.drawPlaceholder(next.width, next.height);
    // 同 src 幂等（失败后同 src 不重入——只能 retry()）
    this.loader?.setSrc(next.src);
    if (this.sprite) {
      this.sprite.width = next.width;
      this.sprite.height = next.height;
      this.sprite.visible = true;
      this.placeholder.visible = false;
    } else {
      this.sprite = null; // 对齐旧实现：src 空时保持 sprite 槽位干净
      this.placeholder.visible = true;
    }
    markRender();
  }

  /** 占位四态绘制（empty/loading 同现状灰框单对角线；failed/missing 叉号） */
  private drawPlaceholder(w: number, h: number): void {
    const stroke =
      this.mode === 'failed'
        ? FAILED_STROKE
        : this.mode === 'missing'
          ? MISSING_STROKE
          : PLACEHOLDER_STROKE;
    this.placeholder.clear();
    this.placeholder
      .rect(0, 0, w, h)
      .fill({ color: PLACEHOLDER_FILL })
      .stroke({ width: 1, color: stroke });
    if (this.mode === 'failed' || this.mode === 'missing') {
      // 叉号 = 两条对角线（错误语义，区别于加载中的单对角线）
      this.placeholder
        .moveTo(0, 0)
        .lineTo(w, h)
        .moveTo(w, 0)
        .lineTo(0, h)
        .stroke({ width: 1, color: stroke });
    } else {
      // 单对角线（图片语义的通用视觉惯例）
      this.placeholder.moveTo(0, 0).lineTo(w, h).stroke({ width: 1, color: stroke });
    }
  }

  private setMode(mode: 'empty' | ImageLoadState): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.drawPlaceholder(this.state.width, this.state.height);
    markRender();
  }

  /** controller 回调适配：sprite 交接顺序由 controller 契约决定
   *  （onLoaded 先换 sprite；onFailed 先销毁——「新 src + 旧图」是错误状态） */
  private hostCallbacks(): IImageLoadHost {
    return {
      onLoading: (_src) => {
        this.setMode('loading'); // 旧 sprite 保持可见（防切图闪烁）
      },
      onLoaded: (_src, texture) => {
        this.destroySprite();
        this.sprite = new Sprite(texture);
        this.sprite.width = this.state.width;
        this.sprite.height = this.state.height;
        this.root.addChild(this.sprite);
        this.setMode('loaded');
        this.placeholder.visible = false;
        markRender();
      },
      onFailed: (_src, kind) => {
        this.destroySprite();
        this.setMode(kind === 'missing' ? 'missing' : 'failed');
        this.placeholder.visible = true;
        markRender();
      },
      onEmpty: () => {
        this.destroySprite();
        this.setMode('empty');
        this.placeholder.visible = true;
        markRender();
      },
    };
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
    this.destroySprite(); // 先断 sprite → 纹理引用（不销毁纹理——归租约所有）
    this.loader?.dispose(); // 再释放租约（texture.destroy + URL 计数归还）
    this.loader = null;
    super.dispose();
  }

  /** sprite 与纹理分离销毁：纹理归缓存租约所有（引用归零才销毁），本方法
   *  只 sprite.destroy()。分离调用 + 防御 catch 保证销毁链不中断 */
  private destroySprite(): void {
    const sprite = this.sprite;
    this.sprite = null;
    if (!sprite) return;
    try {
      sprite.destroy();
    } catch (err) {
      console.warn('[spinth:image] sprite 销毁异常（忽略）', err);
    }
  }

  /** 调试/E2E 探针：sprite 已建（真渲染完成） */
  get hasSprite(): boolean {
    return this.sprite !== null;
  }

  /** 调试/E2E 探针：加载会话状态（字段以 controller.debug 为单源：
   *  src/state/attempts/acquires/textureUid——手动重试由 acquires 证伪） */
  get loadDebug(): ImageLoadController['debug'] | null {
    return this.loader ? this.loader.debug : null;
  }
}
