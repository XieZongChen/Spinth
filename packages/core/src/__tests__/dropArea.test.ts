import { describe, expect, it } from 'vitest';
import {
  DropArea,
  DROP_AREA_HORIZONTAL_PADDING,
  DROP_AREA_VERTICAL_PADDING,
  type IDropTarget,
} from '../widgets/mind/dropArea';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

/** 造一个「节点 n1（100,100,80,30）+ 子节点」的右树热区；目标语义直出便于断言 */
function make(
  opts: { direction?: 'left' | 'right'; children?: Array<{ x: number; y: number }> } = {},
) {
  const direction = opts.direction ?? 'right';
  const kids = opts.children ?? [
    { x: 300, y: 50 },
    { x: 300, y: 100 },
  ];
  const childRects = kids.map((k) => ({ rect: R(k.x, k.y, 60, 24) }));
  return new DropArea({
    originRect: R(100, 100, 80, 30),
    direction,
    childRects,
    currentTarget: (pos): IDropTarget => ({
      kind: 'asSibling',
      parentId: 'root',
      index: pos === 'after' ? 1 : 0,
    }),
    childTarget: (pos): IDropTarget => ({ kind: 'asChild', nodeId: 'n1', index: pos }),
  });
}

describe('DropArea 三层热区（docs/11 §6，几何对齐既有设计 dropArea.ts）', () => {
  it('current 带（节点本体内）→ 兄弟位 before/after（按 current 中线）', () => {
    const area = make();
    expect(area.hitTest({ x: 140, y: 105 })?.target).toEqual({
      kind: 'asSibling',
      parentId: 'root',
      index: 0,
    });
    expect(area.hitTest({ x: 140, y: 125 })?.target).toEqual({
      kind: 'asSibling',
      parentId: 'root',
      index: 1,
    });
  });

  it('回归：兄弟缝隙（节点上下 80px 内、节点列宽内）不再是空白', () => {
    const area = make();
    // 节点上方 30px / 下方 30px——旧实现这里返回 null → 被当成「空白」而拆成新脑图
    expect(area.hitTest({ x: 140, y: 70 })?.target).toEqual({
      kind: 'asSibling',
      parentId: 'root',
      index: 0,
    });
    expect(area.hitTest({ x: 140, y: 160 })?.target).toEqual({
      kind: 'asSibling',
      parentId: 'root',
      index: 1,
    });
    // 超出 80px 才回落为空白
    expect(area.hitTest({ x: 140, y: 19 })).toBeNull();
    expect(area.hitTest({ x: 140, y: 211 })).toBeNull();
  });

  it('子区分界：按子节点中线返回插入下标（0..n）', () => {
    const area = make();
    // 子区只在扩区内可命中（x ∈ [节点左边, 节点右边+120]）；c1 中线 62、c2 中线 112
    expect(area.hitTest({ x: 250, y: 40 })?.target).toEqual({
      kind: 'asChild',
      nodeId: 'n1',
      index: 0,
    });
    expect(area.hitTest({ x: 250, y: 70 })?.target).toEqual({
      kind: 'asChild',
      nodeId: 'n1',
      index: 1,
    });
    expect(area.hitTest({ x: 250, y: 130 })?.target).toEqual({
      kind: 'asChild',
      nodeId: 'n1',
      index: 2,
    });
  });

  it('水平扩区 120px 朝子节点侧；超出即空白', () => {
    const area = make();
    const edge = 100 + 80 + DROP_AREA_HORIZONTAL_PADDING; // 300
    expect(area.hitTest({ x: edge, y: 40 })?.target.kind).toBe('asChild');
    expect(area.hitTest({ x: edge + 1, y: 40 })).toBeNull();
    // 节点左侧不扩（右树）
    expect(area.hitTest({ x: 99, y: 115 })).toBeNull();
  });

  it('左树：水平扩区朝左，子竖条贴子节点右边', () => {
    const area = make({ direction: 'left', children: [{ x: -160, y: 50 }] });
    expect(area.hitTest({ x: 100 - DROP_AREA_HORIZONTAL_PADDING, y: 60 })?.target.kind).toBe(
      'asChild',
    );
    expect(area.hitTest({ x: 181, y: 115 })).toBeNull(); // 节点列右侧不扩（左树）
  });

  it('distance：无子节点取到本体中线的纵向距离；有子节点取到相关竖条的距离', () => {
    const noKids = make({ children: [] });
    // current 带内命中时距离 = 点到本体矩形的纵向距离（y=95 vs 本体 100..130 → 5）
    expect(noKids.hitTest({ x: 140, y: 95 })?.distance).toBe(5);

    const area = make();
    // c1 上方（y=40）命中 index 0 → 到 c1 上边（50）距离 10
    expect(area.hitTest({ x: 250, y: 40 })?.distance).toBe(10);
    // c1 与 c2 之间（y=80）命中 index 1 → min(到 c1 下边 74 → 6, 到 c2 上边 100 → 20) = 6
    expect(area.hitTest({ x: 250, y: 80 })?.distance).toBe(6);
  });

  it('垂直扩区高度 = 既有设计 80px（边界含、越界不含）', () => {
    expect(DROP_AREA_VERTICAL_PADDING).toBe(80);
    const area = make();
    expect(area.hitTest({ x: 140, y: 20 })?.target.kind).toBe('asSibling');
    expect(area.hitTest({ x: 140, y: 19 })).toBeNull();
  });
});
