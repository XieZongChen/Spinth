import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BoardSDK } from '../app';

/**
 * 树命令层守卫单测（审查返工 P0-1/P0-2，specs/tree-diagrams 复审）：
 * 只读门禁（toggleTreeCollapse/setTreeOrientation 早退不触服务）、
 * setTreeOrientation 的 kind 守卫（非树选中不下发）、applySelection 对
 * ORG_CHART 的焦点归属（family 化——曾只认 MIND_MAP 导致 org 选中即清焦点）。
 * 桩法照 alignCommand.test 先例（私有字段注入）。
 */

function harness(opts: { editable: boolean; selected: string[]; treeVmType?: string }) {
  const svc = {
    toggleCollapseFocused: vi.fn(),
    setOrientation: vi.fn(),
  };
  const focusCalls: Array<string | null> = [];
  const focusCtl = {
    focusedNodeId: null as string | null,
    focusChanged$: new BehaviorSubject<void>(undefined),
    emitFocus: vi.fn(),
    clearFocusHighlight: vi.fn(),
    applySelection: undefined as unknown as (ids: string[]) => void,
  };
  const sdk = new BoardSDK();
  const w = sdk as unknown as Record<string, unknown>;
  const treeType = opts.treeVmType ?? 'MIND_MAP';
  w.viewport = { editable$: new BehaviorSubject(opts.editable) };
  w.selector = { selected$: new BehaviorSubject(opts.selected), setSelected: vi.fn() };
  w.vmEngine = {
    getVmById: (id: string) =>
      id === 'tree-1'
        ? { id, type: treeType }
        : id === 'shape-1'
          ? { id, type: 'SHAPE' }
          : undefined,
  };
  w.engine = {
    getModelById: (id: string) =>
      id === 'tree-1'
        ? {
            id,
            kind: { type: treeType, orientations: ['horizontal', 'vertical'] },
            hasRoot: () => true,
            root: { id: 'root-1', id2: 0 },
          }
        : undefined,
  };
  w.treeService = svc;
  w.commands = sdk.commands; // BoardCommands 构造在 app 构造器里已持 ctx 引用
  return { sdk, svc, focusCtl, focusCalls };
}

describe('树命令只读与 kind 守卫（审查 P0-1）', () => {
  it('只读态：toggleTreeCollapse/setTreeOrientation 早退，不触 treeService', () => {
    const { sdk, svc } = harness({ editable: false, selected: ['tree-1'] });
    sdk.toggleTreeCollapse();
    sdk.setTreeOrientation('vertical');
    expect(svc.toggleCollapseFocused).not.toHaveBeenCalled();
    expect(svc.setOrientation).not.toHaveBeenCalled();
  });

  it('可编辑 + 树选中：两命令正常下发', () => {
    const { sdk, svc } = harness({ editable: true, selected: ['tree-1'] });
    sdk.toggleTreeCollapse();
    sdk.setTreeOrientation('vertical');
    expect(svc.toggleCollapseFocused).toHaveBeenCalledTimes(1);
    expect(svc.setOrientation).toHaveBeenCalledWith('tree-1', 'vertical');
  });

  it('可编辑 + 非树选中：setTreeOrientation 不下发（kind 守卫）', () => {
    const { sdk, svc } = harness({ editable: true, selected: ['shape-1'] });
    sdk.setTreeOrientation('vertical');
    expect(svc.setOrientation).not.toHaveBeenCalled();
  });
});

// —— applySelection family 化（审查 P0-2）：org 选中不再清焦点 ——

import * as Y from 'yjs';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { OrgChartModel, buildYTree } from '../widgets/tree/model/treeMapModel';
import { TreeService } from '../widgets/tree/service/treeService';
import { EditingService } from '../platform/textEngine/editingService';

describe('applySelection 对 ORG_CHART 的焦点归属（审查 P0-2）', () => {
  it('选中 org 图：焦点落该图根（不再被 MIND_MAP 判定清掉）', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const model = new OrgChartModel(processor);
    const yMap = doc.getMap<unknown>('om');
    doc.transact(() => {
      yMap.set('id', 'org-1');
      yMap.set('type', 'ORG_CHART');
      yMap.set('zOrder', 'a0');
      yMap.set('root', buildYTree(processor, { text: '负责人' }));
    });
    model.initializeY(yMap);

    const selected$ = new BehaviorSubject<string[]>([]);
    const vp = {
      registerGlobalEventListener: () => {},
      setCursorMode: () => {},
      cursorMode$: new BehaviorSubject('cursor'),
      curPos$: new BehaviorSubject<null>(null),
      optionLayer: { addChild: () => {} },
      vpScale$: new BehaviorSubject(1),
      vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
      toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
      worldToClient: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
      getClientSize: () => ({ width: 800, height: 600 }),
      panBy: () => {},
    };
    const engine = {
      add: () => {},
      removeByIds: () => {},
      genInitialOrder: () => 'a1',
      getModelById: (id: string) => (id === 'org-1' ? model : null),
      transact: (fn: () => void) => fn(),
    };
    const vmStub = {
      type: 'ORG_CHART',
      id: 'org-1',
      root: { x: 0, y: 0 },
      getNodeRect: () => null,
    };
    const vmEngine = {
      getVmById: (id: string) => (id === 'org-1' ? vmStub : undefined),
      getVmByPoint: () => [],
    };
    const svc = new TreeService(
      vp as never,
      engine as never,
      vmEngine as never,
      { selected$, setSelected: () => {} } as never,
      { stopCapturing: () => {} } as never,
      new EditingService(
        vp as never,
        engine as never,
        { selected$, setSelected: () => {} } as never,
        { stopCapturing: () => {} } as never,
      ) as never,
    );
    svc.initialize();
    selected$.next(['org-1']); // 选中 org 图 → applySelection
    expect(svc.focusedNodeId).toBe(model.root.id);
    svc.dispose();
  });
});
