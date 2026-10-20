import * as Y from 'yjs';
import { Disposable } from '../../base/disposable';
import type { IDataEngineService, IHistoryService, ISelectorService } from '../../types';
import type { MindMapVm } from './mindMapVm';
import type { MindNodeModel } from './mindNodeModel';
import type { MindMapModel, IMindNodeSpec } from './mindMapModel';
import { nextBranchColor, findMindNode, buildNavTree } from './mindMapModel';
import { rootInsertSide, focusAfterDelete } from './mindNav';
import type { IDropTarget } from './dropArea';

/**
 * 脑图树写 + 节点操作协作者（自 mindService 拆出，2026-10-06 批刀 1）：
 * Yjs 树结构变更域——Tab/Enter/Delete 节点操作（addChild/addSibling/deleteFocused）、
 * 拖拽松手落库（move 序列化重建 / removeNode / buildFromSpec）与一级分支取色。
 * 无自有状态（纯写编排，零订阅零监听）；焦点归属经 host 回调交还宿主。
 */

/** MindService ↔ 树写域的边界：焦点态读取与写入（含广播/视窗跟随）留在服务侧 */
export interface IMindTreeOpsHost {
  getFocused(): { vm: MindMapVm; mapModel: MindMapModel; node: MindNodeModel } | null;
  setFocusedNode(id: string | null): void;
}

/** move 的入参结构子集（拖拽会话状态满足结构兼容，刀 2 拆出后同源） */
export interface IMindMoveSource {
  /** 拖起的源脑图 id */
  mapId: string;
  /** 拖起节点 id */
  nodeId: string;
  /** 节点 JSON 快照（序列化重建的源） */
  spec: IMindNodeSpec;
  /** 命中目标所属脑图（跨图拖拽用；null = 未命中/与源图相同） */
  lastTargetMapId: string | null;
}

/**
 * 新节点默认文案（既有设计 mindController.insertChild：`子节点 ${count + 1}`，
 * count = 父节点当前子数）。带占位文案的节点让「建完直接打字替换」有落点，
 * 也避免空文本节点渲染成一个看不出是什么的小方块。
 */
export function defaultNodeText(siblingCount: number): string {
  return `子节点 ${siblingCount + 1}`;
}

/** 单节点 Y.Map（树内 id 生成；lineColor 仅根的直接子节点按位分配，深层继承） */
function buildYNode(direction?: 'left' | 'right', lineColor?: string, text = ''): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const children = new Y.Array<Y.Map<unknown>>();
  m.set('id', `mn-${Math.random().toString(36).slice(2, 10)}`);
  m.set('text', text);
  if (direction) m.set('direction', direction);
  if (lineColor) m.set('lineColor', lineColor);
  m.set('children', children);
  return m;
}

export class MindTreeOps extends Disposable {
  constructor(
    private readonly engine: IDataEngineService,
    private readonly history: IHistoryService,
    private readonly selector: ISelectorService,
    private readonly host: IMindTreeOpsHost,
  ) {
    super();
  }

  /** Tab / AddButtons：建子节点并聚焦；根下需按侧分配 direction（direction 仅根子有效）。
   *  未显式指定侧向时按既有设计三规则取侧（根自带 direction / 子数<3 取右 / 少的一侧） */
  addChild(direction?: 'left' | 'right'): void {
    const f = this.host.getFocused();
    if (!f) return;
    const { mapModel, node } = f;
    const isRoot = node === mapModel.root;
    const dir = isRoot
      ? (direction ??
        rootInsertSide({
          direction: node.toJSON().direction,
          children: node.children.map((c) => ({ direction: c.toJSON().direction })),
        }))
      : undefined;
    const yChildren = node.yChildList;
    // 根的直接子节点分配分支色（未占用色规避撞色；深层继承，不落盘）
    const color = isRoot
      ? nextBranchColor(this.usedBranchColors(mapModel), yChildren.length)
      : undefined;
    const yChild = buildYNode(dir, color, defaultNodeText(node.children.length));
    yChildren.doc!.transact(() => yChildren.push([yChild]));
    // 聚焦新子
    this.host.setFocusedNode(String(yChild.get('id')));
    this.history.stopCapturing();
  }

  /** Enter / AddButtons：建同级节点（选中态）。根节点上 Enter 退化为建子节点
   *  （既有设计 keyboardEventService：isRoot → insertMindChild，非根 → insertMindAfter） */
  addSibling(): void {
    const f = this.host.getFocused();
    if (!f) return;
    const { node, mapModel } = f;
    if (node === mapModel.root) {
      this.addChild();
      return;
    }
    const parent = node.getParent();
    if (!parent) return;
    const yChildren = parent.yChildList;
    const idx = parent.children.indexOf(node);
    // 根层建同级 = 新的一级分支，取插入位起第一个未占用分支色
    const color =
      parent === mapModel.root
        ? nextBranchColor(this.usedBranchColors(mapModel), idx + 1)
        : undefined;
    const yChild = buildYNode(undefined, color, defaultNodeText(parent.children.length));
    yChildren.doc!.transact(() => yChildren.insert(idx + 1, [yChild]));
    this.host.setFocusedNode(String(yChild.get('id')));
    this.history.stopCapturing();
  }

