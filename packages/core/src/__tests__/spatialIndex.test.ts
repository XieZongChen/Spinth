import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { SpatialIndex } from '../platform/spatial/spatialIndex';
import { CullingService } from '../platform/spatial/cullingService';
import type { IBaseWidgetVm } from '../types';

/** 空间索引 + 视口 culling（docs/16 §1，4.8 P0）——纯逻辑测试 */
describe('SpatialIndex', () => {
  it('跨界 widget 注册到所有覆盖格；查询自然去重', () => {
    const idx = new SpatialIndex(512);
    // (0,0)-(1024,1024) 跨 4 格（含边界 1024 落在第 2 格）
    idx.update('a', { x: 0, y: 0, width: 1024, height: 1024 });
    expect(idx.queryIds({ x: 0, y: 0, width: 100, height: 100 })).toEqual(new Set(['a']));
    expect(idx.queryIds({ x: 900, y: 900, width: 100, height: 100 })).toEqual(new Set(['a']));
    expect(idx.queryIds({ x: 5000, y: 5000, width: 10, height: 10 })).toEqual(new Set());
  });

  it('移动清旧格：update 到新位置后旧格查询不再命中', () => {
    const idx = new SpatialIndex(512);
    idx.update('a', { x: 0, y: 0, width: 10, height: 10 });
    idx.update('a', { x: 2000, y: 0, width: 10, height: 10 });
    expect(idx.queryIds({ x: 0, y: 0, width: 100, height: 100 })).toEqual(new Set());
    expect(idx.queryIds({ x: 2000, y: 0, width: 100, height: 100 })).toEqual(new Set(['a']));
  });

  it('remove 清理（空格回收）', () => {
    const idx = new SpatialIndex(512);
    idx.update('a', { x: 0, y: 0, width: 10, height: 10 });
    idx.remove('a');
    expect(idx.queryIds({ x: 0, y: 0, width: 100, height: 100 })).toEqual(new Set());
    idx.remove('a'); // 幂等
    expect(idx.size).toBe(0);
  });

  it('同格移动零写（bounds 微变不换格时无副作用）', () => {
    const idx = new SpatialIndex(512);
    idx.update('a', { x: 10, y: 10, width: 10, height: 10 });
    idx.update('a', { x: 20, y: 20, width: 10, height: 10 });
    expect(idx.queryIds({ x: 0, y: 0, width: 100, height: 100 })).toEqual(new Set(['a']));
    expect(idx.size).toBe(1);
  });
});

/** 窄桩：CullingService 只消费这几个面 */
function makeCullingDeps() {
  const vms = new Map<string, IBaseWidgetVm & { root: { renderable: boolean } }>();
  const makeVm = (
    id: string,
    type: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => {
    const vm = {
      id,
      type,
      root: { renderable: true },
      getBounds: () => bounds,
    } as unknown as IBaseWidgetVm & { root: { renderable: boolean } };
    vms.set(id, vm);
    return vm;
  };
  const viewport = {
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 1000, height: 800 }),
  };
  const vmEngine = {
    getAllVms: () => Array.from(vms.values()),
    getVmById: (id: string) => vms.get(id),
  };
  return { viewport, vmEngine, makeVm };
}

