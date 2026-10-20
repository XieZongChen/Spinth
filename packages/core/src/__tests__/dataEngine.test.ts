import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { createYRect, yRectSet, yRectToRect, type IYRectEntry } from '../platform/dataEngine/yRect';

/**
 * 注意：yjs 的孤立（prelim）类型读取会抛 Invalid access，
 * 测试一律用 doc.getMap() 取集成态实例。
 * 真实链路中 Model.initialize 的 prelim Y.Map 经 yWidgets.push 集成后内容保留（已实验验证）。
 */

describe('DataProcessor 写纪律（docs/02 §4）', () => {
  it('create：扁平字段进 yData，rect 进独立 Y.Array', () => {
    const doc = new Y.Doc();
    const yData = doc.getMap('t1');
    const p = new DataProcessor(doc);
    p.create({ id: 'a', type: 'SHAPE', zOrder: 'a0', x: 10, y: 20, width: 100, height: 50 }, yData);
    expect(yData.get('id')).toBe('a');
    expect(yData.get('x')).toBeUndefined(); // 几何被剥离
    const rect = yRectToRect(yData.get('rect') as Y.Array<IYRectEntry>);
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('写前 diff：同值 set 不产生 op（验收 1.12）', () => {
    const doc = new Y.Doc();
    const yData = doc.getMap('t2');
    const p = new DataProcessor(doc);
    p.create({ id: 'a', type: 'SHAPE', zOrder: 'a0', color: '#fff' }, yData);

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    p.update({ color: '#fff' }, yData); // 同值
    expect(updateCount).toBe(0);

    p.update({ color: '#000' }, yData); // 变值
    expect(updateCount).toBe(1);
  });

  it('flatten：rect 条目摊平为 x/y/width/height', () => {
    const doc = new Y.Doc();
    const yData = doc.getMap('t3');
    const p = new DataProcessor(doc);
    p.create({ id: 'a', type: 'SHAPE', zOrder: 'a0', x: 1, y: 2, width: 3, height: 4 }, yData);
    const flat = DataProcessor.flatten(yData.toJSON());
    expect(flat).toMatchObject({ id: 'a', x: 1, y: 2, width: 3, height: 4 });
  });
});

describe('yRect 工具', () => {
  it('yRectSet 按 key 更新，同值跳过', () => {
    const doc = new Y.Doc();
    const holder = doc.getMap('t4');
    const r = createYRect(doc, { x: 0, y: 0, width: 10, height: 10 });
    holder.set('rect', r);
    let updates = 0;
    doc.on('update', () => updates++);
    yRectSet(doc, r, { x: 0 }); // 同值
    expect(updates).toBe(0);
    yRectSet(doc, r, { width: 99 });
    expect(yRectToRect(r)).toMatchObject({ x: 0, width: 99 });
  });

  it('多 key 更新保持其余 key 不变', () => {
    const doc = new Y.Doc();
    const holder = doc.getMap('t5');
    const r = createYRect(doc, { x: 1, y: 2, width: 3, height: 4 });
    holder.set('rect', r);
    yRectSet(doc, r, { x: 10, height: 40 });
    expect(yRectToRect(r)).toEqual({ x: 10, y: 2, width: 3, height: 40 });
  });
});
