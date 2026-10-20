import { token, type Token } from './platform/registry/serviceRegistry';
import type {
  IBaseModel,
  IBaseWidgetVm,
  IDataEngineService,
  IEditingService,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from './types';
import type { DataProcessor } from './platform/dataEngine/dataProcessor';
import type { ITextRenderService } from './platform/textEngine/docDisplay';

/** 全部 DI token 的唯一登记处（组合根与消费方共用；docs/04 §3） */
export const Tokens = {
  ViewportService: token<IViewportService>('ViewportService'),
  DataEngineService: token<IDataEngineService>('DataEngineService'),
  VmEngineService: token<IVmEngineService>('VmEngineService'),
  SelectorService: token<ISelectorService>('SelectorService'),
  HistoryService: token<IHistoryService>('HistoryService'),
  TextRender: token<ITextRenderService>('TextRender'),
  EditingService: token<IEditingService>('EditingService'),

  DataProcessor: token<DataProcessor>('DataProcessor'),

  ShapeModel: token<IBaseModel>('ShapeModel'),
  ShapeVm: token<IBaseWidgetVm>('ShapeVm'),
  TextModel: token<IBaseModel>('TextModel'),
  TextVm: token<IBaseWidgetVm>('TextVm'),
  LineModel: token<IBaseModel>('LineModel'),
  LineVm: token<IBaseWidgetVm>('LineVm'),
  PenModel: token<IBaseModel>('PenModel'),
  PenVm: token<IBaseWidgetVm>('PenVm'),
  StickyModel: token<IBaseModel>('StickyModel'),
  StickyVm: token<IBaseWidgetVm>('StickyVm'),
  ImageModel: token<IBaseModel>('ImageModel'),
  ImageVm: token<IBaseWidgetVm>('ImageVm'),
  MindMapModel: token<IBaseModel>('MindMapModel'),
  MindMapVm: token<IBaseWidgetVm>('MindMapVm'),
} as const;

/** type → token 映射（Batch 2 第四刀，组合根单循环装配用）：加控件在此加
 *  一行 + widgetFactories.ts 加一项——app.ts 装配循环零改动 */
export const WIDGET_TOKENS = {
  SHAPE: { model: Tokens.ShapeModel, vm: Tokens.ShapeVm },
  TEXT: { model: Tokens.TextModel, vm: Tokens.TextVm },
  LINE: { model: Tokens.LineModel, vm: Tokens.LineVm },
  PEN: { model: Tokens.PenModel, vm: Tokens.PenVm },
  STICKY: { model: Tokens.StickyModel, vm: Tokens.StickyVm },
  IMAGE: { model: Tokens.ImageModel, vm: Tokens.ImageVm },
  MIND_MAP: { model: Tokens.MindMapModel, vm: Tokens.MindMapVm },
} as const satisfies Record<string, { model: Token<IBaseModel>; vm: Token<IBaseWidgetVm> }>;
