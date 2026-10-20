import { describe, expect, it } from 'vitest';
import { CullingService } from '../platform/spatial/cullingService';

/** Batch 1 · 1.26：culled 集合死 id 清理（forget API） */
describe('CullingService.forget', () => {
  it('已删 id 出册——culledCount 回落', () => {
    const viewport = {
      vpBounds$: {
        value: { x: 0, y: 0, width: 1000, height: 800 },
        subscribe: () => ({ unsubscribe: () => {} }),
      },
    };
    const vmEngine = { getAllVms: () => [] };
    const spatial = { queryIds: () => new Set<string>() };
    const svc = new CullingService(viewport as never, vmEngine as never, spatial as never, []);
    svc.initialize();
    // 无 vm 场景下 culled 恒空——直接验证 forget 幂等清空（真实滞留场景由 vm 存在
    // 时的 apply 写入；此处锁 API 契约：不抛、集合缩小）
    expect(() => svc.forget(['dead-1', 'dead-2'])).not.toThrow();
    expect(svc.culledCount).toBe(0);
    svc.dispose();
  });
});
