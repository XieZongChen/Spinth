import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Graphics } from 'pixi.js';
import { PenModel } from '../widgets/pen/penModel';
import { PenVm } from '../widgets/pen/penVm';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';

/** pen points 增量写（docs/16 §2，4.8 P1）——纯数据层测试 */

function makePen(initialPoints: Array<[number, number]> = [[0, 0]]) {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const model = new PenModel(processor);
  const yMap = model.initialize({
    id: 'p1',
    type: 'PEN',
    zOrder: 'a0',
    points: initialPoints,
    color: '#1f2937',
    strokeWidth: 3,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  } as never);
  doc.getArray('widgets').push([yMap]);
  return { doc, model };
}

describe('PenModel points Y.Array 化（docs/16 §2）', () => {
  it('appendPoint 增量：每次 delta 只 insert 1 点（不再全量替换）', () => {
    const { doc, model } = makePen([[0, 0]]);
    const yPoints = (doc.getArray('widgets').get(0) as Y.Map<unknown>).get('points') as Y.Array<
      [number, number]
    >;
    const deltas: Array<Array<Record<string, unknown>>> = [];
    yPoints.observe((e) => deltas.push(e.delta as Array<Record<string, unknown>>));
    model.appendPoint([10, 10]);
    model.appendPoint([20, 20]);
    for (const d of deltas) {
      const inserts = d.filter((seg) => 'insert' in seg);
      expect(d.filter((seg) => 'delete' in seg)).toEqual([]); // 无删除 = 非全量替换
      expect(inserts).toHaveLength(1);
      expect(inserts[0]!.insert).toHaveLength(1); // 每帧恰好一个新点
    }
    expect((model.toJSON() as unknown as { points: Array<[number, number]> }).points).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
  });

  it('setPoints 整笔替换：内容正确且存储形态仍是 Y.Array', () => {
    const { doc, model } = makePen([
      [0, 0],
      [5, 5],
    ]);
    model.setPoints([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const yPoints = (doc.getArray('widgets').get(0) as Y.Map<unknown>).get('points');
    expect(yPoints).toBeInstanceOf(Y.Array);
    expect((model.toJSON() as unknown as { points: unknown[] }).points).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('update({points}) 改道 setPoints（不退化普通数组）', () => {
    const { doc, model } = makePen();
    model.update({ points: [[9, 9]] } as never);
    const stored = (doc.getArray('widgets').get(0) as Y.Map<unknown>).get('points');
    expect(stored).toBeInstanceOf(Y.Array);
    expect((model.toJSON() as unknown as { points: unknown[] }).points).toEqual([[9, 9]]);
  });

  it('旧数据迁移：initializeY 遇普通数组一次性转 Y.Array，内容不变', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const yMap = new Y.Map<unknown>();
    doc.getArray('widgets').push([yMap]);
    doc.transact(() => {
      yMap.set('id', 'old-pen');
      yMap.set('type', 'PEN');
      yMap.set('zOrder', 'a0');
      yMap.set('color', '#000');
      yMap.set('strokeWidth', 3);
      yMap.set('points', [
        [1, 2],
        [3, 4],
      ]); // 旧形态：普通数组
    });
    const model = new PenModel(processor);
    model.initializeY(yMap);
    const stored = yMap.get('points');
    expect(stored).toBeInstanceOf(Y.Array);
    expect((model.toJSON() as unknown as { points: unknown[] }).points).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('undo 粒度：同窗口连续 appendPoint 合并为一个栈项，undo 一步回退整笔新增', () => {
    const { doc, model } = makePen([[0, 0]]);
    const um = new Y.UndoManager(doc.getArray('widgets'));
    model.appendPoint([1, 1]);
    model.appendPoint([2, 2]);
    model.appendPoint([3, 3]);
    expect((model.toJSON() as unknown as { points: unknown[] }).points.length).toBe(4);
    um.undo();
    const after = (model.toJSON() as unknown as { points: unknown[] }).points;
    // 采样落 UndoManager 500ms 合并窗口 → 一步回退到落笔初值
    expect(after).toEqual([[0, 0]]);
    um.destroy();
  });

  describe('PenVm 渲染（strokeWidth 改名回归）', () => {
    it('描边用 strokeWidth 而非几何 rect.width（2026-09 改名残留回归）', async () => {
      // 笔画宽 5；几何 width 300——若误读 next.width 会把 300 当线宽
      const doc = new Y.Doc();
      const processor = new DataProcessor(doc);
      const model = new PenModel(processor);
      const yMap = model.initialize({
        id: 'p2',
        type: 'PEN',
        zOrder: 'a0',
        points: [
          [0, 0],
          [300, 0],
        ],
        color: '#1f2937',
        strokeWidth: 5,
        x: 0,
        y: 0,
        width: 300,
        height: 0,
      } as never);
      doc.getArray('widgets').push([yMap]);
      const vm = new PenVm();
      vm.setModel(model as never);
      // pixi v8 的 stroke 经 mixin 挂载，prototype spy 不可靠——直接监听实例
      const g = (vm as unknown as { g: Graphics }).g;
      const strokeSpy = vi.spyOn(g, 'stroke');
      // setState 合批于微任务——flush 后 forceUpdate 才以真实 state 调 render
      await new Promise((r) => setTimeout(r, 0));
      const call = strokeSpy.mock.calls.at(-1)![0] as { width: number };
      expect(call.width).toBe(5);
      strokeSpy.mockRestore();
      vm.dispose();
    });
  });
});
