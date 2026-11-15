import { Container, Graphics, Text } from 'pixi.js';
import { markRender } from '../../../common/render';
import { hexToNum } from '../../../common/color';
import type { TreeNodeModel } from '../model/treeNodeModel';
import type { ITreeStyle } from '../registry';
import { MIND_COLORS } from '../kinds/mind/style';

/**
 * 树节点轻量视图（docs/11 §2，2026-09 形态决策：**不继承 BaseWidgetVm**——
 * 树节点不是 widget 类型，Registry/zOrder/model 注入对树内节点是死重；
 * 树内生命周期由 TreeMapVm 统一编排）。样式经 kind.style（测量与渲染同源），
 * mind 字号按层级：根 28 / 一级 18 / 其余 14。
 * 折叠徽标（specs/tree-diagrams §8.4）：仅折叠节点显示 +N；点击展开由
 * service 层 hitToggle 消费（本类只渲染不持事件）。
 */

export {
  MIND_ROOT_STYLE,
  MIND_COLORS,
  MIND_ROOT_LABEL,
  MIND_NODE_STYLE,
  NODE_MAX_WIDTH,
} from '../kinds/mind/style';

/** 折叠徽标直径（24px 触控目标口径；100% 缩放下达标） */
export const TREE_BADGE_SIZE = 24;

export class TreeNodeVm extends Container {
  readonly model: TreeNodeModel;
  readonly depth: number; // 0 = 根
  readonly bg = new Graphics();
  private readonly badge = new Graphics();
  private readonly badgeLabel = new Text({
    text: '',
    style: { fontFamily: 'sans-serif', fontSize: 11, fontWeight: '600', fill: 0xffffff },
  });
  /** 折叠徽标（null = 无徽标）；由 TreeMapVm 布局后写入 */
  private badgeState: { hiddenCount: number; anchor: 'left' | 'right' | 'root' } | null = null;
  readonly textLabel: Text;
  /** 测量后的本体尺寸（不含子树；布局输入） */
  nodeWidth = 0;
  nodeHeight = 0;

  constructor(model: TreeNodeModel, depth: number, style: ITreeStyle) {
    super();
    this.model = model;
    this.depth = depth;
    this.eventMode = 'none';
    this.styleSource = style;
    const p = this.presentation;
    this.textLabel = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: p.title.fontSize,
        fontWeight: p.title.fontWeight as never,
        fill: hexToNum(p.title.fill),
        wordWrap: true,
        wordWrapWidth: Math.max(p.wrapWidth, 40),
        breakWords: true,
      },
    });
    this.addChild(this.bg, this.textLabel, this.badge);
    this.refresh(model.toJSON().text);
  }

  private readonly styleSource: ITreeStyle;

  private get presentation() {
    return this.styleSource.presentation(
      { text: '', lineColor: this.model.getLineColor(MIND_COLORS.lineFallback) },
      this.depth,
    );
  }

  get fontSize(): number {
    return this.presentation.title.fontSize;
  }

  /** 文本/样式变化 → 测量 + 重绘本体（位置由布局层设置） */
  refresh(text: string): void {
    if (this.textLabel.text !== text) this.textLabel.text = text;
    const p = this.presentation;
    const maxTextW = p.wrapWidth; // 含自身 padding 总宽恒 ≤ maxWidth（presentation 单源）
    this.textLabel.style.wordWrapWidth = Math.max(maxTextW, 40);
    this.textLabel.position.set(p.padding.x, p.padding.y);
    this.nodeWidth = Math.ceil(this.textLabel.width) + p.padding.x * 2;
    this.nodeHeight = Math.ceil(this.textLabel.height) + p.padding.y * 2;

    this.bg.clear();
    this.bg.roundRect(0, 0, this.nodeWidth, this.nodeHeight, p.radius);
    this.bg
      .fill({ color: hexToNum(p.fill) })
      .stroke({ color: hexToNum(p.stroke.color), width: p.stroke.width });
    // 焦点节点**不再自画描边**（2026-09 单层化）：选中视觉统一走
    // SelectionVm 框（getFocusFrame，全元素同一设计语言）——描边+框
    // 双层叠加曾致「选中态样式异常」（用户实测揪出）
    this.drawBadge();
    markRender();
  }

  /** 折叠徽标：布局后由 TreeMapVm 写入（hiddenCount=null 清除） */
  setBadge(hiddenCount: number | null, anchor: 'left' | 'right' | 'root'): void {
    this.badgeState = hiddenCount === null || hiddenCount <= 0 ? null : { hiddenCount, anchor };
    this.drawBadge();
    markRender();
  }

  /** 徽标命中矩形（容器局部坐标；无徽标 null）——selector hitToggle 消费 */
  get badgeRect(): { x: number; y: number; width: number; height: number } | null {
    if (!this.badgeState) return null;
    const c = this.badgeCenter();
    const r = TREE_BADGE_SIZE / 2;
    return { x: c.x - r, y: c.y - r, width: TREE_BADGE_SIZE, height: TREE_BADGE_SIZE };
  }

  private badgeCenter(): { x: number; y: number } {
    const a = this.badgeState?.anchor ?? 'right';
    if (a === 'root') return { x: this.nodeWidth, y: this.nodeHeight }; // 根右下角（横竖通用）
    if (a === 'left') return { x: 0, y: this.nodeHeight / 2 };
    return { x: this.nodeWidth, y: this.nodeHeight / 2 };
  }

  private drawBadge(): void {
    this.badge.clear();
    const st = this.badgeState;
    if (!st) {
      this.badgeLabel.visible = false;
      return;
    }
    const c = this.badgeCenter();
    this.badge.circle(c.x, c.y, TREE_BADGE_SIZE / 2).fill({ color: 0x1f2937 });
    this.badgeLabel.visible = true;
    this.badgeLabel.text = `+${st.hiddenCount}`;
    if (!this.badgeLabel.parent) this.badge.addChild(this.badgeLabel);
    this.badgeLabel.position.set(c.x - this.badgeLabel.width / 2, c.y - this.badgeLabel.height / 2);
  }

  /** 本体矩形（世界坐标 = 容器内布局坐标；命中/连线/热区共用） */
  get rect(): { x: number; y: number; width: number; height: number } {
    return { x: this.x, y: this.y, width: this.nodeWidth, height: this.nodeHeight };
  }
}
