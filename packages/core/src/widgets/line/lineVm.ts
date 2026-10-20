import { Graphics, Point, Rectangle, Text } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { hexToNum } from '../../common/color';
import { rectsIntersect, type IRect } from '../../common/geometry';
import {
  ELBOW_RADIUS,
  effectivePath,
  insetEnds,
  LINE_END_GAP,
  pointAtRatio,
  polylineHit,
  segmentDirection,
  slicePathByDash,
  slicePathExcludingRect,
  type IPt,
} from './lineMath';
import { htmlToPlainText } from '../text/textVm';
import { defaultLineTextColor } from '../../platform/textEngine/theme';
import { markRender } from '../../common/render';
import type { LineData } from '../../types';

/** 命中容差余量（世界像素）：tol = strokeWidth + 6（线宽笔宽批——默认 2 恰等
 *  原定常 8 零默认变化；粗线放宽保可选中性。penVm「strokeWidth + 4」同族口径） */
const HIT_TOLERANCE_BASE = 6;
const ARROW_LEN = 10;
const ARROW_ANGLE = Math.PI / 7; // ~26° 开放箭头
/** 线上文字（视觉规格：12px 深灰，白底由镂空切分自然形成） */
export const LINE_TEXT_FONT_SIZE = 12;
/** 线上文字行高（倍数，视觉规格 1.4）——编辑 DOM（lineTextEditor）与 pixi 渲染
 *  （ensureTextNode 经 fontSize×此值换算像素）同源消费；此前渲染未设行高按 1.0
 *  倍度量，编辑/退出两态文字高度跳变（批 lineHeight 顺修同源） */
export const LINE_TEXT_LINE_HEIGHT = 1.4;
/** 镂空矩形相对文字 bbox 的外扩（视觉规格：文字四周留白） */
const KNOCKOUT_PADDING = 4;
/** 虚线周期（视觉规格：与 shape dashed 同节奏） */
const DASH_PATTERN = [8, 6] as const;

/**
 * 连接线视图层：STRAIGHT/ELBOWED 双线型渲染 + 圆角拐点 + 逐段箭头 + 线上文字镂空
 * + 虚线 + 锚定端点重算（数据驱动）。锚定跟随：绑定节点移动 → 重路由写 points
 * （由 LineService 订阅编排，docs/08 §3）。
 */
export class LineVm extends BaseWidgetVm<LineData & IRect> {
  private readonly g = new Graphics();
  private textSprite: Text | null = null;
  /**
   * 线上文字编辑态（docs/07 §2「edit 态纹理隐藏」在 LINE 的落地）：文字由
   * 编辑器 DOM 承载，pixi 侧隐藏防双显——镂空矩形仍切分（见 _editorFrame），
   * 线在标签处保持断开（透明底露画布，参考同款）。
   */
  private _textEditing = false;
  /**
   * 编辑器框实测尺寸（世界坐标数值同 CSS 布局尺寸，见 RichTextEditor.layoutSize
   * 单位注释）。编辑期间镂空按**框矩形**而非文字 bbox——框含 padding/border 比
   * 文字大一圈，且新文字未落库时 bbox 不存在（线会从框下穿过，2026-10-02 实测）。
   */
  private _editorFrame: { width: number; height: number } | null = null;
  /** 最近一次镂空矩形（世界坐标，E2E 探针 lineKnockout 用） */
  private _lastKnockout: { x: number; y: number; width: number; height: number } | null = null;

  constructor() {
    super({
      id: '',
      type: 'LINE',
      zOrder: '',
      points: [
        [0, 0],
        [0, 0],
      ],
      startNodeId: null,
      endNodeId: null,
      startJoin: null,
      endJoin: null,
      color: '#4b5563',
      strokeWidth: 2,
      startArrow: 'none',
      endArrow: 'arrow',
      lineType: 'STRAIGHT',
      dashed: false,
      text: '',
      textRatio: 0.5,
      // 几何占位（几何交由 rect YKeyValue；线宽已改名 strokeWidth）
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    } as unknown as LineData & IRect);
    this.root.eventMode = 'none';
    this.root.addChild(this.g);
  }

