/**
 * 树连线绘制（自 TreeMapVm 拆出，specs/tree-diagrams §12.2）：策略命令 →
 * Graphics 执行。Vm 只喂「模型树 + 布局位置 + kind」，不写算法。
 */
import { Graphics } from 'pixi.js';
import { TreeNodeModel } from '../model/treeNodeModel';
import type { ITreeKind } from '../registry';
import type { ILayoutResult } from '../layout/types';
import type { IConnectorCmd } from '../connector/types';
import { MIND_COLORS } from '../kinds/mind/style';
import type { TreeNodeVm } from './treeNodeVm';

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** 命令数组 → PIXI Graphics（cubicTo 即 bezierCurveTo；moveTo/lineTo/arc 直通） */
export function executeConnectorCmds(g: Graphics, cmds: IConnectorCmd[]): void {
  for (const cmd of cmds) {
    if (cmd.op === 'moveTo') g.moveTo(cmd.x, cmd.y);
    else if (cmd.op === 'lineTo') g.lineTo(cmd.x, cmd.y);
    else if (cmd.op === 'cubicTo')
      g.bezierCurveTo(cmd.c1x, cmd.c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y);
    else g.arc(cmd.cx, cmd.cy, cmd.r, cmd.start, cmd.end, cmd.ccw);
  }
}

/**
 * 整树连线（docs/11 §5，行为冻结）：DFS 每条父子边经 kind.connector(orientation)
 * 取命令。边色 = 子节点沿父链继承的分支色（kind 只给兜底；org 忽略、用统一色）。
 */
export function drawTreeConnectors(
  g: Graphics,
  kind: ITreeKind,
  orientation: Parameters<ITreeKind['connector']>[0],
  rootModel: TreeNodeModel,
  layout: ILayoutResult,
  nodeVms: Map<string, TreeNodeVm>,
): void {
  g.clear();
  const rootVm = nodeVms.get(rootModel.id);
  if (!rootVm) return;
  const lineWidth = kind.connectorLineWidth;
  const connector = kind.connector(orientation);

  const draw = (n: TreeNodeModel, depth: number): void => {
    const p = layout.positions.get(n.id);
    const vm = nodeVms.get(n.id);
    if (!p || !vm) return;
    for (const c of n.children) {
      const cp = layout.positions.get(c.id);
      const cvm = nodeVms.get(c.id);
      if (!cp || !cvm) continue;
      const childIsLeft = cp.x < p.x;
      const color = hexToInt(c.getLineColor(MIND_COLORS.lineFallback));
      const cmds = connector.path({
        parent: { x: p.x, y: p.y, width: vm.nodeWidth, height: vm.nodeHeight },
        child: { x: cp.x, y: cp.y, width: cvm.nodeWidth, height: cvm.nodeHeight },
        side: childIsLeft ? 'left' : 'right',
        depth,
        lineColor: c.getLineColor(MIND_COLORS.lineFallback),
      });
      executeConnectorCmds(g, cmds);
      g.stroke({ width: lineWidth, color, cap: 'round', join: 'round' });
      draw(c, depth + 1);
    }
  };
  draw(rootModel, 1);
}
