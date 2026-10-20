import { describe, expect, it } from 'vitest';
import { mapPointsRect, translatePoints } from '../common/geometry';
import type { IRect } from '../common/geometry';
import { PenVm } from '../widgets/pen/penVm';
import { LineVm } from '../widgets/line/lineVm';
import type { IBaseModel, IWidgetData, LineData, PenData } from '../types';

/**
 * 交互几何回归（docs/05 §4 / docs/14）：points 世界坐标型控件（LINE/PEN）
 * 的拖拽/缩放语义。守卫 bug：拖拽瞬移 bbox 原点、松手弹回（updateRect 对
 * points 型无效）、缩放拉伸线宽（root.scale 拉伸 stroke）。
 */

const flushMicrotask = () => new Promise<void>((r) => setTimeout(r, 0));

function fakeModel<T extends IWidgetData>(initial: T): IBaseModel<T> {
  const patchLog: Array<Partial<T>> = [];
  let onChange: (() => void) | null = null;
  const model = {
    id: initial.id,
    yData: {
      observeDeep: (fn: (e: unknown, tr: { local: boolean }) => void) => {
        onChange = () => fn(undefined, { local: true });
      },
      unobserveDeep: () => {
        onChange = null;
      },
    },
    initialize: () => ({}),
    initializeY: () => {},
    update: (patch: Partial<T>) => {
      patchLog.push(patch);
      Object.assign(initial, patch);
      onChange?.(); // 模拟 yData 变更 → vm.observeDeep → setState 回流
    },
    // PenModel.setPoints（Y.Array 全量替换路径）——桩转发 update 保持 patchLog 断言语义
    setPoints: (pts: Array<[number, number]>) => {
      model.update({ points: pts } as unknown as Partial<T>);
    },
    updateRect: (patch: Partial<{ x: number; y: number; width: number; height: number }>) => {
      patchLog.push(patch as Partial<T>);
      Object.assign(initial, patch);
      onChange?.();
    },
    toJSON: () => initial,
    patchLog,
  } as unknown as IBaseModel<T> & { patchLog: Array<unknown> };
  return model;
}

function penWithPoints(pts: Array<[number, number]>): {
  vm: PenVm;
  model: IBaseModel<PenData & IRect>;
} {
  const vm = new PenVm();
  const data = {
    id: 'p1',
    type: 'PEN',
    zOrder: 'a0',
    points: pts,
    color: '#1f2937',
    width: 3,
  } as unknown as PenData & IRect;
  const model = fakeModel(data);
  vm.setModel(model);
  return { vm, model };
}

function lineWithPoints(pts: Array<[number, number]>): {
  vm: LineVm;
  model: IBaseModel<LineData & IRect>;
} {
  const vm = new LineVm();
  const data = {
    id: 'l1',
    type: 'LINE',
    zOrder: 'a0',
    points: pts,
    startNodeId: null,
    endNodeId: null,
    startJoin: null,
    endJoin: null,
    color: '#4b5563',
    width: 2,
    startArrow: 'none',
    endArrow: 'arrow',
  } as unknown as LineData & IRect;
  const model = fakeModel(data);
  vm.setModel(model);
  return { vm, model };
}

// ---------- 纯函数 ----------

describe('translatePoints / mapPointsRect（points 平移与重映射）', () => {
  it('translatePoints 平移所有点且不修改原数组', () => {
    const src: Array<[number, number]> = [
      [10, 20],
      [30, 40],
    ];
    const out = translatePoints(src, 5, -5);
    expect(out).toEqual([
      [15, 15],
      [35, 35],
    ]);
    expect(src).toEqual([
      [10, 20],
      [30, 40],
    ]);
  });

  it('mapPointsRect 恒等映射（next = start）', () => {
    const start = { x: 0, y: 0, width: 100, height: 50 };
    const pts: Array<[number, number]> = [
      [0, 0],
      [100, 50],
      [50, 25],
    ];
    expect(mapPointsRect(pts, start, start)).toEqual(pts);
  });

  it('mapPointsRect 线性重映射（放大 2 倍 + 平移原点）', () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const next = { x: 200, y: 100, width: 200, height: 200 };
    expect(
      mapPointsRect(
        [
          [0, 0],
          [100, 100],
        ],
        start,
        next,
      ),
    ).toEqual([
      [200, 100],
      [400, 300],
    ]);
  });

  it('mapPointsRect 零宽轴不缩放（防除零）', () => {
    const start = { x: 10, y: 10, width: 0, height: 100 };
    const next = { x: 10, y: 10, width: 80, height: 200 };
    expect(
      mapPointsRect(
        [
          [10, 10],
          [10, 110],
        ],
        start,
        next,
      ),
    ).toEqual([
      [10, 10],
      [10, 210],
    ]);
  });
});

// ---------- Vm 覆写行为 ----------

