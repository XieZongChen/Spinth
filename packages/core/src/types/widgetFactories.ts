import { Tokens } from '../tokens';
import type { ServiceRegistry } from '../platform/registry/serviceRegistry';
import type { WIDGET_REGISTRY } from './widget';

import { ShapeModel } from '../widgets/shape/shapeModel';
import { ShapeVm } from '../widgets/shape/shapeVm';
import { TextModel } from '../widgets/text/textModel';
import { TextVm } from '../widgets/text/textVm';
import { LineModel } from '../widgets/line/lineModel';
import { LineVm } from '../widgets/line/lineVm';
import { PenModel } from '../widgets/pen/penModel';
import { PenVm } from '../widgets/pen/penVm';
import { StickyModel } from '../widgets/sticky/stickyModel';
import { StickyVm } from '../widgets/sticky/stickyVm';
import { ImageModel } from '../widgets/image/imageModel';
import { ImageVm } from '../widgets/image/imageVm';
import { MindMapModel } from '../widgets/mind/mindMapModel';
import { MindMapVm } from '../widgets/mind/mindMapVm';

/**
 * 控件工厂注册表（Batch 2 第四刀，2026-10-18 组合根装配面）：type →
 * { model, vm } 工厂——组合根单循环装配，加控件在此加一项（WIDGET_REGISTRY
 * schema 域 + WIDGET_TOKENS 各加一项），app.ts 装配循环零改动。
 *
 * **本文件是组合根专属**（import 具体 Model/Vm 实现）：types 层其余文件不
 * 反向依赖 widgets（widget.ts 保持纯类型域——分层纪律）。
 * 依赖注入保持构造函数显式（铁律 4）：工厂体内 r.resolve 即原手工装配的
 * 同款依赖表达，只是收进注册表。
 * **Service 不在此注册**：七个 Service 构造签名异构、初始化时序敏感
 * （selector 先于 refLine、editingService 先于 textService 等）——手工装配
 * 的显式时序是语义，强行注册化是伪收益（docs/16 §8）。
 */
export const WIDGET_FACTORIES = {
  SHAPE: {
    model: (r: ServiceRegistry) => new ShapeModel(r.resolve(Tokens.DataProcessor)),
    vm: (r: ServiceRegistry) => new ShapeVm(r.resolve(Tokens.TextRender)),
  },
  TEXT: {
    model: (r: ServiceRegistry) => new TextModel(r.resolve(Tokens.DataProcessor)),
    vm: (r: ServiceRegistry) => new TextVm(r.resolve(Tokens.TextRender)),
  },
  LINE: {
    model: (r: ServiceRegistry) => new LineModel(r.resolve(Tokens.DataProcessor)),
    vm: () => new LineVm(),
  },
  PEN: {
    model: (r: ServiceRegistry) => new PenModel(r.resolve(Tokens.DataProcessor)),
    vm: () => new PenVm(),
  },
  STICKY: {
    model: (r: ServiceRegistry) => new StickyModel(r.resolve(Tokens.DataProcessor)),
    vm: (r: ServiceRegistry) => new StickyVm(r.resolve(Tokens.TextRender)),
  },
  IMAGE: {
    model: (r: ServiceRegistry) => new ImageModel(r.resolve(Tokens.DataProcessor)),
    vm: () => new ImageVm(),
  },
  MIND_MAP: {
    model: (r: ServiceRegistry) => new MindMapModel(r.resolve(Tokens.DataProcessor)),
    vm: () => new MindMapVm(),
  },
} as const satisfies Record<
  keyof typeof WIDGET_REGISTRY,
  { model: (r: ServiceRegistry) => unknown; vm: (r: ServiceRegistry) => unknown }
>;
