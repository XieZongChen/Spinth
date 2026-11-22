import { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { FrameSchema, type FrameData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import { WIDGET_REGISTRY } from '../../types';
import type { IWidgetCapabilities } from '../../types';

/** 容器控件数据层（specs/container-frame §2）：schema 与校验同源，几何走 yRect */
export class FrameModel extends BaseModel<FrameData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.FRAME.capabilities; // 注册表单源

  /** schema 只描述样式字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = FrameSchema as unknown as z.ZodType<FrameData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
