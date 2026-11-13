import { Graphics, Point, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { contrastRatio } from '../../common/contrast';
import { defaultTextColor, textThemeVersion } from '../../platform/textEngine/theme';
import { type IHostGeom, type IPoint, type IRect, type JoinDir } from '../../common/geometry';
import { outlineAnchor } from './shapeOutline';
import { measureDoc, createCanvasMeasurer, type IDocView } from '../../platform/textEngine/measure';
import { htmlToDoc } from '../../platform/textEngine/htmlDoc';
import { htmlToPlainText } from '../../platform/textEngine/plainText';
import { DocDisplay, type ITextRenderService } from '../../platform/textEngine/docDisplay';
import type { ShapeData } from '../../types';
import {
  pointInRotatedRect,
  rotatedRectBounds,
  rotatedRectIntersectsRect,
} from '../../platform/rectEditor/rotateMath';
// 纯几何单源抽离至 shapeGeometry（32 轮审查 🟡-3）——re-export 保旧 import 路径
import { insetRectOf } from './shapeGeometry';
import { drawShapeDetails, drawShapePath } from './shapePath';
import { resolveShapeStyle } from './shapeStyle';
export { SHAPE_TEXT_PADDING, insetRectOf, shapeHeightFromTextHeight } from './shapeGeometry';

/** 虚线规格：8px 实线 + 8px 间隔（既有设计视觉规格） */
const DASH = 8;

/** 图形内文字（视觉规格：水平+垂直居中、不随形状缩放——resize 只重排换行） */
export const SHAPE_TEXT_FONT_SIZE = 16;
export const SHAPE_LINE_HEIGHT = 1.5;
export const SHAPE_TEXT_COLOR = '#333333';
/** 深填充上的默认字色（specs/flowchart-closeout §16：#333333 on #000000 仅
 *  1.66:1——默认字色随填充自适应，与 borderColor 派生色同一「缺省派生」风格） */
export const SHAPE_TEXT_LIGHT_COLOR = '#ffffff';

/** 默认字色自适应（specs/flowchart-closeout §16）：填充实色且深到 #333333
 *  不达 AA（4.5:1）时切浅色；无填充（文字对画布底）走主题默认
 *  defaultTextColor()（light #333333 / dark #ededf2——文字直对画布与 TEXT
 *  同场景，深色下 #333333 on #1b1b22 仅 1.36:1）。per-实例 textColor 恒优先。 */
export function defaultTextColorForFill(
  fill: 'solid' | 'none' | undefined,
  color: string | undefined,
): string {
  if (fill === 'none' || !color) return defaultTextColor();
  return contrastRatio(SHAPE_TEXT_COLOR, color) >= 4.5 ? SHAPE_TEXT_COLOR : SHAPE_TEXT_LIGHT_COLOR;
}

/** 排版解析（docs/17 §4 per-实例：override → 图形常量默认；实色填充的字色
 *  不主题化——填充色是实例数据，无填充字色随主题（theme.ts 环境通道）；
 *  per-实例 textColor 优先；缺省字色随填充自适应） */
export function resolveShapeTextStyle(state: {
  fontSize?: number;
  textColor?: string;
  lineHeight?: number;
  fill?: 'solid' | 'none';
  color?: string;
}): {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
} {
  return {
    fontFamily: 'sans-serif',
    fontSize: state.fontSize ?? SHAPE_TEXT_FONT_SIZE,
    lineHeight: state.lineHeight ?? SHAPE_LINE_HEIGHT,
    color: state.textColor ?? defaultTextColorForFill(state.fill, state.color),
  };
}

/**
 * 图形控件视图层：默认全量重绘 Graphics（docs/04 §2；纯平移走快速路径零重画，
 * docs/16）+ 图形内文字（docs/17 §6：内接矩形换行 + 双向居中 + 溢出裁剪）。
 * 渲染 = f(state)；root.position 承载平移（拖拽反馈直接改 position，松手经 Model 写回）。
 */
export class ShapeVm extends BaseWidgetVm<ShapeData & IRect> {
  private readonly shapeGraphics = new Graphics();
  private docDisplay: DocDisplay | null = null;
  /** 编辑态开关（descriptor onEnter/onExit 闭包直调，TEXT/STICKY 同模式）：进编辑
   *  清出 docDisplay（真隐藏）+ 编辑期 render 早退（跳过全量重建，编辑视觉由
   *  DOM 编辑器独占）；退出自 refresh——全量恢复由 docDisplay===null 保证
   *  （快速路径首条件不命中），单源不变量 */
  private _textEditing = false;
  /** 渲染时主题版本（textVm 同款守卫）：无填充字色随主题——setTheme 的
   *  refreshAll 走 render(state,state)，无此守卫会被纯平移快速路径吞掉 */
  private renderedThemeVer = 0;

  setTextEditing(editing: boolean): void {
    if (this._textEditing === editing) return;
    this._textEditing = editing;
    if (!editing) {
      // 退出强制全量恢复：refresh = render(state,state) 绕 diff 管线（「state 无
      // 新变化则 render 不跑」）。与最后一次 flush 排队的微任务 render 可能一次
      // 冗余——最终一致（LINE 同款微任务兜底）
      this.refresh();
      return;
    }
    // 进编辑：立即清出画布文字（编辑期 render 早退不再维护 docDisplay——
    // 不清则进编辑瞬间双显，直到下一次早退也不会消失）
    this.docDisplay?.destroy();
    this.docDisplay = null;
    markRender();
  }

  /** 纹理服务经 ServiceRegistry 注入（图形内文字与 TEXT 控件共享两级渲染） */
  constructor(private readonly textRender: ITextRenderService | null = null) {
    super({
      id: '',
      type: 'SHAPE',
      zOrder: '',
      shapeType: 'rect',
      color: '#e8f0fb',
      borderStyle: 'solid',
      text: '',
      fontSize: undefined,
      textColor: undefined,
      align: undefined,
      lineHeight: undefined,
      // 几何（摊平自 rect）
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.addChild(this.shapeGraphics);
  }

  override render(prev: ShapeData & IRect, next: ShapeData & IRect): void {
    // 编辑期早退（节能隐藏）：编辑器 DOM 独占视觉，34ms 落库触发的重绘全免。
    // setState/onStateChanged$ 广播链不受影响（红线：短路只能放 render 内，
    // 放 setState 层会断 autoHeight/选区框广播）
    if (this._textEditing) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
      return;
    }
    // 纯平移快速路径（textVm/stickyVm 同模式，本笔补齐）：两档守卫——有文字比
    // 全键（图形+text+排版）；无文字（docDisplay null 且 next 亦无字——漏判
    // next 有字 = 丢字）只比图形键，Graphics 零重画。rotation 不进守卫：
    // applyRootTransform 顺带写变换（pixi 矢量旋转无需重画图形）
    const sameShapeKeys =
      prev.shapeType === next.shapeType &&
      prev.color === next.color &&
      prev.borderStyle === next.borderStyle &&
      // 样式三键（specs/flowchart-closeout §4.2）：漏加会让改边框色/宽/填充态
      // 走快速路径不重画（resolveShapeStyle 的全部输入键）
      prev.borderColor === next.borderColor &&
      prev.borderWidth === next.borderWidth &&
      prev.fill === next.fill &&
      prev.width === next.width &&
      prev.height === next.height;
    const hasText = htmlToPlainText(next.text ?? '').trim().length > 0;
    if (
      sameShapeKeys &&
      (!hasText ||
        (this.docDisplay !== null &&
          // 主题版本守卫（textVm 同模式）：无填充字色随主题，主题切换强制重建
          this.renderedThemeVer === textThemeVersion() &&
          (prev.text || '') === (next.text || '') &&
          prev.fontSize === next.fontSize &&
          prev.textColor === next.textColor &&
          prev.align === next.align &&
          prev.lineHeight === next.lineHeight))
    ) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
      this.textRender?.markDirty();
      return;
    }
    this.renderedThemeVer = textThemeVersion();
    const g = this.shapeGraphics;
    g.clear();
    // 样式解析单源（specs/flowchart-closeout §4.2）：缺省 = 派生边框色/宽 1/
    // 恒填充——老文档渲染逐字节不变
    const style = resolveShapeStyle(next);

    drawShapePath(g, next.shapeType, next.width, next.height);

    if (next.borderStyle === 'dashed') {
      // v8 Graphics 无原生虚线：先（可选）填充，再用点划线段描边；细节线
      // （内弧/双竖线）虚线边框同样绘制（G-10——此前只在 solid 分支画）
      if (style.fill) g.fill({ color: style.fillColor });
      g.setStrokeStyle({ width: style.strokeWidth, color: style.strokeColor, cap: 'round' });
      drawDashedStroke(g, next, DASH);
      drawShapeDetails(
        g,
        next.shapeType,
        next.width,
        next.height,
        style.strokeColor,
        style.strokeWidth,
      );
    } else {
      if (style.fill) g.fill({ color: style.fillColor });
      if (next.borderStyle !== 'none') {
        g.stroke({ width: style.strokeWidth, color: style.strokeColor });
        // 细节线（内弧/双竖线）——与外框同规格单独描边（shapePath 单源）
        drawShapeDetails(
          g,
          next.shapeType,
          next.width,
          next.height,
          style.strokeColor,
          style.strokeWidth,
        );
      }
    }

    // 图形内文字（docs/17 §6）：内接矩形内换行、水平（段落 align 默认 center）+
    // 垂直居中；溢出裁剪（overflow hidden——autoHeight 首版不做，挂账）。
    // 挂载模式同 stickyVm：shapeGraphics 常驻保留，doc 每帧销毁重建
    const inset = insetRectOf(next.shapeType, next.width, next.height);
    // ?? '' 兜底：zod default 只在 parse 路径填充，绕过 parse 的旧文档 text 键缺失
    const text = next.text ?? '';
    if (htmlToPlainText(text).trim().length > 0) {
      const textStyle = resolveShapeTextStyle(next);
      const view: IDocView = measureDoc(
        {
          paragraphs: htmlToDoc(text).map((p) => ({ ...p, align: next.align ?? 'center' })),
          maxWidth: inset.width,
          overflow: 'hidden',
          style: textStyle,
        },
        { measurer: createCanvasMeasurer() },
      );
      this.docDisplay?.destroy();
      this.docDisplay = new DocDisplay(view, textStyle, this.textRender);
      // 垂直居中（水平由段落 align 承担，DocDisplay x 从内接矩形左缘起）
      this.docDisplay.position.set(
        inset.x,
        inset.y + Math.max((inset.height - view.height) / 2, 0),
      );
      for (const c of [...this.root.children]) {
        if (c !== this.shapeGraphics) c.destroy();
      }
      this.root.addChild(this.docDisplay);
    } else if (this.docDisplay) {
      this.docDisplay?.destroy();
      this.docDisplay = null;
    }

    this.applyRootTransform(next.x, next.y, next.width, next.height, next.rotation ?? 0);
    // 拖拽/缩放反馈用过 root.scale，全量渲染归位时重置（applyRootTransform
    // 不碰 scale——「快速路径不碰 scale」是既定语义，docs/16 ⑧ 探针同源）
    this.root.scale.set(1);
  }

  hitTestPoint(p: Point): boolean {
    const b = this.state;
    // 世界 → 局部（pivot 式：root.position = 视觉中心、scale/rotation 感知）
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return pointInRotatedRect(
      p,
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  override hitTestRect(r: Rectangle): boolean {
    // 框选精判：旋转矩形 vs marquee（docs/05 §8；θ=0 退化为数据矩形相交）
    return rotatedRectIntersectsRect(this.getLocalRect(), this.state.rotation ?? 0, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
  }

  /** 世界 AABB（docs/05 §8 拆分）：局部矩形绕中心旋 root.rotation 的外接矩形。
   *  root.position/scale 感知（拖拽/缩放预览中同样正确）；不读 localBounds：
   *  描边使 localBounds 外溢 0.5px/边。θ=0 时与旧「root 左上」实现逐字节等价。 */
  override getBounds(): IRect {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return rotatedRectBounds(
      { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h },
      this.root.rotation,
    );
  }

  /** 数据矩形（未旋转局部系——resize/锚定/微移的输入语义，docs/05 §8） */
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

  /** 锚点 = 轮廓交点（specs/flowchart-closeout §7.2，G-04）：局部系求交后
   *  平移到宿主矩形、绕心旋转 θ。rect 族与 bbox 边点逐字节等价（回归锁）。
   *  geom 显式传入 = 急切 reattach 的权威几何（vm root 渲染滞后防幻影事务） */
  override getAnchorPoint(join: JoinDir, t: number, geom?: IHostGeom): IPoint {
    const g = geom ?? this.getHostGeom();
    const p = outlineAnchor(this.state.shapeType, g.rect.width, g.rect.height, join, t);
    const local = { x: g.rect.x + p.x, y: g.rect.y + p.y };
    if (g.rotation === 0) return local;
    const cx = g.rect.x + g.rect.width / 2;
    const cy = g.rect.y + g.rect.height / 2;
    const cos = Math.cos(g.rotation);
    const sin = Math.sin(g.rotation);
    const dx = local.x - cx;
    const dy = local.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  /** 手动缩放解除 autoHeight（docs/17 §6 四点拍板：参考惯例 + 既有设计同款）：
   *  宽/高任一被用户改变即关——此后形状高度恒用户控制（reflowHeight 闸门拦下）。
   *  仅平移（对齐/拖拽走 commitDrag）不解除。updateRect 与 update 背靠背两事务
   *  经 captureTimeout 合并为一个 undo 项（TEXT 先例同款） */
  override commitResize(startRect: IRect, nextRect: IRect): void {
    super.commitResize(startRect, nextRect);
    if (
      Math.abs(nextRect.width - startRect.width) > 0.5 ||
      Math.abs(nextRect.height - startRect.height) > 0.5
    ) {
      this.model?.update({ autoHeight: false } as never);
    }
  }
}

/** 沿形状轮廓画虚线（矩形近似：按外框四边） */
function drawDashedStroke(g: Graphics, s: ShapeData & IRect, dash: number): void {
  const w = s.width;
  const h = s.height;
  const edges: Array<[number, number, number, number]> = [
    [0, 0, w, 0],
    [w, 0, w, h],
    [w, h, 0, h],
    [0, h, 0, 0],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.floor(len / dash));
    for (let i = 0; i < n; i += 2) {
      const t1 = i / n;
      const t2 = Math.min((i + 1) / n, 1);
      g.moveTo(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1);
      g.lineTo(x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
      g.stroke();
    }
  }
}
