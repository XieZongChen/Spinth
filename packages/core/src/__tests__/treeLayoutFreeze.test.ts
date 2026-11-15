import { describe, expect, it } from 'vitest';
import { layoutMindTree } from '../widgets/tree/layout/mindHorizontal';
import type { ILayoutNode } from '../widgets/tree/layout/types';

/**
 * mind 横向布局 golden 冻结（specs/tree-diagrams §5.2/Phase 0 验收）：骨架抽取/
 * 竖向/org 落地过程中，同夹具的逐节点 positions/bbox 必须逐值不变——改算法
 * （含「看似等价」的重构）先红这里，再由人工确认是否真的要改基线。
 */

/** 夹具：3 层左右树（右侧两分支含孙层、左侧单子链）+ 尺寸差异（触发居中/平衡分支） */
const FIXTURE: ILayoutNode = {
  id: 'root',
  width: 120,
  height: 40,
  children: [
    {
      id: 'A',
      width: 80,
      height: 20,
      direction: 'right',
      children: [
        { id: 'A1', width: 50, height: 16 },
        { id: 'A2', width: 70, height: 24 },
      ],
    },
    { id: 'B', width: 60, height: 30, direction: 'right' },
    {
      id: 'L1',
      width: 90,
      height: 20,
      direction: 'left',
      children: [{ id: 'L1a', width: 40, height: 16 }],
    },
  ],
};

/** 基准值由 2026-11-15 实现实跑生成（b67fcce 前的 mind/mindLayout.ts 同值） */
const GOLDEN_POSITIONS: Record<string, [number, number]> = {
  root: [0, 0],
  A: [220, -27.5],
  A1: [348, -39.5],
  A2: [348, -19.5],
  B: [220, 42.5],
  L1: [-190, 10],
  L1a: [-278, 12],
};
const GOLDEN_BBOX = { x: -278, y: -39.5, width: 696, height: 112 };

describe('treeLayoutFreeze（mind 横向 golden 冻结）', () => {
  it('夹具逐节点 positions 与 bbox 逐值一致', () => {
    const r = layoutMindTree(FIXTURE);
    expect(r.positions.size).toBe(Object.keys(GOLDEN_POSITIONS).length);
    for (const [id, [x, y]] of Object.entries(GOLDEN_POSITIONS)) {
      const p = r.positions.get(id);
      expect(p, `节点 ${id} 缺失`).toBeDefined();
      expect(p!.x).toBe(x);
      expect(p!.y).toBe(y);
    }
    expect(r.bbox).toEqual(GOLDEN_BBOX);
  });

  it('单子节点：子与父同 y 中线（连线应为直线，无台阶）', () => {
    const r = layoutMindTree({
      id: 'r',
      width: 100,
      height: 30,
      children: [{ id: 'c', width: 60, height: 20, direction: 'right' }],
    });
    const c = r.positions.get('c')!;
    // 子中心 y === 父中心 y（根 (0,0) h=30 → 中线 15；子 h=20 → y=5）
    expect(c.y + 10).toBe(15);
  });
});
