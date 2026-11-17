import { Disposable } from '../../../base/disposable';
import type { IDataEngineService, IHistoryService, ISelectorService } from '../../../types';
import type { TreeMapVm } from './../vm/treeMapVm';
import type { TreeNodeModel } from './../model/treeNodeModel';
import type { TreeMapModel, IMindNodeSpec } from './../model/treeMapModel';
import { nextBranchColor, findMindNode, buildNavTree } from './../model/treeMapModel';
import { projectSpecFor } from './../model/treeSpec';
import { rootInsertSide } from './../nav/mind';
import type { IDropTarget } from './../drop/dropArea';
import type { TreeOrientation } from '../../../types/tree';
import { buildFromSpec, buildYNode, rootChildColor, usedBranchColors } from './treeOpsNodes';

/**
 * 脑图树写 + 节点操作协作者（自 treeService 拆出，2026-10-06 批刀 1）：
 * Yjs 树结构变更域——Tab/Enter/Delete 节点操作（addChild/addSibling/deleteFocused）、
 * 拖拽松手落库（move 序列化重建 / removeNode / buildFromSpec）与一级分支取色。
 * 无自有状态（纯写编排，零订阅零监听）；焦点归属经 host 回调交还宿主。
 */

/** TreeService ↔ 树写域的边界：焦点态读取与写入（含广播/视窗跟随）留在服务侧 */
export interface ITreeOpsHost {
  getFocused(): { vm: TreeMapVm; mapModel: TreeMapModel; node: TreeNodeModel } | null;
  setFocusedNode(id: string | null): void;
}

/** move 的入参结构子集（拖拽会话状态满足结构兼容，刀 2 拆出后同源） */
export interface ITreeMoveSource {
  /** 拖起的源脑图 id */
  mapId: string;
  /** 拖起节点 id */
  nodeId: string;
  /** 节点 JSON 快照（序列化重建的源） */
  spec: IMindNodeSpec;
  /** 命中目标所属脑图（跨图拖拽用；null = 未命中/与源图相同） */
  lastTargetMapId: string | null;
}

export class TreeOps extends Disposable {
  constructor(
    private readonly engine: IDataEngineService,
    private readonly history: IHistoryService,
    private readonly selector: ISelectorService,
    private readonly host: ITreeOpsHost,
  ) {
    super();
  }

  /** Tab / AddButtons：建子节点并聚焦；根下需按侧分配 direction（direction 仅根子有效）。
   *  未显式指定侧向时按既有设计三规则取侧（根自带 direction / 子数<3 取右 / 少的一侧） */
  addChild(direction?: 'left' | 'right'): void {
    const f = this.host.getFocused();
    if (!f) return;
    const { mapModel, node } = f;
    const kind = mapModel.kind;
    const isRoot = node === mapModel.root;
    // kind 能力位（审查返工 P0-4）：org 不写 direction/lineColor——文案/侧向/
    // 分支色全部经 kind（org「成员 N」、恒无侧无色），mind 行为不变
    const dir =
      isRoot && kind.supportsSides
        ? (direction ??
          rootInsertSide({
            direction: node.toJSON().direction,
            children: node.children.map((c) => ({ direction: c.toJSON().direction })),
          }))
        : undefined;
    const yChildren = node.yChildList;
    // 根的直接子节点分配分支色（未占用色规避撞色；深层继承，不落盘）
    const color =
      isRoot && kind.supportsLineColor
        ? nextBranchColor(usedBranchColors(mapModel), yChildren.length)
        : undefined;
    const yChild = buildYNode(dir, color, kind.defaultChildText(node.children.length));
    yChildren.doc!.transact(() => {
      yChildren.push([yChild]);
      // 折叠节点上建子：同一事务展开，新节点可见（仍一步撤销，specs §4.5）
      if (node.isCollapsed()) node.yMap.set('collapsed', false);
    });
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
    // 根层建同级 = 新的一级分支，取插入位起第一个未占用分支色（kind 守卫）
    const color =
      parent === mapModel.root && mapModel.kind.supportsLineColor
        ? nextBranchColor(usedBranchColors(mapModel), idx + 1)
        : undefined;
    const yChild = buildYNode(
      undefined,
      color,
      mapModel.kind.defaultChildText(parent.children.length),
    );
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
    // 焦点落点经 kind 导航策略（审查返工 P1-8：org 用 后兄弟→前→父、
    // 不跨叔；mind 用侧向过滤版——此前 org 走 mind 碰巧兼容）
    const nav = buildNavTree(mapModel.root);
    const navNode = nav.byId.get(node.id);
    const nextFocus = navNode
      ? mapModel.kind.nav(mapModel.kind.defaultOrientation).focusAfterDelete(node.id, nav)
      : null;
    yChildren.doc!.transact(() => yChildren.delete(idx, 1));
    this.host.setFocusedNode(nextFocus);
    this.history.stopCapturing();
  }