  override render(_prev: LineData & IRect, next: LineData & IRect): void {
    // root 在原点（线是世界坐标绝对绘制），命中以世界坐标进行
    this.root.position.set(0, 0);
    this.root.scale.set(1);
    this.drawLine(
      next.points.map((p) => ({ x: p[0], y: p[1] })),
      next,
    );
  }

  /**
   * 拖拽预览期的视觉重路由（docs/08 §3 实时跟随）：图形按给定折线重绘、
   * **不写模型**——手势期零 Yjs 写（docs/00 铁律 4），松手落库后既有
   * onStateChanged$ → reattach 写真值并覆盖本预览。
   */
  previewRoute(pts: Array<{ x: number; y: number }>): void {
    this.drawLine(pts, this.state);
  }

  /** 编辑态开关（lineService.enterTextEdit/exitEdit 调）：立即按当前 state 重绘 */
  setTextEditing(editing: boolean): void {
    if (this._textEditing === editing) return;
    this._textEditing = editing;
    this.drawLine(
      this.state.points.map((p) => ({ x: p[0], y: p[1] })),
      this.state,
    );
  }

  /** 编辑器框尺寸（打字变宽时即时喂入）；null = 非编辑态回退文字 bbox 镂空 */
  setEditorFrame(frame: { width: number; height: number } | null): void {
    const cur = this._editorFrame;
    if (cur === frame) return;
    if (cur && frame && cur.width === frame.width && cur.height === frame.height) return;
    this._editorFrame = frame;
    this.drawLine(
      this.state.points.map((p) => ({ x: p[0], y: p[1] })),
      this.state,
    );
  }

  get knockoutRectDebug(): { x: number; y: number; width: number; height: number } | null {
    return this._lastKnockout;
  }

  /** 按给定折线重绘（数据渲染与缩放预览共用一条绘制路径；文字节点常驻不重建） */
  private drawLine(rawPts: IPt[], style: LineData): void {
    const g = this.g;
    g.clear(); // 只清图形路径；textSprite 是 g 的子节点不受影响
    if (rawPts.length < 2) return;
    const pts = effectivePath(rawPts, style.lineType);
    // 视觉路径两端收缩（2026-09-30 用户拍板留隙）：线不直接顶到元素，端点
    // 圆按钮悬空嵌在空隙里——只影响 stroke/箭头/镂空，文字锚点与命中检测
    // 仍按原始 pts（ratio 落库/反算/滑移语义不变）
    const vpts = insetEnds(pts, LINE_END_GAP);

    // 线上文字：先取实测尺寸的 Text 节点（决定镂空矩形），再切分路径。
    // 镂空宽用 Text 实测而非字符数估算——中文每字约 1em，0.62 系数会窄 40%，
    // 线会从文字两端穿过（外部审查揪出）。Text 实例常驻复用（文字不变只挪位置，
    // 节点拖拽带动连线跟随时不再每帧重建 canvas 栅格化纹理）。
    const plain = htmlToPlainText(style.text || '');
    let knockout: Rectangle | null = null;
    let textAnchor: IPt | null = null;
    const hasText = plain.trim().length > 0;
    const textNode = this.ensureTextNode();
    if (this._textEditing && this._editorFrame) {
      // 编辑期镂空 = 编辑器框实测矩形：空文字（未落库）即断线，且框含
      // padding/border 比文字 bbox 大一圈——按 bbox 切线会从框边缘穿过
      //（2026-10-02 用户实测揪出）
      textAnchor = pointAtRatio(pts, style.textRatio).point;
      knockout = new Rectangle(
        textAnchor.x - this._editorFrame.width / 2,
        textAnchor.y - this._editorFrame.height / 2,
        this._editorFrame.width,
        this._editorFrame.height,
      );
    } else if (hasText) {
      // per-实例排版 override（docs/17 §4）：style 可变——赋值触发重栅格化，
      // Text 实测宽高变化后镂空/滑移命中自动跟随
      const fs = style.fontSize ?? LINE_TEXT_FONT_SIZE;
      const fill = hexToNum(style.textColor ?? defaultLineTextColor());
      // 行高同源（批 lineHeight 顺修）：pixi lineHeight 是像素单位 = fs × 1.4，
      // 与编辑 DOM 的 1.4 倍逐像素一致——消除编辑/退出两态高度跳变
      const lh = fs * LINE_TEXT_LINE_HEIGHT;
      if (textNode.style.fontSize !== fs) textNode.style.fontSize = fs;
      if (textNode.style.lineHeight !== lh) textNode.style.lineHeight = lh;
      if (textNode.style.fill !== fill) textNode.style.fill = fill;
      if (textNode.text !== plain) textNode.text = plain;
      const { point } = pointAtRatio(pts, style.textRatio);
      textAnchor = point;
      const w = textNode.width + KNOCKOUT_PADDING * 2;
      const h = textNode.height + KNOCKOUT_PADDING * 2;
      knockout = new Rectangle(point.x - w / 2, point.y - h / 2, w, h);
    }
    this._lastKnockout = knockout
      ? { x: knockout.x, y: knockout.y, width: knockout.width, height: knockout.height }
      : null;
    // 编辑期间文字只留 DOM 一份；Text 隐藏但尺寸已实测（镂空断线保持——
    // border 框内透明底露画布，参考同款）
    textNode.visible = hasText && !this._textEditing;

    const visible = knockout ? slicePathExcludingRect(vpts, knockout) : [vpts];
    for (const piece of visible) {
      this.strokePath(piece, style);
    }

    // 箭头方向取首/尾段（ELBOWED 折线箭头沿最后一段方向，docs/08 §5）——
    // 画在收缩后端点（悬空贴元素，参考同款）
    if (style.endArrow !== 'none') {
      this.drawArrow(vpts[vpts.length - 2]!, vpts[vpts.length - 1]!, 'end', style);
    }
    if (style.startArrow !== 'none') {
      this.drawArrow(vpts[1]!, vpts[0]!, 'start', style);
    }

    if (textAnchor) {
      textNode.position.set(textAnchor.x, textAnchor.y);
    }
  }

