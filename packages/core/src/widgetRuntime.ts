/**
 * 控件三件套运行时注册表（specs/api-surface §3.8 b）——控件 token 表与
 * 工厂表合一单源：type → { modelToken, vmToken, createModel, createVm }。
 * token 现场生成（Symbol(desc) 仅调试可读）：具名 token 常量只被装配点引用，
 * 无保留价值。加控件 = WIDGET_REGISTRY（schema 域）+ 本表各加一项，引擎与
 * 装配循环零改动。
 *
 * **本文件是组合根专属**（import 具体 Model/Vm 实现）：types/ 层不反向依赖
 * widgets（widget.ts 保持纯类型域——分层纪律）。依赖注入保持构造函数显式
 * （铁律 4）：工厂体内 r.resolve 即原手工装配的同款依赖表达。
 * **Service 不在此注册**：七个 Service 构造签名异构、初始化时序敏感
 * （selector 先于 refLine、editingService 先于 textService 等）——手工装配
 * 的显式时序是语义，强行注册化是伪收益（docs/16 §8）。
 */
import { token, type ServiceRegistry, type Token } from './platform/registry/serviceRegistry';
import type { IBaseModel, IBaseWidgetVm } from './types';
import { Tokens } from './tokens';
import { WIDGET_REGISTRY } from './types/widget';
import { ShapeModel } from './widgets/shape/shapeModel';
import { ShapeVm } from './widgets/shape/shapeVm';
import { TextModel } from './widgets/text/textModel';
import { TextVm } from './widgets/text/textVm';
import { LineModel } from './widgets/line/lineModel';
import { LineVm } from './widgets/line/lineVm';
import { PenModel } from './widgets/pen/penModel';
import { PenVm } from './widgets/pen/penVm';
import { StickyModel } from './widgets/sticky/stickyModel';
import { StickyVm } from './widgets/sticky/stickyVm';
import { ImageModel } from './widgets/image/imageModel';
import { ImageVm } from './widgets/image/imageVm';
import { MindMapModel } from './widgets/mind/mindMapModel';
import { MindMapVm } from './widgets/mind/mindMapVm';

export const WIDGET_RUNTIME = {
  SHAPE: {
    modelToken: token<IBaseModel>('ShapeModel'),
    vmToken: token<IBaseWidgetVm>('ShapeVm'),
    createModel: (r: ServiceRegistry) => new ShapeModel(r.resolve(Tokens.DataProcessor)),
    createVm: (r: ServiceRegistry) => new ShapeVm(r.resolve(Tokens.TextRender)),
  },
  TEXT: {
    modelToken: token<IBaseModel>('TextModel'),
    vmToken: token<IBaseWidgetVm>('TextVm'),
    createModel: (r: ServiceRegistry) => new TextModel(r.resolve(Tokens.DataProcessor)),
    createVm: (r: ServiceRegistry) => new TextVm(r.resolve(Tokens.TextRender)),
  },
  LINE: {
    modelToken: token<IBaseModel>('LineModel'),
    vmToken: token<IBaseWidgetVm>('LineVm'),
    createModel: (r: ServiceRegistry) => new LineModel(r.resolve(Tokens.DataProcessor)),
    createVm: () => new LineVm(),
  },
  PEN: {
    modelToken: token<IBaseModel>('PenModel'),
    vmToken: token<IBaseWidgetVm>('PenVm'),
    createModel: (r: ServiceRegistry) => new PenModel(r.resolve(Tokens.DataProcessor)),
    createVm: () => new PenVm(),
  },
  STICKY: {
    modelToken: token<IBaseModel>('StickyModel'),
    vmToken: token<IBaseWidgetVm>('StickyVm'),
    createModel: (r: ServiceRegistry) => new StickyModel(r.resolve(Tokens.DataProcessor)),
    createVm: (r: ServiceRegistry) => new StickyVm(r.resolve(Tokens.TextRender)),
  },
  IMAGE: {
    modelToken: token<IBaseModel>('ImageModel'),
    vmToken: token<IBaseWidgetVm>('ImageVm'),
    createModel: (r: ServiceRegistry) => new ImageModel(r.resolve(Tokens.DataProcessor)),
    createVm: () => new ImageVm(),
  },
  MIND_MAP: {
    modelToken: token<IBaseModel>('MindMapModel'),
    vmToken: token<IBaseWidgetVm>('MindMapVm'),
    createModel: (r: ServiceRegistry) => new MindMapModel(r.resolve(Tokens.DataProcessor)),
    createVm: () => new MindMapVm(),
  },
} as const satisfies Record<
  keyof typeof WIDGET_REGISTRY,
  {
    modelToken: Token<IBaseModel>;
    vmToken: Token<IBaseWidgetVm>;
    createModel: (r: ServiceRegistry) => IBaseModel;
    createVm: (r: ServiceRegistry) => IBaseWidgetVm;
  }
>;

/** 注册表之外多出来的类型（satisfies 只能查漏，这里查多） */
type AssertNever<T extends never> = T;
export type _RuntimeOnlyKeys = AssertNever<
  Exclude<keyof typeof WIDGET_RUNTIME, keyof typeof WIDGET_REGISTRY>
>;
