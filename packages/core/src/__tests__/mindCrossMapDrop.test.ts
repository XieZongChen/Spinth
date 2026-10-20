// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { MindService } from '../widgets/mind/mindService';
import { EditingService } from '../platform/textEngine/editingService';
import { MindMapModel, buildYTree, type IMindNodeSpec } from '../widgets/mind/mindMapModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';

const spec = (
  text: string,
  kids?: IMindNodeSpec[],
  direction?: 'left' | 'right',
): IMindNodeSpec => ({
  text,
  children: kids,
  direction,
});

function makeTwoMaps() {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const mk = (id: string, tree: IMindNodeSpec) => {
    const model = new MindMapModel(processor);
    const yMap = doc.getMap<unknown>(id);
    doc.transact(() => {
      yMap.set('id', id);
      yMap.set('type', 'MIND_MAP');
      yMap.set('zOrder', 'a0');
      yMap.set('root', buildYTree(processor, tree));
    });
    model.initializeY(yMap);
    return model;
  };
  // 源图 S：根 + A（待拖）
  const src = mk('map-s', spec('S根', [spec('A')]));
  // 目标图 T：根 → L1 → L2（深层）
  const tgt = mk('map-t', spec('T根', [spec('L1', [spec('L2')])]));

  const rectOf = (
    mapId: string,
    nodeId: string,
    r: { x: number; y: number; width: number; height: number },
  ) => {
    store.get(mapId)!.rects.set(nodeId, r);
  };
  const store = new Map<
    string,
    {
      model: MindMapModel;
      rects: Map<string, { x: number; y: number; width: number; height: number }>;
      rootPos: { x: number; y: number };
    }
  >();
  store.set('map-s', { model: src, rects: new Map(), rootPos: { x: 0, y: 0 } });
  store.set('map-t', { model: tgt, rects: new Map(), rootPos: { x: 0, y: 0 } });

  const vmStub = (mapId: string) => {
    const entry = store.get(mapId)!;
    return {
      type: 'MIND_MAP',
      id: mapId,
      root: entry.rootPos,
      rects: entry.rects,
      getNodeRect: (id: string) => entry.rects.get(id) ?? null,
      getNodeVm: (id: string) => (entry.rects.has(id) ? { depth: 1, fontSize: 18 } : null),
      setNodeAlpha: () => {},
      setFocusedNode: () => {},
      hitNode: () => null,
    };
  };
  const viewport = {
    registerGlobalEventListener: () => {},
    setCursorMode: () => {},
    cursorMode$: new BehaviorSubject('cursor'),
    curPos$: new BehaviorSubject<null>(null),
    optionLayer: { addChild: () => {} },
    vpScale$: new BehaviorSubject(1),
    vpBounds$: new BehaviorSubject({ x: -500, y: -500, width: 3000, height: 3000 }),
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
  };
  const engine = {
    add: () => 'map-x',
    removeByIds: () => {},
    genInitialOrder: () => 'a1',
    getModelById: (id: string) => store.get(id)?.model ?? null,
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = {
    getVmById: (id: string) => (store.has(id) ? (vmStub(id) as never) : undefined),
    getVmByPoint: () => [],
    getAllVms: () => [...store.keys()].map((id) => vmStub(id) as never),
  };
  const selector = {
    selected$: new BehaviorSubject<string[]>(['map-s']),
    setSelected: (ids: string[]) => selector.selected$.next(ids),
  };
  const svc = new MindService(
    viewport as never,
    engine as never,
    vmEngine as never,
    selector as never,
    { stopCapturing: () => {} } as never,
    new EditingService(
      viewport as never,
      engine as never,
      selector as never,
      { stopCapturing: () => {} } as never,
    ) as never,
  );
  return { svc, src, tgt, rectOf, selector };
}

describe('跨图拖拽深层落点（2026-09-22 用户实测：只能触发一级）', () => {
  it('悬停目标图深层节点：应命中（用户实测：深层无预置块）', () => {
    const { svc, src, tgt, rectOf } = makeTwoMaps();
    const a = src.root.children[0]!;
    const l1 = tgt.root.children[0]!;
    const l2 = l1.children[0]!;
    // 源图左上角 (0,0)；目标图放在 (1000, 0)——远离源图
    // 目标图节点：根 (1000,0)、L1 (1150,-50)、L2 (1300,-60)（右树深层）
    rectOf('map-s', src.root.id, { x: 0, y: 0, width: 60, height: 26 });
    rectOf('map-s', a.id, { x: 150, y: 0, width: 60, height: 24 });
    rectOf('map-t', tgt.root.id, { x: 1000, y: 0, width: 60, height: 26 });
    rectOf('map-t', l1.id, { x: 1150, y: -50, width: 60, height: 24 });
    rectOf('map-t', l2.id, { x: 1300, y: -60, width: 60, height: 24 });

    svc.startDrag('map-s', a.id, { x: 10, y: 10 });
    // 1) 悬停 L1（一级）——对照：应命中
    const hitL1 = svc.dragMove({ x: 1180, y: -38 });
    console.log('[hit L1 center]', hitL1);
    // 2) 悬停 L2（深层）中心——用户报无预置
    const hitL2 = svc.dragMove({ x: 1330, y: -48 });
    console.log('[hit L2 center]', hitL2);
    // 断言：一级与深层都命中（曾深层 null——目标图被空 excludeId 自排除）
    expect(hitL1).toBe(true);
    expect(hitL2).toBe(true);
    // 松手：落到目标图（非成新图），A 成为 L1 的兄弟（悬停 L2 中心的 current 带）
    const result = svc.dragEnd({ x: 1330, y: -48 });
    expect(result).toBe('moved');
    const movedParent = tgt.root.children[0]!.children.find((n) => n.toJSON().text === 'A');
    expect(movedParent).toBeDefined(); // A 进了目标图深层（L2 的父 L1 之下）
    expect(svc.focusedNodeId).toBeTruthy();
    svc.dispose();
  });
});
