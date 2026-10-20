import * as Y from 'yjs';
import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { MindMapSchema, type MindMapData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';
import { MindNodeModel } from './mindNodeModel';
import type { INavNode } from './mindNav';

/** 创建/模板用的纯 JSON 节点树 */
export interface IMindNodeSpec {
  text: string;
  direction?: 'left' | 'right';
  /** 分支色（hex）。仅根的直接子节点由 buildYTree 按位分配；深层沿父链继承。
   *  序列化透传（yTreeToSpec）——拖拽搬移子树不丢色 */
  lineColor?: string;
  children?: IMindNodeSpec[];
}

/**
 * 分支色板（docs/11 §2，既有设计脑图核心视觉语言：每个一级分支一个颜色，深层继承）。
 * 曾只定义未消费——全图连线/描边退化灰色（2026-09 样式审查实锤）。
 * 饱和度取中：浅色画布不刺眼、暗色画布足够亮。
 */
export const BRANCH_COLORS = [
  '#e0559c',
  '#3e8bff',
  '#2fa96e',
  '#e8843c',
  '#7c5cfc',
  '#0fb5a6',
] as const;

/** 第 i 个一级分支的分支色（越界循环取色） */
export function branchColorAt(index: number): string {
  const i = ((index % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length;
  return BRANCH_COLORS[i]!;
}

/** 根层新分支取色：从 preferIndex 位起取色板中第一个未被现有一级分支占用的色
 *  （撞色规避——按位取色在中间插入时会与既有兄弟同色，2026-09-20 收口）；
 *  色板全被占用（一级分支 > 6 个）则循环复用按位色 */
export function nextBranchColor(existing: ReadonlySet<string>, preferIndex: number): string {
  for (let i = 0; i < BRANCH_COLORS.length; i++) {
    const c = branchColorAt(preferIndex + i);
    if (!existing.has(c)) return c;
  }
  return branchColorAt(preferIndex);
}

/**
 * 脑图数据层（docs/11 §2/§3）：MIND_MAP 是 widgets 数组成员（整图一个 widget），
 * 树存 root Y.Map 内（节点不占 widget 类型/zOrder——4.1 决策）。
 * MindNodeModel 承担增量树同步；本类只持根引用与 JSON↔Y 树转换。
 */
export class MindMapModel extends BaseModel<MindMapData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.MIND_MAP.capabilities; // 注册表单源（Batch 2 第二刀）

  protected readonly schema = MindMapSchema as unknown as z.ZodType<MindMapData & IRect>;

  private rootNode: MindNodeModel | null = null;

  constructor(processor: DataProcessor) {
    super(processor);
  }

  /** 增量树模型（Vm 消费 childrenChange$）；延迟构建——yData 就绪后首次调用 */
  get root(): MindNodeModel {
    if (!this.rootNode) {
      const yRoot = this.yData.get('root') as Y.Map<unknown> | undefined;
      if (!yRoot) throw new Error('[MindMapModel] yData 缺 root');
      this.rootNode = new MindNodeModel(yRoot);
    }
    return this.rootNode;
  }

  hasRoot(): boolean {
    return !!this.yData.get('root');
  }

  override initialize(data: MindMapData & IRect): Y.Map<unknown> {
    // root JSON 树 → Y.Map 树（创建路径）；rect 等其余字段走 processor.create
    const { root: rootSpec, ...rest } = data as MindMapData & IRect & { root?: IMindNodeSpec };
    const yMap = super.initialize(rest as MindMapData & IRect);
    if (rootSpec) {
      this.processor.transact(() => {
        yMap.set('root', buildYTree(this.processor, rootSpec));
      });
    }
    return yMap;
  }
}

/** JSON 树 → 嵌套 Y.Map（id 此处生成：树内节点 id 不走 widgets 语义） */
export function buildYTree(processor: DataProcessor, spec: IMindNodeSpec): Y.Map<unknown> {
  return buildYNodeY(processor, spec, 0, 0);
}

function buildYNodeY(
  processor: DataProcessor,
  spec: IMindNodeSpec,
  depth: number,
  index: number,
): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const children = new Y.Array<Y.Map<unknown>>();
  processor.transact(() => {
    m.set('id', `mn-${Math.random().toString(36).slice(2, 10)}`);
    m.set('text', spec.text);
    if (spec.direction) m.set('direction', spec.direction);
    // 分支色：根的直接子节点按位分配；spec 自带（拖拽搬移）优先；深层不落盘走继承
    const lineColor = spec.lineColor ?? (depth === 1 ? branchColorAt(index) : undefined);
    if (lineColor) m.set('lineColor', lineColor);
    for (const [i, c] of (spec.children ?? []).entries()) {
      children.push([buildYNodeY(processor, c, depth + 1, i)]);
    }
    m.set('children', children);
  });
  return m;
}

/** Y 树 → JSON（复制/模板用；4.4 move 的序列化搬移同源）。lineColor 透传——搬移子树不丢色 */
export function yTreeToSpec(yNode: Y.Map<unknown>): IMindNodeSpec {
  const out: IMindNodeSpec = { text: String(yNode.get('text') ?? '') };
  const dir = yNode.get('direction');
  if (dir === 'left' || dir === 'right') out.direction = dir;
  const lc = yNode.get('lineColor');
  if (typeof lc === 'string') out.lineColor = lc;
  const kids = (yNode.get('children') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? [];
  if (kids.length > 0) out.children = kids.map(yTreeToSpec);
  return out;
}

/** 沿父链取侧向（direction 仅根的直接子节点有，深层继承——docs/11 §2；
 *  自 mindService 收单源，拖拽落点判定与焦点槽位共用） */
export function nodeDirection(node: MindNodeModel): 'left' | 'right' {
  let n: MindNodeModel | null = node;
  while (n) {
    const d = n.toJSON().direction;
    if (d === 'left' || d === 'right') return d;
    n = n.getParent();
  }
  return 'right';
}

/** 按 id 深度优先找节点。id 为 null/空 = 回退根（调用方以「无焦点 → 根」语义消费，
 *  故 falsy 不视为「找不到」——框选/跨图排除逻辑依赖此回退，改前先核对调用方） */
export function findMindNode(root: MindNodeModel, id: string | null): MindNodeModel | null {
  if (!id) return root;
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findMindNode(c, id);
    if (f) return f;
  }
  return null;
}

/** 从 Model 树构建轻量导航树（parent 反向引用 + id 索引一次建好；MindService
 *  私有辅助自 2026-10-06 批刀 1 收单源至此——节点操作与导航共用同一棵树） */
export function buildNavTree(root: MindNodeModel): { root: INavNode; byId: Map<string, INavNode> } {
  const byId = new Map<string, INavNode>();
  const build = (n: MindNodeModel, parent: INavNode | null): INavNode => {
    const dir = n.toJSON().direction;
    const node: INavNode = { id: n.id, direction: dir, parent, children: [] };
    byId.set(n.id, node);
    node.children = n.children.map((c) => build(c, node));
    return node;
  };
  return { root: build(root, null), byId };
}
