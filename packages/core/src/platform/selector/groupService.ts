import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type { IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
} from '../../types';
import {
  collectInvolvedGroupIds,
  computeGroupZOrderContraction,
  expandIdsToGroups,
  filterMarqueeByGroups,
  partitionGroupable,
  toggleIdWithGroups,
} from './groupOps';

/**
 * 编组业务服务（docs/18，2026-10-17 四点拍板）：命令（建组/解组）+ 组籍查询 +
 * 选择层接线的语义包装。组是选择聚合层——拖动/删除/复制/层级等平铺机制
 * 零改动（docs/18 §1）。
 * 组籍无索引：groupOf 单模型 O(1) 读、membersOf O(n) 扫描（点击/命令频率
 * 可接受）；marquee 每帧过滤用手势级一次性索引（createMarqueeFilter）。
 */
export class GroupService extends Disposable {
  constructor(
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private history: IHistoryService,
  ) {
    super();
  }

  /** id → groupId（无组/已删 = undefined；toJSON 实时投影无副本） */
  groupOf(id: string): string | undefined {
    const data = this.engine.getModelById(id)?.toJSON() as { groupId?: string } | undefined;
    return data?.groupId;
  }

  /** groupId → 存活成员（zOrder 序——选中顺序语义，docs/18 §4.1） */
  membersOf(groupId: string): string[] {
    return this.indexMembers().get(groupId) ?? [];
  }

  /** 全量组索引：groupId → 成员（zOrder 序）。命令/一次性索引共用 */
  private indexMembers(): Map<string, string[]> {
    const byGroup = new Map<string, Array<{ id: string; z: string }>>();
    for (const vm of this.vmEngine.getAllVms()) {
      const g = (this.engine.getModelById(vm.id)?.toJSON() as { groupId?: string } | undefined)
        ?.groupId;
      if (!g) continue;
      const list = byGroup.get(g);
      if (list) list.push({ id: vm.id, z: vm.root.zOrder ?? '' });
      else byGroup.set(g, [{ id: vm.id, z: vm.root.zOrder ?? '' }]);
    }
    const out = new Map<string, string[]>();
    for (const [g, list] of byGroup) {
      list.sort((a, b) => (a.z < b.z ? -1 : 1));
      out.set(
        g,
        list.map((o) => o.id),
      );
    }
    return out;
  }

  /** 可组性单源（docs/18 §3.1）：类型能力位 groupable + LINE 锚定态运行时判定 */
  isGroupable(id: string): boolean {
    const model = this.engine.getModelById(id);
    if (!model || !model.capabilities.groupable) return false;
    if (model.toJSON().type === 'LINE') {
      const d = model.toJSON() as { startNodeId?: string | null; endNodeId?: string | null };
      return !d.startNodeId && !d.endNodeId;
    }
    return true;
  }

  // ---------- 选择接线语义包装（selectorService 消费） ----------

  /** 点击扩展（docs/18 §4.1）：组员 → 存活成员全集 */
  expandIds(ids: string[]): string[] {
    return expandIdsToGroups(
      ids,
      (id) => this.groupOf(id),
      (g) => this.membersOf(g),
    );
  }

  /** shift 组原子切换（docs/18 §4.2） */
  toggleIds(ids: string[], hitId: string): string[] {
    return toggleIdWithGroups(
      ids,
      hitId,
      (id) => this.groupOf(id),
      (g) => this.membersOf(g),
    );
  }

  /** marquee 过滤闭包（docs/18 §4.3）：组索引按手势建一次（拖框期间组籍/
   *  成员不变，几何读取走实时 getBounds），过程与松手同口径 */
  createMarqueeFilter(): (hitIds: string[], marquee: IRect) => string[] {
    const byGroup = this.indexMembers();
    const byId = new Map<string, string>();
    for (const [g, members] of byGroup) {
      for (const m of members) byId.set(m, g);
    }
    const boundsOf = (id: string): IRect =>
      this.vmEngine.getVmById(id)?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    const groupOf = (id: string) => byId.get(id);
    const membersOf = (g: string) => byGroup.get(g) ?? [];
    return (hitIds, marquee) =>
      filterMarqueeByGroups(hitIds, marquee, boundsOf, groupOf, membersOf);
  }

