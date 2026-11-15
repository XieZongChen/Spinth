import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildYTree, yTreeToSpec, buildNavTree } from '../widgets/tree/model/treeSpec';
import { TreeNodeModel } from '../widgets/tree/model/treeNodeModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { TreeOps } from '../widgets/tree/ops/treeOps';
import { MindMapModel } from '../widgets/tree/model/treeMapModel';
import { makeTreeService } from './helpers/mindServiceFixture';
import type { ITreeNodeSpec } from '../types/tree';

/** 折叠数据域单测（specs/tree-diagrams §4.5/§8.4/Phase 1a）：
 *  字段透传、no-op 边界、导航树剪枝、自动展开、焦点自愈。 */

const TREE: ITreeNodeSpec = {
  text: '根',
  children: [
    {
      text: 'A',
      children: [{ text: 'A1', children: [{ text: 'A1a' }] }, { text: 'A2' }],
    },
    { text: 'B', direction: 'left' },
  ],
};

function buildRoot(tree: ITreeNodeSpec = TREE) {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const yRoot = buildYTree(processor, tree);
  // 游离 Y.Map 事务后会被 yjs 丢弃——必须挂进 doc（mindServiceFixture 同款坑）
  doc.getMap<unknown>('holder').set('root', yRoot);
  return { doc, processor, yRoot, node: new TreeNodeModel(yRoot) };
}

describe('折叠：序列化透传（specs §4.6）', () => {
  it('yTreeToSpec 读出 collapsed；buildYTree 对称落盘', () => {
    const { yRoot, doc, processor } = buildRoot({
      text: 'r',
      collapsed: true,
      children: [{ text: 'c' }],
    });
    expect(yRoot.get('collapsed')).toBe(true);
    const spec = yTreeToSpec(yRoot);
    expect(spec.collapsed).toBe(true);
    // 游离 Y.Map 的 transact 会被丢弃——重建树也挂进 doc 再断言（mindBuild 同款）
    const rebuilt = buildYTree(processor, spec);
    doc.getMap<unknown>('rebuilt').set('root', rebuilt);
    expect(rebuilt.get('collapsed')).toBe(true);
  });

  it('展开态不落盘（老文档零迁移）', () => {
    const { yRoot } = buildRoot({ text: 'r', children: [{ text: 'c' }] });
    expect(yRoot.get('collapsed')).toBeUndefined();
    expect(yTreeToSpec(yRoot).collapsed).toBeUndefined();
  });
});

describe('折叠：导航树剪枝（specs §8.4）', () => {
  it('折叠节点保留为叶子：byId 无隐藏后代', () => {
    const { node } = buildRoot();
    const nodeA = node.children[0]!;
    nodeA.yMap.doc!.transact(() => nodeA.yMap.set('collapsed', true));
    const nav = buildNavTree(node);
    expect(nav.byId.has(nodeA.id)).toBe(true);
    expect(nav.byId.has(nodeA.children[0]!.id)).toBe(false); // A1 隐藏
    expect(nav.byId.get(nodeA.id)!.children).toHaveLength(0); // 折叠 = 叶子
  });

  it('isCollapsed 读态 + toJSON 透传', () => {
    const { node } = buildRoot();
    const nodeA = node.children[0]!;
    expect(nodeA.isCollapsed()).toBe(false);
    nodeA.yMap.doc!.transact(() => nodeA.yMap.set('collapsed', true));
    expect(nodeA.isCollapsed()).toBe(true);
    expect(nodeA.toJSON().collapsed).toBe(true);
  });
});

