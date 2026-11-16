/**
 * org kind 配置（specs/tree-diagrams §5.4/§6.4/§8.1，Phase 3）：
 * 上→下层级布局 + 正交总线 + 父/子/兄弟导航 + 三带落点 + 卡片样式。
 * 只 import 纯策略模块（layout/connector/nav/drop/style），不 import Model/Vm/Service。
 */
import type {
  ITreeConnector,
  ITreeDrop,
  ITreeKind,
  ITreeLayout,
  ITreeNav,
  ITreeNavCtx,
} from '../registry';
import { layoutOrgTree } from '../layout/org';
import { ORG_LINE, orgConnectorPath } from '../connector/org';
import { orgNavigate, orgFocusAfterDelete } from '../nav/org';
import { buildOrgDropAreas, orgHitTreeDropAreas } from '../drop/org';
import { ORG_ROOT_TEXT, orgPresentation } from './org/style';

class OrgLayout implements ITreeLayout {
  layout: ITreeLayout['layout'] = (root) => layoutOrgTree(root);
}

class OrgConnector implements ITreeConnector {
  path = (edge: Parameters<ITreeConnector['path']>[0]) => orgConnectorPath(edge);
}

class OrgNav implements ITreeNav {
  navigate: ITreeNav['navigate'] = (currentId, key, ctx: ITreeNavCtx) =>
    orgNavigate(currentId, key, ctx);
  focusAfterDelete: ITreeNav['focusAfterDelete'] = (nodeId, ctx) =>
    orgFocusAfterDelete(nodeId, ctx);
}

class OrgDrop implements ITreeDrop {
  buildAreas: ITreeDrop['buildAreas'] = (model, vm, excludeId) =>
    buildOrgDropAreas(model, vm, excludeId);
  hitTest: ITreeDrop['hitTest'] = (vm, areas, world) =>
    orgHitTreeDropAreas(vm, areas as Parameters<typeof orgHitTreeDropAreas>[1], world);
}

export const orgKind: ITreeKind = {
  type: 'ORG_CHART',
  defaultOrientation: 'top-down',
  orientations: ['top-down'],
  supportsSides: false,
  supportsLineColor: false,
  connectorLineWidth: 2,
  connectorFallback: ORG_LINE,
  style: { presentation: orgPresentation },
  defaultRootText: ORG_ROOT_TEXT,
  defaultChildText: (n: number) => `成员 ${n + 1}`,
  layout: () => new OrgLayout(),
  connector: () => new OrgConnector(),
  nav: () => new OrgNav(),
  drop: () => new OrgDrop(),
};

export { ORG_LINE, ORG_ROOT_TEXT };
