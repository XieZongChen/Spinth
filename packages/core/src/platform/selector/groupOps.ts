import { generateKeyBetween } from 'fractional-indexing';
import { unionRects, type IRect } from '../../common/geometry';
import { type ILayerChange, type ILayerItem } from '../layer/layerOps';

/**
 * 编组纯逻辑（docs/18，2026-10-17 四点拍板：成员挂 groupId 无容器元素、
 * 参考框选口径整组全入框、Alt+点击进组、仅自由元素）。
 * 与 alignOps/layerOps 同款纪律：无状态纯函数，同输入同输出（docs/14 规则 3）。
 * 组籍与成员查找由调用方注入（groupService 从 engine 现算，命令频率 O(n)
 * 可接受；marquee 按手势建一次索引，docs/18 §4.3）。
 * 组消解规则（docs/18 §2）：存活成员 ≤1 的组语义自然失效——membersOf 只返回
 * 存活成员；对单员组，扩展=自身、切换=单 id，各函数不特判即天然正确
 * （filterMarqueeByGroups 例外——框选「全含」比「相交」严，单员组若走组
 * 口径会从「相交即选」变严为「全含才选」，故显式按无组处理）。
 */

/** id → groupId（无组 = undefined） */
export type GroupOf = (id: string) => string | undefined;
/** groupId → 存活成员 id（zOrder 序——选中顺序语义约束，调用方保证） */
export type MembersOf = (groupId: string) => string[];

/** 框选全含判定：inner 四边都在 outer 内。AABB 口径——旋转元素用世界
 *  getBounds 包围盒，与框选命中（getVmByRect）同源 */
