/**
 * mind kind 配置（specs/tree-diagrams §3.3/§5.2/§6.2/§8.1）：策略工厂包装
 * 现有纯函数——Phase 0 行为冻结，竖向（orientation 分派）在 Phase 2 落位。
 * 本文件只 import 纯策略模块，不 import Model/Vm/Service（防环）。
 */
import type { TreeOrientation } from '../../../types/tree';
import type {
  ITreeConnector,
  ITreeKind,
  ITreeLayout,
  ITreeNav,
  ITreeNavCtx,
  ITreeStyle,
} from '../registry';
import { layoutMindTree } from '../layout/mindHorizontal';
import { layoutMindTreeVertical } from '../layout/mindVertical';
import type { ILayoutNode, ILayoutResult } from '../layout/types';
import type { ITreeEdge } from '../connector/types';
import {
  nodeConnectorPath,
  nodeConnectorPathVertical,
  rootConnectorCmdsVertical,
  rootEnd,
  rootStartX,
  rootT,
  ROOT_CP_RATIO,
} from '../connector/mind';
import { mindNavigate, mindNavigateVertical } from '../nav/mind';
import { MIND_ROOT_LABEL, mindPresentation, type ITreeNodePresentation } from './mind/style';

export {
  MIND_COLORS,
  MIND_ROOT_LABEL,
  MIND_ROOT_STYLE,
  MIND_NODE_STYLE,
  NODE_MAX_WIDTH,
} from './mind/style';

/** mind 横向布局策略（行为冻结：直通 layoutMindTree） */
class MindHorizontalLayout implements ITreeLayout {
  layout(root: ILayoutNode): ILayoutResult {
    return layoutMindTree(root);
  }
}

/** mind 竖向布局策略：横向的严格转置（specs §5.3） */
class MindVerticalLayout implements ITreeLayout {
  layout(root: ILayoutNode): ILayoutResult {
    return layoutMindTreeVertical(root);
  }
}

/** mind 横向连线策略：根→一级贝塞尔（升阶 cubic 输出——与 PIXI
 *  quadraticCurveTo 内部实现同一升阶，逐像素一致）+ 普通鱼骨命令直通 */
/** mind 竖向连线策略：根贝塞尔/鱼骨的转置镜像（specs §6.3） */
class MindVerticalConnector implements ITreeConnector {
  path(edge: ITreeEdge) {
    if (edge.depth === 1) {
      return rootConnectorCmdsVertical(edge.parent, edge.child, edge.side === 'left');
    }
    return nodeConnectorPathVertical(edge.parent, edge.child);
  }
}

class MindHorizontalConnector implements ITreeConnector {
  path(edge: ITreeEdge) {
    if (edge.depth === 1) {
      const vertDist = Math.abs(
        edge.child.y + edge.child.height / 2 - (edge.parent.y + edge.parent.height / 2),
      );
      const t = rootT(vertDist, edge.side === 'left');
      const sX = rootStartX(edge.parent.x + edge.parent.width / 2, edge.parent.width, t);
      const sY = edge.parent.y + edge.parent.height / 2;
      const e = rootEnd(edge.child, edge.side === 'left');
      const cpX = sX + (e.x - sX) * ROOT_CP_RATIO;
      const cpY = e.y;
      // quadratic(p0,cp,p1) ≡ cubic(p0, p0+⅔(cp−p0), p1+⅔(cp−p1), p1)——数学恒等
      const c1x = sX + (2 / 3) * (cpX - sX);
      const c1y = sY + (2 / 3) * (cpY - sY);
      const c2x = e.x + (2 / 3) * (cpX - e.x);
      const c2y = e.y + (2 / 3) * (cpY - e.y);
      return [
        { op: 'moveTo' as const, x: sX, y: sY },
        { op: 'cubicTo' as const, c1x, c1y, c2x, c2y, x: e.x, y: e.y },
      ];
    }
    return nodeConnectorPath(edge.parent, edge.child);
  }
}

/** mind 横向导航策略（直通 mindNavigate） */
class MindHorizontalNav implements ITreeNav {
  navigate(
    currentId: string,
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
    ctx: ITreeNavCtx,
  ): string | null {
    return mindNavigate(currentId, key, ctx);
  }
}

/** mind 竖向导航策略：键位映射后复用横向逻辑（specs §8.1 表） */
class MindVerticalNav implements ITreeNav {
  navigate(
    currentId: string,
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
    ctx: ITreeNavCtx,
  ): string | null {
    return mindNavigateVertical(currentId, key, ctx);
  }
}

/** mind 样式策略：presentation 按深度（行为冻结） */
const mindStyle: ITreeStyle = {
  presentation(node: { text: string; lineColor?: string }, depth: number): ITreeNodePresentation {
    return mindPresentation(node, depth);
  },
};

export const mindKind: ITreeKind = {
  type: 'MIND_MAP',
  defaultOrientation: 'horizontal',
  orientations: ['horizontal', 'vertical'],
  supportsSides: true,
  supportsLineColor: true,
  connectorLineWidth: 4,
  style: mindStyle,
  defaultRootText: MIND_ROOT_LABEL,
  defaultChildText: (n: number) => `子节点 ${n + 1}`,
  layout(o: TreeOrientation): ITreeLayout {
    return o === 'vertical' ? new MindVerticalLayout() : new MindHorizontalLayout();
  },
  connector(o: TreeOrientation): ITreeConnector {
    return o === 'vertical' ? new MindVerticalConnector() : new MindHorizontalConnector();
  },
  nav(o: TreeOrientation): ITreeNav {
    return o === 'vertical' ? new MindVerticalNav() : new MindHorizontalNav();
  },
};