describe('PEN/LINE 交互几何（points 世界坐标型，docs/05 §4）', () => {
  it('applyDragPreview：root 偏移 = delta 本身（不是 init + delta）', async () => {
    const { vm } = penWithPoints([
      [400, 320],
      [544, 380],
    ]);
    await flushMicrotask();
    const init = vm.getBounds();
    vm.applyDragPreview(init, 30, 20);
    // 守卫「瞬移」：若误用 init.x + dx 会得到 430（bbox 原点被叠加）
    expect(vm.root.x).toBe(30);
    expect(vm.root.y).toBe(20);
  });

  it('拖拽预览中 getBounds 反映视觉位置（bbox + root 偏移）——编辑框跟随不残留原地', async () => {
    const { vm } = penWithPoints([
      [400, 320],
      [544, 380],
    ]);
    await flushMicrotask();
    const before = vm.getBounds();
    vm.applyDragPreview(before, 30, 20);
    const during = vm.getBounds();
    expect(during.x).toBe(before.x + 30);
    expect(during.y).toBe(before.y + 20);
    expect(during.width).toBe(before.width);

    // LINE：整体拖动为空操作（2026-09-20 对齐既有设计，docs/08 §3）——预览不动
    const lv = lineWithPoints([
      [100, 100],
      [300, 200],
    ]).vm;
    await flushMicrotask();
    const lb = lv.getBounds();
    lv.applyDragPreview(lb, -40, 10);
    expect(lv.getBounds()).toEqual(lb);
  });

  it('commitDrag：平移 points 落库，不写 rect 字段', async () => {
    const { vm } = penWithPoints([
      [400, 320],
      [544, 380],
    ]);
    await flushMicrotask();
    vm.commitDrag(vm.getBounds(), 30, 20);
    await flushMicrotask();
    expect(vm.state.points).toEqual([
      [430, 340],
      [574, 400],
    ]);
  });

  it('commitDrag 后 getBounds 随 points 平移（松手不弹回的语义保证）', async () => {
    const { vm } = penWithPoints([
      [400, 320],
      [544, 380],
    ]);
    await flushMicrotask();
    const before = vm.getBounds();
    vm.commitDrag(before, 30, 20);
    await flushMicrotask();
    const after = vm.getBounds();
    expect(after.x).toBe(before.x + 30);
    expect(after.y).toBe(before.y + 20);
  });

  it('LINE commitDrag 空操作（对齐既有设计：线不可整体拖动/键盘微移）', async () => {
    const { vm } = lineWithPoints([
      [100, 100],
      [300, 200],
    ]);
    await flushMicrotask();
    vm.commitDrag(vm.getBounds(), -50, 10);
    await flushMicrotask();
    expect(vm.state.points).toEqual([
      [100, 100],
      [300, 200],
    ]); // 原地不动
  });

  it('applyResizePreview：不使用 root.scale（防止拉伸线宽/箭头）', async () => {
    const { vm } = penWithPoints([
      [0, 0],
      [100, 100],
    ]);
    await flushMicrotask();
    vm.applyResizePreview(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 300 },
    );
    expect(vm.root.scale.x).toBe(1);
    expect(vm.root.scale.y).toBe(1);
  });

  it('commitResize：points 重映射到目标矩形', async () => {
    const { vm } = penWithPoints([
      [0, 0],
      [100, 100],
    ]);
    await flushMicrotask();
    vm.commitResize(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 300 },
    );
    await flushMicrotask();
    expect(vm.state.points).toEqual([
      [0, 0],
      [200, 300],
    ]);
  });

  it('LINE commitResize 空操作（对齐既有设计：线不可整体缩放）', async () => {
    const { vm } = lineWithPoints([
      [100, 100],
      [200, 200],
    ]);
    await flushMicrotask();
    const widthBefore = (vm.state as unknown as { width: number }).width;
    vm.commitResize(
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 100, y: 100, width: 300, height: 50 },
    );
    await flushMicrotask();
    expect(vm.state.points).toEqual([
      [100, 100],
      [200, 200],
    ]); // 原地不动
    expect((vm.state as unknown as { width: number }).width).toBe(widthBefore);
  });

  it('hitTestRect 框选：按 points bbox 判定（基类按 root 原点会偏移）', async () => {
    const { vm } = penWithPoints([
      [400, 320],
      [544, 380],
    ]);
    await flushMicrotask();
    const inside = vm.hitTestRect(
      Object.assign(new (await import('pixi.js')).Rectangle(300, 300, 400, 200), {}),
    );
    expect(inside).toBe(true);
    // 只框到笔迹右上角外侧一小块（笔迹 bbox 之外）不命中
    const outside = vm.hitTestRect(new (await import('pixi.js')).Rectangle(560, 320, 50, 50));
    expect(outside).toBe(false);
  });

  it('hitTestPoint：计入 root 拖拽偏移（预览中点视觉位置可命中）', async () => {
    const { vm } = penWithPoints([
      [400, 320],
      [544, 380],
    ]);
    await flushMicrotask();
    const start = { x: 400, y: 320 } as import('pixi.js').Point;
    expect(vm.hitTestPoint(start)).toBe(true);
    // 拖拽预览：视觉平移 (+30,+20)，points 不变 → 原起点不再命中、新视觉起点命中
    vm.applyDragPreview(vm.getBounds(), 30, 20);
    expect(vm.hitTestPoint(start)).toBe(false);
    expect(vm.hitTestPoint({ x: 430, y: 340 } as import('pixi.js').Point)).toBe(true);
  });
});
