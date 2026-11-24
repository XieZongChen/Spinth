import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { DataEngineService } from '../../platform/dataEngine/dataEngineService';
import { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { ServiceRegistry, type Token } from '../../platform/registry/serviceRegistry';
import { HistoryService } from '../../platform/history/historyService';
import { Tokens } from '../../tokens';
import { WIDGET_RUNTIME } from '../../widgetRuntime';
import { FrameService } from '../../widgets/frame/frameService';
import type { IBaseModel, IDataEngineService, IVmEngineService } from '../../types';

/** model.toJSON() 的宽松读取形状（测试断言用） */
export type FrameEnvRow = {
  id: string;
  type: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
} & Record<string, unknown>;

/**
 * 容器归属的真引擎环境（docs/15 编排层）：真 Y.Doc + 真 DataEngineService（生产
 * 同款 WIDGET_RUNTIME 工厂表）+ 真 HistoryService + 真 FrameService。归属作用域与
 * 撤销粒度依赖 Yjs 事务生命周期时序，桩测不出，必须在这层锁。
 * vm 侧只提供 id/type 清单与「模型矩形即包围盒」的 getBounds——FrameService 的
 * 几何一律经 model.toJSON；ClipboardService 复制时读 getBounds 取快照。
 */
export function makeFrameEnv() {
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

  const rowOf = (id: string): FrameEnvRow | undefined =>
    engine.getModelById(id)?.toJSON() as unknown as FrameEnvRow | undefined;
  const idsOf = () =>
    (widgets.toArray() as Y.Map<unknown>[]).map((m) => ({
      id: m.get('id') as string,
      type: m.get('type') as string,
    }));
  const vmEngine = {
    getAllVms: idsOf,
    getVmById: (id: string) => {
      const row = idsOf().find((r) => r.id === id);
      const d = rowOf(id);
      if (!row || !d) return undefined;
      return {
        ...row,
        getBounds: () => ({ x: d.x, y: d.y, width: d.width, height: d.height }),
      };
    },
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
    vmEngine as unknown as IVmEngineService,
    { selected$: new BehaviorSubject<string[]>([]) } as never,
    history,
    null,
  );
  svc.initialize();

  const dataOf = (id: string): FrameEnvRow => rowOf(id)!;
  /** 事务外建件（工具创建同构：id 需调用方给足） */
  const add = (data: Record<string, unknown>): void => {
    engine.add({ zOrder: engine.genInitialOrder(), ...data } as never);
  };
  const addFrame = (id: string, x: number, y: number, w: number, h: number): void => {
    add({ id, type: 'FRAME', color: '#ffffff', x, y, width: w, height: h });
  };
  const addShape = (id: string, x: number, y: number, extra: { parentId?: string } = {}): void => {
    add({
      id,
      type: 'SHAPE',
      shapeType: 'rect',
      color: '#e8f0fb',
      text: '',
      x,
      y,
      width: 50,
      height: 50,
      ...extra,
    });
  };
  return {
    engine,
    history,
    svc,
    vmEngine: vmEngine as unknown as IVmEngineService,
    dataOf,
    add,
    addFrame,
    addShape,
    dispose: () => {
      svc.dispose();
      history.dispose();
    },
  };
}