  /** 线上文字节点（常驻，drawLine 只更新 text/style/visible/position） */
  private ensureTextNode(): Text {
    if (!this.textSprite) {
      this.textSprite = new Text({
        text: '',
        style: {
          fontFamily: 'sans-serif',
          fontSize: LINE_TEXT_FONT_SIZE,
          lineHeight: LINE_TEXT_FONT_SIZE * LINE_TEXT_LINE_HEIGHT,
          fill: hexToNum(defaultLineTextColor()),
          align: 'center',
        },
      });
      this.textSprite.anchor.set(0.5);
      this.g.addChild(this.textSprite);
    }
    return this.textSprite;
  }

  /** 一条可见折线 → stroke（虚线切分 / ELBOWED 圆角拐点） */
  private strokePath(piece: IPt[], style: LineData): void {
    const segments = style.dashed
      ? slicePathByDash(piece, DASH_PATTERN[0], DASH_PATTERN[1])
      : [piece];
    for (const seg of segments) {
      if (style.lineType === 'ELBOWED') {
        this.strokeRounded(seg, style);
      } else if (style.lineType === 'CURVE' && seg.length > 2) {
        // 曲线（批次 4）：piece = flattenCurve 采样折线，逐点连线（弦高误差
        // <0.3% 视觉平滑；虚线切分同管线——slicePathByDash 天然可用）
        this.g.moveTo(seg[0]!.x, seg[0]!.y);
        for (let i = 1; i < seg.length; i++) {
          this.g.lineTo(seg[i]!.x, seg[i]!.y);
        }
        this.g.stroke({
          width: style.strokeWidth,
          color: hexToNum(style.color),
          cap: 'round',
          join: 'round',
        });
      } else {
        this.g
          .moveTo(seg[0]!.x, seg[0]!.y)
          .lineTo(seg[seg.length - 1]!.x, seg[seg.length - 1]!.y)
          .stroke({ width: style.strokeWidth, color: hexToNum(style.color), cap: 'round' });
      }
    }
  }

