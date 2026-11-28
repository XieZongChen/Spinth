import type { z } from 'zod';
import { BaseModel } from '../../base/baseModel';
import { ActivationSchema, WIDGET_REGISTRY, type ActivationData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { DataProcessor } from '../../platform/dataEngine/dataProcessor';
import type { IWidgetCapabilities } from '../../types';

/** 激活条数据层（specs/sequence-diagram §2.2）：schema 与校验同源，几何走 yRect */
export class ActivationModel extends BaseModel<ActivationData & IRect> {
  readonly capabilities: IWidgetCapabilities = WIDGET_REGISTRY.ACTIVATION.capabilities; // 注册表单源

  /** schema 只描述绑定与编组字段（几何在 yRect，parse 会 strip 掉），cast 仅弥合输出类型 */
  protected readonly schema = ActivationSchema as unknown as z.ZodType<ActivationData & IRect>;

  constructor(processor: DataProcessor) {
    super(processor);
  }
}
