import { Graphics, Point } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';

/** 框选手势状态（start 按下点 / cur 当前点，世界坐标） */
export interface MarqueeState {
  start: Point;
  cur: Point;
}

/** 框选矩形（start/cur → 正向矩形）：SelectorVm.show/update 的输入几何 */
export function marqueeRectOf(m: MarqueeState): IRect {
  return {
    x: Math.min(m.start.x, m.cur.x),
    y: Math.min(m.start.y, m.cur.y),
    width: Math.abs(m.cur.x - m.start.x),
    height: Math.abs(m.cur.y - m.start.y),
  };
}

/** 框选橡皮筋（docs/05 §2）：只在空白处按下拖动时出现 */
export class SelectorVm {
  readonly graphics = new Graphics();

  constructor(parent: { addChild(c: Graphics): void }) {
    this.graphics.eventMode = 'none';
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  show(rect: IRect): void {
    this.graphics.visible = true;
    this.draw(rect);
  }

  update(rect: IRect): void {
    this.draw(rect);
  }

  hide(): void {
    this.graphics.visible = false;
    markRender();
  }

  private draw(r: IRect): void {
    this.graphics.clear();
    this.graphics.rect(r.x, r.y, r.width, r.height);
    this.graphics.fill({ color: 0x2878ff, alpha: 0.08 });
    this.graphics.stroke({ width: 1, color: 0x2878ff, alpha: 0.6 });
    markRender();
  }
}
