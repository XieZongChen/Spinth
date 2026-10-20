import { Container, Graphics } from 'pixi.js';
import { markRender } from '../../common/render';
import { ANCHOR_COLOR, DOT_RADIUS, RING_COLOR } from './lineAnchorIndicator';
import type { IPt } from './lineMath';

/**
 * 连线端点手柄（docs/08 §10 批次 2，2026-09-30 用户拍板统一）：单选连线时
 * 首末两端圆点——**实心蓝 + 白描边，与快捷创建点（lineAnchorIndicator）
 * 同一套圆点样式**（样式常量单点定义 import，防两处漂移）——拖拽重锚定 /
 * 拖离解绑的抓取提示。尺寸按视口 scale 反补偿（世界坐标绘制，屏显恒定）；
 * hover 端 +2 放大（同 indicator 的 active 语义）。eventMode none：命中判定
 * 由 lineService 手势钩子按距离完成（与连接点指示器同策略）。
 */

export class LineEndpointHandles extends Container {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.g);
    parent.addChild(this);
  }

  /**
   * 显示两端手柄（pts = [起点, 终点]，世界坐标）。
   * scale = 视口缩放（尺寸反补偿：除以 scale 屏显恒定）；
   * activeIndex = 悬停/按住的端点（0 起点 / 1 终点，+2/scale 放大）。
   */
  show(pts: readonly [IPt, IPt], scale = 1, activeIndex: number | null = null): void {
    const s = scale || 1;
    this.g.clear();
    pts.forEach((p, i) => {
      const r = i === activeIndex ? (DOT_RADIUS + 2) / s : DOT_RADIUS / s;
      this.g
        .circle(p.x, p.y, r)
        .fill({ color: ANCHOR_COLOR })
        .stroke({ width: 2 / s, color: RING_COLOR });
    });
    this.visible = true;
    markRender();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    markRender();
  }

  override destroy(): void {
    this.g.destroy();
    super.destroy({ children: true });
  }
}
