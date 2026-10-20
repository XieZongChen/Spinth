import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ShapeModel } from '../widgets/shape/shapeModel';
import { PenModel } from '../widgets/pen/penModel';
import { MindMapModel, buildYTree } from '../widgets/mind/mindMapModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { projectIncremental } from '../base/projection';

/**
 * observe→toJSON 增量投影（docs/16 §4，4.8 P2）：
 * 单字段变更 partial 只含该字段；rect 展开四键；mind root 丢弃；pen points 转 plain array。
 */
describe('projectIncremental（docs/16 §4）', () => {
  function makeShape() {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const model = new ShapeModel(processor);
    const yMap = model.initialize({
      id: 's1',
      type: 'SHAPE',
      zOrder: 'a0',
      shapeType: 'rect',
      color: '#fff',
      borderStyle: 'solid',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as never);
    doc.getArray('widgets').push([yMap]);
    // Yjs 事件 getter（keys/delta）仅限处理器内同步访问——在回调里同步投影
    let partial: ReturnType<typeof projectIncremental> = null;
    yMap.observeDeep((es) => {
      partial = projectIncremental(model, es as Y.YEvent<never>[]);
    });
    return { doc, model, yMap, getPartial: () => partial };
  }

  it('单字段变更：partial 只含该字段（绕过全量 toJSON）', () => {
    const { doc, yMap, getPartial } = makeShape();
    doc.transact(() => yMap.set('color', '#0f0'));
    const partial = getPartial() as Record<string, unknown>;
    expect(Object.keys(partial)).toEqual(['color']);
    expect(partial.color).toBe('#0f0');
  });

  it('rect 变化：partial 展开为四键（x/y/width/height）', () => {
    const { model, getPartial } = makeShape();
    model.updateRect({ x: 55, y: 66 });
    const partial = getPartial() as unknown as Record<string, unknown>;
    expect(partial.x).toBe(55);
    expect(partial.y).toBe(66);
    expect(partial.width).toBe(10);
    expect('rect' in partial).toBe(false);
  });

  it('pen points 增量：partial.points 是普通数组（非 Y.Array 实例）', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const model = new PenModel(processor);
    const yMap = model.initialize({
      id: 'p1',
      type: 'PEN',
      zOrder: 'a0',
      points: [[0, 0]],
      color: '#000',
      strokeWidth: 3,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    } as never);
    doc.getArray('widgets').push([yMap]);
    let partial: ReturnType<typeof projectIncremental> = null;
    yMap.observeDeep((es) => {
      partial = projectIncremental(model, es as Y.YEvent<never>[]);
    });
    model.appendPoint([5, 5]);
    const p = partial as unknown as { points: Array<[number, number]> };
    expect(Array.isArray(p.points)).toBe(true);
    expect(p.points).toEqual([
      [0, 0],
      [5, 5],
    ]);
  });

  it('MIND_MAP 树内变化：partial 为空（整图重渲染由 childrenChange$ 驱动，不进投影）', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const model = new MindMapModel(processor);
    const yMap = doc.getMap<unknown>('mm');
    doc.transact(() => {
      yMap.set('id', 'mm-1');
      yMap.set('type', 'MIND_MAP');
      yMap.set('zOrder', 'a0');
      yMap.set('root', buildYTree(processor, { text: '根' }));
    });
    model.initializeY(yMap);
    let partial: ReturnType<typeof projectIncremental> = null;
    yMap.observeDeep((es) => {
      partial = projectIncremental(model, es as Y.YEvent<never>[]);
    });
    const yRoot = yMap.get('root') as Y.Map<unknown>;
    const yChildren = yRoot.get('children') as Y.Array<unknown>;
    doc.transact(() =>
      yChildren.push([
        new Y.Map([
          ['id', 'mn-x'],
          ['text', '子'],
          ['children', new Y.Array()],
        ]),
      ]),
    );
    expect(partial).not.toBeNull();
    expect(Object.keys(partial!)).toEqual([]);
  });
});
