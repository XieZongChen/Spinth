import { Container, Graphics } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IHostGeom } from '../../common/geometry';
import { anchorOf, rotatePointAround, type IPt, type JoinDir } from './lineMath';

/**
 * line 工具悬停连接点指示器（docs/08 §10 批次 1）：悬停对象渲染四边中点
 * 蓝色圆点（参考同款），提示可锚定的位置与所在边。挂 optionLayer、
 * eventMode none（不参与命中）、随 markRender 按需渲染。
 */

/** 功能蓝（选区语言同源，docs/05 §2）+ 白描边（任意填充上可见）。
 *  导出共用：连线端点手柄（lineEndpointHandles）与快捷创建点同一套圆点样式，
 *  单点定义防两处漂移（2026-09-30 用户拍板统一）。 */
export const ANCHOR_COLOR = 0x2878ff;
export const RING_COLOR = 0xffffff;
export const DOT_RADIUS = 4;

const JOINS: readonly JoinDir[] = ['top', 'right', 'bottom', 'left'];

/** 连接点外移距离（形状外 24px，参考同款——边中点已被缩放手柄占用）。
 *  常量单源在 lineMath（dotOffsetCenter 纯函数同源），此处 re-export 保持
 *  既有 import 路径不破 */
import { ANCHOR_DOT_OFFSET } from './lineMath';
export { ANCHOR_DOT_OFFSET };

const JOIN_NORMALS: Record<JoinDir, IPt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export class LineAnchorIndicator extends Container {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.g);
    parent.addChild(this);
  }

  /**
   * 显示连接点（bounds 为世界坐标 = stage 坐标）：
   * - 默认（选中态快速创建点）：形状**外** 24px——避开边缘缩放热区，与抓取判定
   *   （dotCenter）/ 快捷创建快照同一坐标（历史上默认值写反过：点位画在边中点、
   *   抓取却按外移点判定的隐形错位，2026-09-29 修正）；
   * - outside=false（连线工具的目标反馈）：**紧贴边中点**（两套逻辑不同，docs/08 §10）；
   * activeIndex = 光标最近连接点（放大高亮——指示器本身 eventMode none，
   * 用视觉响应替代 hover 态）。
   */
  show(geom: IHostGeom, activeIndex: number | null = null, opts?: { outside?: boolean }): void {
    const off = opts?.outside === false ? 0 : ANCHOR_DOT_OFFSET;
    this.g.clear();
    JOINS.forEach((j, i) => {
      const a = anchorOf(geom.rect, j, geom.rotation);
      const n =
        geom.rotation === 0
          ? JOIN_NORMALS[j]
          : rotatePointAround(JOIN_NORMALS[j], { x: 0, y: 0 }, geom.rotation);
      const p = { x: a.x + n.x * off, y: a.y + n.y * off };
      const r = i === activeIndex ? DOT_RADIUS + 2 : DOT_RADIUS;
      this.g
        .circle(p.x, p.y, r)
        .fill({ color: ANCHOR_COLOR })
        .stroke({ width: 2, color: RING_COLOR });
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
