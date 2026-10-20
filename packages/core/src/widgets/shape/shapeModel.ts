import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { ShapeSchema, type ShapeData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/** 矩形控件数据层（docs/04 §2）：schema 与校验同源，几何走 yRect */
export class ShapeModel extends BaseModel<ShapeData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.SHAPE.capabilities; // 注册表单源（Batch 2 第二刀）

  /** schema 只描述样式字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = ShapeSchema as unknown as z.ZodType<ShapeData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
