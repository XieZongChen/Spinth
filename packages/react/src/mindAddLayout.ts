/**
 * 脑图 +/- 按钮槽位布局（批次 A · A3/D8）：纯算术抽纯函数，
 * 组件只负责测量与渲染。
 *
 * 此前直接输出 slotLeft - BTN - GAP / slotRight + GAP，无边界——
 * 靠边节点的按钮冲出视口（390 实测右槽到 612 > 390）。钳制语义：
 * 每个槽位 left/top 钳到 [4, area - BTN - 4]；不左右翻转（左槽仍是
 * 左子——翻转会让按钮语义与位置矛盾）。area 无效（小到放不下按钮）
 * 时钳到下限 4，组件层负责传有效测量值。
 */

/** 按钮直径（与 MindAddButtons 的 BTN 保持一致——单源在此，组件从这里 import） */
export const MIND_ADD_BTN = 28;
/** 按钮与节点边缘的间距 */
export const MIND_ADD_GAP = 8;
/** 视口边最小留白 */
const MARGIN = 4;

export interface MindAddBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindAddSlot {
  key: 'left' | 'right' | 'sibling';
  left: number;
  top: number;
}

function clamp(v: number, areaSize: number): number {
  const max = areaSize - MIND_ADD_BTN - MARGIN;
  return Math.min(Math.max(v, MARGIN), Math.max(MARGIN, max));
}

export function buildMindAddSlots(input: {
  bounds: MindAddBounds;
  isRoot: boolean;
  direction: 'left' | 'right';
  slotLeft: number;
  slotRight: number;
  area: { width: number; height: number };
}): MindAddSlot[] {
  const { bounds, isRoot, direction, slotLeft, slotRight, area } = input;
  const midX = bounds.x + bounds.width / 2 - MIND_ADD_BTN / 2;
  const midY = bounds.y + bounds.height / 2 - MIND_ADD_BTN / 2;

  const slots: MindAddSlot[] = [];
  // 左右：建子（根双侧、非根所在侧；方向由槽位决定）
  if (isRoot || direction === 'left') {
    slots.push({
      key: 'left',
      left: clamp(slotLeft - MIND_ADD_BTN - MIND_ADD_GAP, area.width),
      top: clamp(midY, area.height),
    });
  }
  if (isRoot || direction === 'right') {
    slots.push({
      key: 'right',
      left: clamp(slotRight + MIND_ADD_GAP, area.width),
      top: clamp(midY, area.height),
    });
  }
  // 下：建同级（根无同级）
  if (!isRoot) {
    slots.push({
      key: 'sibling',
      left: clamp(midX, area.width),
      top: clamp(bounds.y + bounds.height + MIND_ADD_GAP, area.height),
    });
  }
  return slots;
}
