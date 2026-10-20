import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { LineSchema, type LineData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/** 连接线数据层：points 数组整体写（update 走全量 points 替换） */
export class LineModel extends BaseModel<LineData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.LINE.capabilities; // 注册表单源（Batch 2 第二刀）

  /** schema 只描述样式字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = LineSchema as unknown as z.ZodType<LineData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }

  /** 线的 rect 是派生量（points 包围盒），数据层面占位 */
  updatePoints(points: Array<[number, number]>): void {
    this.update({ points });
  }
}
