import { Container, Graphics, Text } from 'pixi.js';
import { markRender } from '../../common/render';
import { hexToNum } from '../../common/color';
import type { MindNodeModel } from './mindNodeModel';

/**
 * 脑图节点轻量视图（docs/11 §2，2026-09 形态决策：**不继承 BaseWidgetVm**——
 * MIND_NODE 不是 widget 类型，Registry/zOrder/model 注入对树内节点是死重；
 * 树内生命周期由 MindMapVm 统一编排）。字号按层级：根 28 / 一级 18 / 其余 14。
 */

/** 根节点视觉规格（docs/11 §4 常量表；mind 工具幽灵根共享同一规格，所见即所得） */
export const MIND_ROOT_STYLE = {
  fontSize: 28,
  padX: 32,
  padY: 24,
  radius: 8,
} as const;

/**
 * 脑图视觉色板——唯一色源（hex 字符串，PIXI 侧经 hexToNum 消费）。
 * Vm / 幽灵根 / 缩略图 / 连线兜底全部同源；改配色只改这里。
 * rootStroke 用画布浅色：暗色画布上勾出根轮廓（根填充 #1f2937 与暗底
 * #1b1b22 对比度仅 ~1.2:1，曾整块隐身），浅色画布上与底同色无害。
 */
export const MIND_COLORS = {
  rootFill: '#1f2937',
  rootStroke: '#f8f9fa',
  rootStrokeWidth: 1.5,
  rootText: '#ffffff',
  nodeFill: '#ffffff',
  nodeStroke: '#d1d5db',
  nodeText: '#1f2937',
  lineFallback: '#22ab68',
  thumbConnector: '#9ca3af',
} as const;
/** 新建脑图根节点默认文案 */
export const MIND_ROOT_LABEL = '中心主题';

/** 普通节点视觉规格（缩略图渲染同源消费） */
export const MIND_NODE_STYLE = {
  fontSizeFirst: 18,
  fontSizeNode: 14,
  padX: 14,
  padY: 8,
  radius: 6,
} as const;

const FONT_SIZE_FIRST = MIND_NODE_STYLE.fontSizeFirst;
const FONT_SIZE_NODE = MIND_NODE_STYLE.fontSizeNode;
const NODE_FILL = hexToNum(MIND_COLORS.nodeFill);
const NODE_STROKE = hexToNum(MIND_COLORS.nodeStroke);
const NODE_RADIUS = MIND_NODE_STYLE.radius;
const NODE_PAD_X = MIND_NODE_STYLE.padX;
const NODE_PAD_Y = MIND_NODE_STYLE.padY;
export const NODE_MAX_WIDTH = 360;

export class MindNodeVm extends Container {
  readonly model: MindNodeModel;
  readonly depth: number; // 0 = 根
  readonly bg = new Graphics();
  readonly textLabel: Text;
  /** 测量后的本体尺寸（不含子树；布局输入） */
  nodeWidth = 0;
  nodeHeight = 0;

  constructor(model: MindNodeModel, depth: number) {
    super();
    this.model = model;
    this.depth = depth;
    this.eventMode = 'none';
    this.textLabel = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: this.fontSize,
        fontWeight: depth <= 1 ? '700' : '500',
        fill: hexToNum(depth === 0 ? MIND_COLORS.rootText : MIND_COLORS.nodeText),
        wordWrap: true,
        wordWrapWidth: NODE_MAX_WIDTH - NODE_PAD_X * 2,
        breakWords: true,
      },
    });
    this.addChild(this.bg, this.textLabel);
    this.refresh(model.toJSON().text);
  }

  get fontSize(): number {
    return this.depth === 0
      ? MIND_ROOT_STYLE.fontSize
      : this.depth === 1
        ? FONT_SIZE_FIRST
        : FONT_SIZE_NODE;
  }

  /** 文本/样式变化 → 测量 + 重绘本体（位置由布局层设置） */
  refresh(text: string): void {
    if (this.textLabel.text !== text) this.textLabel.text = text;
    const isRoot = this.depth === 0;
    const padX = isRoot ? MIND_ROOT_STYLE.padX : NODE_PAD_X;
    const padY = isRoot ? MIND_ROOT_STYLE.padY : NODE_PAD_Y;
    const maxTextW = NODE_MAX_WIDTH - padX * 2; // 含自身 padding 总宽恒 ≤ NODE_MAX_WIDTH
    this.textLabel.style.wordWrapWidth = Math.max(maxTextW, 40);
    this.textLabel.position.set(padX, padY);
    this.nodeWidth = Math.ceil(this.textLabel.width) + padX * 2;
    this.nodeHeight = Math.ceil(this.textLabel.height) + padY * 2;

    const radius = isRoot ? MIND_ROOT_STYLE.radius : NODE_RADIUS;
    const color = hexToNum(this.model.getLineColor(MIND_COLORS.lineFallback));
    this.bg.clear();
    this.bg.roundRect(0, 0, this.nodeWidth, this.nodeHeight, radius);
    if (isRoot) {
      this.bg
        .fill({ color: hexToNum(MIND_COLORS.rootFill) })
        .stroke({ width: MIND_COLORS.rootStrokeWidth, color: hexToNum(MIND_COLORS.rootStroke) });
    } else {
      this.bg
        .fill({ color: NODE_FILL })
        .stroke({ width: this.depth === 1 ? 2 : 1, color: this.depth === 1 ? color : NODE_STROKE });
    }
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