  /** ELBOWED：逐拐点 R8 二次贝塞尔圆角（首尾端点精确，箭头贴齐） */
  private strokeRounded(seg: IPt[], style: LineData): void {
    const g = this.g;
    const color = hexToNum(style.color);
    if (seg.length === 2) {
      g.moveTo(seg[0]!.x, seg[0]!.y)
        .lineTo(seg[1]!.x, seg[1]!.y)
        .stroke({ width: style.strokeWidth, color, cap: 'round' });
      return;
    }
    g.moveTo(seg[0]!.x, seg[0]!.y);
    for (let i = 1; i + 1 < seg.length; i++) {
      const prev = seg[i - 1]!;
      const c = seg[i]!;
      const next = seg[i + 1]!;
      const inDir = segmentDirection(prev, c);
      const outDir = segmentDirection(c, next);
      const prevLen = Math.hypot(c.x - prev.x, c.y - prev.y);
      const nextLen = Math.hypot(next.x - c.x, next.y - c.y);
      const rIn = Math.min(ELBOW_RADIUS, prevLen / 2);
      const rOut = Math.min(ELBOW_RADIUS, nextLen / 2);
      const before = { x: c.x - inDir.x * rIn, y: c.y - inDir.y * rIn };
      const after = { x: c.x + outDir.x * rOut, y: c.y + outDir.y * rOut };
      g.lineTo(before.x, before.y);
      g.quadraticCurveTo(c.x, c.y, after.x, after.y);
    }
    const last = seg[seg.length - 1]!;
    g.lineTo(last.x, last.y);
    g.stroke({ width: style.strokeWidth, color, cap: 'round', join: 'round' });
  }

