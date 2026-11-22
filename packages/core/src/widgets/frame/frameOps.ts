/**
 * 容器归属纯逻辑（specs/container-frame §2.4/§4.3/§6.4）：归属三态判定、
 * 级联展开、zOrder 钳制、剪贴板 parentId 桶重映射、框选归并——全部纯函数，
 * 无服务依赖，单测直测。服务层（FrameService）只做读取与落库编排。
 */
import { generateKeyBetween } from 'fractional-indexing';
import { rectsIntersect, type IRect } from '../../common/geometry';
import type { IFrameLookup } from '../../types';

/** 归属判定结果：string = 设父；undefined = 清父；null = 不改（§2.4） */
export type ParentUpdate = string | undefined | null;

/** 全含判据：inner 的 AABB 完全落在 outer 的 AABB 内（等值边界算含） */
export function fullyContains(outer: IRect, inner: IRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * 归属三态判定（§2.4——**顺序即语义，不得重排**）：
 * 1. 仍全含于当前父 → null（原地不动，即使别的容器也全含——滞回区起点）
 * 2. 全含容器中 zOrder 最上者 → 该 id（与当前父相同则 null）
 * 3. 完全离开当前父（不相交且不全含）→ undefined（唯一脱离条件）
 * 4. 其余（相交但不全含）→ null（保持原状）
 * parentRect null = 父已删/被隔离/非容器（孤儿即顶层，读取侧降级，§2.5）——
 * 规则 1/3 都不触发，仅规则 2 可换父。
 */
export function resolveParentUpdate(args: {
  parentId: string | undefined;
  parentRect: IRect | null;
  selfRect: IRect;
  /** 全部存活容器（id + zOrder + AABB；不含自身） */
  frames: ReadonlyArray<{ id: string; zOrder: string; rect: IRect }>;
}): ParentUpdate {
  const { parentId, parentRect, selfRect, frames } = args;
  if (parentId && parentRect && fullyContains(parentRect, selfRect)) return null;
  const containing = frames.filter((f) => fullyContains(f.rect, selfRect));
  if (containing.length > 0) {
    const top = containing.reduce((a, b) => (a.zOrder > b.zOrder ? a : b));
    return top.id === parentId ? null : top.id;
  }
  if (parentId && parentRect && !rectsIntersect(parentRect, selfRect)) return undefined;
  return null;
}

/** 级联展开（§4.4）：容器 → 并入全部存活子元素（Set 去重保插入序；
 *  非容器原样保留——[frame, child, child] 不得重复 commit 是 §6.6-7 陷阱） */
export function expandContainers(ids: string[], frames: IFrameLookup): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
    if (!frames.isFrame(id)) continue;
    for (const child of frames.childIds(id)) {
      if (!seen.has(child)) {
        out.push(child);
        seen.add(child);
      }
    }
  }
  return out;
}

/**
 * 容器 key 钳制（I3）：容器 zOrder 必须 < 全部子元素 key，否则容器盖住子元素
 * 后点击全被容器吃掉。无需调整返回 null；需要时返回新 key（紧贴最小子 key
 * 之下、且落在「minChild 之下最近的既有 key」与 minChild 之间——不与任何
 * 既有 key 冲突）。items 须为**变更后**的 zOrder 表（调用方算术叠加，§4.8）。
 */
export function clampFrameZOrder(
  items: ReadonlyArray<{ id: string; zOrder: string }>,
  frameId: string,
  childIds: string[],
): string | null {
  const frame = items.find((i) => i.id === frameId);
  if (!frame || childIds.length === 0) return null;
  const byId = new Map(items.map((i) => [i.id, i.zOrder] as const));
  let minChild: string | null = null;
  for (const c of childIds) {
    const z = byId.get(c);
    if (z === undefined) continue; // 子不在此表（已删/异常）——跳过不猜
    if (minChild === null || z < minChild) minChild = z;
  }
  if (minChild === null || frame.zOrder < minChild) return null;
  let lower: string | null = null;
  for (const i of items) {
    if (i.id === frameId) continue;
    if (i.zOrder < minChild && (lower === null || i.zOrder > lower)) lower = i.zOrder;
  }
  return generateKeyBetween(lower, minChild);
}

/**
 * 剪贴板 parentId 桶重映射（§4.7，groupIdMap 先例）：新 id → 新 parentId。
 * 批内旧父 → 该容器的新 id（一拷贝一容器）；批外父 → undefined（落为顶层
 * ——复制了子没复制容器）；无父快照不入表（消费侧不动该键）。
 */
export function remapParentIds(
  snapshots: ReadonlyArray<{ id: string; parentId?: string }>,
  idMap: ReadonlyMap<string, string>,
): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const { id, parentId } of snapshots) {
    if (!parentId) continue;
    const newId = idMap.get(id);
    if (!newId) continue;
    out.set(newId, idMap.get(parentId));
  }
  return out;
}

/**
 * 框选容器归并（§4.3，顺序固定）：组过滤后并列调用。
 * 1. 全含才入选（fullyContains(marquee, f.rect)），半含剔除；
 * 2. 容器子元素里有选中组成员 → 容器不入选（不拆组——容器移动会带走组员，
 *    组外成员不动；组是选择层、容器是几何层，几何归属优先）；
 * 3. 入选容器的子元素从结果剔除（子随容器走）；
 * 4. 其余元素保持原序。
 */
export function mergeFramesIntoSelection(args: {
  /** 组过滤后的命中（zOrder 降序，getVmByRect 的稳定序） */
  ids: string[];
  marquee: IRect;
  frames: ReadonlyArray<{ id: string; rect: IRect }>;
  childIdsOf: (frameId: string) => string[];
  /** 本次结果涉及的、存活成员 ≥2 的组的全部成员（GroupService 提供） */
  groupedIds: ReadonlySet<string>;
}): string[] {
  const { ids, marquee, frames, childIdsOf, groupedIds } = args;
  if (frames.length === 0) return ids;
  const accepted = new Set<string>();
  const drop = new Set<string>();
  for (const f of frames) {
    if (!fullyContains(marquee, f.rect)) continue; // 半含剔除
    if (childIdsOf(f.id).some((c) => groupedIds.has(c))) continue; // 不拆组
    accepted.add(f.id);
    for (const c of childIdsOf(f.id)) drop.add(c);
  }
  // 半含容器剔除由下方 frameById 分支统一处理（无入选时也生效）
  const frameById = new Map(frames.map((f) => [f.id, f] as const));
  const out: string[] = [];
  for (const id of ids) {
    if (frameById.has(id)) {
      if (accepted.has(id)) out.push(id);
      continue; // 半含/不拆组容器剔除
    }
    if (drop.has(id)) continue; // 入选容器子元素剔除（子随容器走）
    out.push(id);
  }
  return out;
}
