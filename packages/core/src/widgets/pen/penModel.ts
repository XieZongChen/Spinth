import * as Y from 'yjs';
import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { PenSchema, type PenData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { REPAIR_ORIGIN } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/**
 * 画笔数据层（docs/16 §2，4.8 P1）：points 存 Y.Array<[x,y]>——采样逐点
 * push 增量（update 帧只含新点，O(n²)→O(n)）；整笔变换（拖拽/缩放松手）
 * 走 setPoints 全量替换（低频）。undo 粒度不变：采样间隔 60ms 落在
 * UndoManager captureTimeout(500ms) 合并窗口内 + 落笔 stopCapturing 切分。
 * 旧数据（普通数组）在 initializeY 首读时一次性迁移。
 */
export class PenModel extends BaseModel<PenData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.PEN.capabilities; // 注册表单源（Batch 2 第二刀）

  /** schema 只描述样式字段与输入形态（points 是创建输入的普通数组；parse 会 strip rect） */
  protected readonly schema = PenSchema as unknown as z.ZodType<PenData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }

  override initialize(data: PenData & IRect): Y.Map<unknown> {
    const { points, ...rest } = data as PenData & IRect & { points: Array<[number, number]> };
    const yMap = super.initialize(rest as PenData & IRect);
    const arr = new Y.Array<[number, number]>();
    if (points && points.length > 0) {
      this.processor.transact(() => arr.push(points));
    }
    this.processor.transact(() => yMap.set('points', arr));
    return yMap;
  }

  override initializeY(yData: Y.Map<unknown>): void {
    super.initializeY(yData);
    // 旧数据迁移：points 普通数组 → Y.Array（一次性；协同端各迁各的幂等安全）
    const cur = yData.get('points');
    if (Array.isArray(cur)) {
      const arr = new Y.Array<[number, number]>();
      this.processor.transact(() => {
        arr.push(cur as Array<[number, number]>);
        yData.set('points', arr);
      }, REPAIR_ORIGIN);
    }
  }

  private get yPoints(): Y.Array<[number, number]> {
    const v = this.yData.get('points');
    if (v instanceof Y.Array) return v as Y.Array<[number, number]>;
    const arr = new Y.Array<[number, number]>(); // 异常形态兜底重建
    this.processor.transact(() => this.yData.set('points', arr));
    return arr;
  }

  /** 采样加点（Y.Array 增量 push） */
  appendPoint(p: [number, number]): void {
    this.yPoints.push([p]);
  }

  /** 整笔变换替换（拖拽/缩放松手；保持 Y.Array 形态不退化普通数组） */
  setPoints(points: Array<[number, number]>): void {
    const yPoints = this.yPoints;
    this.processor.transact(() => {
      if (yPoints.length > 0) yPoints.delete(0, yPoints.length);
      if (points.length > 0) yPoints.push(points);
    });
  }

  /** points 键改道 setPoints（防外部 update 直接写普通数组退化存储形态） */
  override update(patch: Partial<PenData & IRect>): void {
    const rec = patch as Record<string, unknown>;
    if (Array.isArray(rec.points)) {
      const { points, ...rest } = rec;
      this.setPoints(points as Array<[number, number]>);
      super.update(rest as Partial<PenData & IRect>);
      return;
    }
    super.update(patch);
  }
}