  /** Delete / AddButtons：删节点（删根 = 删整图）；焦点移到兄弟 */
  deleteFocused(): void {
    const f = this.host.getFocused();
    if (!f) return;
    const { node, mapModel } = f;
    if (node === mapModel.root) {
      this.engine.removeByIds([f.mapModel.id]);
      this.selector.setSelected([]);
      this.host.setFocusedNode(null);
      this.history.stopCapturing();
      return;
    }
    const parent = node.getParent()!;
    const yChildren = parent.yChildList;
    const idx = parent.children.indexOf(node);
    // 焦点落点先按既有设计 getFocusAfterDelete 规则算好（同侧后兄弟 → 前兄弟 →
    // 递归到父；父为根且该侧删空 → 回根），再落库删除——避免删完拿不到兄弟信息
    const navNode = buildNavTree(mapModel.root).byId.get(node.id);
    const nextFocus = navNode ? focusAfterDelete(new Set([node.id]), navNode) : undefined;
    yChildren.doc!.transact(() => yChildren.delete(idx, 1));
    this.host.setFocusedNode(nextFocus?.id ?? null);
    this.history.stopCapturing();
  }

  /** 序列化→删除→反序列化插入（协同安全，docs/11 §6）。
   *  颜色规则：移入根节点分配未占用色、移入普通节点清空继承新父
   *  返回重建后的新节点 id（松手重选用——move 走序列化重建，id 全新生成） */
  move(d: IMindMoveSource, target: IDropTarget): string | null {
    const destMapId = d.lastTargetMapId ?? d.mapId;
    const crossMap = destMapId !== d.mapId;
    const model = this.engine.getModelById(destMapId) as MindMapModel | undefined;
    if (!model?.hasRoot()) return null;
    let newId: string | null = null;
    if (target.kind === 'asChild') {
      const dest = findMindNode(model.root, target.nodeId);
      if (!dest) return null;
      const destChildren = dest.yChildList;
      const isRoot = dest === model.root;
      // 同父内前移补偿（既有设计 mindController.move 的 fixedIndex）：
      // 删除自身会让目标下标左移一位，不补偿就会落到落点指示的后一位
      const self = findMindNode(model.root, d.nodeId);
      const selfParent = self?.getParent() ?? null;
      let insertAt = Math.min(target.index, destChildren.length);
      if (self && selfParent === dest) {
        const cur = dest.children.indexOf(self);
        if (cur >= 0 && cur < insertAt) insertAt -= 1;
      }
      // 颜色规则（既有设计 move Rule 1）：移入根节点且同图、自身带色 → 保留原色；
      // 跨图或自身无色 → 按落位分配未占用色。移入普通节点 → 清空继承新父（Rule 2）
      const color = isRoot
        ? this.rootChildColor(model, d.spec.lineColor, crossMap, insertAt)
        : undefined;
      this.engine.transact(() => {
        this.removeNode(d.mapId, d.nodeId);
        const yNew = this.buildFromSpec(d.spec, target.direction, color);
        destChildren.insert(insertAt, [yNew]);
        newId = String(yNew.get('id'));
      });
    } else {
      const parent = findMindNode(model.root, target.parentId);
      if (!parent) return null;
      const parentChildren = parent.yChildList;
      const insertAt = Math.min(target.index, parentChildren.length);
      const isRoot = parent === model.root;
      const color = isRoot
        ? this.rootChildColor(model, d.spec.lineColor, crossMap, insertAt)
        : undefined;
      this.engine.transact(() => {
        this.removeNode(d.mapId, d.nodeId);
        const yNew = this.buildFromSpec(d.spec, undefined, color);
        // 删除自身后同父长度变短（同父搬移）——insertAt 在删前算的，删后再兜底
        parentChildren.insert(Math.min(insertAt, parentChildren.length), [yNew]);
        newId = String(yNew.get('id'));
      });
    }
    this.history.stopCapturing();
    return newId;
  }

  /** 一级分支落位取色：自身带色且同图 → 保留；否则取未占用色（既有设计 move Rule 1.1/1.2） */
  private rootChildColor(
    model: MindMapModel,
    ownColor: string | undefined,
    crossMap: boolean,
    index: number,
  ): string {
    if (!crossMap && ownColor) return ownColor;
    return nextBranchColor(this.usedBranchColors(model), index);
  }

  /** Y.Map 删节点（找父 children 数组删） */
  removeNode(mapId: string, nodeId: string): void {
    const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
    if (!model?.hasRoot()) return;
    const walk = (node: MindNodeModel): boolean => {
      const yChildren = node.yChildList;
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i]!;
        if (c.id === nodeId) {
          yChildren.delete(i, 1);
          return true;
        }
        if (walk(c)) return true;
      }
      return false;
    };
    walk(model.root);
  }

  /** 从 spec 建 Y.Map 节点（递归）。颜色规则（docs/11 §6）由调用方分派：
   *  lineColor 显式传入（移入根节点分配/根层插入），不传 = 清空继承新父
   *  （曾透传 spec.lineColor——移入普通节点后子树仍显原分支色） */
  private buildFromSpec(
    spec: IMindNodeSpec,
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
    for (const c of spec.children ?? []) children.push([this.buildFromSpec(c, dir)]);
    m.set('children', children);
    return m;
  }

  /** 根层现有一级分支已占用色集（撞色规避取色输入） */
  private usedBranchColors(model: MindMapModel): Set<string> {
    const used = new Set<string>();
    for (const c of model.root.children) {
      const color = c.toJSON().lineColor;
      if (color) used.add(color);
    }
    return used;
  }
}
