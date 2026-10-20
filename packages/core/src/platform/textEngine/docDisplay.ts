import { Container, Graphics, Sprite, Text, type DestroyOptions } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IDocView, ITextStyleProps } from './measure';

/**
 * 文本视图 → PIXI 显示对象（docs/07 §5 输出的消费端）。
 *
 * 两级渲染（docs/07 §6）：
 * - 快照级：整棵 DocView 离屏生成纹理（可能切块为多 Sprite 容器），缩远/屏外时用
 * - 高清级：每行一个 PIXI.Text，屏内且行高×scale 足够时替换
 *
 * 无纹理服务环境（单测）恒为 Text 模式。
 */

export interface ITextRenderService {
  /** 设备像素比（renderer 分辨率；未 attach 前为 1） */
  readonly dpr: number;
  /** 注册 display：由服务按当前视口决定初始模式 */
  register(display: DocDisplay): void;
  unregister(display: DocDisplay): void;
  /** 控件几何变化（拖拽落库等）后请求重评可视性/清晰度档位——
   *  修复「拖文本出屏不触发升级/降级」（docs/16 P3 ① 尾巴，2026-09-28） */
  markDirty(): void;
  /** 快照节点（常规 1 Sprite；超过 MAX_TEXTURE_SIZE 切块为多 Sprite 容器）；不可用返回 null */
  snapshot(view: IDocView, style: ITextStyleProps, resolution: number): Container | null;
}

/** 两级切换阈值（docs/07 §6）：行高 × scale ≤ 10 屏幕像素不值得高清渲染 */
export const MIN_TEXT_LINE_HEIGHT = 10;

/** 已屏内后分辨率漂移超过 10% 才调整（docs/07 §6，防缩放中频繁重建） */
const RESOLUTION_DRIFT = 0.1;

/** 下划线视觉规格（pixi 8 TextStyle 无 underline 能力——按 span 手绘）：
 *  y ≈ 基线下方（行内比例，Nunito 类字体基线 ≈ 0.8×fontSize，再留空隙）；
 *  线宽随字号钳制。2026-10-10 首版定值，快照/截图过目后可调 */
const UNDERLINE_Y_RATIO = 0.9;
const underlineThickness = (fontSize: number): number => Math.min(2, Math.max(1, fontSize / 14));

/** DocView → 真实文本渲染树（高清级与快照生成共用，保证两级像素对齐） */
export function buildTextTree(
  view: IDocView,
  style: ITextStyleProps,
  resolution: number,
): Container {
  const root = new Container();
  for (const para of view.paragraphs) {
    for (const line of para.lines) {
      for (const span of line.spans) {
        if (!span.text) continue;
        const fill = span.color ?? style.color;
        const t = new Text({
          text: span.text,
          resolution,
          style: {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            // 行内 marks（docs/17 §4 刀 3）：span 级颜色覆盖 doc 级（DOM 规范化
            // rgb() 形态，pixi fill 直接消费）
            fill,
            fontWeight: span.bold ? 'bold' : 'normal',
            fontStyle: span.italic ? 'italic' : 'normal',
            lineHeight: style.fontSize * style.lineHeight,
          },
        });
        t.position.set(span.rect.x, span.rect.y);
        root.addChild(t);
        if (span.underline) {
          // 下划线手绘（docs/07 §6）：色随文字 fill，宽 = 度量出的 span 宽
          const g = new Graphics();
          g.rect(
            span.rect.x,
            span.rect.y + style.fontSize * UNDERLINE_Y_RATIO,
            span.rect.width,
            underlineThickness(style.fontSize),
          ).fill(fill);
          root.addChild(g);
        }
      }
    }
  }
  return root;
}

/** 递归销毁显示树：Sprite 连带销毁其纹理（generateTexture 产物不销毁会泄漏 GPU 内存） */
function destroyTree(node: Container): void {
  if (node instanceof Sprite) {
    node.destroy({ texture: true, textureSource: true });
    return;
  }
  for (const child of [...node.children]) destroyTree(child);
  node.destroy();
}

