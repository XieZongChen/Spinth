import { Container, Graphics } from 'pixi.js';
import { markRender } from '../../common/render';
import { CORNER_HANDLE_SCREEN } from './lineHandles';
import { capsuleAnchors, type IPt } from './lineMath';
import type { IRect } from '../../common/geometry';

/**
 * 线段中点手柄（docs/08 §10 批次 3，参考同款）：单选连线时的蓝色胶囊
 * （沿段方向旋转），提示段级操作（滑移手势抓取点）。
 * 锚点 = capsuleAnchors 单一事实源（2026-10-02 参考规格）：无字 = 每主段
 * （屏显 ≥60px）中点；有字 = 文字两侧各侧可见部分弧长中点（避字双胶囊）。
 * 尺寸按视口 scale 反补偿；hover 段放大 1.25×。eventMode none：命中判定
 * 由 lineService 按距离完成。
 */

const SEG_HANDLE_LEN = 24;
const SEG_HANDLE_THICK = 6;
const SEG_COLOR = 0x2878ff;
const HOVER_SCALE = 1.25;

export class LineSegmentHandles extends Container {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.g);
    parent.addChild(this);
  }

  /** 显示段手柄（pts 视觉语义路径；scale 反补偿；activeIndex = 锚点数组
   *  序号，hover 放大；knockout = 文字镂空矩形（null = 无字走主段口径）；
   *  corners = 内部拐点手柄（specs/flowchart-closeout §6.4 G-11——6 屏幕 px
   *  方块，仅 ELBOWED 传入；null = 不画） */
  show(
    pts: readonly IPt[],
    scale = 1,
    activeIndex: number | null = null,
    knockout: IRect | null = null,
    corners: readonly IPt[] | null = null,
  ): void {
    const s = scale || 1;
    this.g.clear();
    if (corners && corners.length > 0) {
      // 拐点方块：先画（层序在胶囊之下——拐点是更小的精操作目标）
      const half = CORNER_HANDLE_SCREEN / 2 / s;
      for (const c of corners) {
        this.g.rect(c.x - half, c.y - half, half * 2, half * 2).fill({ color: SEG_COLOR });
      }
    }
    capsuleAnchors(pts, s, knockout).forEach(({ geom }, i) => {
      const len = (SEG_HANDLE_LEN / s) * (i === activeIndex ? HOVER_SCALE : 1);
      const thick = (SEG_HANDLE_THICK / s) * (i === activeIndex ? HOVER_SCALE : 1);
      const r = thick / 2;
      const half = len / 2 - r; // 直段半长（两端各让出半圆）
      const dx = Math.cos(geom.angle);
      const dy = Math.sin(geom.angle);
      const nx = -dy;
      const ny = dx;
      const c1 = { x: geom.mid.x - dx * half, y: geom.mid.y - dy * half };
      const c2 = { x: geom.mid.x + dx * half, y: geom.mid.y + dy * half };
      this.g.circle(c1.x, c1.y, r).circle(c2.x, c2.y, r);
      this.g
        .moveTo(c1.x + nx * r, c1.y + ny * r)
        .lineTo(c2.x + nx * r, c2.y + ny * r)
        .lineTo(c2.x - nx * r, c2.y - ny * r)
        .lineTo(c1.x - nx * r, c1.y - ny * r)
        .closePath();
      this.g.fill({ color: SEG_COLOR });
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
