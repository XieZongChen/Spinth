import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MindTreeOps, defaultNodeText } from '../widgets/mind/mindTreeOps';
import { MindMapModel } from '../widgets/mind/mindMapModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import type { IDataEngineService, IHistoryService, ISelectorService } from '../types';

/** 1.28 反驳的行为锁：同父搬移前移补偿已存在（fixedIndex 先例）——
 *  3+ 兄弟四向（前移/后移/原位/越尾）锁现状，防未来重构丢失补偿 */
function harness() {
  const yDoc = new Y.Doc();
  const processor = new DataProcessor(yDoc);
  const root = new Y.Map<unknown>();
  root.set('id', 'root');
  root.set('text', '中心主题');
  const kids = new Y.Array<Y.Map<unknown>>();
  yDoc.transact(() => {
    for (const t of ['A', 'B', 'C', 'D']) {
      const m = new Y.Map<unknown>();
      m.set('id', `n-${t}`);
      m.set('text', t);
      m.set('children', new Y.Array<unknown>());
      kids.push([m]);
    }
    root.set('children', kids);
  });
  // MindMapModel 的 yData 是 widget 级 Y.Map（root 是其字段——docs/11 §2）；
  // 脱离文档的 Y.Map 读取无效——经 doc 集成 map
  const yData = yDoc.getMap('w');
  yData.set('root', root);
  const model = new MindMapModel(processor);
  model.initializeY(yData as never);
  const models = new Map([['map1', model]]);
  const engine = {
    getModelById: (id: string) => models.get(id),
    transact: (fn: () => void) => fn(),
  } as unknown as IDataEngineService;
  const ops = new MindTreeOps(
    engine,
    { stopCapturing: vi.fn() } as unknown as IHistoryService,
    {} as ISelectorService,
    {
      addChildFocused: vi.fn(),
      restoreFocusAfterEdit: vi.fn(),
      focusEditedNode: vi.fn(),
    } as never,
  );
  return { ops, model };
}

describe('1.28 同父搬移下标补偿（行为锁）', () => {
  it('前移：拖 D(3)→index1，落到 A,D,B,C（删自身后目标左移一位于 D 前）', () => {
    const { ops, model } = harness();
    const d = model.root.children[3]!;
    ops.move(
      { mapId: 'map1', nodeId: d.id, spec: { text: d.toJSON().text }, lastTargetMapId: null },
      { kind: 'asChild', nodeId: 'root', index: 1, direction: 'right' } as never,
    );
    expect(model.root.children.map((c) => c.toJSON().text)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('后移：拖 A(0)→index3，落到 B,C,A,D（cur<insertAt 不成立不减）', () => {
    const { ops, model } = harness();
    const a = model.root.children[0]!;
    ops.move(
      { mapId: 'map1', nodeId: a.id, spec: { text: a.toJSON().text }, lastTargetMapId: null },
      { kind: 'asChild', nodeId: 'root', index: 3, direction: 'right' } as never,
    );
    expect(model.root.children.map((c) => c.toJSON().text)).toEqual(['B', 'C', 'A', 'D']);
  });

  it('原位：拖 B(1)→index1 不变（cur===insertAt 不减）', () => {
    const { ops, model } = harness();
    const b = model.root.children[1]!;
    ops.move(
      { mapId: 'map1', nodeId: b.id, spec: { text: b.toJSON().text }, lastTargetMapId: null },
      { kind: 'asChild', nodeId: 'root', index: 1, direction: 'right' } as never,
    );
    expect(model.root.children.map((c) => c.toJSON().text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('越尾：拖 A(0)→index99 钳制到尾', () => {
    const { ops, model } = harness();
    const a = model.root.children[0]!;
    ops.move(
      { mapId: 'map1', nodeId: a.id, spec: { text: a.toJSON().text }, lastTargetMapId: null },
      { kind: 'asChild', nodeId: 'root', index: 99, direction: 'right' } as never,
    );
    expect(model.root.children.map((c) => c.toJSON().text)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('defaultNodeText 递增文案（顺带锁）', () => {
    expect(defaultNodeText(0)).toContain('1');
    expect(defaultNodeText(3)).toContain('4');
  });
});
