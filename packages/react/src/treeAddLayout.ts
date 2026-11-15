/**
 * 树形图 +/- 按钮槽位钳制（specs/tree-diagrams §8.5，自 mindAddLayout 泛化）：
 * 槽位几何由 core getTreeAddButtons 计算（按 kind/orientation），本层只做
 * 两轴钳制——靠边节点的按钮不冲出视口（390 实测口径延续）。
 * 不翻转：child 槽的语义侧与位置绑定（翻转会让按钮语义与位置矛盾）。
 */

import type { ITreeAddButtonsState } from '@spinth/core';

/** 按钮直径（与 TreeAddButtons 的 BTN 保持一致——单源在此，组件从这里 import） */
export const TREE_ADD_BTN = 28;
/** 视口边最小留白 */
export const TREE_ADD_MARGIN = 4;

export interface TreeAddSlot {
  key: 'child' | 'sibling';
  side?: 'left' | 'right';
  /** 钳制后位置（canvas 局部坐标） */
  left: number;
  top: number;
}

function clamp(v: number, areaSize: number): number {
  const max = areaSize - TREE_ADD_BTN - TREE_ADD_MARGIN;
  return Math.min(Math.max(v, TREE_ADD_MARGIN), Math.max(TREE_ADD_MARGIN, max));
}

/** 槽位两轴钳制（area 无效时钳到下限 4，组件层负责传有效测量值） */
export function clampTreeAddSlots(
  slots: ITreeAddButtonsState['slots'],
  area: { width: number; height: number },
): TreeAddSlot[] {
  return slots.map((s) => ({
    ...s,
    left: clamp(s.left, area.width),
    top: clamp(s.top, area.height),
  }));
}
