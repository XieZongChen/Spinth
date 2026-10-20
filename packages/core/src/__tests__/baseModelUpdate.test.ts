import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DataEngineService } from '../platform/dataEngine/dataEngineService';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { ServiceRegistry, token, type Token } from '../platform/registry/serviceRegistry';
import { ShapeModel } from '../widgets/shape/shapeModel';
import type { IBaseModel, IWidgetData } from '../types';

/** BaseModel.update 局部校验（docs/16 §3，4.8 P1）：只 pick+parse 变更键 */
describe('BaseModel.update 局部校验', () => {
  function makeModel() {
    const registry = new ServiceRegistry();
    const shapeToken = token<IBaseModel>('ShapeModel');
    const tokens = new Map<string, Token<IBaseModel>>([['SHAPE', shapeToken]]);
    const engine = new DataEngineService(registry, tokens);
    const yDoc = new Y.Doc();
    const processor = new DataProcessor(yDoc);
    (engine as unknown as { processorRef: DataProcessor }).processorRef = processor;
    (engine as unknown as { _yDoc: Y.Doc })._yDoc = yDoc;
    (engine as unknown as { _yWidgets: Y.Array<unknown> })._yWidgets = yDoc.getArray('widgets');
    const handler = (
      engine as unknown as { handleWidgetsChange: (e: Y.YArrayEvent<unknown>) => void }
    ).handleWidgetsChange;
    yDoc.getArray('widgets').observe(handler);
    registry.register(shapeToken, () => new ShapeModel(processor));
    engine.add({
      id: 's1',
      type: 'SHAPE',
      zOrder: 'a0',
      shapeType: 'rect',
      color: '#fff',
      borderStyle: 'solid',
      x: 1,
      y: 2,
      width: 10,
      height: 20,
    } as IWidgetData);
    return { engine, model: engine.getModelById('s1') as ShapeModel };
  }

  it('合法字段更新后 toJSON 正确（其余字段不受影响）', () => {
    const { model } = makeModel();
    model.update({ color: '#0f0' } as never);
    const json = model.toJSON() as unknown as Record<string, unknown>;
    expect(json.color).toBe('#0f0');
    expect(json.shapeType).toBe('rect');
    expect(json.borderStyle).toBe('solid');
  });

  it('非法字段仍被拒（zod 抛错且未写入）', () => {
    const { model } = makeModel();
    expect(() => model.update({ shapeType: 123 as never })).toThrow();
    expect((model.toJSON() as unknown as Record<string, unknown>).shapeType).toBe('rect');
  });

  it('rect 键照旧忽略（几何走 updateRect clamp 路径）', () => {
    const { model } = makeModel();
    model.update({ x: 999, color: '#111' } as never);
    const json = model.toJSON() as unknown as Record<string, unknown>;
    expect(json.color).toBe('#111');
    expect(json.x).toBe(1); // x 未被 update 改写
  });

  it('多次单字段更新（pen/line 热路径形态）均生效', () => {
    const { model } = makeModel();
    for (const c of ['#aaa', '#bbb', '#ccc']) model.update({ color: c } as never);
    expect((model.toJSON() as unknown as Record<string, unknown>).color).toBe('#ccc');
  });
});
