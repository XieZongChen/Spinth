import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { MindService } from '../../widgets/mind/mindService';
import { EditingService } from '../../platform/textEngine/editingService';
import { MindMapModel, buildYTree, type IMindNodeSpec } from '../../widgets/mind/mindMapModel';
import { DataProcessor } from '../../platform/dataEngine/dataProcessor';

/** mindService 系单测共享 fixture（specs/split-large-files §5.3）：
 *  桩顺序与原 mindService.test.ts 逐字一致——不得在 module 顶层执行 Pixi 构造 */

/** 纯逻辑测试：方向键导航表（不依赖 BoardSDK/engine 组装） */
export function makeService() {
  const viewport = {
    registerGlobalEventListener: () => {},
    setCursorMode: () => {},
    cursorMode$: new BehaviorSubject('cursor'),
    curPos$: new BehaviorSubject<null>(null),
    optionLayer: { addChild: () => {} },
    vpScale$: { value: 1 },
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    worldToClient: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    getClientSize: () => ({ width: 800, height: 600 }),
    panBy: () => {},
  };
  const engine = {
    add: () => {},
    removeByIds: () => {},
    genInitialOrder: () => 'a1',
    getModelById: () => null,
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = { getVmById: () => null, getVmByPoint: () => [] };
  const selector = { selected$: { value: [] }, setSelected: () => {} };
  const history = { stopCapturing: () => {}, undo: () => {}, redo: () => {} };
  return new MindService(
    viewport as never,
    engine as never,
    vmEngine as never,
    selector as never,
    history as never,
    new EditingService(
      viewport as never,
      engine as never,
      selector as never,
      history as never,
    ) as never,
  );
}

/** 真树服务：真 Yjs 文档 + MindMapModel + vm 桩（getNodeRect 恒定 rect、root 于 (100,50)） */
export function makeTreeService(specTree: IMindNodeSpec) {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const model = new MindMapModel(processor);
  // 直接挂 doc 顶级（游离 Y.Map 事务后会被 yjs 丢弃——mindMapVm.test 同款坑）
  const yMap = doc.getMap<unknown>('mm');
  doc.transact(() => {
    yMap.set('id', 'mm-1');
    yMap.set('type', 'MIND_MAP');
    yMap.set('zOrder', 'a0');
    yMap.set('root', buildYTree(processor, specTree));
  });
  model.initializeY(yMap);

  const addedToLayer: unknown[] = [];
  /** 节点局部 rect（测试可改：跟随/命中类断言用） */
  const nodeRect = { x: 10, y: 20, width: 80, height: 30 };
  /** panBy 调用记录（焦点跟随断言用） */
  const pans: Array<{ dx: number; dy: number }> = [];
  const vmStub = {
    type: 'MIND_MAP',
    id: 'mm-1',
    root: { x: 100, y: 50 },
    getNodeRect: () => ({ ...nodeRect }),
    getNodeVm: () => ({ depth: 1, fontSize: 18 }),
    hitNode: () => null,
    setFocusedNode: () => {},
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const adds: Array<Record<string, unknown>> = [];
  const viewport = {
    registerGlobalEventListener: (_mode: string, h: Record<string, (e: unknown) => void>) => {
      Object.assign(handlers, h);
    },
    setCursorMode: () => {},
    cursorMode$: new BehaviorSubject('cursor'),
    curPos$: new BehaviorSubject<null>(null),
    optionLayer: { addChild: (c: unknown) => addedToLayer.push(c) },
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
    // 屏幕空间恒等映射 + 800×600 可视区（安全区：左右上 10、下 96）
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    worldToClient: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    getClientSize: () => ({ width: 800, height: 600 }),
    panBy: (dx: number, dy: number) => pans.push({ dx, dy }),
  };
  const engine = {
    add: (d: Record<string, unknown>) => adds.push(d),
    removeByIds: () => {},
    genInitialOrder: () => 'a1',
    getModelById: (id: string) => (id === 'mm-1' ? model : null),
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = {
    getVmById: (id: string) => (id === 'mm-1' ? vmStub : undefined),
    getVmByPoint: () => [],
  };
  const selector = { selected$: new BehaviorSubject<string[]>(['mm-1']), setSelected: () => {} };
  const history = { stopCapturing: () => {} };
  const svc = new MindService(
    viewport as never,
    engine as never,
    vmEngine as never,
    selector as never,
    history as never,
    new EditingService(
      viewport as never,
      engine as never,
      selector as never,
      history as never,
    ) as never,
  );
  return { svc, model, viewport, addedToLayer, nodeRect, pans, handlers, adds, vmEngine };
}

export function spec(
  text: string,
  kids?: IMindNodeSpec[],
  direction?: 'left' | 'right',
): IMindNodeSpec {
  return { text, children: kids, direction };
}
