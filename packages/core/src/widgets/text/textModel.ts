import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { TextSchema, type TextData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/** 文本控件数据层（docs/07）：内容为 TipTap HTML，几何自动随内容测量 */
export class TextModel extends BaseModel<TextData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.TEXT.capabilities; // 注册表单源（Batch 2 第二刀）

  /** schema 只描述样式字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = TextSchema as unknown as z.ZodType<TextData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