  /** 序列化→删除→反序列化插入（协同安全，docs/11 §6）。
   *  颜色规则：移入根节点分配未占用色、移入普通节点清空继承新父
   *  返回重建后的新节点 id（松手重选用——move 走序列化重建，id 全新生成） */
  move(d: ITreeMoveSource, target: IDropTarget): string | null {
    const destMapId = d.lastTargetMapId ?? d.mapId;
    const crossMap = destMapId !== d.mapId;
    const model = this.engine.getModelById(destMapId) as TreeMapModel | undefined;
    if (!model?.hasRoot()) return null;
    // 跨种类投影（specs §4.3）：mind→org 剥 direction/lineColor；org→mind
    // 落根层按落点侧/分配色写入。同 kind 时透传（org→org 也剥侧向冗余）
    const destKind = model.kind.type;
    const project = (direction?: 'left' | 'right', lineColor?: string): IMindNodeSpec =>
      projectSpecFor(destKind, d.spec, { direction, lineColor });
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
      const color =
        isRoot && model.kind.supportsLineColor
          ? rootChildColor(model, d.spec.lineColor, crossMap, insertAt)
          : undefined;
      this.engine.transact(() => {
        this.removeNode(d.mapId, d.nodeId);
        const yNew = buildFromSpec(project(target.direction, color), target.direction, color);
        destChildren.insert(insertAt, [yNew]);
        // 折叠节点作为 asChild 目标：同事务展开（specs §8.3），仍一步撤销
        if (dest.isCollapsed()) dest.yMap.set('collapsed', false);
        newId = String(yNew.get('id'));
      });
    } else {
      const parent = findMindNode(model.root, target.parentId);
      if (!parent) return null;
      const parentChildren = parent.yChildList;
      const insertAt = Math.min(target.index, parentChildren.length);
      const isRoot = parent === model.root;
      const color =
        isRoot && model.kind.supportsLineColor
          ? rootChildColor(model, d.spec.lineColor, crossMap, insertAt)
          : undefined;
      this.engine.transact(() => {
        this.removeNode(d.mapId, d.nodeId);
        const yNew = buildFromSpec(project(undefined, color), undefined, color);
        // 删除自身后同父长度变短（同父搬移）——insertAt 在删前算的，删后再兜底
        parentChildren.insert(Math.min(insertAt, parentChildren.length), [yNew]);
        newId = String(yNew.get('id'));
      });
    }
    this.history.stopCapturing();
    return newId;
  }

  /** 切换排列物理轴（specs §4.4）：只写图字段 orientation，一个事务一步撤销，
   *  不重写任何节点（direction 恒逻辑侧）；kind 不支持的档位与同值 no-op */
  setOrientation(mapId: string, orientation: TreeOrientation): void {
    const model = this.engine.getModelById(mapId) as TreeMapModel | undefined;
    // kind 防御（审查返工 P0-1）：非树模型无 kind——命令层已守卫，这里兜底
    if (!model?.kind) return;
    if (!model.kind.orientations.includes(orientation)) return;
    if (model.yData.get('orientation') === orientation) return;
    model.yData.doc!.transact(() => model.yData.set('orientation', orientation));
    this.history.stopCapturing();
  }

  /** 折叠/展开（specs/tree-diagrams §4.5，D5 入文档）：一次切换一步撤销。
   *  no-op：节点不存在 / 无子节点（不写 collapsed:true，避免空徽标）/ 同值。
   *  折叠时焦点在隐藏后代 → 焦点移到被折叠节点（显式，不等 getFocused 自愈）。 */
  setCollapsed(mapId: string, nodeId: string, next: boolean): void {
    const model = this.engine.getModelById(mapId) as TreeMapModel | undefined;
    if (!model?.hasRoot()) return;
    const node = findMindNode(model.root, nodeId);
    if (!node || node.children.length === 0) return;
    if (node.isCollapsed() === next) return;
    node.yMap.doc!.transact(() => node.yMap.set('collapsed', next));
    if (next) {
      // 焦点在隐藏后代：移到折叠节点（沿父链判定，不做全树扫描）
      const f = this.host.getFocused();
      let n = f && f.mapModel === model ? f.node : null;
      while (n && n !== node) n = n.getParent();
      if (n === node && f && f.node !== node) this.host.setFocusedNode(node.id);
    }
    this.history.stopCapturing();
  }

  /** Y.Map 删节点（找父 children 数组删） */
  removeNode(mapId: string, nodeId: string): void {
    const model = this.engine.getModelById(mapId) as TreeMapModel | undefined;
    if (!model?.hasRoot()) return;
    const walk = (node: TreeNodeModel): boolean => {
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
}