export class DocDisplay extends Container {
  /** null = 构造后未决策（等待服务 register 的首次 updateForViewport） */
  private mode: 'snapshot' | 'text' | null = null;
  private snapshotResolutionUsed = 1;
  private textResolutionUsed = 1;

  constructor(
    private view: IDocView,
    private style: ITextStyleProps,
    private textureService: ITextRenderService | null,
  ) {
    super();
    if (textureService) {
      // register 内部按当前视口决定初始模式（构造期 renderer 未就绪则降级 text）
      textureService.register(this);
    } else {
      this.enterTextMode(1);
    }
  }

  private clearContent(): void {
    for (const child of [...this.children]) destroyTree(child);
  }

  /** 快照级分辨率（docs/07 §6）：max(1, MIN_LINE_HEIGHT / lineHeight) × dpr——小字号保证最小行高 10 物理像素 */
  /** 快照分辨率（Batch 1 · 1.27）：纳入视口 scale（下限 0.25 防过度模糊）——
   *  此前与 scale 无关，深缩放下屏外/低清快照线性过采样（0.05x ≈ 20×）。
   *  scale ≥ 1 保持原值（行为零漂移）；快照是过渡显示（入屏切高清 Text），
   *  分辨率只需满足「世界尺寸 × scale ≈ 屏幕像素」 */
  private computeSnapshotResolution(scale: number): number {
    const lineH = this.style.fontSize * this.style.lineHeight;
    return (
      Math.max(1, MIN_TEXT_LINE_HEIGHT / lineH) *
      (this.textureService?.dpr ?? 1) *
      Math.min(1, Math.max(0.25, scale))
    );
  }

  /** 快照级：单纹理（超大文本为切块容器） */
  private enterSnapshot(resolution: number): void {
    const node = this.textureService?.snapshot(this.view, this.style, resolution) ?? null;
    if (!node) {
      this.enterTextMode(this.textureService?.dpr ?? 1);
      return;
    }
    this.clearContent();
    this.addChild(node);
    this.mode = 'snapshot';
    this.snapshotResolutionUsed = resolution;
    markRender();
  }

  /** 高清级：每行一个 PIXI.Text */
  private enterTextMode(resolution: number): void {
    this.clearContent();
    this.addChild(buildTextTree(this.view, this.style, resolution));
    this.mode = 'text';
    this.textResolutionUsed = resolution;
    markRender();
  }

  /** 高清级下仅调整分辨率（不重建整棵树，缩放中的增量路径）；递归到嵌套的 Text 节点 */
  private adjustTextResolution(resolution: number): void {
    const apply = (node: Container): void => {
      for (const child of node.children) {
        if (child instanceof Text) child.resolution = resolution;
        else apply(child);
      }
    };
    apply(this);
    this.textResolutionUsed = resolution;
    markRender();
  }

  /**
   * 视口变化时的升级/降级判断（docs/07 §6）：
   * 屏内且行高×scale > 10px → 高清 Text；否则快照纹理。
   */
  updateForViewport(visible: boolean, scale: number): void {
    if (!this.textureService) return; // 无纹理服务时恒为 Text 模式
    const lineH = this.style.fontSize * this.style.lineHeight;
    const worth = visible && this.view.height > 0 && lineH * scale > MIN_TEXT_LINE_HEIGHT;
    if (worth) {
      const target = scale * this.textureService.dpr;
      if (this.mode !== 'text') {
        this.enterTextMode(target);
      } else if (Math.abs(1 - target / this.textResolutionUsed) > RESOLUTION_DRIFT) {
        this.adjustTextResolution(target);
      }
    } else if (this.mode !== 'snapshot') {
      this.enterSnapshot(this.computeSnapshotResolution(scale));
    }
  }

  get renderMode(): 'snapshot' | 'text' {
    return this.mode ?? 'text';
  }

  get snapshotResolution(): number {
    return this.snapshotResolutionUsed;
  }

  override destroy(options?: DestroyOptions): void {
    this.textureService?.unregister(this);
    this.clearContent();
    super.destroy(options ?? { children: false });
  }
}