  private drawArrow(from: IPt, to: IPt, variant: 'start' | 'end', next: LineData): void {
    const variantStyle = variant === 'end' ? next.endArrow : next.startArrow;
    const dir = segmentDirection(from, to);
    const tip = { x: to.x, y: to.y };
    const ang = Math.atan2(dir.y, dir.x);
    const color = hexToNum(next.color);
    const p1 = {
      x: tip.x - ARROW_LEN * Math.cos(ang - ARROW_ANGLE),
      y: tip.y - ARROW_LEN * Math.sin(ang - ARROW_ANGLE),
    };
    const p2 = {
      x: tip.x - ARROW_LEN * Math.cos(ang + ARROW_ANGLE),
      y: tip.y - ARROW_LEN * Math.sin(ang + ARROW_ANGLE),
    };
    if (variantStyle === 'solid') {
      this.g.moveTo(tip.x, tip.y).lineTo(p1.x, p1.y).lineTo(p2.x, p2.y).closePath().fill({ color });
    } else if (variantStyle === 'diamond') {
      // 菱形箭头（docs/05 §5 第四种，批次 3 落地）：长轴沿箭向、前顶点贴 tip
      // （线画到端点，菱形覆盖线端）；实心填充与 solid 同色
      const len = ARROW_LEN * 1.4;
      const wid = ARROW_LEN * 0.7;
      const back = { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
      const n = { x: -dir.y, y: dir.x };
      const mid = { x: tip.x - dir.x * (len / 2), y: tip.y - dir.y * (len / 2) };
      this.g
        .moveTo(tip.x, tip.y)
        .lineTo(mid.x + (n.x * wid) / 2, mid.y + (n.y * wid) / 2)
        .lineTo(back.x, back.y)
        .lineTo(mid.x - (n.x * wid) / 2, mid.y - (n.y * wid) / 2)
        .closePath()
        .fill({ color });
    } else {
      this.g
        .moveTo(p1.x, p1.y)
        .lineTo(tip.x, tip.y)
        .lineTo(p2.x, p2.y)
        .stroke({ width: next.strokeWidth, color, cap: 'round' });
    }
  }

  hitTestPoint(p: Point): boolean {
    // 视觉位置 = points + root 偏移（拖拽预览中 root 携带 delta），先把点转回 points 坐标系；
    // 命中沿视觉语义路径（STRAIGHT 只测首尾线段，不测残留拐点）
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    const pts = effectivePath(
      this.state.points.map((q) => ({ x: q[0], y: q[1] })),
      this.state.lineType,
    );
    // 屏幕恒定容差（Batch 1 · 1.8①）：worldTransform.a = 全局缩放（含 viewport
    // zoom；预览位移不改变它）——低 zoom 世界 tol 缩成亚像素点不中、高 zoom 过宽误选
    const s = Math.abs(this.root.worldTransform.a) || 1;
    return polylineHit(
      { x: lx, y: ly },
      pts,
      ((this.state.strokeWidth ?? 2) + HIT_TOLERANCE_BASE) / s,
    );
  }

  /** 线上文字 bbox 命中（世界坐标；文字滑移手势抓取判定，docs/08 §6 批次 3）。
   *  bbox 与渲染镂空同源：Text 实测尺寸 + KNOCKOUT_PADDING 外扩 */
  hitTestText(p: Point): boolean {
    if (!this.textSprite || !this.textSprite.visible) return false;
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    const pts = effectivePath(
      this.state.points.map((q) => ({ x: q[0], y: q[1] })),
      this.state.lineType,
    );
    const { point } = pointAtRatio(pts, this.state.textRatio);
    const w = this.textSprite.width + KNOCKOUT_PADDING * 2;
    const h = this.textSprite.height + KNOCKOUT_PADDING * 2;
    return (
      lx >= point.x - w / 2 &&
      lx <= point.x + w / 2 &&
      ly >= point.y - h / 2 &&
      ly <= point.y + h / 2
    );
  }

  /** 文字滑移视觉预览（零模型写——手势期铁律 docs/00 ④；松手落库 textRatio）。
   *  复用 drawLine 全管线（镂空切分/虚线/箭头随 ratio 重算）。
   *  直绘场景图故尾部自求渲染 tick——此前依赖手势链路顺带 markRender 的
   *  隐式链，删任何一处上游 show 即真冻结（外部审查 A2，2026-10-03） */
  previewTextRatio(ratio: number): void {
    this.drawLine(
      this.state.points.map((p) => ({ x: p[0], y: p[1] })),
      { ...this.state, textRatio: ratio },
    );
    markRender();
  }

  /** 线无包围盒语义：points bbox + root 拖拽偏移（getBounds 反映当前视觉位置，docs/14 规则 4） */
  override getBounds(): IRect {
    const pts = effectivePath(
      this.state.points.map((q) => ({ x: q[0], y: q[1] })),
      this.state.lineType,
    );
    if (pts.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX + this.root.x,
      y: minY + this.root.y,
      width: Math.max(...xs) - minX,
      height: Math.max(...ys) - minY,
    };
  }

  /** 线不可整体拖动/缩放（2026-09-20 用户拍板对齐既有设计，docs/08 §3 修订）：
   *  既有设计 LineModel.updateTransform 为空操作（「取消操作」实证）——四覆写
   *  即空操作语义：拖线身/键盘微移/整体缩放均无视觉反馈与落库；线的移动
   *  只能拖端点重锚定或随锚定节点移动。注意是覆写为空而非删覆写——删了
   *  会回归 rect 型基类默认（updateRect 平移，松手弹回的旧 bug 形态）。 */
  override applyDragPreview(_initBounds: IRect, _dx: number, _dy: number): void {
    /* 空操作（对齐既有设计） */
  }

  override commitDrag(_initBounds: IRect, _dx: number, _dy: number): void {
    /* 空操作（对齐既有设计） */
  }

  override applyResizePreview(_startRect: IRect, _nextRect: IRect): void {
    /* 空操作（对齐既有设计） */
  }

  override commitResize(_startRect: IRect, _nextRect: IRect): void {
    /* 空操作（对齐既有设计） */
  }

  /** 框选：points bbox 与矩形相交（按 root 原点 + localBounds 会偏移 bbox） */
  override hitTestRect(r: Rectangle): boolean {
    return rectsIntersect(this.getBounds(), { x: r.x, y: r.y, width: r.width, height: r.height });
  }

  override dispose(): void {
    this.textSprite = null;
    super.dispose();
  }
}