describe('折叠：服务行为（fixture 真服务，specs §4.5/§8.3）', () => {
  it('setCollapsedFocused：折叠/展开生效；无子节点 no-op', () => {
    const { svc, model } = makeTreeService(TREE);
    svc.focusedNodeId = model.root.children[0]!.id; // 焦点 A（有子）
    expect(svc.setCollapsedFocused(true)).toBe(true);
    expect(model.root.children[0]!.isCollapsed()).toBe(true);
    expect(svc.setCollapsedFocused(false)).toBe(true);
    expect(model.root.children[0]!.isCollapsed()).toBe(false);
    // B 无子：焦点 B 折叠 no-op
    svc.focusedNodeId = model.root.children[1]!.id;
    expect(svc.setCollapsedFocused(true)).toBe(false);
    expect(model.root.children[1]!.yMap.get('collapsed')).toBeUndefined();
  });

  it('同值重复写：零事务（无多余 Yjs 写）', () => {
    const { svc, model } = makeTreeService(TREE);
    const nodeA = model.root.children[0]!;
    svc.focusedNodeId = nodeA.id;
    svc.setCollapsedFocused(true);
    let writes = 0;
    nodeA.yMap.observe(() => {
      writes += 1;
    });
    svc.setCollapsedFocused(true); // 同值 no-op（返回 true：有焦点有子，命令合法）
    expect(writes).toBe(0);
  });

  it('折叠节点上 Tab 建子：同事务自动展开', () => {
    const { svc, model } = makeTreeService(TREE);
    const nodeA = model.root.children[0]!;
    svc.focusedNodeId = nodeA.id;
    svc.setCollapsedFocused(true);
    expect(nodeA.isCollapsed()).toBe(true);
    svc.addChild();
    expect(nodeA.isCollapsed()).toBe(false); // 自动展开
    expect(nodeA.children.length).toBe(3); // A1/A2/新子
  });

  it('悬挂焦点自愈：焦点在折叠隐藏后代 → getFocused 收口到折叠节点', () => {
    const { svc, model } = makeTreeService(TREE);
    const nodeA = model.root.children[0]!;
    svc.focusedNodeId = nodeA.id;
    svc.setCollapsedFocused(true);
    // 模拟 undo/远端折叠后的悬挂焦点（直接写入，绕过服务收口）
    svc.focusedNodeId = nodeA.children[0]!.children[0]!.id; // A1a（隐藏中）
    expect(svc.navigate('ArrowDown')).toBe(true); // 经 getFocused 自愈且被消费
    expect(svc.focusedNodeId).toBe(nodeA.id); // 收口到折叠节点 A
  });
});

describe('折叠：TreeOps 焦点迁移（specs §4.5「焦点移到被折叠节点」）', () => {
  it('折叠 nodeId 时焦点在其后代 → 焦点移到 nodeId', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const model = new MindMapModel(processor);
    const yMap = doc.getMap<unknown>('mm');
    doc.transact(() => {
      yMap.set('id', 'mm-1');
      yMap.set('type', 'MIND_MAP');
      yMap.set('zOrder', 'a0');
      yMap.set('root', buildYTree(processor, TREE));
    });
    model.initializeY(yMap);
    const nodeA = model.root.children[0]!;
    const a1a = nodeA.children[0]!.children[0]!;
    let focusWrite: string | null = a1a.id; // 焦点在 A 的孙层
    const ops = new TreeOps(
      { getModelById: () => model, transact: (fn: () => void) => fn() } as never,
      { stopCapturing: () => {} } as never,
      { setSelected: () => {} } as never,
      {
        getFocused: () => ({
          vm: {} as never,
          mapModel: model,
          node: findNode(model.root, focusWrite),
        }),
        setFocusedNode: (id) => {
          focusWrite = id;
        },
      },
    );
    ops.setCollapsed('mm-1', nodeA.id, true);
    expect(nodeA.isCollapsed()).toBe(true);
    expect(focusWrite).toBe(nodeA.id); // 焦点从 A1a 移到 A
  });
});

function findNode(root: TreeNodeModel, id: string | null): TreeNodeModel {
  if (!id || root.id === id) return root;
  for (const c of root.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  throw new Error('not found');
}
