/**
 * 树序列化与树查询纯函数（specs/tree-diagrams §4.6/§12.2，自 treeMapModel 拆出）：
 * JSON↔Y 树转换、沿链侧向、按 id 找节点、轻量导航树构建。
 * 跨种类写边界（projectSpecFor）随 Phase 3 org 落位。
 */
import * as Y from 'yjs';
import type { IMindNodeSpec, ITreeNodeSpec } from '../../../types/tree';
import type { DataProcessor } from '../../../platform/dataEngine/dataProcessor';
import type { TreeNodeModel } from './treeNodeModel';
import type { INavNode } from '../nav/types';
import { branchColorAt } from '../kinds/mind/colors';

export type { IMindNodeSpec, ITreeNodeSpec };

/** JSON 树 → 嵌套 Y.Map（id 此处生成：树内节点 id 不走 widgets 语义）。
 *  kind 可选（审查返工 P0-4）：缺省 = mind 行为（旧测试兼容）；org kind 下
 *  direction/lineColor 不落盘（specs §4.3 按目标 kind 投影、不写脏字段） */
export function buildYTree(
  processor: DataProcessor,
  spec: ITreeNodeSpec,
  kind?: { supportsSides: boolean; supportsLineColor: boolean },
): Y.Map<unknown> {
  return buildYNodeY(processor, spec, 0, 0, kind);
}

function buildYNodeY(
  processor: DataProcessor,
  spec: ITreeNodeSpec,
  depth: number,
  index: number,
  kind?: { supportsSides: boolean; supportsLineColor: boolean },
): Y.Map<unknown> {
  // 字段能力缺省按 mind（全支持）——显式传入的 kind 按其能力位收窄
  const sides = kind?.supportsSides ?? true;
  const colors = kind?.supportsLineColor ?? true;
  const m = new Y.Map<unknown>();
  const children = new Y.Array<Y.Map<unknown>>();
  processor.transact(() => {
    m.set('id', `mn-${Math.random().toString(36).slice(2, 10)}`);
    m.set('text', spec.text);
    if (sides && spec.direction) m.set('direction', spec.direction);
    // 分支色：根的直接子节点按位分配；spec 自带（拖拽搬移）优先；深层不落盘走继承
    const lineColor = spec.lineColor ?? (depth === 1 ? branchColorAt(index) : undefined);
    if (colors && lineColor) m.set('lineColor', lineColor);
    // 折叠透传（搬移/复制保持折叠态；展开态缺省不落盘——老文档零迁移）
    if (spec.collapsed) m.set('collapsed', true);
    for (const [i, c] of (spec.children ?? []).entries()) {
      children.push([buildYNodeY(processor, c, depth + 1, i, kind)]);
    }
    m.set('children', children);
  });
  return m;
}

/** Y 树 → JSON（复制/模板用；拖拽 move 的序列化搬移同源）。lineColor/collapsed 透传——搬移子树不丢态 */
export function yTreeToSpec(yNode: Y.Map<unknown>): ITreeNodeSpec {
  const out: ITreeNodeSpec = { text: String(yNode.get('text') ?? '') };
  const dir = yNode.get('direction');
  if (dir === 'left' || dir === 'right') out.direction = dir;
  const lc = yNode.get('lineColor');
  if (typeof lc === 'string') out.lineColor = lc;
  if (yNode.get('collapsed') === true) out.collapsed = true;
  const kids = (yNode.get('children') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? [];
  if (kids.length > 0) out.children = kids.map(yTreeToSpec);
  return out;
}

/** 沿父链取侧向（direction 仅根的直接子节点有，深层继承——docs/11 §2；
 *  自 TreeService 收单源，拖拽落点判定与焦点槽位共用） */
export function nodeDirection(node: TreeNodeModel): 'left' | 'right' {
  let n: TreeNodeModel | null = node;
  while (n) {
    const d = n.toJSON().direction;
    if (d === 'left' || d === 'right') return d;
    n = n.getParent();
  }
  return 'right';
}

/** 按 id 深度优先找节点。id 为 null/空 = 回退根（调用方以「无焦点 → 根」语义消费，
 *  故 falsy 不视为「找不到」——框选/跨图排除逻辑依赖此回退，改前先核对调用方） */
export function findTreeNode(root: TreeNodeModel, id: string | null): TreeNodeModel | null {
  if (!id) return root;
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findTreeNode(c, id);
    if (f) return f;
  }
  return null;
}

/** 1.0 内部调用名兼容（specs §11.2 命名保留口径——内部函数随骨架归树名） */
export const findMindNode = findTreeNode;

/** 从 Model 树构建轻量导航树（parent 反向引用 + id 索引一次建好；TreeService
 *  私有辅助自 2026-10-06 批刀 1 收单源至此——节点操作与导航共用同一棵树）。
 *  折叠节点保留为叶子（specs/tree-diagrams §8.4：导航/删除落点不进隐藏子树）；
 *  深度遍历在折叠处剪枝——隐藏后代不进 byId，天然不成为任何落点 */
export function buildNavTree(root: TreeNodeModel): { root: INavNode; byId: Map<string, INavNode> } {
  const byId = new Map<string, INavNode>();
  const build = (n: TreeNodeModel, parent: INavNode | null): INavNode => {
    const dir = n.toJSON().direction;
    const node: INavNode = { id: n.id, direction: dir, parent, children: [] };
    byId.set(n.id, node);
    const kids = n.isCollapsed() ? [] : n.children;
    node.children = kids.map((c) => build(c, node));
    return node;
  };
  return { root: build(root, null), byId };
}

/** 跨种类写边界（specs/tree-diagrams §4.3，Phase 3）：搬移/粘贴进目标 kind
 *  时按目标 kind 投影——不做「保留但隐藏」的脏数据：
 *  - mind → org：递归剥离 direction/lineColor（org 不消费）；
 *  - org → mind：保留 text/collapsed；direction/lineColor 由落点决定
 *    （destIsRoot 时 direction = 落点侧，lineColor 由调用方按插入位分配） */
export function projectSpecFor(
  kind: 'MIND_MAP' | 'ORG_CHART',
  spec: ITreeNodeSpec,
  opts: { direction?: 'left' | 'right'; lineColor?: string } = {},
): ITreeNodeSpec {
  if (kind === 'ORG_CHART') {
    const strip = (s: ITreeNodeSpec): ITreeNodeSpec => ({
      text: s.text,
      ...(s.collapsed ? { collapsed: true } : {}),
      children: s.children?.map(strip),
    });
    return strip(spec);
  }
  const stripMind = (s: ITreeNodeSpec, depth: number): ITreeNodeSpec => ({
    text: s.text,
    ...(s.collapsed ? { collapsed: true } : {}),
    // 落根层：direction = 落点侧、lineColor = 调用方分配（其余层清空继承新父）
    ...(depth === 1 && opts.direction ? { direction: opts.direction } : {}),
    ...(depth === 1 && opts.lineColor ? { lineColor: opts.lineColor } : {}),
    children: s.children?.map((c) => stripMind(c, depth + 1)),
  });
  return stripMind(spec, 0);
}
