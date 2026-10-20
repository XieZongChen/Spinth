import 'fake-indexeddb/auto';
import { ServiceRegistry } from '../../platform/registry/serviceRegistry';
import { Tokens } from '../../tokens';
import { DataEngineService } from '../../platform/dataEngine/dataEngineService';
import { HistoryService } from '../../platform/history/historyService';
import { ShapeModel } from '../../widgets/shape/shapeModel';
import { TextModel } from '../../widgets/text/textModel';
import { LineModel } from '../../widgets/line/lineModel';
import { PenModel } from '../../widgets/pen/penModel';
import { StickyModel } from '../../widgets/sticky/stickyModel';
import { ImageModel } from '../../widgets/image/imageModel';
import type { IBaseModel, IWidgetData } from '../../types';
import type { Token } from '../../platform/registry/serviceRegistry';

/**
 * 测试工厂（docs/10 §8）：进程内组装 DataEngineService + HistoryService
 * （纯数据层，无 viewport/BoardSDK）。与组合根同构的注册逻辑，供协作集成
 * 测试双端使用；不进运行时代码。
 */
export async function createEngineForTest(docId: string, wsUrl?: string) {
  const registry = new ServiceRegistry();
  const modelTokens = new Map<string, Token<IBaseModel<IWidgetData>>>([
    ['SHAPE', Tokens.ShapeModel],
    ['TEXT', Tokens.TextModel],
    ['LINE', Tokens.LineModel],
    ['PEN', Tokens.PenModel],
    ['STICKY', Tokens.StickyModel],
    ['IMAGE', Tokens.ImageModel],
  ]);
  const engine = new DataEngineService(registry, modelTokens);
  registry
    .registerSingleton(Tokens.DataProcessor, () => engine.processor)
    .register(Tokens.ShapeModel, (r) => new ShapeModel(r.resolve(Tokens.DataProcessor)))
    .register(Tokens.TextModel, (r) => new TextModel(r.resolve(Tokens.DataProcessor)))
    .register(Tokens.LineModel, (r) => new LineModel(r.resolve(Tokens.DataProcessor)))
    .register(Tokens.PenModel, (r) => new PenModel(r.resolve(Tokens.DataProcessor)))
    .register(Tokens.StickyModel, (r) => new StickyModel(r.resolve(Tokens.DataProcessor)))
    .register(Tokens.ImageModel, (r) => new ImageModel(r.resolve(Tokens.DataProcessor)));

  await engine.initialize({ docId, wsUrl });
  const history = new HistoryService(engine);
  history.initialize();

  return {
    engine,
    history,
    dispose: (): void => {
      history.dispose();
      engine.dispose();
      registry.dispose();
    },
  };
}
