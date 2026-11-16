import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { OrgChartModel, MindMapModel, buildYTree } from '../widgets/tree/model/treeMapModel';
import { TreeService } from '../widgets/tree/service/treeService';
import { EditingService } from '../platform/textEngine/editingService';
import { orgKind } from '../widgets/tree/kinds/org';
import { ORG_LINE } from '../widgets/tree/connector/org';
import type { ITreeNodeSpec } from '../types/tree';

/** org 语义统一单测（审查返工 P0-4，specs/tree-diagrams §4.3/§7）：
 *  建节点文案/字段零污染（成员 N、无 direction/lineColor）、buildYTree kind
 *  投影、连线兜底色（org 恒 ORG_LINE 不走分支色）。 */

const TREE: ITreeNodeSpec = {
  text: '负责人',
  children: [{ text: '成员 1', children: [{ text: '组 1' }] }, { text: '成员 2' }],
};

function buildDoc(Model: typeof OrgChartModel | typeof MindMapModel, spec: ITreeNodeSpec) {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const model = new Model(processor);
  const yMap = doc.getMap<unknown>('tm');
  doc.transact(() => {
    yMap.set('id', 'tm-1');
    yMap.set('type', Model === OrgChartModel ? 'ORG_CHART' : 'MIND_MAP');
    yMap.set('zOrder', 'a0');
    yMap.set('root', buildYTree(processor, spec, Model === OrgChartModel ? orgKind : undefined));
  });
  model.initializeY(yMap);
  return { doc, model };
}

describe('buildYTree kind 投影（org 不写脏字段）', () => {
  it('org kind：direction/lineColor 不落盘（含根层按位分配分支）', () => {
    const { model } = buildDoc(OrgChartModel, {
      text: 'r',
      children: [{ text: 'a', direction: 'left', lineColor: '#e0559c' }, { text: 'b' }],
    });
    for (const c of model.root.children) {
      const j = c.toJSON();
      expect(j.direction).toBeUndefined();
      expect(j.lineColor).toBeUndefined();
    }
  });

  it('mind 行为（缺省 kind）：direction 透传、根层按位分配分支色', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const yRoot = buildYTree(processor, {
      text: 'r',
      children: [{ text: 'a', direction: 'left' }, { text: 'b' }],
    });
    doc.getMap('holder').set('root', yRoot);
    const first = yRoot.get('children') as Y.Array<Y.Map<unknown>>;
    expect(first.get(0)?.get('direction')).toBe('left');
    expect(first.get(0)?.get('lineColor')).toBe('#e0559c'); // branchColorAt(0)
    expect(first.get(1)?.get('lineColor')).toBe('#3e8bff'); // branchColorAt(1)
  });
});

describe('org addChild/addSibling 语义（kind 消费）', () => {
  function makeSvc(model: OrgChartModel) {
    const selected$ = new BehaviorSubject<string[]>(['tm-1']);
    const vp = {
      registerGlobalEventListener: () => {},
      setCursorMode: () => {},
      cursorMode$: new BehaviorSubject('cursor'),
      curPos$: new BehaviorSubject(null),
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
      getModelById: () => model,
      transact: (fn: () => void) => fn(),
    };
    const vmStub = {
      type: 'ORG_CHART',
      id: 'tm-1',
      root: { x: 0, y: 0 },
      getNodeRect: () => null,
    };
    const svc = new TreeService(
      vp as never,
      engine as never,
      { getVmById: () => vmStub, getVmByPoint: () => [] } as never,
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
    return svc;
  }

  it('org 建子：文案「成员 N」、无 direction/lineColor', () => {
    const { model } = buildDoc(OrgChartModel, TREE);
    const svc = makeSvc(model as OrgChartModel);
    svc.focusedNodeId = model.root.id;
    svc.addChild();
    const kid = model.root.children[model.root.children.length - 1]!;
    expect(kid.toJSON().text).toBe('成员 3'); // 已有 2 子 → 成员 3
    expect(kid.toJSON().direction).toBeUndefined();
    expect(kid.toJSON().lineColor).toBeUndefined();
    // addSibling 同守卫（根层不分配分支色）
    svc.focusedNodeId = model.root.children[0]!.id; // 成员 1 → 同级插其后（idx 1）
    svc.addSibling();
    const sib = model.root.children[1]!;
    expect(sib.toJSON().text).toBe('成员 4'); // root.children.length=3 → 成员 4
    expect(sib.toJSON().lineColor).toBeUndefined();
    svc.dispose();
  });
});

describe('org 连线兜底色（审查 P0-4）', () => {
  it('ORG_LINE 为固定灰（#64748b），与白卡对比 ≥4.5:1 由 orgChart.test 锁定', () => {
    expect(ORG_LINE).toBe('#64748b');
    expect(orgKind.connectorFallback).toBe(ORG_LINE);
    expect(orgKind.supportsLineColor).toBe(false);
  });
});
