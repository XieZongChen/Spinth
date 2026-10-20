import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { ImageSchema, type ImageData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/** 图片数据层：src 变更走 update（几何在 yRect） */
export class ImageModel extends BaseModel<ImageData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.IMAGE.capabilities; // 注册表单源（Batch 2 第二刀）

  protected readonly schema = ImageSchema as unknown as z.ZodType<ImageData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
