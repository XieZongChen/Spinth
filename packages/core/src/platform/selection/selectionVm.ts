import { Graphics } from 'pixi.js';
import { markRender } from '../../common/render';
import { unionRects, type IRect } from '../../common/geometry';
import {
  SELECTION_COLOR,
  SELECTION_LINE_WIDTH,
  SELECTION_RADIUS,
  SELECTION_FILL_ALPHA,
} from '../../common/selectionStyle';

/** 多选/混合选区外框（docs/05 §2）：可随拖拽平移（纯视觉）。
 *  视觉语言见 selectionStyle.ts（全元素统一：恒定线宽 + 圆角 + 微填充）。 */
export class SelectionVm {
  readonly graphics = new Graphics();
  private current: IRect | null = null;

  constructor(
    parent: { addChild(c: Graphics): void },
    /** 视口缩放（线宽屏幕恒定 /scale 补偿；单测注入常量 1） */
    private getScale: () => number = () => 1,
  ) {
    this.graphics.eventMode = 'none';
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  get bounds(): IRect | null {
    return this.current;
  }

  showBounds(rects: IRect[]): void {
    const u = unionRects(rects);
    if (!u) {
      this.hide();
      return;
    }
    this.current = u;
    this.graphics.visible = true;
    this.draw(u);
  }

  /** 拖拽跟随：绝对定位（幂等）。docs/14 规则 1——禁止增量累加式更新
   *  （累加在多次 pointermove 下复合漂移，框以倍速飞离形状）。
   *  隐藏态跳过（2026-09-30 用户实测：拖线身时 selector 拖拽跟随会把单选
   *  LINE 已隐藏的选区框拽出来现身——框跟手动 =「线看似可拖」，松手空操作
   *  落库框消失 =「弹回」；draw 强制 visible=true 是根因） */
  moveTo(rect: IRect): void {
    if (!this.graphics.visible) return; // 隐藏态无位置语义（连 current 一并不动）
    this.current = { ...rect };
    this.draw(this.current);
  }

  hide(): void {
    this.current = null;
    this.graphics.visible = false;
    markRender();
  }

  private draw(r: IRect): void {
    const s = this.getScale() || 1;
    this.graphics.clear();
    this.graphics
      .roundRect(r.x, r.y, r.width, r.height, SELECTION_RADIUS / s)
      .fill({ color: SELECTION_COLOR, alpha: SELECTION_FILL_ALPHA })
      .stroke({ width: SELECTION_LINE_WIDTH / s, color: SELECTION_COLOR });
    markRender();
  }
}
