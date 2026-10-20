import { Graphics, Container, Text } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';
import type { ISpacingGap } from './spacingGuides';

const LINE_COLOR = 0xf5484d;
const LINE_WIDTH_SCREEN = 2;
/** 等间距徽标色（docs/06 §7 橙色系，与对齐红区分） */
const SPACING_COLOR = 0xe8930c;
const SPACING_TEXT_COLOR = 0xffffff;
/** 徽标屏幕规格：字号 11、胶囊内边 5×3、桥线端帽 4 */
const BADGE_FONT_SCREEN = 11;
const BADGE_PAD_SCREEN = 5;
const BADGE_CAP_SCREEN = 4;

/**
 * 参考线绘制（docs/06 §4/§7）：对齐命中线横贯当前视口（红）；等间距徽标 +
 * 间隙桥线（橙）。宽度/字号按缩放反向补偿（屏幕恒定）。root 为 Container——
 * 线走 Graphics、徽标文字走 Text（pixi Graphics 无法承载文本）。
 */
export class RefLineVm {
  readonly root = new Container();
  private readonly lineG = new Graphics();
  private readonly badgeLayer = new Container();

  constructor(parent: Container) {
    this.root.eventMode = 'none';
    this.root.visible = false;
    this.root.zIndex = 900;
    this.root.addChild(this.lineG, this.badgeLayer);
    parent.addChild(this.root);
  }

  show(
    vPositions: number[],
    hPositions: number[],
    gaps: ISpacingGap[],
    vpBounds: IRect,
    scale: number,
  ): void {
    const has = vPositions.length > 0 || hPositions.length > 0 || gaps.length > 0;
    this.root.visible = has;
    if (!has) return;
    const lw = LINE_WIDTH_SCREEN / scale;
    const g = this.lineG;
    g.clear();
    for (const x of vPositions) {
      g.rect(x - lw / 2, vpBounds.y, lw, vpBounds.height).fill({ color: LINE_COLOR });
    }
    for (const y of hPositions) {
      g.rect(vpBounds.x, y - lw / 2, vpBounds.width, lw).fill({ color: LINE_COLOR });
    }
    this.drawBadges(gaps, scale);
    markRender();
  }

  hide(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    this.lineG.clear();
    this.clearBadges();
    markRender();
  }

  /** 徽标层每帧销毁重建（拖拽 move 低频、数量 ≤4——与 docDisplay 同模式） */
  private drawBadges(gaps: ISpacingGap[], scale: number): void {
    this.clearBadges();
    const font = BADGE_FONT_SCREEN / scale;
    const cap = BADGE_CAP_SCREEN / scale;
    const bridge = this.lineG; // 桥线与对齐线同 Graphics（同为矢量描边）
    for (const gap of gaps) {
      const mid = (gap.from + gap.to) / 2;
      if (gap.axis === 'x') {
        // 桥线水平横跨间隙 + 两端端帽（垂直短线）
        bridge
          .moveTo(gap.from, gap.cross)
          .lineTo(gap.to, gap.cross)
          .stroke({ width: 1 / scale, color: SPACING_COLOR });
        bridge
          .moveTo(gap.from, gap.cross - cap)
          .lineTo(gap.from, gap.cross + cap)
          .stroke({ width: 1 / scale, color: SPACING_COLOR });
        bridge
          .moveTo(gap.to, gap.cross - cap)
          .lineTo(gap.to, gap.cross + cap)
          .stroke({ width: 1 / scale, color: SPACING_COLOR });
        this.badgeLayer.addChild(
          this.mkBadge(`${Math.round(gap.value)}`, mid, gap.cross, font, scale),
        );
      } else {
        bridge
          .moveTo(gap.cross, gap.from)
          .lineTo(gap.cross, gap.to)
          .stroke({ width: 1 / scale, color: SPACING_COLOR });
        bridge
          .moveTo(gap.cross - cap, gap.from)
          .lineTo(gap.cross + cap, gap.from)
          .stroke({ width: 1 / scale, color: SPACING_COLOR });
        bridge
          .moveTo(gap.cross - cap, gap.to)
          .lineTo(gap.cross + cap, gap.to)
          .stroke({ width: 1 / scale, color: SPACING_COLOR });
        this.badgeLayer.addChild(
          this.mkBadge(`${Math.round(gap.value)}`, gap.cross, mid, font, scale),
        );
      }
    }
  }

  /** 数字胶囊：圆角底 + 白字，中心钉在 (x,y)（屏幕恒定尺寸） */
  private mkBadge(label: string, x: number, y: number, font: number, scale: number): Container {
    const text = new Text({
      text: label,
      style: { fill: SPACING_TEXT_COLOR, fontSize: font, fontFamily: 'sans-serif' },
    });
    text.resolution = Math.max(1, scale); // 高倍缩放下保持文字清晰
    const pad = BADGE_PAD_SCREEN / scale;
    const w = text.width + pad * 2;
    const h = text.height + (pad * 2) / 2.5;
    // 胶囊底走同一 Text 的背景不可行——用 Graphics 垫底，Text 装入 Container 返回
    const wrap = new Container();
    const bg = new Graphics();
    const r = h / 2;
    bg.roundRect(-w / 2, -h / 2, w, h, r).fill({ color: SPACING_COLOR });
    wrap.addChild(bg, text);
    text.position.set(-text.width / 2, -text.height / 2);
    wrap.position.set(x, y);
    return wrap;
  }

  private clearBadges(): void {
    for (const c of [...this.badgeLayer.children]) c.destroy();
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