  // ---------- 命令（docs/18 §3） ----------

  /** 建组可否（ActionBar 禁用态/快捷键守卫同源）：≥2 且全可组（docs/18 §3.1） */
  canGroupSelection(): boolean {
    const ids = this.selector.selected$.value;
    return ids.length >= 2 && ids.every((id) => this.isGroupable(id));
  }

  /** 建组：新 groupId 覆写（旧组成员改籍）+ zOrder 归拢，单事务一步 undo；
   *  选区不变（docs/18 §3.1）。混入不可组元素整命令拒绝——不部分建组 */
  groupSelection(): void {
    const ids = [...this.selector.selected$.value];
    const { rejected } = partitionGroupable(ids, (id) => this.isGroupable(id));
    if (ids.length < 2 || rejected.length > 0) return;
    const groupId = genId();
    this.engine.transact(() => {
      for (const id of ids) {
        this.engine.getModelById(id)?.update({ groupId } as never);
      }
      // zOrder 归拢（docs/18 §3.3）：连续区段置于原成员最高层
      const items = this.vmEngine.getAllVms().map((vm) => ({
        id: vm.id,
        zOrder: vm.root.zOrder ?? '',
        bounds: vm.getBounds(),
      }));
      for (const c of computeGroupZOrderContraction(items, ids)) {
        this.engine.getModelById(c.id)?.update({ zOrder: c.zOrder } as never);
      }
    });
    this.history.stopCapturing();
  }

  /** 解组可否：选中集涉及任一组（Alt 单选一名成员也算，docs/18 §3.2） */
  canUngroupSelection(): boolean {
    return (
      collectInvolvedGroupIds(this.selector.selected$.value, (id) => this.groupOf(id)).length > 0
    );
  }

  /** 解组：涉及组整组清 groupId（键删除投影），单事务一步 undo；
   *  选区保持原成员集不变（docs/18 §3.2） */
  ungroupSelection(): void {
    const groups = collectInvolvedGroupIds(this.selector.selected$.value, (id) => this.groupOf(id));
    if (groups.length === 0) return;
    this.engine.transact(() => {
      for (const g of groups) {
        for (const m of this.membersOf(g)) {
          this.engine.getModelById(m)?.update({ groupId: undefined } as never);
        }
      }
    });
    this.history.stopCapturing();
  }

  /** ActionBar 组切换单钮单源（docs/18 §3.4，2026-10-17 二轮拍板）：显示
   *  「解组」当且仅当选中集恰为一个整组，或兜底（涉组可解但编组不可行——
   *  否则死按钮）；其余一律「编组」（建组/多组合并/收编/Alt 改籍，参考
   *  Cmd+G 同款意图——点完选中恰成一整组，按钮随之翻「解组」）。
   *  禁用 = 编组态且不可组（含脑图/锚定线且不涉组，参考「显示但禁用」同款） */
  getGroupActionState(): { id: 'group' | 'ungroup'; disabled: boolean } {
    const ids = this.selector.selected$.value;
    const canGroup = ids.length >= 2 && ids.every((id) => this.isGroupable(id));
    const involved = collectInvolvedGroupIds(ids, (id) => this.groupOf(id));
    const canUngroup = involved.length > 0;
    // 「恰为一整个组」：唯一涉及组，且选中集 === 该组存活成员全集
    let exactlyOneWholeGroup = false;
    if (involved.length === 1) {
      const members = new Set(this.membersOf(involved[0]!));
      exactlyOneWholeGroup = ids.length === members.size && ids.every((id) => members.has(id));
    }
    const id = exactlyOneWholeGroup || (canUngroup && !canGroup) ? 'ungroup' : 'group';
    return { id, disabled: id === 'group' ? !canGroup : !canUngroup };
  }
}
