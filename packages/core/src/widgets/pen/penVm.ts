import { Graphics, Point, Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import {
  mapPointsRect,
  rectsIntersect,
  sqDistToSegment,
  translatePoints,
  type IRect,
} from '../../common/geometry';
import type { PenData } from '../../types';
import type { PenModel } from './penModel';

/**
 * 画笔视图层：中点二次贝塞尔平滑（既有设计同款，docs/04 §8）：
 * >3 点时以相邻中点为端点、原采样点为控制点逐段 quadraticCurveTo；
 * ≤3 点退化为折线。points 为世界坐标（控件自身不位移，root 恒在原点）。
 */
export class PenVm extends BaseWidgetVm<PenData & IRect> {
  private readonly g = new Graphics();

  constructor() {
    super({
      id: '',
      type: 'PEN',
      zOrder: '',
      points: [],
      color: '#1f2937',
      strokeWidth: 4,
      // 几何占位（几何交由 rect YKeyValue；笔宽已改名 strokeWidth）
      width: 0,
      x: 0,
      y: 0,
      height: 0,
    } as unknown as PenData & IRect);
    this.root.eventMode = 'none';
    this.root.addChild(this.g);
  }

  override render(_prev: PenData & IRect, next: PenData & IRect): void {
    this.root.position.set(0, 0);
    this.root.scale.set(1);
    this.drawPts(next.points, next.strokeWidth, next.color);
  }

  /** 按给定世界坐标点集重绘（数据渲染与缩放预览共用一条绘制路径） */
  private drawPts(pts: Array<[number, number]>, width: number, color: string): void {
    const g = this.g;
    g.clear();
    if (pts.length === 0) return;
    if (pts.length <= 3) {
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
    } else {
      // 中点平滑
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const cx = pts[i]![0];
        const cy = pts[i]![1];
        const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
        const my = (pts[i]![1] + pts[i + 1]![1]) / 2;
        g.quadraticCurveTo(cx, cy, mx, my);
      }
      const last = pts[pts.length - 1]!;
      g.lineTo(last[0], last[1]);
    }
    g.stroke({ width, color: parseInt(color.replace('#', ''), 16), cap: 'round', join: 'round' });
  }

  hitTestPoint(p: Point): boolean {
    // 视觉位置 = points + root 偏移（拖拽预览中 root 携带 delta），先把点转回 points 坐标系
    const lx = p.x - this.root.x;
    const ly = p.y - this.root.y;
    const pts = this.state.points;
    if (pts.length < 2) return false;
    const tol = (this.state.strokeWidth + 4) / (Math.abs(this.root.worldTransform.a) || 1); // 1.8② 屏幕恒定
    for (let i = 0; i + 1 < pts.length; i++) {
      if (
        sqDistToSegment(
          { x: lx, y: ly },
          { x: pts[i]![0], y: pts[i]![1] },
          { x: pts[i + 1]![0], y: pts[i + 1]![1] },
        ) <=
        tol * tol
      ) {
        return true;
      }
    }
    return false;
  }

  /** 线无包围盒语义：points bbox + root 拖拽偏移（getBounds 反映当前视觉位置，docs/14 规则 4） */
  override getBounds(): IRect {
    const pts = this.state.points;
    if (pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX + this.root.x,
      y: minY + this.root.y,
      width: Math.max(...xs) - minX,
      height: Math.max(...ys) - minY,
    };
  }

  /** points 世界坐标型：root 钉原点，平移量即 root 偏移（禁止用 init.x——那是 points bbox 原点） */
  override applyDragPreview(_initBounds: IRect, dx: number, dy: number): void {
    this.root.position.set(dx, dy);
  }

  override commitDrag(_initBounds: IRect, dx: number, dy: number): void {
    this._commitPoints(translatePoints(this.state.points, dx, dy));
  }

  /** 缩放视觉：points 重映射重绘（不用 root.scale——会拉伸笔宽） */
  override applyResizePreview(startRect: IRect, nextRect: IRect): void {
    this.drawPts(
      mapPointsRect(this.state.points, startRect, nextRect),
      this.state.strokeWidth,
      this.state.color,
    );
  }

  override commitResize(startRect: IRect, nextRect: IRect): void {
    this._commitPoints(mapPointsRect(this.state.points, startRect, nextRect));
  }

  private _commitPoints(points: Array<[number, number]>): void {
    // 整笔变换（低频全量替换；保持 Y.Array 形态，docs/16 §2）
    (this.model as PenModel | null)?.setPoints(points);
  }

  /** 框选：points bbox 与矩形相交（按 root 原点 + localBounds 会偏移 bbox） */
  override hitTestRect(r: Rectangle): boolean {
    return rectsIntersect(this.getBounds(), { x: r.x, y: r.y, width: r.width, height: r.height });
  }
}
