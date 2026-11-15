import { describe, expect, it } from 'vitest';
import { clampTreeAddSlots, TREE_ADD_BTN } from '../treeAddLayout';

/** 树形图 + 按钮槽位钳制（specs/tree-diagrams §8.5，Phase 2b）：
 *  槽位几何在 core（getTreeAddButtons），react 只做两轴钳制。 */

const area = { width: 800, height: 600 };

describe('clampTreeAddSlots', () => {
  it('视口内槽位原样通过', () => {
    const out = clampTreeAddSlots(
      [
        { key: 'child', side: 'left', left: 100, top: 50 },
        { key: 'sibling', left: 300, top: 400 },
      ],
      area,
    );
    expect(out[0]).toMatchObject({ left: 100, top: 50, side: 'left' });
    expect(out[1]).toMatchObject({ left: 300, top: 400 });
  });

  it('靠边槽位钳进 [4, area-BTN-4]（不翻转语义侧）', () => {
    const out = clampTreeAddSlots(
      [
        { key: 'child', side: 'left', left: -20, top: 590 },
        { key: 'child', side: 'right', left: 900, top: -10 },
      ],
      area,
    );
    expect(out[0]).toMatchObject({ left: 4, top: 600 - TREE_ADD_BTN - 4, side: 'left' });
    expect(out[1]).toMatchObject({ left: 800 - TREE_ADD_BTN - 4, top: 4, side: 'right' });
  });

  it('无效 area（0）钳到下限 4', () => {
    const out = clampTreeAddSlots([{ key: 'sibling', left: 500, top: 500 }], {
      width: 0,
      height: 0,
    });
    expect(out[0]).toMatchObject({ left: 4, top: 4 });
  });
});