function marqueeContains(outer: IRect, inner: IRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** 点击扩展（docs/18 §4.1）：输入逐 id，组员替换为组存活成员全集（membersOf
 *  的 zOrder 序），同组重复输入只展开一次；输出去重保序 */
export function expandIdsToGroups(ids: string[], groupOf: GroupOf, membersOf: MembersOf): string[] {
  const out: string[] = [];
  const seenIds = new Set<string>();
  const seenGroups = new Set<string>();
  for (const id of ids) {
    const g = groupOf(id);
    if (g && !seenGroups.has(g)) {
      seenGroups.add(g);
      for (const m of membersOf(g)) {
        if (!seenIds.has(m)) {
          seenIds.add(m);
          out.push(m);
        }
      }
    } else if (!g && !seenIds.has(id)) {
      seenIds.add(id);
      out.push(id);
    }
  }
  return out;
}

/** shift 加/减选的组原子切换（docs/18 §4.2）：命中组员时，该组任一成员在选
 *  → 整组移除（含 Alt 单选在选的残留成员——不留给选区半组中间态）；全不在
 *  选 → 整组加入（**只扩展命中组**，不重扩选区里 Alt 单选的其他组成员——
 *  进入组状态是用户显式意图，无关切换不得抹掉）。无组命中 = 普通单 id 切换 */
export function toggleIdWithGroups(
  ids: string[],
  hitId: string,
  groupOf: GroupOf,
  membersOf: MembersOf,
): string[] {
  const g = groupOf(hitId);
  if (!g) {
    return ids.includes(hitId) ? ids.filter((i) => i !== hitId) : [...ids, hitId];
  }
  const members = membersOf(g);
  const memberSet = new Set(members);
  const anyIn = ids.some((i) => memberSet.has(i));
  if (anyIn) return ids.filter((i) => !memberSet.has(i));
  return [...ids, ...members];
}

/** 框选口径（docs/18 §4.3，参考）：组全部存活成员 bounds 落入框内才整组
 *  保留，否则该组整体剔除（半组命中不算）；无组与单员组照旧相交即选。
 *  全含 ⇒ 相交：保留时直接用成员全集（即便个别成员未进 hitIds，防上游
 *  命中口径与本过滤漂移出半组） */
export function filterMarqueeByGroups(
  hitIds: string[],
  marquee: IRect,
  boundsOf: (id: string) => IRect,
  groupOf: GroupOf,
  membersOf: MembersOf,
): string[] {
  const out: string[] = [];
  const seenGroups = new Set<string>();
  for (const id of hitIds) {
    const g = groupOf(id);
    if (!g) {
      out.push(id);
      continue;
    }
    if (seenGroups.has(g)) continue;
    seenGroups.add(g);
    const members = membersOf(g);
    if (members.length <= 1) {
      out.push(id); // 单员组语义消解，视同无组（相交即选）
      continue;
    }
    const allIn = members.every((m) => marqueeContains(marquee, boundsOf(m)));
    if (allIn) out.push(...members);
  }
  return out;
}

/** 对齐/分布参与体的组折叠（docs/18 §5）：**整组在集**才折叠为单参与体
 *  （bounds = 成员 union，命令层把 delta 同值摊回每成员——相对位置不变）；
 *  部分在集（Alt 进组）的成员按单体参与——参考语义：组内选择 = 个体 */
export interface ICollapsedPart<P> {
  /** 折叠组参与体的 groupId；单体参与体无 */
  groupId?: string;
  /** 参与体包围盒：单体 = 自身 bounds；组 = 成员 union */
  bounds: IRect;
  /** 成员参与体（单体 = [自身]；组 = 全部成员，保持输入序） */
  members: P[];
}

export function collapseGroupParticipants<P extends { id: string; bounds: IRect }>(
  parts: P[],
  groupOf: GroupOf,
  membersOf: MembersOf,
): ICollapsedPart<P>[] {
  const out: ICollapsedPart<P>[] = [];
  const byGroup = new Map<string, ICollapsedPart<P>>();
  const partIds = new Set(parts.map((p) => p.id));
  for (const p of parts) {
    const g = groupOf(p.id);
    const members = g ? membersOf(g) : [];
    // 整组在集才折叠（≥2 存活成员且全部参与）
    const whole = !!g && members.length >= 2 && members.every((m) => partIds.has(m));
    if (!whole) {
      out.push({ bounds: p.bounds, members: [p] });
      continue;
    }
    let entry = byGroup.get(g!);
    if (!entry) {
      entry = { groupId: g!, bounds: p.bounds, members: [] };
      byGroup.set(g!, entry);
      out.push(entry);
    }
    entry.members.push(p);
    entry.bounds = unionRects([entry.bounds, p.bounds]) ?? entry.bounds;
  }
  return out;
}

/** 建组校验（docs/18 §3.1）：可组性谓词由调用方注入（类型能力位 groupable +
 *  LINE 锚定态运行时判定，groupService 单源）；选中集须**全部**可组才建组，
 *  混入不可组元素整命令拒绝——不部分建组 */
export function partitionGroupable(
  ids: string[],
  isGroupable: (id: string) => boolean,
): { groupable: string[]; rejected: string[] } {
  const groupable: string[] = [];
  const rejected: string[] = [];
  for (const id of ids) (isGroupable(id) ? groupable : rejected).push(id);
  return { groupable, rejected };
}

/** 解组涉及组（docs/18 §3.2）：选中集出现的去重 groupId（首次出现序）。
 *  口径：任一成员在选即整组解（参考——Alt 单选一名成员也算涉及） */
export function collectInvolvedGroupIds(ids: string[], groupOf: GroupOf): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const g = groupOf(id);
    if (g && !seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

/** 建组 zOrder 归拢（docs/18 §3.3）：成员移到**连续区段**（保持相对序），
 *  置于原成员最高 zOrder 处——不归拢则「组移到顶层」后成员仍与其他元素
 *  夹层（成员 z 1、3 夹外元素 2）。夹在成员间的非成员被压到块下方（参考
 *  编组同款：组占据最高成员的层位）。数学与 layerOps 置顶同源
 *  （generateKeyBetween 链），边界 = 最高成员两侧最近的非成员 key */
export function computeGroupZOrderContraction(
  items: ILayerItem[],
  memberIds: string[],
): ILayerChange[] {
  const memberSet = new Set(memberIds);
  const members = items
    .filter((i) => memberSet.has(i.id))
    .sort((a, b) => (a.zOrder < b.zOrder ? -1 : 1));
  if (members.length < 2) return []; // 单成员无从夹层，零变更省写
  const top = members[members.length - 1]!;
  const others = items.filter((i) => !memberSet.has(i.id));
  const above =
    others.filter((o) => o.zOrder > top.zOrder).sort((a, b) => (a.zOrder < b.zOrder ? -1 : 1))[0]
      ?.zOrder ?? null;
  const below =
    others.filter((o) => o.zOrder < top.zOrder).sort((a, b) => (a.zOrder > b.zOrder ? -1 : 1))[0]
      ?.zOrder ?? null;
  const changes: ILayerChange[] = [];
  let cursor = below;
  for (const m of members) {
    const key = generateKeyBetween(cursor, above);
    changes.push({ id: m.id, zOrder: key });
    cursor = key;
  }
  return changes;
}
