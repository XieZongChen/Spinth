import * as Y from 'yjs';
import type { TreeMapModel } from '../model/treeMapModel';
import type { ITreeNodeSpec } from '../../../types/tree';
import { nextBranchColor } from '../kinds/mind/colors';

/**
 * 树节点构造/取色纯辅助（自 treeOps 拆出，specs/tree-diagrams §12.3）：
 * 新节点文案、单节点 Y.Map、序列化重建、一级分支取色——都不依赖 TreeOps 状态，
 * 独立可测，TreeOps 只负责事务边界与焦点委托。
 */

/** 新节点默认文案（既有设计 mindController.insertChild：`子节点 ${count + 1}`） */
export function defaultNodeText(siblingCount: number): string {
  return `子节点 ${siblingCount + 1}`;
}

/** 单节点 Y.Map（树内 id 生成；lineColor 仅根的直接子节点按位分配，深层继承） */
export function buildYNode(
  direction?: 'left' | 'right',
  lineColor?: string,
  text = '',
): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const children = new Y.Array<Y.Map<unknown>>();
  m.set('id', `mn-${Math.random().toString(36).slice(2, 10)}`);
  m.set('text', text);
  if (direction) m.set('direction', direction);
  if (lineColor) m.set('lineColor', lineColor);
  m.set('children', children);
  return m;
}

/** 根层现有一级分支已占用色集（撞色规避取色输入） */
export function usedBranchColors(model: TreeMapModel): Set<string> {
  const used = new Set<string>();
  for (const c of model.root.children) {
    const color = c.toJSON().lineColor;
    if (color) used.add(color);
  }
  return used;
}

/** 一级分支落位取色：自身带色且同图 → 保留；否则取未占用色（既有设计 move Rule 1.1/1.2） */
export function rootChildColor(
  model: TreeMapModel,
  ownColor: string | undefined,
  crossMap: boolean,
  index: number,
): string {
  if (!crossMap && ownColor) return ownColor;
  return nextBranchColor(usedBranchColors(model), index);
}

/** 从 spec 建 Y.Map 节点（递归）。颜色规则由调用方分派：
 *  lineColor 显式传入（移入根节点分配/根层插入），不传 = 清空继承新父 */
export function buildFromSpec(
  spec: ITreeNodeSpec,
  direction?: 'left' | 'right',
  lineColor?: string,
): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const children = new Y.Array<Y.Map<unknown>>();
  m.set('id', `mn-${Math.random().toString(36).slice(2, 10)}`);
  m.set('text', spec.text);
  // 落点侧优先（既有设计 move：dest 为根时 json.direction = 命中侧向）
  const dir = direction ?? spec.direction;
  if (dir) m.set('direction', dir);
  if (lineColor) m.set('lineColor', lineColor);
  // 折叠态透传（specs §4.6：搬移/复制保持折叠；展开态缺省不落盘）
  if (spec.collapsed) m.set('collapsed', true);
  for (const c of spec.children ?? []) children.push([buildFromSpec(c, dir)]);
  m.set('children', children);
  return m;
}