describe('CullingService', () => {
  it('屏外 vm renderable=false、屏内 true；MIND_MAP 豁免', () => {
    const { viewport, vmEngine, makeVm } = makeCullingDeps();
    const inside = makeVm('in', 'SHAPE', { x: 100, y: 100, width: 50, height: 50 });
    const outside = makeVm('out', 'SHAPE', { x: 5000, y: 5000, width: 50, height: 50 });
    const mindFar = makeVm('mind', 'MIND_MAP', { x: 9000, y: 9000, width: 500, height: 500 });

    const idx = new SpatialIndex(512);
    for (const vm of vmEngine.getAllVms()) idx.update(vm.id, vm.getBounds());
    const cull = new CullingService(viewport as never, vmEngine as never, idx, []);
    cull.initialize();

    expect(inside.root.renderable).toBe(true);
    expect(outside.root.renderable).toBe(false);
    expect(mindFar.root.renderable).toBe(true); // 脑图不裁（树增长索引过期风险）

    // pan 到屏外控件 → 翻转恢复
    viewport.vpBounds$.next({ x: 4900, y: 4900, width: 1000, height: 800 });
    expect(outside.root.renderable).toBe(true);
    expect(inside.root.renderable).toBe(false);

    cull.dispose();
    expect(outside.root.renderable).toBe(true); // dispose 恢复
  });

  it('suspendForExport：全量置回 + 恢复闭包重跑 apply（导出包夹，docs/03 §8）', () => {
    const { viewport, vmEngine, makeVm } = makeCullingDeps();
    const inside = makeVm('in', 'SHAPE', { x: 100, y: 100, width: 50, height: 50 });
    const outside = makeVm('out', 'SHAPE', { x: 5000, y: 5000, width: 50, height: 50 });
    const idx = new SpatialIndex(512);
    for (const vm of vmEngine.getAllVms()) idx.update(vm.id, vm.getBounds());
    const cull = new CullingService(viewport as never, vmEngine as never, idx, []);
    cull.initialize();
    expect(outside.root.renderable).toBe(false);

    const restore = cull.suspendForExport();
    expect(inside.root.renderable).toBe(true);
    expect(outside.root.renderable).toBe(true); // 挂起段全量可见（extract 不缺件）
    expect(cull.culledCount).toBe(0);

    restore(); // 恢复闭包重跑 apply——视口外的回到剔除态
    expect(inside.root.renderable).toBe(true);
    expect(outside.root.renderable).toBe(false);
    cull.dispose();
  });

  // ---- 拖拽预览复核（specs/edge-auto-scroll 修订：预览只改 root，索引停在旧几何） ----

  it('预览 id 实时 bounds 在视口内（索引旧位屏外）→ 不剔除', () => {
    const { viewport, vmEngine, makeVm } = makeCullingDeps();
    const vm = makeVm('drag', 'SHAPE', { x: 5000, y: 5000, width: 50, height: 50 });
    const idx = new SpatialIndex(512);
    idx.update(vm.id, vm.getBounds()); // 索引 = 拖拽前旧位置（远屏外）
    vm.getBounds = () => ({ x: 100, y: 100, width: 50, height: 50 }); // 实时视觉位
    let preview = true;
    const cull = new CullingService(viewport as never, vmEngine as never, idx, [], () =>
      preview ? ['drag'] : [],
    );
    cull.initialize();
    expect(vm.root.renderable).toBe(true); // 误剔修复：指针下保留
    expect(cull.culledCount).toBe(0);

    // 松手后预览集清空：索引仍指旧位置、实时 bounds 也不再参与 → 恢复剔除
    preview = false;
    vm.getBounds = () => ({ x: 5000, y: 5000, width: 50, height: 50 });
    viewport.vpBounds$.next({ x: 0, y: 0, width: 1000, height: 800 });
    expect(vm.root.renderable).toBe(false);
    cull.dispose();
  });

  it('预览 id 实时 bounds 也在视口外 → 仍剔除（非无脑豁免）', () => {
    const { viewport, vmEngine, makeVm } = makeCullingDeps();
    const vm = makeVm('drag', 'SHAPE', { x: 9000, y: 9000, width: 50, height: 50 });
    const idx = new SpatialIndex(512);
    idx.update(vm.id, vm.getBounds());
    const cull = new CullingService(viewport as never, vmEngine as never, idx, [], () => ['drag']);
    cull.initialize();
    expect(vm.root.renderable).toBe(false); // 拖出视口外照常剔除
    expect(cull.culledCount).toBe(1);
    cull.dispose();
  });

  it('无预览提供者（缺省参）→ 索引外一律剔除（旧行为逐字节不变）', () => {
    const { viewport, vmEngine, makeVm } = makeCullingDeps();
    const vm = makeVm('w', 'SHAPE', { x: 5000, y: 5000, width: 50, height: 50 });
    const idx = new SpatialIndex(512);
    idx.update(vm.id, vm.getBounds());
    vm.getBounds = () => ({ x: 100, y: 100, width: 50, height: 50 }); // 实时位在视口内
    const cull = new CullingService(viewport as never, vmEngine as never, idx, []);
    cull.initialize();
    expect(vm.root.renderable).toBe(false); // 不给提供者就不复核——纯索引判定
    cull.dispose();
  });
});
