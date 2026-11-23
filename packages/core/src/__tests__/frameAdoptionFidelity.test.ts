import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DataEngineService } from '../platform/dataEngine/dataEngineService';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { ServiceRegistry, type Token } from '../platform/registry/serviceRegistry';
import { HistoryService } from '../platform/history/historyService';
import { Tokens } from '../tokens';
import { WIDGET_RUNTIME } from '../widgetRuntime';
import { FrameService } from '../widgets/frame/frameService';
import type { IBaseModel, IDataEngineService } from '../types';

/**
 * 创建即归属的作用域（specs/container-frame §4.2 + 审查三轮 P2）：真 Y.Doc +
 * 真 DataEngineService（生产同款 WIDGET_RUNTIME 工厂表）+ 真 HistoryService——
 * 「工具创建」与「粘贴批 / undo·redo 恢复」的区分依赖 Yjs 事务生命周期时序，
 * 桩测不出来，必须在真引擎上锁：
 * - 工具创建（事务外 add）→ 框内新件归属；
 * - 批量上下文（engine.transact 内连发 add / undo·redo 恢复）→ 不重判——
 *   重判会让副本、恢复件与原状态分叉（已有父被清 / 无父被收养）。
 */

type Row = {
  id: string;
  type: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function makeEnv() {
  const registry = new ServiceRegistry();
  const yDoc = new Y.Doc();
  const processor = new DataProcessor(yDoc);
  const modelTokens = new Map<string, Token<IBaseModel>>();
  for (const [type, entry] of Object.entries(WIDGET_RUNTIME)) {
    modelTokens.set(type, entry.modelToken);
    registry.register(entry.modelToken, entry.createModel);
  }
  registry.registerSingleton(Tokens.DataProcessor, () => processor);
  const engine = new DataEngineService(registry, modelTokens);
  // DataEngineService.initialize 是异步的（IndexedDB）——手动装配等价状态
  // （dataEngineService.test 同款）
  const widgets = yDoc.getArray('widgets');
  const e = engine as unknown as {
    processorRef: DataProcessor;
    _yDoc: Y.Doc;
    _yWidgets: Y.Array<unknown>;
    handleWidgetsChange: (ev: Y.YArrayEvent<unknown>) => void;
  };
  e.processorRef = processor;
  e._yDoc = yDoc;
  e._yWidgets = widgets;
  widgets.observe(e.handleWidgetsChange);

  // vm 侧只提供 id/type 清单（liveFrames/childIds 的几何一律经 model.toJSON）
  const idsOf = () =>
    (widgets.toArray() as Y.Map<unknown>[]).map((m) => ({
      id: m.get('id') as string,
      type: m.get('type') as string,
    }));
  const vmEngine = {
    getAllVms: idsOf,
    getVmById: (id: string) => idsOf().find((r) => r.id === id),
  };
  const history = new HistoryService(engine as unknown as IDataEngineService);
  history.initialize();
  const svc = new FrameService(
    {
      editable$: new BehaviorSubject(true),
      vpScale$: new BehaviorSubject(1),
      registerGlobalEventListener: () => {},
    } as never,
    engine as unknown as IDataEngineService,
    vmEngine as never,
    { selected$: new BehaviorSubject<string[]>([]) } as never,
    history,
    null,
  );
  svc.initialize();

  const dataOf = (id: string): Row => engine.getModelById(id)!.toJSON() as unknown as Row;
  const addFrame = (id: string, x: number, y: number, w: number, h: number): void => {
    engine.add({
      id,
      type: 'FRAME',
      zOrder: engine.genInitialOrder(),
      color: '#ffffff',
      x,
      y,
      width: w,
      height: h,
    } as never);
  };
  const addShape = (id: string, x: number, y: number, extra: { parentId?: string } = {}): void => {
    engine.add({
      id,
      type: 'SHAPE',
      zOrder: engine.genInitialOrder(),
      shapeType: 'rect',
      color: '#e8f0fb',
      text: '',
      x,
      y,
      width: 50,
      height: 50,
      ...extra,
    } as never);
  };
  return {
    engine,
    history,
    svc,
    dataOf,
    addFrame,
    addShape,
    dispose: () => {
      svc.dispose();
      history.dispose();
    },
  };
}

describe('创建即归属的作用域（真 Yjs + 真 HistoryService）', () => {
  it('工具创建（事务外 add）：框内新件归属、框外不归属', () => {
    const h = makeEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('in', 10, 10);
    h.addShape('out', 500, 500);
    expect(h.dataOf('in').parentId).toBe('f1');
    expect('parentId' in h.dataOf('out')).toBe(false);
    h.dispose();
  });

  it('粘贴批（engine.transact 内连发 add）：已有父的框外子保持父——审查三轮 P2 红探针', () => {
    const h = makeEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('c1', 10, 10); // 归属 f1
    expect(h.dataOf('c1').parentId).toBe('f1');
    // 缩小容器使子元素完全在框外（缩放不重判归属——框外子只可能由此产生）
    h.engine.getModelById('f1')!.updateRect({ x: 200, width: 100 }); // f1: 200..300
    expect(h.dataOf('c1').parentId).toBe('f1'); // 滞回：缩放路径不动归属
    // 「复制 f1+c1 → 粘贴」：桶映射已给副本父 f2；副本子同在 f2 框外
    h.engine.transact(() => {
      h.addFrame('f2', 500, 0, 100, 300); // f2: 500..600
      h.addShape('c2', 310, 10, { parentId: 'f2' }); // 310..360：不在任何容器内
    });
    expect(h.dataOf('c2').parentId).toBe('f2'); // 曾被 rule 3 清成 undefined（副本与原件分叉）
    h.dispose();
  });

  it('粘贴批：无父件落进别的容器也不被收养（复制 = 保真，§4.7/I5）', () => {
    const h = makeEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.engine.transact(() => h.addShape('p1', 10, 10)); // 无父、几何在 f1 内
    expect('parentId' in h.dataOf('p1')).toBe(false); // 曾被收养进 f1
    // 标记不粘连：批量收尾后，工具创建照常归属
    h.addShape('in2', 10, 10);
    expect(h.dataOf('in2').parentId).toBe('f1');
    h.dispose();
  });

  it('undo 恢复：已有父子保持父（删容器 → undo），且恢复不产生幻影撤销项', () => {
    const h = makeEnv();
    h.addFrame('f1', 0, 0, 300, 300);
    h.addShape('c1', 10, 10);
    h.history.stopCapturing();
    h.engine.getModelById('f1')!.updateRect({ x: 200, width: 100 });
    h.history.stopCapturing();
    h.engine.removeByIds(['f1', 'c1']);
    h.history.stopCapturing();

    h.history.undo(); // 恢复删除：f1 + c1 回来
    expect(h.dataOf('f1').x).toBe(200); // 仍是缩小后的几何（只回退了删除）
    expect(h.dataOf('c1').parentId).toBe('f1'); // 曾被清成 undefined

    h.history.undo(); // 回退缩放——若恢复时偷写过归属，这一步会先吃掉那笔
    expect(h.dataOf('f1').x).toBe(0);
    expect(h.dataOf('f1').width).toBe(300);
    h.dispose();
  });

  it('undo 恢复：无父件不被收养——先画形状后画容器（建容器不收养），删形状 undo 后仍是顶层', () => {
    const h = makeEnv();
    h.addShape('s1', 10, 10); // 此时无容器
    h.addFrame('f1', 0, 0, 300, 300); // 包住 s1——建容器不收养既有元素
    expect('parentId' in h.dataOf('s1')).toBe(false);
    h.history.stopCapturing();
    h.engine.removeByIds(['s1']);
    h.history.stopCapturing();

    h.history.undo();
    expect('parentId' in h.dataOf('s1')).toBe(false); // 曾被收养进 f1
    h.dispose();
  });

  it('redo 重放粘贴批同样不重判', () => {
    const h = makeEnv();
    h.engine.transact(() => {
      h.addFrame('f2', 500, 0, 100, 300);
      h.addShape('c2', 310, 10, { parentId: 'f2' });
    });
    h.history.stopCapturing();
    h.history.undo(); // 撤销粘贴：f2 + c2 移除
    expect(h.engine.getModelById('c2')).toBeUndefined();
    h.history.redo(); // 重放：观察者相重建模型
    expect(h.dataOf('c2').parentId).toBe('f2');
    h.dispose();
  });
});
