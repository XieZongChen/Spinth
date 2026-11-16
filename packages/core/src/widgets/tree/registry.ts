/**
 * 树形图族种类注册表（specs/tree-diagrams D1/D3）：type → kind 配置单源。
 * 骨架（TreeMapModel/TreeMapVm/TreeService/TreeOps）只经 ITreeKind 消费差异，
 * 不出现 `if type/kind === ...` 分支；新增种类 = 加 kind 配置 + 注册 + 工厂，
 * 骨架与引擎零改动（specs §3.7 扩展指南）。
 *
 * 编译锁：TREE_KINDS 键集 ≡ WIDGET_REGISTRY 中 family === 'tree' 的类型集
 * （TreeWidgetType 由注册表派生）——注册表加了树类型而种类表没加即编译红。
 */

import type { TreeWidgetType } from '../../types';
import type { TreeOrientation } from '../../types/tree';
import type { IDropTarget } from './drop/types';
import { mindKind } from './kinds/mind';
import { orgKind } from './kinds/org';
import type { ILayoutNode, ILayoutResult } from './layout/types';
import type { ConnectorCmd, ITreeEdge } from './connector/types';
import type { INavNode } from './nav/types';
import type { ITreeNodePresentation } from './kinds/mind/style';

/** 布局策略：纯函数（禁 import PIXI/Yjs/服务；输入可见树——折叠后代已剔除） */
export interface ITreeLayout {
  layout(root: ILayoutNode): ITreeLayoutResult;
}
export interface ITreeLayoutResult extends ILayoutResult {
  /** org 调试用层深索引（mind 无） */
  levels?: Map<string, number>;
}

/** 连线策略：输出纯命令数组（Vm 只负责 Graphics 执行；预览与实物同源） */
export interface ITreeConnector {
  path(edge: ITreeEdge): ConnectorCmd[];
}

/** 导航上下文（focusController 提供 adapter；策略不依赖 Vm/Model 类型） */
export interface ITreeNavCtx {
  root: INavNode;
  byId: Map<string, INavNode>;
  /** 焦点节点主轴跨度（mind 横向 = y 区间；竖向/org 由 kind 侧定义） */
  spanOf(id: string): { start: number; end: number } | null;
}

/** 导航策略：方向键语义（返回 null = 不动）+ 删除后焦点落点（审查返工
 *  P1-8：org 策略此前是死代码——ops 对所有 kind 都用 mind 的侧向过滤版） */
export interface ITreeNav {
  navigate(
    currentId: string,
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
    ctx: ITreeNavCtx,
  ): string | null;
  /** 删除 nodeId 后焦点落哪（返回 null = 无落点；根删除 = 删整图语义在 ops） */
  focusAfterDelete(
    nodeId: string,
    ctx: { root: INavNode; byId: Map<string, INavNode> },
  ): string | null;
}

/** 节点呈现策略（spec §7.1）：测量与渲染同源的唯一取值面 */
export interface ITreeStyle {
  presentation(node: { text: string; lineColor?: string }, depth: number): ITreeNodePresentation;
}

/** 落点策略（specs §8.3）：areas 是策略私有形状（mind = DropArea 集、
 *  org = 可见节点集），buildAreas/hitTest 成对使用——骨架只透传 */
/** 落点策略的窄 host（审查返工 P1-10，spec §3.4：用结构化最小面而非
 *  TreeMapModel/TreeMapVm 具体类——kind 配置不反向依赖骨架 Vm/Model） */
export interface ITreeDropModelHost {
  kind: ITreeKind;
  root: import('./model/treeNodeModel').TreeNodeModel;
  hasRoot(): boolean;
}
export interface ITreeDropVmHost {
  orientation: TreeOrientation;
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null;
  root: { x: number; y: number };
}
export interface ITreeDrop {
  buildAreas(model: ITreeDropModelHost, vm: ITreeDropVmHost, excludeId: string): unknown;
  hitTest(vm: ITreeDropVmHost, areas: unknown, world: { x: number; y: number }): IDropTarget | null;
}

/** 种类配置：语义差异的全部来源（布局/连线/导航/落点/样式/文案） */
export interface ITreeKind {
  readonly type: TreeWidgetType;
  readonly defaultOrientation: TreeOrientation;
  readonly orientations: readonly TreeOrientation[];
  /** mind true / org false：逻辑分支侧（direction 字段是否消费） */
  readonly supportsSides: boolean;
  /** mind true / org false：分支色（lineColor 字段是否消费） */
  readonly supportsLineColor: boolean;
  /** 连线宽度（mind 4 / org 2——绘制与预览同源） */
  readonly connectorLineWidth: number;
  /** 连线兜底色（mind = 分支色兜底；org 恒 ORG_LINE——节点无 lineColor） */
  readonly connectorFallback: string;
  readonly style: ITreeStyle;
  readonly defaultRootText: string;
  defaultChildText(n: number): string;
  layout(o: TreeOrientation): ITreeLayout;
  connector(o: TreeOrientation): ITreeConnector;
  nav(o: TreeOrientation): ITreeNav;
  drop(o: TreeOrientation): ITreeDrop;
}

/** type → kind 单源（family 'tree' 的类型集由 WIDGET_REGISTRY 派生锁定） */
export const TREE_KINDS = {
  MIND_MAP: mindKind,
  ORG_CHART: orgKind,
} as const satisfies Record<TreeWidgetType, ITreeKind>;

type AssertNever<T extends never> = T;
/** TREE_KINDS 键集与注册表树类型集双向对齐（编译期即红） */
export type _TreeKindsMatchRegistry = AssertNever<
  | Exclude<keyof typeof TREE_KINDS, TreeWidgetType>
  | Exclude<TreeWidgetType, keyof typeof TREE_KINDS>
>;

/** 防御性取 kind（正常装配路径 vm/model 必有注册；null 只用于防御，不静默兜底） */
export function treeKindOf(type: string): ITreeKind | null {
  return (TREE_KINDS as Record<string, ITreeKind | undefined>)[type] ?? null;
}

/** 树形图种类选项（specs §10.1：只给工具坞类型菜单——脑图/组织架构；
 *  id 即 CursorMode（'mind'/'org'，D9：不引入 'tree' 模式） */
export const TREE_KIND_OPTIONS = [
  { id: 'mind', label: '脑图', icon: 'mindmap' },
  { id: 'org', label: '组织架构', icon: 'orgchart' },
] as const;
