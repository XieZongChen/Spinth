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
 */

export {
  MIND_ROOT_STYLE,
  MIND_COLORS,
  MIND_ROOT_LABEL,
  MIND_NODE_STYLE,
  NODE_MAX_WIDTH,
} from '../kinds/mind/style';

export class TreeNodeVm extends Container {
  readonly model: TreeNodeModel;
  readonly depth: number; // 0 = 根
  readonly bg = new Graphics();
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
    this.addChild(this.bg, this.textLabel);
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
    markRender();
  }

  /** 本体矩形（世界坐标 = 容器内布局坐标；命中/连线/热区共用） */
  get rect(): { x: number; y: number; width: number; height: number } {
    return { x: this.x, y: this.y, width: this.nodeWidth, height: this.nodeHeight };
  }
}
