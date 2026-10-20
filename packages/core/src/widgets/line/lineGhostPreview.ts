import { Container, Graphics } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';
import type { IPt } from './lineMath';

/**
 * quick-add 影子预览（docs/08 §10 批次 2，参考同款）：hover 快捷按钮时
 * 显示「点击后会发生什么」——灰色连线 + 幽灵形状轮廓（落位与路由均由
 * quickAddPlan 算好传入，预览与实际创建一致）。eventMode none。
 */

const LINE_COLOR = 0x9ca3af;
const GHOST_FILL = 0xe8f0fb;
const GHOST_STROKE = 0x9ca3af;

export class LineGhostPreview extends Container {
  private readonly g = new Graphics();
  /** 当前预览形态（探针 ghostModeDebug 同源）：rect = 幽灵矩形（建新形状）；
   *  line = 灰线连已有形状（方向被占，2026-10-02 参考视频） */
  mode: 'rect' | 'line' | null = null;

  constructor(parent: Container) {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.g);
    parent.addChild(this);
  }

  /** 建新形状预览（quickAddPlan create 分支）：幽灵矩形画**实际落位 rect**
   *  （正对或交替错开——调用方算好，2026-10-02），灰线画 routeElbow 真实
   *  路由折线（偏移布局下预览即点击后将创建的拐弯线；正对退化为直线） */
  showAt(rect: IRect, route: IPt[]): void {
    this.g.clear();
    if (route.length >= 2) {
      this.g.moveTo(route[0]!.x, route[0]!.y);
      for (let i = 1; i < route.length; i++) this.g.lineTo(route[i]!.x, route[i]!.y);
      this.g.stroke({ width: 2, color: LINE_COLOR, alpha: 0.8 });
    }
    this.g
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: GHOST_FILL, alpha: 0.6 })
      .stroke({ width: 1.5, color: GHOST_STROKE, alpha: 0.8 });
    this.mode = 'rect';
    this.visible = true;
    markRender();
  }

  /** 方向被已有形状占据（quickAddTarget 命中）：灰线画**真实路由折线**
   *  （routeElbow 预演——偏移布局下预览即点击后将创建的拐弯线，2026-10-02
   *  用户实测：直线预览在偏移场景被误读为「创建的连线是直连」） */
  showRoute(pts: IPt[]): void {
    if (pts.length < 2) return;
    this.g.clear();
    this.g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) this.g.lineTo(pts[i]!.x, pts[i]!.y);
    this.g.stroke({ width: 2, color: LINE_COLOR, alpha: 0.8 });
    this.mode = 'line';
    this.visible = true;
    markRender();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.mode = null;
    markRender();
  }

  override destroy(): void {
    this.g.destroy();
    super.destroy({ children: true });
  }
}
