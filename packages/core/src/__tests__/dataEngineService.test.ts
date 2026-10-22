import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DataEngineService } from '../platform/dataEngine/dataEngineService';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { DbProvider } from '../platform/dataEngine/dbProvider';
import { yRectSet, type IYRectEntry } from '../platform/dataEngine/yRect';
import { generateKeyBetween } from 'fractional-indexing';
import { ServiceRegistry, token, type Token } from '../platform/registry/serviceRegistry';
import { ShapeModel } from '../widgets/shape/shapeModel';
import type { IBaseModel, IWidgetData } from '../types';

/** 数据引擎集成测试：真实 Model 工厂 + undo/redo 删除传导（docs/02 §3） */
describe('DataEngineService', () => {
  function makeEngineWithDoc() {
    // DataEngineService.initialize 是异步的（IndexedDB）；这里手动装配等价状态
    const registry = new ServiceRegistry();
    const shapeToken = token<IBaseModel>('ShapeModel');
    const tokens = new Map<string, Token<IBaseModel>>([['SHAPE', shapeToken]]);
    const engine = new DataEngineService(registry, tokens);
    const yDoc = new Y.Doc();
    const processor = new DataProcessor(yDoc);
    (engine as unknown as { processorRef: DataProcessor }).processorRef = processor;
    (engine as unknown as { _yDoc: Y.Doc })._yDoc = yDoc;
    (engine as unknown as { _yWidgets: Y.Array<unknown> })._yWidgets = yDoc.getArray('widgets');
    // 挂 observe（与 initialize 一致）
    const handler = (
      engine as unknown as { handleWidgetsChange: (e: Y.YArrayEvent<unknown>) => void }
    ).handleWidgetsChange;
    yDoc.getArray('widgets').observe(handler);
    registry.register(shapeToken, () => new ShapeModel(processor));
    return { engine, yDoc };
  }

  const shapeData = (id: string): IWidgetData =>
    ({
      id,
      type: 'SHAPE',
      zOrder: 'a0',
      shapeType: 'rect',
      color: '#fff',
      borderStyle: 'solid',
      x: 1,
      y: 2,
      width: 10,
      height: 20,
    }) as IWidgetData;

  it('本地 add 发射 onModelCreated$（本地与远端同路径铁律）', () => {
    const { engine } = makeEngineWithDoc();
    const onCreated = vi.fn();
    engine.onModelCreated$.subscribe(onCreated);
    engine.add(shapeData('a'));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(engine.getModelById('a')).toBeDefined();
  });

  it('远端插入（直接 push 未登记的 Y.Map）同样发射 onModelCreated$', () => {
    const { engine, yDoc } = makeEngineWithDoc();
    const onCreated = vi.fn();
    engine.onModelCreated$.subscribe(onCreated);
    const m = new Y.Map<unknown>();
    m.set('id', 'remote-1');
    m.set('type', 'SHAPE');
    m.set('zOrder', 'a0');
    yDoc.getArray('widgets').push([m]);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('undo 删除 → onModelRemoved$ 携带正确 id（deleted 内容不可读的踩坑回归）', async () => {
    const { engine, yDoc } = makeEngineWithDoc();
    const um = new Y.UndoManager(yDoc.getArray('widgets') as Y.Array<unknown>, {
      ignoreRemoteMapChanges: true,
    });
    const removed: string[][] = [];
    engine.onModelRemoved$.subscribe((ids) => removed.push(ids));
    engine.add(shapeData('a'));
    um.stopCapturing(); // 分割撤销步：否则 500ms 内的事务合并为一项
    engine.add(shapeData('b'));

    um.undo(); // 撤销 b 的插入
    expect(removed).toHaveLength(1);
    expect(removed[0]).toEqual(['b']);
    expect(engine.getModelById('b')).toBeUndefined();

    um.redo(); // 重做恢复 b
    expect(engine.getModelById('b')).toBeDefined();
  });

  it('removeByIds 批量删除 → 单次 onModelRemoved$', () => {
    const { engine } = makeEngineWithDoc();
    const removed: string[][] = [];
    engine.onModelRemoved$.subscribe((ids) => removed.push(ids));
    engine.add(shapeData('a'));
    engine.add(shapeData('b'));
    engine.removeByIds(['a', 'b']);
    expect(removed).toEqual([['a', 'b']]);
  });

  it('genInitialOrder 递增生成', () => {
    const { engine } = makeEngineWithDoc();
    const z1 = engine.genInitialOrder();
    engine.add({ ...shapeData('a'), zOrder: z1 } as IWidgetData);
    const z2 = engine.genInitialOrder();
    expect(z2 > z1).toBe(true);
  });

  it('1.2 未知类型隔离不抛穿：同批混入 FUTURE_WIDGET，其余照常建模、文档可打开', () => {
    const { engine, yDoc } = makeEngineWithDoc();
    const created: string[] = [];
    engine.onModelCreated$.subscribe((m) => created.push(m.id));
    yDoc.transact(() => {
      const arr = yDoc.getArray('widgets');
      arr.push([
        new Y.Map([
          ['id', 'fut1'],
          ['type', 'FUTURE_WIDGET'],
          ['zOrder', 'a1'],
        ]),
      ]);
      arr.push([
        new Y.Map([
          ['id', 'ok1'],
          ['type', 'SHAPE'],
          ['zOrder', 'a2'],
          ['shapeType', 'rect'],
          ['color', '#fff'],
          ['borderStyle', 'solid'],
          ['rect', new Y.Array()],
        ]),
      ]);
    });
    // 旧代码：buildModel 对 FUTURE_WIDGET throw → 观察者链打穿、ok1 也不会建
    expect(created).toEqual(['ok1']);
    expect([...engine.quarantinedIds]).toEqual(['fut1']);
  });

  it('1.3 REPAIR_ORIGIN：缺 rect 修补不进 undo 栈（修复前=幽灵撤销步）', () => {
    const { yDoc } = makeEngineWithDoc();
    const um = new Y.UndoManager(yDoc.getArray('widgets') as Y.Array<unknown>, {
      captureTimeout: 0,
    });
    yDoc.transact(() => {
      const m = new Y.Map();
      m.set('id', 'legacy-1');
      m.set('type', 'SHAPE');
      m.set('zOrder', 'a0');
      yDoc.getArray('widgets').push([m]); // 缺 rect → initializeY 修补
    });
    expect(yDoc.getArray('widgets').toArray().length).toBe(1);
    // 插入事务（null origin）= 1 项属正常；修补（REPAIR_ORIGIN）零增量——
    // 修复前总数 = 2：用户首次 undo 撤掉的是修补而非自己的操作
    expect(um.undoStack.length).toBe(1);
    um.destroy();
  });

  it('非法键删除 / text 超限截断 / 几何超界 clamp / 消毒不进 undo 栈 / 未知键保留', () => {
    const { engine, yDoc } = makeEngineWithDoc();
    const um = new Y.UndoManager(yDoc.getArray('widgets') as Y.Array<unknown>, {
      captureTimeout: 0,
    });
    yDoc.transact(() => {
      const rect = new Y.Array();
      rect.push([
        { key: 'x', val: 2_000_000 },
        { key: 'y', val: 5 },
        { key: 'width', val: 0 },
        { key: 'height', val: 50 },
      ]);
      const m = new Y.Map();
      m.set('id', 'dirty-1');
      m.set('type', 'SHAPE');
      m.set('zOrder', 'a0');
      m.set('shapeType', 'rect');
      m.set('fontSize', 'big'); // 非法：TypoFields.fontSize 是 number
      m.set('futureField', { v: 1 }); // 未知键：前向兼容保留
      m.set('text', 'a'.repeat(500_001)); // 超限截断
      m.set('rect', rect);
      yDoc.getArray('widgets').push([m]);
    });
    const data = engine.getModelById('dirty-1')!.toJSON() as unknown as Record<string, unknown>;
    expect(data.fontSize).toBeUndefined(); // 非法键被删
    expect(data.futureField).toBeDefined(); // 未知键保留（旧客户端不毁新字段）
    expect(String(data.text).length).toBe(500_000); // 截断到上限
    expect(Number(data.x)).toBe(1_000_000); // clamp 到 POS_MAX
    expect(Number(data.width)).toBe(1); // clamp 到 SIZE_MIN
    expect(um.undoStack.length).toBe(1); // 仅插入事务；消毒零增量（REPAIR_ORIGIN）
    um.destroy();
  });

  it('1.25 genInitialOrder 缓存：连发递增 O(1)，非 add 写入失效重扫仍正确', () => {
    const { engine, yDoc } = makeEngineWithDoc();
    const z1 = engine.genInitialOrder();
    const z2 = engine.genInitialOrder();
    expect(z2 > z1).toBe(true);
    engine.add(shapeData('a') as IWidgetData);
    // 合法且大于缓存上界的远端 key（fractional key 格式严格——手写易非法，双跳生成）
    const remoteKey = generateKeyBetween(generateKeyBetween(z2, null), null);
    yDoc.transact(() => {
      yDoc.getArray('widgets').push([
        new Y.Map([
          ['id', 'r1'],
          ['type', 'SHAPE'],
          ['zOrder', remoteKey],
          ['rect', new Y.Array()],
        ]),
      ]);
    });
    // 真实环境 handleDocUpdate（非 add 写入）置失效——harness 手动装配无此监听，
    // 直接等价模拟其行为
    (engine as unknown as { maxZOrderCache: string | null | undefined }).maxZOrderCache = undefined;
    const z3 = engine.genInitialOrder();
    expect(z3 > remoteKey).toBe(true); // 失效重扫纳入远端最大 key
  });
});
describe('1.4 yRectSet 同 key 并发残渣自愈', () => {
  it('重复条目（并发残渣）在一次写入后收敛为单条', () => {
    const yDoc = new Y.Doc();
    const yRect = new Y.Array<IYRectEntry>();
    yDoc.getMap('m').set('rect', yRect); // 脱离文档的 Y.Array 写入无效——先集成
    yDoc.transact(() => {
      // 模拟并发写 x 的合并残渣：两条 x + 正常 y/w/h
      yRect.push([
        { key: 'x', val: 1 },
        { key: 'x', val: 9 },
        { key: 'y', val: 2 },
        { key: 'width', val: 10 },
        { key: 'height', val: 20 },
      ]);
    });
    yRectSet(yDoc, yRect, { x: 5 });
    const entries = yRect.toArray();
    const xs = entries.filter((e) => e.key === 'x');
    expect(xs).toHaveLength(1); // 旧实现：findIndex 只换第一条，第二条残渣留存
    expect(xs[0]!.val).toBe(5);
    expect(entries.filter((e) => e.key === 'y')).toHaveLength(1); // 未动 key 原样
    // 同值跳过仍成立（无并发残渣时零写入）
    const lenBefore = JSON.stringify(yRect.toArray());
    yRectSet(yDoc, yRect, { y: 2 });
    expect(JSON.stringify(yRect.toArray())).toBe(lenBefore);
  });
});

it('writeEnabled 透传：initialize 与 setWriteEnabled 联动 db 只读（docs/21 §4）', async () => {
  // 桩掉 DbProvider（不开真实 IndexedDB），只验证透传契约
  const attachSpy = vi.spyOn(DbProvider.prototype, 'attach').mockResolvedValue(undefined);
  const roSpy = vi.spyOn(DbProvider.prototype, 'setReadOnly').mockImplementation(() => {});
  const registry = new ServiceRegistry();
  const engine = new DataEngineService(registry, new Map());
  await engine.initialize({ docId: 'we-test', writeEnabled: false });
  expect(attachSpy).toHaveBeenCalledWith('we-test', expect.any(Y.Doc), {
    replay: false,
    readOnly: true,
  });
  engine.setWriteEnabled(true);
  expect(roSpy).toHaveBeenCalledWith(false); // 切回可写 = 解除只读
  engine.setWriteEnabled(false);
  expect(roSpy).toHaveBeenCalledWith(true);
  engine.dispose();
  attachSpy.mockRestore();
  roSpy.mockRestore();
});
