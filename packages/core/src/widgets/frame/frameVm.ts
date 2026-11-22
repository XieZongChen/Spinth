import { Graphics, Point, Text, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { hexToNum } from '../../common/color';
import { contrastRatio } from '../../common/contrast';
import { defaultTextColor, textThemeVersion } from '../../platform/textEngine/theme';
import { createCanvasMeasurer } from '../../platform/textEngine/measure';
import { type IHostGeom, type IRect } from '../../common/geometry';
import type { FrameData } from '../../types';
import {
  FRAME_DEFAULT_BORDER,
  FRAME_HIT_EDGE,
  FRAME_HIT_EDGE_MAX,
  FRAME_TITLE_FONT,
  FRAME_TITLE_MIN_SIZE,
  frameHitTest,
  frameTitleRect,
  truncateTitle,
} from './frameGeometry';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';

/** 虚线规格与 SHAPE 同源（shapeVm DASH = 8px 实 + 8px 空，specs §3.4） */
const DASH = 8;
/** 标题深色（浅带底自适应双态之一，specs/container-frame §5.4——SHAPE §16 同款） */
const TITLE_DARK = '#333333';
const TITLE_LIGHT = '#ffffff';

/**
 * 容器控件视图层（specs/container-frame §3.4）：背景 + 边框 + 标题带（与底
 * 同色，'none' 时透明）+ 带沿分隔线 + 单行左对齐标题。子元素不是容器的
 * 子树——不裁剪、渲染互不相干（§0.2 拍板）。命中 = 标题带 ∪ 边框环
 * （§3.3），边框环宽按屏幕 px 折算（getScale 构造注入，现算不缓存）。
 */
export class FrameVm extends BaseWidgetVm<FrameData & IRect> {
  /** 背景/边框/分隔线共用一块 Graphics（全量重绘 = clear + 重画） */
  private readonly g = new Graphics();
  private titleText: Text | null = null;
  /** 编辑态开关（descriptor onEnter/onExit 闭包直调，SYMBOL 同模式）：进编辑
   *  清出画布标题 + 编辑期 render 早退；退出自 refresh 全量恢复 */
  private _titleEditing = false;
  /** 渲染时主题版本（SYMBOL 同款守卫）：缺省标题色随带底/主题，setTheme 的
   *  refreshAll 走 render(state,state)，无守卫会被快速路径吞掉 */
  private renderedThemeVer = 0;

  /** vpScale 注入（widgetRuntime 工厂经 Tokens.ViewportService 解析；缺省 1） */
  constructor(private readonly getScale: () => number = () => 1) {
    super({
      id: '',
      type: 'FRAME',
      zOrder: '',
      title: '',
      color: '#ffffff',
      borderStyle: 'solid',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.addChild(this.g);
  }

  setTitleEditing(editing: boolean): void {
    if (this._titleEditing === editing) return;
    this._titleEditing = editing;
    if (!editing) {
      // 退出强制全量恢复：refresh = render(state,state) 绕 diff 管线（SYMBOL 同款）
      this.refresh();
      return;
    }
    // 进编辑：立即清出画布标题（编辑器 DOM 独占视觉，不双显）
    this.destroyTitle();
    markRender();
  }

  override render(prev: FrameData & IRect, next: FrameData & IRect): void {
    // 编辑期早退：编辑器 DOM 独占标题视觉，落库触发的重绘全免（SYMBOL 同款红线：
    // 短路只能放 render 内，setState/onStateChanged$ 广播链不受影响）
    if (this._titleEditing) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
      return;
    }
    const hasTitle = (next.title ?? '').length > 0;
    // 纯平移快速路径：样式键全未变只改 root 变换；有标题时要求 titleText 存在
    // （编辑退出销毁后强制全量重建）
    if (
      prev.title === next.title &&
      prev.color === next.color &&
      prev.fill === next.fill &&
      prev.borderColor === next.borderColor &&
      prev.borderWidth === next.borderWidth &&
      prev.borderStyle === next.borderStyle &&
      prev.headerSide === next.headerSide &&
      prev.titleColor === next.titleColor &&
      prev.width === next.width &&
      prev.height === next.height &&
      this.renderedThemeVer === textThemeVersion() &&
      (!hasTitle || this.titleText !== null)
    ) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
      return;
    }
    this.renderedThemeVer = textThemeVersion();
    const side = next.headerSide ?? 'top';
    const borderWidth = next.borderWidth ?? 1;
    // 边框色缺省 = 常量 FRAME_DEFAULT_BORDER（§2.1 写死不自适应；坏值兜底防 NaN 色）
    const strokeColor = hexToNum(resolveFrameBorderColor(next));

    this.g.clear();
    // 底：fill 'none' 不画（无底只有边框的标注框语义）
    if (next.fill !== 'none') {
      this.g.rect(0, 0, next.width, next.height).fill({ color: hexToNum(next.color) });
    }
    // 边：实线/虚线/无（虚线与 SHAPE 同源手工点划——v8 Graphics 无原生虚线）
    if (next.borderStyle !== 'none') {
      this.g.setStrokeStyle({ width: borderWidth, color: strokeColor, cap: 'round' });
      if (next.borderStyle === 'dashed') {
        this.drawDashedBorder(next.width, next.height);
      } else {
        this.g.rect(0, 0, next.width, next.height).stroke();
      }
    }
    // 带沿分隔线（§3.4）：top 带画底边线、left 带画右边线——泳道「行」的视觉
    // 分隔；恒画（borderStyle none 时仍是结构分隔），色同边框
    this.drawSeparator(side, next.width, next.height, strokeColor);

    // 标题：单行左对齐、带内垂直居中，超出可用宽截断（退化尺寸不画不抛错）
    this.destroyTitle();
    if (hasTitle && next.width >= FRAME_TITLE_MIN_SIZE && next.height >= FRAME_TITLE_MIN_SIZE) {
      const titleRect = frameTitleRect(next.width, next.height, side);
      const color = resolveFrameTitleColor(next);
      const measurer = createCanvasMeasurer();
      const measureStyle = {
        fontFamily: 'sans-serif',
        fontSize: FRAME_TITLE_FONT,
        lineHeight: 1,
        color,
      };
      const visible = truncateTitle(next.title ?? '', titleRect.width, (s) =>
        measurer.measure(s, measureStyle),
      );
      this.titleText = new Text({
        text: visible,
        style: { fontFamily: 'sans-serif', fontSize: FRAME_TITLE_FONT, fill: hexToNum(color) },
      });
      // anchor (0, 0.5)：垂直中线对 titleRect 中线（左对齐从 PAD 起）
      this.titleText.anchor.set(0, 0.5);
      this.titleText.position.set(titleRect.x, titleRect.y + titleRect.height / 2);
      this.root.addChild(this.titleText);
    }

    this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
    // 拖拽/缩放反馈用过 root.scale，全量渲染归位时重置（applyRootTransform
    // 不碰 scale——「快速路径不碰 scale」是既定语义）
    this.root.scale.set(1);
  }

  /** 手工虚线边（shapeVm.drawDashedStroke 同款：四边按 DASH 点划） */
  private drawDashedBorder(w: number, h: number): void {
    const edges: Array<[number, number, number, number]> = [
      [0, 0, w, 0],
      [w, 0, w, h],
      [w, h, 0, h],
      [0, h, 0, 0],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.floor(len / DASH));
      for (let i = 0; i < n; i += 2) {
        const t1 = i / n;
        const t2 = Math.min((i + 1) / n, 1);
        this.g.moveTo(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1);
        this.g.lineTo(x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
        this.g.stroke();
      }
    }
  }

  /** 带沿分隔线：1px、同边框色；带被压扁（带宽 = 整尺寸）时不画（与边框重叠无意义） */
  private drawSeparator(side: 'top' | 'left', w: number, h: number, color: number): void {
    const band = side === 'top' ? Math.min(28, h) : Math.min(112, w);
    if (band <= 0) return;
    this.g.setStrokeStyle({ width: 1, color });
    if (side === 'top') {
      if (h - band < 1) return;
      this.g.moveTo(0, band).lineTo(w, band).stroke();
    } else {
      if (w - band < 1) return;
      this.g.moveTo(band, 0).lineTo(band, h).stroke();
    }
  }

  private destroyTitle(): void {
    this.titleText?.destroy();
    this.titleText = null;
  }

  // —— 命中/几何：标题带 ∪ 边框环（§3.3；旋转恒 0） ——

  hitTestPoint(p: Point): boolean {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    const rect = { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h };
    if (!pointInRotatedRect(p, rect, this.root.rotation)) return false;
    // 边框环按屏幕 px 折算（0.2x 下 8 世界 px 只有 1.6 屏幕 px 抓不住；上限防
    // 深缩放环宽吞掉内部）——每帧现算，不缓存（缩放随时变）
    const scale = this.getScale() || 1;
    const edgeWorld = Math.min(
      Math.max(FRAME_HIT_EDGE / scale, FRAME_HIT_EDGE),
      FRAME_HIT_EDGE_MAX,
    );
    return frameHitTest({ x: p.x, y: p.y }, rect, this.state.headerSide ?? 'top', edgeWorld);
  }

  override hitTestRect(r: Rectangle): boolean {
    return rotatedRectIntersectsRect(this.getLocalRect(), 0, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
  }

  /** 世界 AABB（空间索引与 culling 用） */
  override getBounds(): IRect {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return rotatedRectBounds(
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  /** 数据矩形（未旋转局部系——resize/级联展开/微移的输入语义） */
  override getLocalRect(): IRect {
    return { x: this.state.x, y: this.state.y, width: this.state.width, height: this.state.height };
  }

  /** 锚定链宿主几何：视觉中心放平矩形（预览感知）+ θ（恒 0） */
  override getHostGeom(): IHostGeom {
    const w = this.state.width * this.root.scale.x;
    const h = this.state.height * this.root.scale.y;
    return {
      rect: { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      rotation: this.root.rotation,
    };
  }
}

/** 合法着色：#RRGGBB（ActionBar 色板全 6 位 hex；坏值兜底防 hexToNum NaN） */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** 标题缺省色（specs/container-frame §5.4 双态护栏）：per-实例 titleColor 优先；
 *  填充实色随带底自适应（深带浅字/浅带深字——SHAPE defaultTextColorForFill
 *  同款判据，因 frameGeometry 保持纯模块不复用 shapeVm 的导出）；无填充对
 *  画布走主题墨色。渲染 / 编辑器 / 对比度护栏测试共用本单源 */
export function resolveFrameTitleColor(data: {
  titleColor?: string;
  fill?: 'solid' | 'none';
  color: string;
}): string {
  if (data.titleColor && HEX6.test(data.titleColor)) return data.titleColor;
  if (data.fill === 'none' || !data.color) return defaultTextColor();
  return contrastRatio(TITLE_DARK, data.color) >= 4.5 ? TITLE_DARK : TITLE_LIGHT;
}

/** 边框缺省色（§2.1 写死不自适应；ActionBar 派生色点与渲染共用） */
export function resolveFrameBorderColor(data: { borderColor?: string }): string {
  return data.borderColor && HEX6.test(data.borderColor) ? data.borderColor : FRAME_DEFAULT_BORDER;
}
