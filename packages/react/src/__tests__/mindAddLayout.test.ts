import { describe, expect, it } from 'vitest';
import { MIND_ADD_BTN, MIND_ADD_GAP, MIND_ADD_MARGIN, buildMindAddSlots } from '../mindAddLayout';

/**
 * 脑图 +/- 槽位钳制（批次 A · D8）：四边钳制、根/非根、左/右/同级
 * 槽位数量、居中不位移。BTN/GAP/边距常量全部从 mindAddLayout.ts 导入——
 * 单源，调整任一常量时测试与实现一起走。
 */

const AREA = { width: 390, height: 800 };

describe('buildMindAddSlots（批次 A · 脑图按钮视口钳制）', () => {
  it('居中节点不位移：钳制是恒等变换', () => {
    const bounds = { x: 150, y: 300, width: 90, height: 40 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: true,
      direction: 'right',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    const left = slots.find((s) => s.key === 'left')!;
    const right = slots.find((s) => s.key === 'right')!;
    expect(left.left).toBe(bounds.x - MIND_ADD_BTN - MIND_ADD_GAP);
    expect(left.top).toBe(bounds.y + bounds.height / 2 - MIND_ADD_BTN / 2);
    expect(right.left).toBe(bounds.x + bounds.width + MIND_ADD_GAP);
    // 根节点无同级槽
    expect(slots.find((s) => s.key === 'sibling')).toBeUndefined();
    expect(slots.length).toBe(2);
  });

  it('靠右节点：右槽钳到 area.width - BTN - MARGIN（390 主缺陷面）', () => {
    // 右槽原始位置 612 冲出视口（mobile.spec M8 首跑实测）
    const bounds = { x: 300, y: 300, width: 80, height: 36 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: true,
      direction: 'right',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    const right = slots.find((s) => s.key === 'right')!;
    expect(right.left).toBe(390 - MIND_ADD_BTN - MIND_ADD_MARGIN); // 358
  });

  it('靠左节点：左槽钳到下限 MARGIN', () => {
    const bounds = { x: 10, y: 300, width: 80, height: 36 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: true,
      direction: 'left',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    const left = slots.find((s) => s.key === 'left')!;
    expect(left.left).toBe(MIND_ADD_MARGIN); // 原始 10-28-8=-26
  });

  it('靠下节点：同级槽 top 钳到 area.height - BTN - MARGIN', () => {
    const bounds = { x: 150, y: 780, width: 80, height: 36 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: false,
      direction: 'right',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    const sibling = slots.find((s) => s.key === 'sibling')!;
    expect(sibling.top).toBe(800 - MIND_ADD_BTN - MIND_ADD_MARGIN); // 768
  });

  it('靠上节点：top 钳到下限 MARGIN（垂直中心不钻顶）', () => {
    const bounds = { x: 150, y: 0, width: 80, height: 30 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: false,
      direction: 'right',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    const right = slots.find((s) => s.key === 'right')!;
    expect(right.top).toBe(MIND_ADD_MARGIN); // 原始 0+15-14=1
  });

  it('非根只建所在侧 + 同级：direction=left 时右槽不存在', () => {
    const bounds = { x: 150, y: 300, width: 80, height: 36 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: false,
      direction: 'left',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    expect(slots.map((s) => s.key)).toEqual(['left', 'sibling']);
  });

  it('非根只建所在侧：direction=right → 右 + 同级（左侧是父节点方向）', () => {
    const bounds = { x: 150, y: 300, width: 80, height: 36 };
    const slots = buildMindAddSlots({
      bounds,
      isRoot: false,
      direction: 'right',
      slotLeft: bounds.x,
      slotRight: bounds.x + bounds.width,
      area: AREA,
    });
    expect(slots.map((s) => s.key)).toEqual(['right', 'sibling']);
  });

  it('area 放不下按钮（极端值）：钳到下限 MARGIN 不产出负坐标', () => {
    const slots = buildMindAddSlots({
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      isRoot: true,
      direction: 'right',
      slotLeft: 0,
      slotRight: 40,
      area: { width: 0, height: 0 },
    });
    for (const s of slots) {
      expect(s.left).toBe(MIND_ADD_MARGIN);
      expect(s.top).toBe(MIND_ADD_MARGIN);
    }
  });
});
