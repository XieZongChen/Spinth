import { token } from './platform/registry/serviceRegistry';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from './types';
import type { DataProcessor } from './platform/dataEngine/dataProcessor';
import type { ITextRenderService } from './platform/textEngine/docDisplay';

/** 全部 DI **服务** token 的唯一登记处（组合根与消费方共用；docs/04 §3）。
 *  控件 Model/Vm token 不在此：单源在 widgetRuntime.ts 的 WIDGET_RUNTIME
 *  （specs/api-surface Step 7 三表合一）。 */
export const Tokens = {
  ViewportService: token<IViewportService>('ViewportService'),
  DataEngineService: token<IDataEngineService>('DataEngineService'),
  VmEngineService: token<IVmEngineService>('VmEngineService'),
  SelectorService: token<ISelectorService>('SelectorService'),
  HistoryService: token<IHistoryService>('HistoryService'),
  TextRender: token<ITextRenderService>('TextRender'),
  EditingService: token<IEditingService>('EditingService'),

  DataProcessor: token<DataProcessor>('DataProcessor'),
} as const;
