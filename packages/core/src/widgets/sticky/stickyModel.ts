import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { StickySchema, type StickyData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/** 便签数据层：色板枚举 + TipTap HTML 文本 */
export class StickyModel extends BaseModel<StickyData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.STICKY.capabilities; // 注册表单源（Batch 2 第二刀）

  /** schema 只描述样式字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = StickySchema as unknown as z.ZodType<StickyData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
