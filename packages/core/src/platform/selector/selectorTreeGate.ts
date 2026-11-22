import type { Point } from 'pixi.js';
import type { IPointerEventInfo, ITreeDragDelegate } from '../../types';

/**
 * 树按下门（docs/11 §6，自 selectorService.onPointerDown 拆出——审查返工
 * 400 行拆分，逻辑逐字搬移）：按下在树控件上时的节点级接管分支。
 * 返回结果供宿主落字段（treeDragging/treeDragWasSelected 归 SelectorService，
 * 拆出只搬判定不搬状态）。
 */

/** 树分支处理结果；'pass' = 未接管，落回通用路径（整图拖拽/框选） */
export type TreeGateResult =
  | { kind: 'consumed' } // 折叠徽标：已建选区/焦点/展开，本次按下到此为止
  | { kind: 'dragging'; wasSelected: boolean } // startDrag 接管，宿主置 treeDragging
  | { kind: 'focus-root' } // 点根：已重置焦点根，落回通用路径选整图
  | { kind: 'pass' }; // 未命中节点：通用路径

export function treePointerDown(
  delegate: ITreeDragDelegate,
  top: { id: string },
  e: IPointerEventInfo,
  isSelected: (id: string) => boolean,
  setSelected: (ids: string[]) => void,
): TreeGateResult {
  // 折叠徽标优先于节点拖拽（specs/tree-diagrams §8.4）：命中 → 建选区/节点
  // 焦点、执行展开、消费本次按下（不建拖拽会话）；未命中才走 startDrag。
  // 只读态指针分发整条丢弃（不会到达此处），徽标不可操作由该闸门保证
  const toggleId = delegate.hitToggle?.(top.id, e.world);
  if (toggleId) {
    delegate.focusNode?.(top.id, toggleId);
    setSelected([top.id]);
    delegate.toggleCollapseAt?.(top.id, toggleId);
    return { kind: 'consumed' };
  }
  const node = (top as unknown as { hitNode(p: Point): { model: { id: string } } | null }).hitNode(
    e.world,
  );
  // 按下时该脑图是否已在选区（松手未拖动 = 再点已选中 → 激活编辑，同通用路径）
  const wasSelected = isSelected(top.id);
  if (node && delegate.startDrag(top.id, node.model.id, e.world)) {
    // 按下即建立节点级选中态（先于 setSelected：选区框同步时 isNodeSelected
    // 已可判定，整树框不闪现——松手 click 分支的焦点覆写同值幂等）
    delegate.focusNode?.(top.id, node.model.id);
    setSelected([top.id]);
    return { kind: 'dragging', wasSelected };
  }
  // 4.9 点根 = 整图选中 + 焦点重置根（selected$ 订阅对同图旧焦点不重置，
  // 此处精确通知——既有设计点根即选整图的语义）
  if (node) {
    delegate.focusRoot?.(top.id);
  }
  return { kind: node ? 'focus-root' : 'pass' };
}
