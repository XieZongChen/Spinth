import { generateKeyBetween } from 'fractional-indexing';
import { rectsIntersect, type IRect } from '../../common/geometry';

/**
 * 图层操作纯逻辑（docs/02 §2 zOrder + 既有设计 LayerService 语义）。
 * zOrder 是 fractional indexing 字符串：调整层级 = 只改目标元素的 key，无冲突、免重排。
 */

export interface ILayerItem {
  id: string;
  zOrder: string;
  bounds: IRect;
}

export type LayerOp = 'front' | 'back' | 'forward' | 'backward';

export interface ILayerChange {
  id: string;
  zOrder: string;
}

/**
 * 置顶/置底：选中集整体移到最顶/最底，保持组内相对顺序。
 * 上移/下移一层：只与「空间上重叠」的相邻元素交换（参考语义：跳过非重叠元素）。
 */
export function computeLayerChanges(
  items: ILayerItem[],
  selectedIds: string[],
  op: LayerOp,
): ILayerChange[] {
  if (selectedIds.length === 0) return [];
  const selectedSet = new Set(selectedIds);
  const changes: ILayerChange[] = [];

  if (op === 'front' || op === 'back') {
    const others = items.filter((i) => !selectedSet.has(i.id));
    const selected = items.filter((i) => selectedSet.has(i.id));
    if (op === 'front') {
      // 从最底selected开始逐个插到当前最大之上，保持组内顺序
      let cursor: string | null = null;
      for (const o of others) {
        if (cursor === null || o.zOrder > cursor) cursor = o.zOrder;
      }
      for (const s of selected.sort((a, b) => (a.zOrder < b.zOrder ? -1 : 1))) {
        const key = generateKeyBetween(cursor, null);
        changes.push({ id: s.id, zOrder: key });
        cursor = key;
      }
    } else {
      let cursor: string | null = null;
      for (const o of others) {
        if (cursor === null || o.zOrder < cursor) cursor = o.zOrder;
      }
      for (const s of selected.sort((a, b) => (a.zOrder > b.zOrder ? -1 : 1))) {
        const key = generateKeyBetween(null, cursor);
        changes.push({ id: s.id, zOrder: key });
        cursor = key;
      }
    }
    return changes;
  }

  // forward/backward：逐个选中元素（按 zOrder 从高到低处理，避免互换后越位）
  // others 为工作副本：已移动的选中项要加入其中，作为后续元素的插入边界（防止 key 碰撞）
  const others: ILayerItem[] = items.filter((i) => !selectedSet.has(i.id)).map((i) => ({ ...i }));
  const selected = items.filter((i) => selectedSet.has(i.id));
  const order = op === 'forward' ? -1 : 1; // forward 降序（先处理最高的），backward 升序
  const sorted = [...selected].sort((a, b) => (a.zOrder < b.zOrder ? -order : order));

  const zOrders = new Map(items.map((i) => [i.id, i.zOrder]));

  for (const item of sorted) {
    const itemZ = zOrders.get(item.id)!;
    // 相邻候选：zOrder 在移动方向上相邻的**非选中**元素，且与 item 空间重叠
    const candidates = others
      .filter(({ zOrder }) => (op === 'forward' ? zOrder > itemZ : zOrder < itemZ))
      .filter(({ bounds }) => rectsIntersect(bounds, item.bounds))
      .sort((a, b) =>
        op === 'forward' ? (a.zOrder < b.zOrder ? -1 : 1) : a.zOrder > b.zOrder ? -1 : 1,
      );
    const neighbor = candidates[0];
    if (!neighbor) continue;

    let newKey: string;
    if (op === 'forward') {
      // 插到 neighbor 之上：介于 neighbor 与 neighbor 的上邻之间
      const nextAbove = others
        .filter(({ zOrder }) => zOrder > neighbor.zOrder)
        .sort((a, b) => (a.zOrder < b.zOrder ? -1 : 1))[0];
      newKey = generateKeyBetween(neighbor.zOrder, nextAbove?.zOrder ?? null);
    } else {
      const nextBelow = others
        .filter(({ zOrder }) => zOrder < neighbor.zOrder)
        .sort((a, b) => (a.zOrder > b.zOrder ? -1 : 1))[0];
      newKey = generateKeyBetween(nextBelow?.zOrder ?? null, neighbor.zOrder);
    }
    zOrders.set(item.id, newKey);
    changes.push({ id: item.id, zOrder: newKey });
    // 已移动项参与后续边界计算
    others.push({ id: item.id, zOrder: newKey, bounds: item.bounds });
  }
  return changes;
}
