import * as Y from 'yjs';
import { z } from 'zod';
import type { IRect } from '../common/geometry';
import type { IBaseModel } from '../types';
import type { IWidgetData, IWidgetCapabilities } from '../types';
import { DataProcessor, REPAIR_ORIGIN } from '../platform/dataEngine/dataProcessor';
import { RECT_KEYS, yRectSet, type IYRectEntry } from '../platform/dataEngine/yRect';

/** 尺寸/坐标约束（防脏数据撑爆渲染） */
export const WIDGET_POS_MAX = 1_000_000;
export const WIDGET_SIZE_MAX = 20_000;
export const WIDGET_SIZE_MIN = 1;
/** 未受信数据长度上限（Batch 1 · 1.1）：恢复时超限截断——防渲染/内存放大 */
export const TEXT_MAX_CHARS = 500_000;
export const POINTS_MAX = 100_000;

/**
 * Model 基类：yData 是唯一数据源，toJSON 实时投影、无副本（docs/02 §5）。
 * 双初始化路径：initialize（本地新建）/ initializeY（远端已有，含修补）。
 */
export abstract class BaseModel<D extends IWidgetData> implements IBaseModel<D> {
  yData!: Y.Map<unknown>;
  id!: string;

  protected constructor(protected processor: DataProcessor) {}

  /** zod schema：类型与校验同源 */
  protected abstract readonly schema: z.ZodType<D>;

  /** 控件能力位：控件自声明，交互层查询（不可缩放的类型不出手柄等，docs/02 §5） */
  abstract readonly capabilities: IWidgetCapabilities;

  initialize(data: D): Y.Map<unknown> {
    this.yData = new Y.Map<unknown>();
    this.id = data.id;
    this.processor.create(data as unknown as Record<string, unknown>, this.yData);
    return this.yData;
  }

  initializeY(yData: Y.Map<unknown>): void {
    this.yData = yData;
    this.id = yData.get('id') as string;
    // 远端数据不可信：缺 rect 时补默认值（既有设计线上真实踩坑，docs/02 §3）。
    // REPAIR_ORIGIN（Batch 1 · 1.3）：修补不进 undo 栈——null origin 会被
    // UndoManager 捕获成幽灵撤销步
    if (!yData.get('rect')) {
      this.processor.transact(() => {
        const rect = new Y.Array<IYRectEntry>();
        for (const k of RECT_KEYS) {
          rect.push([{ key: k, val: k === 'width' || k === 'height' ? 100 : 0 }]);
        }
        yData.set('rect', rect);
      }, REPAIR_ORIGIN);
    }
    this.sanitizeYData(yData);
  }

  /** 未受信数据消毒（Batch 1 · 1.1，2026-10-17 审查）：远端/损坏数据在恢复
   *  时一次性清洗，写走 REPAIR_ORIGIN（不进 undo 栈）：
   *  ① schema 形状过滤——**本版 schema 已知**且值非法的键删除（update() 同款
   *     strip 口径）；未知键**保留**（前向兼容：旧客户端不毁新客户端的字段，
   *     滚动升级与 1.2 隔离同向）；
   *  ② 长度上限——text/points 超限截断（防渲染/内存放大）；
   *  ③ 几何消毒——x/y/w/h 非有限数修默认、超界 clamp（与 updateRect 同表） */
  private sanitizeYData(yData: Y.Map<unknown>): void {
    const schemaObj = this.schema as unknown as z.ZodObject<z.ZodRawShape>;
    const drops: string[] = [];
    if (schemaObj instanceof z.ZodObject) {
      for (const k of Array.from(yData.keys())) {
        if (k === 'rect' || k === 'id' || k === 'type' || k === 'zOrder') continue;
        const shape = schemaObj.shape[k] as unknown as
          { safeParse(v: unknown): { success: boolean } } | undefined;
        if (!shape) continue; // 未知键保留（前向兼容）
        if (!shape.safeParse(yData.get(k)).success) drops.push(k);
      }
    }
    const patches: Record<string, unknown> = {};
    const text = yData.get('text');
    if (typeof text === 'string' && text.length > TEXT_MAX_CHARS) {
      patches.text = text.slice(0, TEXT_MAX_CHARS);
    }
    const pts = yData.get('points');
    if (pts instanceof Y.Array && pts.length > POINTS_MAX) {
      // 截断在事务内直接删尾部（Y.Array 增量操作）
      this.processor.transact(() => {
        pts.delete(POINTS_MAX, pts.length - POINTS_MAX);
      }, REPAIR_ORIGIN);
      console.warn(`[spinth:sanitize] points 超限截断 (id=${this.id.slice(0, 6)})`);
    }
    const yRect = yData.get('rect') as Y.Array<IYRectEntry> | undefined;
    const geom: Partial<IRect> = {};
    if (yRect) {
      for (const entry of yRect.toArray()) {
        const v = entry.val;
        if (!Number.isFinite(v)) {
          geom[entry.key] = entry.key === 'width' || entry.key === 'height' ? 100 : 0;
        } else if (entry.key === 'width' || entry.key === 'height') {
          const c = Math.max(WIDGET_SIZE_MIN, Math.min(WIDGET_SIZE_MAX, v));
          if (c !== v) geom[entry.key] = c;
        } else {
          const c = Math.max(-WIDGET_POS_MAX, Math.min(WIDGET_POS_MAX, v));
          if (c !== v) geom[entry.key] = c;
        }
      }
    }
    if (drops.length === 0 && Object.keys(patches).length === 0 && Object.keys(geom).length === 0)
      return;
    this.processor.transact(() => {
      for (const k of drops) yData.delete(k);
      for (const [k, v] of Object.entries(patches)) yData.set(k, v);
      if (Object.keys(geom).length > 0 && yRect && yData.doc) {
        yRectSet(yData.doc as Y.Doc, yRect, geom);
      }
    }, REPAIR_ORIGIN);
    if (drops.length > 0) {
      console.warn(
        `[spinth:sanitize] 非法键已删除 (id=${this.id.slice(0, 6)}): ${drops.join(',')}`,
      );
    }
  }

