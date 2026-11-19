import { Graphics, GraphicsContext, Point, Text, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { hexToNum } from '../../common/color';
import { defaultTextColor, textThemeVersion } from '../../platform/textEngine/theme';
import { type IHostGeom, type IPoint, type IRect, type JoinDir } from '../../common/geometry';
import {
  createCanvasMeasurer,
  measureDoc,
  type IDocView,
  type ITextStyleProps,
} from '../../platform/textEngine/measure';
import { DocDisplay, type ITextRenderService } from '../../platform/textEngine/docDisplay';
import type { SymbolData } from '../../types';
import { SYMBOL_GLYPHS, type SymbolKind } from './symbolGlyphs.generated';
import {
  containFitGlyph,
  symbolGlyphAnchor,
  symbolGlyphRect,
  symbolLabelRect,
  SYMBOL_LABEL_BAND,
  SYMBOL_LABEL_FONT_SIZE,
  SYMBOL_LABEL_LINE_HEIGHT,
  SYMBOL_LABEL_PADDING_X,
  truncateLabelToWidth,
} from './symbolGeometry';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';

/** 着色单源（specs/symbol-widget §4.4）：缺省随主题墨色（light #333333 /
 *  dark #ededf2）；图标与标签同色；显式 color 不随主题反转（实例数据语义，
 *  与 textColor 同口径）。渲染 / 编辑器 / ActionBar 触发钮共用本函数 */
export function resolveSymbolColor(data: { color?: string }): string {
  return data.color ?? defaultTextColor();
}

/**
 * 按 kind 共享的 GraphicsContext 缓存（§4.4）：SVG 解析只在首次；颜色不进
 * 缓存键（tint 承载，任意色值不撑大缓存）；context 由本缓存持有，不随使用
 * 它的 Graphics 销毁（PIXI 8 契约：构造传入的 context destroy 不级联）。
 * 解析异常 / 未知 kind 返回 null → 调用方落占位图（§4.7，不抛错不阻断导入）。
 */
const glyphContextCache = new Map<string, GraphicsContext>();

function getGlyphContext(kind: string): GraphicsContext | null {
  const cached = glyphContextCache.get(kind);
  if (cached) return cached;
  const svg = SYMBOL_GLYPHS[kind as SymbolKind];
  if (!svg) return null;
  try {
    const ctx = new GraphicsContext().svg(svg);
    glyphContextCache.set(kind, ctx);
    return ctx;
  } catch {
    return null; // 单个符号解析失败不拖垮整帧渲染（§4.7）
  }
}

/** 占位图问号字号（视觉规格：图形区内居中） */
const PLACEHOLDER_MARK_SIZE = 18;

/**
 * 符号控件视图层（specs/symbol-widget §7.1）：root（pivot 中心）→
 * glyphLayer（共享 context 的 Graphics，tint 着色 + contain 适配）+
 * labelDisplay（标签带内居中的 DocDisplay，颜色独立于父容器 tint）。
 * 重绘守卫：symbol/label/color/width/height/主题版本/_textEditing；
 * 纯平移走快速路径（只改 root.position）。
 */
export class SymbolVm extends BaseWidgetVm<SymbolData & IRect> {
  /** 图标宿主：context 按 kind 切换（setter 换引用，不销毁共享 context） */
  private readonly glyphLayer = new Graphics();
  /** 未知 kind 占位（虚线框 + 问号；常驻节点，重绘只清画布） */
  private readonly placeholderLayer = new Graphics();
  private placeholderMark: Text | null = null;
  private labelDisplay: DocDisplay | null = null;
  /** 当前 glyphLayer 挂的 context kind（换 kind 才走 setter） */
  private renderedKind: string | null = null;
  /** 编辑态开关（descriptor onEnter/onExit 闭包直调，SHAPE 同模式）：进编辑
   *  清出画布标签 + 编辑期 render 早退；退出自 refresh 全量恢复 */
  private _textEditing = false;
  /** 渲染时主题版本（SHAPE 同款守卫）：无显式 color 时图标与标签随主题，
   *  setTheme 的 refreshAll 走 render(state,state)，无守卫会被快速路径吞掉 */
  private renderedThemeVer = 0;

  /** 纹理服务经 ServiceRegistry 注入（标签与 TEXT 控件共享两级渲染） */
  constructor(private readonly textRender: ITextRenderService | null = null) {
    super({
      id: '',
      type: 'SYMBOL',
      zOrder: '',
      symbol: 'net-server',
      label: '',
      color: undefined,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.addChild(this.glyphLayer, this.placeholderLayer);
  }

  setTextEditing(editing: boolean): void {
    if (this._textEditing === editing) return;
    this._textEditing = editing;
    if (!editing) {
      // 退出强制全量恢复：refresh = render(state,state) 绕 diff 管线（SHAPE 同款）
      this.refresh();
      return;
    }
    // 进编辑：立即清出画布标签（编辑器 DOM 独占视觉，不双显）
    this.labelDisplay?.destroy();
    this.labelDisplay = null;
    markRender();
  }

  override render(prev: SymbolData & IRect, next: SymbolData & IRect): void {
    // 编辑期早退：编辑器 DOM 独占标签视觉，34ms 落库触发的重绘全免；
    // setState/onStateChanged$ 广播链不受影响（SHAPE 同款红线）
    if (this._textEditing) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
      return;
    }
    const hasLabel = (next.label ?? '').length > 0;
    // 纯平移快速路径：图形/标签/主题全未变只改 root 变换；hasLabel 时要求
    // labelDisplay 存在（编辑退出销毁后强制全量重建）
    if (
      prev.symbol === next.symbol &&
      prev.label === next.label &&
      prev.color === next.color &&
      prev.width === next.width &&
      prev.height === next.height &&
      this.renderedThemeVer === textThemeVersion() &&
      (!hasLabel || this.labelDisplay !== null)
    ) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
      this.textRender?.markDirty();
      return;
    }
    this.renderedThemeVer = textThemeVersion();
    const color = resolveSymbolColor(next);
    const tintNum = hexToNum(color);

    // 图形区：高 ≤ 32（h−24−8 ≤ 0）不画图标仅标签（§3.3）；未知 kind 落占位
    const glyph = symbolGlyphRect(next.width, next.height);
    this.glyphLayer.visible = false;
    this.placeholderLayer.visible = false;
    if (glyph.height > 0.5 && glyph.width > 0.5) {
      const ctx = getGlyphContext(next.symbol);
      if (ctx) {
        if (this.renderedKind !== next.symbol) {
          this.glyphLayer.context = ctx;
          this.renderedKind = next.symbol;
        }
        const fit = containFitGlyph(glyph);
        this.glyphLayer.scale.set(fit.scale);
        this.glyphLayer.position.set(fit.x, fit.y);
        this.glyphLayer.tint = tintNum;
        this.glyphLayer.visible = true;
      } else {
        this.drawPlaceholder(glyph, color);
        this.placeholderLayer.visible = true;
      }
    }

    // 标签：单行截断（§5.4）+ 段落居中 + 带内垂直居中；带被压扁（h < 24）不画
    this.labelDisplay?.destroy();
    this.labelDisplay = null;
    const band = symbolLabelRect(next.width, next.height);
    if (hasLabel && band.height >= SYMBOL_LABEL_BAND - 0.01) {
      const style: ITextStyleProps = {
        fontFamily: 'sans-serif',
        fontSize: SYMBOL_LABEL_FONT_SIZE,
        lineHeight: SYMBOL_LABEL_LINE_HEIGHT / SYMBOL_LABEL_FONT_SIZE,
        color,
      };
      const availW = Math.max(next.width - SYMBOL_LABEL_PADDING_X * 2, 1);
      const measurer = createCanvasMeasurer();
      const visible = truncateLabelToWidth(next.label ?? '', availW, style, measurer);
      const view: IDocView = measureDoc(
        { paragraphs: [{ spans: [{ text: visible }], align: 'center' }], maxWidth: availW, style },
        { measurer },
      );
      this.labelDisplay = new DocDisplay(view, style, this.textRender);
      // 水平：从左内边距起（measure 的 align center 已把行烘焙进 [0, availW]，
      // 起点 = padding 才与 bbox 中轴对齐）；垂直：带内居中
      this.labelDisplay.position.set(
        SYMBOL_LABEL_PADDING_X,
        band.y + Math.max((band.height - view.height) / 2, 0),
      );
      this.root.addChild(this.labelDisplay);
    }

    this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
    // 拖拽/缩放反馈用过 root.scale，全量渲染归位时重置（applyRootTransform
    // 不碰 scale——「快速路径不碰 scale」是既定语义）
    this.root.scale.set(1);
  }

  /** 未知 kind 占位（§4.7）：图形区内虚线框 + 中心问号，标签照常显示 */
  private drawPlaceholder(glyph: IRect, color: string): void {
    const g = this.placeholderLayer;
    g.clear();
    g.setStrokeStyle({ width: 1.5, color: hexToNum(color), cap: 'round' });
    const dash = 5;
    const edges: Array<[number, number, number, number]> = [
      [glyph.x, glyph.y, glyph.x + glyph.width, glyph.y],
      [glyph.x + glyph.width, glyph.y, glyph.x + glyph.width, glyph.y + glyph.height],
      [glyph.x + glyph.width, glyph.y + glyph.height, glyph.x, glyph.y + glyph.height],
      [glyph.x, glyph.y + glyph.height, glyph.x, glyph.y],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / dash));
      for (let i = 0; i < n; i += 2) {
        const t1 = i / n;
        const t2 = Math.min((i + 1) / n, 1);
        g.moveTo(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1);
        g.lineTo(x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
        g.stroke();
      }
    }
    if (!this.placeholderMark) {
      this.placeholderMark = new Text({
        text: '?',
        style: { fontFamily: 'sans-serif', fontSize: PLACEHOLDER_MARK_SIZE, fill: 0xffffff },
      });
      this.placeholderMark.anchor.set(0.5);
      this.placeholderLayer.addChild(this.placeholderMark);
    }
    this.placeholderMark.position.set(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
    this.placeholderMark.style.fill = hexToNum(color);
  }

  // —— 命中/几何：rect 型语义（SHAPE 同款；旋转恒 0） ——

  hitTestPoint(p: Point): boolean {
    // 整 bbox 命中（§3.5：点名字也算选中，否则点标签「点空」）
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
    return rotatedRectIntersectsRect(this.getLocalRect(), 0, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
  }

  /** 世界 AABB（含标签带——空间索引与 culling 用，§7.2） */
  override getBounds(): IRect {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return rotatedRectBounds(
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  /** 数据矩形（未旋转局部系——resize/锚定/微移的输入语义） */
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

  /** 锚点 = 图形区四边（§3.4 覆写）：t 沿图形区边滑动，标签带不参与；
   *  geom 显式传入 = 急切 reattach 的权威几何（vm root 渲染滞后防幻影事务） */
  override getAnchorPoint(join: JoinDir, t: number, geom?: IHostGeom): IPoint {
    const g = geom ?? this.getHostGeom();
    return symbolGlyphAnchor(g.rect, join, t);
  }
}
