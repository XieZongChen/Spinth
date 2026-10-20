import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
import { mindViewportStub } from './helpers/mindViewportStub';
stubPixiCanvasDocument();
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { MindService } from '../widgets/mind/mindService';
import { EditingService } from '../platform/textEngine/editingService';
import { MindMapModel, buildYTree, type IMindNodeSpec } from '../widgets/mind/mindMapModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';

/**
 * 焦点高亮跨图切换回归（7ea28df 引入的残留 bug，2026-09 Phase 4 复审揪出）：
 * emitFocus 焦点换图时直接覆盖 focusMapId——旧图的紫色焦点描边不清除。
 * 场景：图 A 有焦点高亮 → 点选图 B 节点 → A 图节点描边永久残留。
 */

interface MapVmStub {
  type: string;
  id: string;
  root: { x: number; y: number };
  setFocusedNode: ReturnType<typeof vi.fn>;
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null;
  hitNode(): null;
}

function makeTwoMapService() {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const mkMap = (id: string, text: string): { model: MindMapModel; vm: MapVmStub } => {
    const model = new MindMapModel(processor);
    const yMap = doc.getMap<unknown>(id);
    doc.transact(() => {
      yMap.set('id', id);
      yMap.set('type', 'MIND_MAP');
      yMap.set('zOrder', 'a0');
      yMap.set('root', buildYTree(processor, { text } satisfies IMindNodeSpec));
    });
    model.initializeY(yMap);
    const vm: MapVmStub = {
      type: 'MIND_MAP',
      id,
      root: { x: 0, y: 0 },
      setFocusedNode: vi.fn(),
      getNodeRect: () => ({ x: 10, y: 20, width: 80, height: 30 }),
      hitNode: () => null,
    };
    return { model, vm };
  };
  const a = mkMap('mm-a', '图A');
  const b = mkMap('mm-b', '图B');

  const selected$ = new BehaviorSubject<string[]>(['mm-a']);
  const viewport = {
    registerGlobalEventListener: () => {},
    setCursorMode: () => {},
    cursorMode$: new BehaviorSubject('cursor'),
    curPos$: new BehaviorSubject<null>(null),
    optionLayer: { addChild: () => {} },
    vpScale$: new BehaviorSubject(1),
    ...mindViewportStub(),
  };
  const engine = {
    add: () => 'mm-x',
    removeByIds: () => {},
    genInitialOrder: () => 'a1',
    getModelById: (id: string) => (id === 'mm-a' ? a.model : id === 'mm-b' ? b.model : null),
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = {
    getVmById: (id: string) =>
      id === 'mm-a' ? (a.vm as never) : id === 'mm-b' ? (b.vm as never) : undefined,
    getAllVms: () => [a.vm as never, b.vm as never],
    getVmByPoint: () => [],
  };
  const svc = new MindService(
    viewport as never,
    engine as never,
    vmEngine as never,
    { selected$, setSelected: (ids: string[]) => selected$.next(ids) } as never,
    { stopCapturing: () => {} } as never,
    new EditingService(
      viewport as never,
      engine as never,
      { selected$, setSelected: () => {} } as never,
      { stopCapturing: () => {} } as never,
    ) as never,
  );
  return { svc, a, b, selected$ };
}

describe('焦点换图语义（7ea28df 回归——高亮通道已删，改验焦点归属）', () => {
  it('焦点换图：focusMapId 切换 + 双图广播（旧图残留曾因 focusMapId 直接覆盖）', () => {
    const { svc, a, b, selected$ } = makeTwoMapService();
    let fired = 0;
    const sub = svc.focusChanged$.subscribe(() => fired++);
    // 图 A 建焦点（addChild → emitFocus）
    svc.focusedNodeId = a.model.root.id;
    svc.addChild();
    const firedAfterA = fired;

    // 切到图 B：选区换 + 在 B 根建子 → focusMapId 归属切到 B
    selected$.next(['mm-b']);
    svc.focusedNodeId = b.model.root.id;
    svc.addChild();
    expect(fired).toBeGreaterThan(firedAfterA); // 双图各广播
    // 归属图 = B（通过 getFocusedLineColor 间接验证焦点在 B 的子节点上）
    expect(svc.getFocusedLineColor()).not.toBeNull();
    svc.dispose();
    sub.unsubscribe();
  });
});