  get yRect(): Y.Array<IYRectEntry> {
    return this.yData.get('rect') as Y.Array<IYRectEntry>;
  }

  /** 更新扁平属性：合并旧值 → schema 校验 → DataProcessor */
  update(patch: Partial<D>): void {
    const patchRec = patch as unknown as Record<string, unknown>;
    const schemaObj = this.schema as unknown as z.ZodObject<z.ZodRawShape>;
    let parsed: Record<string, unknown>;
    if (schemaObj instanceof z.ZodObject) {
      // 局部校验（docs/16 §3）：控件 schema 字段独立（无跨字段 refine），
      // 只 pick + parse 变更键——pen 逐点写/样式切换不再全量 parse。
      // rect 键照原路径忽略（几何走 updateRect clamp）。行为差异：不再顺带
      // 补写其他字段的 zod default（add 时已 parse 过，正常数据无差异）。
      const keys = Object.keys(patchRec).filter(
        (k) => !(RECT_KEYS as readonly string[]).includes(k) && k in schemaObj.shape,
      );
      if (keys.length === 0) return;
      const picked = schemaObj.pick(
        Object.fromEntries(keys.map((k) => [k, true])) as Record<string, true>,
      );
      parsed = picked.parse(Object.fromEntries(keys.map((k) => [k, patchRec[k]]))) as Record<
        string,
        unknown
      >;
    } else {
      // 非 ZodObject（effects 包装等兜底）：原全量路径
      const next = { ...(this.toJSON() as unknown as Record<string, unknown>), ...patchRec };
      parsed = this.schema.parse(next) as unknown as Record<string, unknown>;
      for (const k of RECT_KEYS) delete parsed[k];
    }
    this.processor.update(parsed, this.yData);
  }

  /** 更新几何（带 clamp；拖拽/缩放松手统一走这里） */
  updateRect(patch: Partial<IRect>): void {
    const clamped: Partial<IRect> = {};
    for (const [k, v] of Object.entries(patch) as Array<[keyof IRect, number]>) {
      if (v === undefined) continue;
      let val = v;
      if (k === 'x' || k === 'y') {
        val = Math.max(-WIDGET_POS_MAX, Math.min(WIDGET_POS_MAX, val));
      } else {
        val = Math.max(WIDGET_SIZE_MIN, Math.min(WIDGET_SIZE_MAX, val));
      }
      clamped[k] = Math.round(val * 100) / 100;
    }
    try {
      const doc = this.yData.doc as Y.Doc;
      yRectSet(doc, this.yRect, clamped);
    } catch (err) {
      console.error(
        '[spinth:updateRect] FAILED',
        this.id.slice(0, 6),
        JSON.stringify(clamped),
        err,
      );
    }
  }

  toJSON(): D {
    const json = this.yData.toJSON() as Record<string, unknown>;
    return DataProcessor.flatten(json) as unknown as D;
  }
}
