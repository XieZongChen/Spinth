import * as Y from 'yjs';
import type { IRect } from '../../common/geometry';

/**
 * rect 的 YArray-KV 结构（docs/02 §2）：
 * 几何字段 x/y/width/height 以 {key, val} 条目存于 Y.Array，
 * 与低频属性分离事务，精确控制撤销粒度（YKeyValue 语义的手写最小实现）。
 */

export type RectKey = 'x' | 'y' | 'width' | 'height';
export interface IYRectEntry {
  key: RectKey;
  val: number;
}

export const RECT_KEYS: readonly RectKey[] = ['x', 'y', 'width', 'height'];

export function yRectToRect(yRect: Y.Array<IYRectEntry> | undefined): IRect | null {
  if (!yRect) return null;
  const rect: Partial<IRect> = {};
  for (const entry of yRect.toArray()) {
    rect[entry.key] = entry.val;
  }
  if (
    rect.x === undefined ||
    rect.y === undefined ||
    rect.width === undefined ||
    rect.height === undefined
  ) {
    return null;
  }
  return rect as IRect;
}

/** 按 key 更新；同值跳过（写前 diff，避免产生无意义 op——docs/02 §4 纪律 1） */
/** 按 key 更新；同值跳过（写前 diff，避免产生无意义 op——docs/02 §4 纪律 1）。
 *  同 key **全部**条目清理后写一条（Batch 1 · 1.4，2026-10-17 审查）：并发写
 *  同一 key 时双方 index 操作各自成立、两个 insert 都存活 → 条目重复累积
 *  （读侧 last-wins 掩盖、同值 diff 失真）。全量重建式（≤4 条）免索引位移，
 *  自愈——任何后续写入顺带清理历史并发残渣（Y.Map/LWW 全量迁移挂 Batch 2） */
export function yRectSet(yDoc: Y.Doc, yRect: Y.Array<IYRectEntry>, patch: Partial<IRect>): void {
  const entries = yRect.toArray();
  const effective = new Map<RectKey, number>();
  for (const [k, v] of Object.entries(patch) as Array<[RectKey, number]>) {
    if (v === undefined) continue;
    const hits = entries.filter((e) => e.key === k);
    if (hits.length === 1 && hits[0]!.val === v) continue; // 已是目标值且无残渣
    effective.set(k, v);
  }
  if (effective.size === 0) return;
  const written = new Set<RectKey>();
  const next: IYRectEntry[] = [];
  for (const e of entries) {
    if (effective.has(e.key)) {
      if (!written.has(e.key)) {
        next.push({ key: e.key, val: effective.get(e.key)! });
        written.add(e.key);
      }
      continue; // 该 key 其余条目（含并发重复残渣）丢弃
    }
    next.push(e);
  }
  for (const [k, v] of effective) {
    if (!written.has(k)) next.push({ key: k, val: v }); // 原数组无此 key → 尾部
  }
  yDoc.transact(() => {
    if (yRect.length > 0) yRect.delete(0, yRect.length);
    yRect.insert(0, next);
  });
}

export function createYRect(yDoc: Y.Doc, rect: IRect): Y.Array<IYRectEntry> {
  const yRect = new Y.Array<IYRectEntry>();
  yDoc.transact(() => {
    for (const k of RECT_KEYS) {
      yRect.push([{ key: k, val: rect[k] } as IYRectEntry]);
    }
  });
  return yRect;
}
