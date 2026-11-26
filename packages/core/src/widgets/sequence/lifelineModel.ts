import type { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { LifelineSchema, WIDGET_REGISTRY, type LifelineData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import type { IWidgetCapabilities } from '../../types';

/** 生命线数据层（specs/sequence-diagram §2.1）：schema 与校验同源，几何走 yRect */
export class LifelineModel extends BaseModel<LifelineData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.LIFELINE.capabilities; // 注册表单源

  /** schema 只描述样式字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = LifelineSchema as unknown as z.ZodType<LifelineData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
