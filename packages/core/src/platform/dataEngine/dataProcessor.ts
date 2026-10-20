import type * as Y from 'yjs';
import { RECT_KEYS, createYRect, yRectSet, type IYRectEntry } from './yRect';
import type { IRect } from '../../common/geometry';

/**
 * 唯一写入口（docs/02 §4）：所有方法包 Y.transact（事务 = 撤销粒度），
 * 写前 diff 同值跳过。业务代码不允许绕过本类直接操作 Yjs。
 */
/** 修补/迁移写 origin（Batch 1 · 1.3）：内部维护性写入（补 rect/points 迁移等）
 *  ——非 null origin 不被 UndoManager 默认 trackedOrigins=[null] 捕获，
 *  修补不产生幽灵撤销步（用户首次 undo 撤的应是自己而非修补） */
export const REPAIR_ORIGIN = Symbol('spinth-repair');

/** 存量 dataURL 迁移写 origin（Batch 2 二期）：与 REPAIR_ORIGIN 同纪律——
 *  维护性写入不进 undo 栈（用户 undo 撤的应是自己，不是文档格式迁移） */
export const MIGRATE_ORIGIN = Symbol('spinth-migrate');

export class DataProcessor {
  constructor(private yDoc: Y.Doc) {}

  transact<T>(fn: () => T, origin?: unknown): T {
    return this.yDoc.transact(fn, origin);
  }

  /** 新建 widget：扁平字段进 yData，几何进独立 yRect（挂 yData.rect） */
  create(data: Record<string, unknown>, yData: Y.Map<unknown>): void {
    const rect: Partial<IRect> = {};
    this.yDoc.transact(() => {
      for (const [k, v] of Object.entries(data)) {
        if ((RECT_KEYS as readonly string[]).includes(k)) {
          rect[k as keyof IRect] = v as number;
          continue;
        }
        if (!Object.is(yData.get(k), v)) {
          yData.set(k, v);
        }
      }
      const yRect = createYRect(this.yDoc, {
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        width: rect.width ?? 100,
        height: rect.height ?? 100,
      });
      yData.set('rect', yRect);
    });
  }

  /** 更新扁平字段（几何走 updateRect） */
  update(patch: Record<string, unknown>, yData: Y.Map<unknown>): void {
    this.yDoc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if ((RECT_KEYS as readonly string[]).includes(k)) continue;
        if (!Object.is(yData.get(k), v)) {
          yData.set(k, v);
        }
      }
    });
  }

  updateRect(patch: Partial<IRect>, yRect: Y.Array<IYRectEntry>): void {
    yRectSet(this.yDoc, yRect, patch);
  }

  /** yData.toJSON() → 摊平 rect 为 x/y/width/height（供 Model.toJSON 投影） */
  static flatten(json: Record<string, unknown>): Record<string, unknown> {
    const { rect: rectEntries, ...rest } = json;
    const out: Record<string, unknown> = { ...rest };
    if (Array.isArray(rectEntries)) {
      for (const entry of rectEntries as IYRectEntry[]) {
        out[entry.key] = entry.val;
      }
    }
    return out;
  }
}
