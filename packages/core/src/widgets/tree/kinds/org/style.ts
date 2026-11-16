/**
 * org 卡片呈现策略（specs/tree-diagrams §7.3，Phase 3）：白卡描边、标题
 * 14/600、副标题 12/400（Phase 4 渲染）、clamp(120,260) 宽——不做「同层等宽」
 * （名字长短差异大时等宽留白/截断；clamp + 父居中保持秩序）。深浅主题都用
 * 白卡（与 mind 固定色板一致；主题化改此单源）。
 */
import type { ITreeNodePresentation } from '../mind/style';

export const ORG_TITLE = { fontSize: 14, fontWeight: '600', fill: '#1f2937' } as const;
export const ORG_CARD = {
  fill: '#ffffff',
  stroke: '#cbd5e1',
  strokeWidth: 1,
  rootStrokeWidth: 2, // 根卡视觉锚点（不放大字号）
  radius: 6,
  padX: 12,
  padY: 8,
  minW: 120,
  maxW: 260,
} as const;
export const ORG_ROOT_TEXT = '负责人';

/** org presentation：所有层同规格（根仅描边加粗）——测量与渲染单源 */
export function orgPresentation(
  node: { text: string; lineColor?: string },
  depth: number,
): ITreeNodePresentation {
  void node;
  return {
    title: { ...ORG_TITLE },
    padding: { x: ORG_CARD.padX, y: ORG_CARD.padY },
    radius: ORG_CARD.radius,
    fill: ORG_CARD.fill,
    stroke: {
      color: ORG_CARD.stroke,
      width: depth === 0 ? ORG_CARD.rootStrokeWidth : ORG_CARD.strokeWidth,
    },
    wrapWidth: ORG_CARD.maxW - ORG_CARD.padX * 2,
    minWidth: ORG_CARD.minW,
    maxWidth: ORG_CARD.maxW,
  };
}

/** 卡片宽钳制（测量侧与命中侧同源）：clamp(测量宽, 120, 260) */
export function clampOrgCardWidth(measured: number): number {
  return Math.min(Math.max(measured, ORG_CARD.minW), ORG_CARD.maxW);
}
