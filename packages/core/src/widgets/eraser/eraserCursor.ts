import { Container, Graphics } from 'pixi.js';
import { markRender } from '../../common/render';

/**
 * 橡皮圆形指示（eraser 大小可视）：optionLayer 世界坐标锚定的空心细描边圆
 * 跟随指针——调大小（方括号）与切割判定共用同一半径源（radiusPx 数据同源，
 * 切割处 eraserService.eraseSweep 自行做 ÷vpScale 同款换算）。eventMode none
 * 不参与命中（lineAnchorIndicator 同款形态）；半径/描边宽按 vpScale 换算，
 * 屏幕观感恒定（awarenessVm 缩放重画同款纪律）。
 */
export class EraserCursor extends Container {
  private readonly g = new Graphics();

  constructor(
    private readonly layer: Container,
    private radiusPx: number,
    private readonly vpScaleOf: () => number,
  ) {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.g);
    layer.addChild(this);
    this.redraw();
  }

  setRadius(px: number): void {
    this.radiusPx = px;
    this.redraw();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    markRender();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    markRender();
  }

  /** 指针移动（window pointermove passive → clientToWorld 后调用） */
  moveTo(world: { x: number; y: number }): void {
    this.position.set(world.x, world.y);
    markRender();
  }

  /** vpScale 变化：半径与描边宽重画（屏幕观感恒定） */
  rescale(): void {
    this.redraw();
  }

  private redraw(): void {
    const scale = this.vpScaleOf();
    this.g.clear();
    this.g
      .circle(0, 0, this.radiusPx / scale)
      .stroke({ width: 1 / scale, color: 0x1f2937, alpha: 0.55 });
    markRender();
  }

  override destroy(): void {
    this.layer.removeChild(this);
    super.destroy();
  }
}
