import 'fake-indexeddb/auto';
import { ServiceRegistry } from '../../platform/registry/serviceRegistry';
import { Tokens } from '../../tokens';
import { WIDGET_RUNTIME } from '../../widgetRuntime';
import { DataEngineService } from '../../platform/dataEngine/dataEngineService';
import { HistoryService } from '../../platform/history/historyService';
import type { IBaseModel } from '../../types';
import type { Token } from '../../platform/registry/serviceRegistry';

/**
 * 测试工厂（docs/10 §8）：进程内组装 DataEngineService + HistoryService
 * （纯数据层，无 viewport/BoardSDK）。与组合根同构的注册逻辑（单源
 * WIDGET_RUNTIME 派生，specs/api-surface §3.8 c）——顺带注册 MIND_MAP
 * （原手工表漏项；只影响注册表内容，不影响用例断言）；只注册 model，
 * 不引入 Vm（数据层测试不涉渲染）。不进运行时代码。
 */
export async function createEngineForTest(docId: string, wsUrl?: string) {
  const registry = new ServiceRegistry();
  const modelTokens = new Map<string, Token<IBaseModel>>(
    Object.entries(WIDGET_RUNTIME).map(([t, e]) => [t, e.modelToken] as const),
  );
  const engine = new DataEngineService(registry, modelTokens);
  registry.registerSingleton(Tokens.DataProcessor, () => engine.processor);
  for (const entry of Object.values(WIDGET_RUNTIME)) {
    registry.register(entry.modelToken, entry.createModel);
  }

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
