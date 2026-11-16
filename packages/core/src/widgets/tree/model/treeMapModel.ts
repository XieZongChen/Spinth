import * as Y from 'yjs';
import { z } from 'zod';
import { BaseModel } from '../../../base/baseModel';
import { WIDGET_REGISTRY, type IWidgetCapabilities, type IWidgetData } from '../../../types';
import type { MindMapData, OrgChartData } from '../../../types';
import type { IRect } from '../../../common/geometry';
import type { DataProcessor } from '../../../platform/dataEngine/dataProcessor';
import { TreeNodeModel } from './treeNodeModel';
import { buildYTree, type ITreeNodeSpec } from './treeSpec';
import type { ITreeKind } from '../registry';
import { mindKind } from '../kinds/mind';
import { orgKind } from '../kinds/org';

export {
  buildYTree,
  yTreeToSpec,
  nodeDirection,
  findTreeNode,
  findMindNode,
  buildNavTree,
} from './treeSpec';
export { BRANCH_COLORS, branchColorAt, nextBranchColor } from '../kinds/mind/colors';
export type { IMindNodeSpec, ITreeNodeSpec } from '../../../types/tree';

/**
 * 树形图数据层基类（specs/tree-diagrams §4，docs/11 §2/§3）：树图是 widgets
 * 数组成员（整图一个 widget），树存 root Y.Map 内（节点不占 widget 类型/zOrder
 * ——4.1 决策）。TreeNodeModel 承担增量树同步；本类只持根引用与 JSON↔Y 树转换。
 * schema/capabilities 由 kind 从 WIDGET_REGISTRY 单源取——种类差异不进基类。
 */
export class TreeMapModel<D extends IWidgetData = IWidgetData> extends BaseModel<D> {
  readonly kind: ITreeKind;
  readonly capabilities: IWidgetCapabilities;

  protected readonly schema: z.ZodType<D>;

  private rootNode: TreeNodeModel | null = null;

  constructor(processor: DataProcessor, kind: ITreeKind) {
    super(processor);
    this.kind = kind;
    const entry = WIDGET_REGISTRY[kind.type];
    this.capabilities = entry.capabilities; // 注册表单源（Batch 2 第二刀）
    this.schema = entry.schema as unknown as z.ZodType<D>;
  }

  /** 增量树模型（Vm 消费 childrenChange$）；延迟构建——yData 就绪后首次调用 */
  get root(): TreeNodeModel {
    if (!this.rootNode) {
      const yRoot = this.yData.get('root') as Y.Map<unknown> | undefined;
      if (!yRoot) throw new Error('[TreeMapModel] yData 缺 root');
      this.rootNode = new TreeNodeModel(yRoot);
    }
    return this.rootNode;
  }

  hasRoot(): boolean {
    return !!this.yData.get('root');
  }

  override initialize(data: D): Y.Map<unknown> {
    // root JSON 树 → Y.Map 树（创建路径）；rect 等其余字段走 processor.create
    const { root: rootSpec, ...rest } = data as D & { root?: ITreeNodeSpec };
    const yMap = super.initialize(rest as D);
    if (rootSpec) {
      this.processor.transact(() => {
        yMap.set('root', buildYTree(this.processor, rootSpec, this.kind));
      });
    }
    return yMap;
  }
}

/** MIND_MAP 薄子类：注入 mind kind（specs §3.3——两个类型是同骨架的策略实例） */
export class MindMapModel extends TreeMapModel<MindMapData & IRect> {
  constructor(processor: DataProcessor) {
    super(processor, mindKind);
  }
}

/** ORG_CHART 薄子类：注入 org kind */
export class OrgChartModel extends TreeMapModel<OrgChartData & IRect> {
  constructor(processor: DataProcessor) {
    super(processor, orgKind);
  }
}
