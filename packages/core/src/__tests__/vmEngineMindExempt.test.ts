import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';

stubPixiCanvasDocument();
import { Container, Point } from 'pixi.js';
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { VmEngineService } from '../platform/vmEngine/vmEngineService';
import { SpatialIndex } from '../platform/spatial/spatialIndex';
import type { ServiceRegistry, Token } from '../platform/registry/serviceRegistry';
import type { IBaseModel, IBaseWidgetVm, IWidgetData } from '../types';

/**
 * 回归（2026-09 Phase 4 审查实测）：MIND_MAP 落盘 rect 为零面积锚点且布局不回写，
 * 空间索引恒过期——mind 工具点击画布上可见的子节点被当空白画布，新建重叠脑图
 * （modelCount 1→2）。守卫：vmEngine 查询对 MIND_MAP 豁免索引（与 culling 豁免同因）。
 */

interface VmStubInit {
  id: string;
  type: string;
  hit: (p: Point) => boolean;
}

function makeVm(init: VmStubInit): IBaseWidgetVm {
  return {
    id: init.id,
    type: init.type,
    root: new Container(),
    hitTestPoint: init.hit,
    hitTestRect: () => false,
    // 拟真 bug 场景：落盘 rect 是零面积锚点（真实 getBounds 未覆盖命中点）
    getBounds: () => ({ x: 100, y: 100, width: 0, height: 0 }),
    applyDragPreview: () => {},
    commitDrag: () => {},
    onStateChanged$: new Subject(),
    onSelected$: new BehaviorSubject(false),
    setState: () => {},
    dispose: () => {},
    setModel: () => {},
  } as unknown as IBaseWidgetVm;
}

function makeEngine(vms: IBaseWidgetVm[]) {
  const created$ = new Subject<IBaseModel<IWidgetData>>();
  const registry = {
    resolve: (t: Token<IBaseWidgetVm>): IBaseWidgetVm => t as unknown as IBaseWidgetVm,
  } as unknown as ServiceRegistry;
  const tokens = new Map<string, Token<IBaseWidgetVm>>();
  for (const vm of vms) tokens.set(vm.type, vm as unknown as Token<IBaseWidgetVm>);
  const spatial = new SpatialIndex();
  const engine = new VmEngineService(
    { onModelCreated$: created$, onModelRemoved$: new Subject<string[]>() } as never,
    registry,
    tokens,
    { addWidget: () => {}, removeWidget: () => {}, setZOrder: () => {} } as never,
    spatial,
  );
  engine.initialize();
  return { engine, created$, spatial };
}

function makeModel(id: string, type: string): IBaseModel<IWidgetData> {
  const yData = new Y.Map<unknown>();
  const doc = new Y.Doc();
  doc.getMap('mm').set('x', yData); // 挂进 doc：游离 Y.Map 的 transact 会被丢弃
  doc.transact(() => {
    yData.set('id', id);
    yData.set('type', type);
  });
  return {
    id,
    yData,
    toJSON: () => ({ id, type, zOrder: 'a0' }),
  } as unknown as IBaseModel<IWidgetData>;
}

describe('VmEngine：MIND_MAP 查询豁免空间索引（docs/16 §1 决策）', () => {
  it('索引无候选时 MIND_MAP 仍参与命中——点击画布上可见子节点不再被判空白', () => {
    // 脑图 hit 热区在 (700,450)；索引从未登记该区域（落盘 rect 是零面积锚点）
    const mindVm = makeVm({
      id: 'mind1',
      type: 'MIND_MAP',
      hit: (p) => Math.abs(p.x - 700) < 100 && Math.abs(p.y - 450) < 60,
    });
    const { engine, created$ } = makeEngine([mindVm]);
    created$.next(makeModel('mind1', 'MIND_MAP'));

    const hits = engine.getVmByPoint(new Point(700, 450));
    expect(hits.map((v) => v.id)).toEqual(['mind1']);
  });

  it('豁免仅限 MIND_MAP：非脑图控件索引无登记即不候选', () => {
    // shape 命中热区与脑图重叠，但 getBounds 在远处（索引登记点也远）——
    // 若豁免逻辑误扩到全部类型，这里会误命中 shape
    const mindVm = makeVm({ id: 'mind1', type: 'MIND_MAP', hit: () => false });
    const shapeVm = makeVm({ id: 'sh1', type: 'SHAPE', hit: (p) => Math.abs(p.x - 700) < 100 });
    (shapeVm as unknown as { getBounds: () => unknown }).getBounds = () => ({
      x: 5000,
      y: 400,
      width: 50,
      height: 50,
    });
    const { engine, created$, spatial } = makeEngine([mindVm, shapeVm]);
    created$.next(makeModel('mind1', 'MIND_MAP'));
    created$.next(makeModel('sh1', 'SHAPE'));
    void spatial;

    const hits = engine.getVmByPoint(new Point(700, 450));
    expect(hits.map((v) => v.id)).toEqual([]);
  });

  it('卸载期逐 VM dispose：每个 vm.dispose 被调、映射清空（SDK teardown 收口）', () => {
    const vmA = makeVm({ id: 'a', type: 'SHAPE', hit: () => false });
    const vmB = makeVm({ id: 'b', type: 'IMAGE', hit: () => false });
    const disposeA = vi.spyOn(vmA, 'dispose');
    const disposeB = vi.spyOn(vmB, 'dispose');
    const { engine, created$ } = makeEngine([vmA, vmB]);
    created$.next(makeModel('a', 'SHAPE'));
    created$.next(makeModel('b', 'IMAGE'));
    expect(engine.getAllVms()).toHaveLength(2);

    engine.dispose();
    expect(disposeA).toHaveBeenCalledTimes(1); // 图片重试计时器/在途加载随 vm 收口
    expect(disposeB).toHaveBeenCalledTimes(1);
    expect(engine.getAllVms()).toHaveLength(0);

    // 幂等/不双调：再次 dispose 不再触达 VM
    engine.dispose();
    expect(disposeA).toHaveBeenCalledTimes(1);
  });
});
