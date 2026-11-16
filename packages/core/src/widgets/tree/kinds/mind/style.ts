/**
 * mind 节点呈现策略（specs/tree-diagrams §7.2 行为冻结）：字号按层级、
 * 根深底白字、一级分支色描边——测量与渲染同源的唯一取值面（ITreeNodePresentation）。
 * MIND_* 常量是公开导出源（包入口 re-export 冻结，specs §11.2）。
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

export const NODE_MAX_WIDTH = 360;

/** 节点呈现取值（spec §7.1 ITreeNodePresentation）：TreeNodeVm 的测量/绘制单源 */
export interface ITreeNodePresentation {
  title: { fontSize: number; fontWeight: string; fill: string };
  padding: { x: number; y: number };
  radius: number;
  fill: string;
  stroke: { color: string; width: number };
  /** 文本换行宽（不含 padding；Vm 里 wordWrapWidth = max(此值, 40)） */
  wrapWidth: number;
  /** 本体宽钳制（org 卡片 clamp(120,260)——specs §7.3；mind 不给 = 不钳制） */
  minWidth?: number;
  maxWidth?: number;
}

/** mind presentation（行为冻结：与 2026-09 实现逐字段一致）。
 *  lineColor 由调用方从 model.getLineColor 取好传入（分支色是数据，不是纯静态样式）。 */
export function mindPresentation(
  node: { text: string; lineColor?: string },
  depth: number,
): ITreeNodePresentation {
  const isRoot = depth === 0;
  const isFirst = depth === 1;
  if (isRoot) {
    return {
      title: {
        fontSize: MIND_ROOT_STYLE.fontSize,
        fontWeight: '700',
        fill: MIND_COLORS.rootText,
      },
      padding: { x: MIND_ROOT_STYLE.padX, y: MIND_ROOT_STYLE.padY },
      radius: MIND_ROOT_STYLE.radius,
      fill: MIND_COLORS.rootFill,
      stroke: { color: MIND_COLORS.rootStroke, width: MIND_COLORS.rootStrokeWidth },
      wrapWidth: NODE_MAX_WIDTH - MIND_ROOT_STYLE.padX * 2,
    };
  }
  return {
    title: {
      fontSize: isFirst ? MIND_NODE_STYLE.fontSizeFirst : MIND_NODE_STYLE.fontSizeNode,
      fontWeight: depth <= 1 ? '700' : '500',
      fill: MIND_COLORS.nodeText,
    },
    padding: { x: MIND_NODE_STYLE.padX, y: MIND_NODE_STYLE.padY },
    radius: MIND_NODE_STYLE.radius,
    fill: MIND_COLORS.nodeFill,
    stroke: isFirst
      ? { color: node.lineColor ?? MIND_COLORS.lineFallback, width: 2 }
      : { color: MIND_COLORS.nodeStroke, width: 1 },
    wrapWidth: NODE_MAX_WIDTH - MIND_NODE_STYLE.padX * 2,
  };
}
