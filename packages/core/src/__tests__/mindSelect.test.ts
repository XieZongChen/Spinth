import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { makeTreeService, spec } from './helpers/mindServiceFixture';

describe('框选节点级命中（4.9 focusFromMarquee，2026-09-26）', () => {
  it('框中根本体 = 焦点回根；框中子节点 bbox = 节点级选中；空隙不动', () => {
    const { svc, model, vmEngine } = makeTreeService(spec('根', [spec('a'), spec('b')]));
    svc.initialize();
    const rootId = model.root.id;
    const aId = model.root.children[0]!.id;
    const bId = model.root.children[1]!.id;
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
      [rootId]: { x: 0, y: 0, width: 100, height: 40 }, // 局部 rect；vmStub.root=(100,50) → 世界 (100,50)
      [aId]: { x: 150, y: 0, width: 80, height: 30 }, // 世界 (250,50)
      [bId]: { x: 150, y: 60, width: 80, height: 30 }, // 世界 (250,110)
    };
    (
      vmEngine.getVmById('mm-1') as unknown as {
        getNodeRect: (id: string) => (typeof rects)[string] | null;
      }
    ).getNodeRect = (id) => rects[id] ?? null;

    // 框住 a（世界坐标相交判定，不含根本体）
    svc.focusFromMarquee!({ x: 240, y: 40, width: 100, height: 50 }, 'mm-1');
    expect(svc.focusedNodeId).toBe(aId);
    // 框中根本体 → 整图（焦点回根）
    svc.focusFromMarquee!({ x: 90, y: 40, width: 30, height: 30 }, 'mm-1');
    expect(svc.focusedNodeId).toBe(rootId);
    // 框住 b
    svc.focusFromMarquee!({ x: 240, y: 100, width: 100, height: 50 }, 'mm-1');
    expect(svc.focusedNodeId).toBe(bId);
    // 树内空隙（无任何节点 bbox 相交）→ 焦点不动（保持框选前的根）
    svc.focusedNodeId = rootId;
    svc.focusFromMarquee!({ x: 210, y: 50, width: 30, height: 30 }, 'mm-1');
    expect(svc.focusedNodeId).toBe(rootId);
    svc.dispose();
  });
});

describe('MindService 节点级选中（4.9，docs/11 §0 规格修订）', () => {
  it('选中脑图（初始/框选/切图）→ 焦点落根；重复选中幂等', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize(); // BehaviorSubject 初始发射（已选中 mm-1）→ 焦点落根
    expect(svc.focusedNodeId).toBe(model.root.id);
    const sel = (svc as unknown as { selector: { selected$: BehaviorSubject<string[]> } }).selector
      .selected$;
    // 同图子节点焦点下切走再切回 → 重新落根（focusMapId 异图条件）
    sel.next(['other']);
    expect(svc.focusedNodeId).toBeNull();
    sel.next(['mm-1']);
    expect(svc.focusedNodeId).toBe(model.root.id);
    svc.dispose();
  });

  it('选区不含脑图 → 焦点清空 + focusChanged$ 广播（awareness 收空）', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.initialize();
    // 先建立选中态（addChild → emitFocus 建立 focusMapId 高亮）
    svc.focusedNodeId = model.root.children[0]!.id;
    svc.addChild();
    let fired = 0;
    const sub = svc.focusChanged$.subscribe(() => fired++);
    (
      svc as unknown as { selector: { selected$: BehaviorSubject<string[]> } }
    ).selector.selected$.next(['other-widget']);
    expect(svc.focusedNodeId).toBeNull();
    expect(fired).toBe(1);
    sub.unsubscribe();
    svc.dispose();
  });

  it('getFocusFrame：根/子节点焦点都返回该节点本体世界 rect；无焦点返回 null', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    // vm 桩：root (100,50) + 节点局部 rect (10,20,80,30)
    svc.focusedNodeId = model.root.id;
    expect(svc.getFocusFrame()).toEqual({ x: 110, y: 70, width: 80, height: 30 });
    // 子节点同样给框（既有设计点任意 MIND_NODE 都在节点本体上画蓝框——
    // 只给根画框曾让子节点「没有选中态」）
    svc.focusedNodeId = model.root.children[0]!.id;
    expect(svc.getFocusFrame()).toEqual({ x: 110, y: 70, width: 80, height: 30 });
    svc.dispose();
  });

  it('isNodeFocused：子节点 true / 根 false / 无焦点 false', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    expect(svc.isNodeFocused()).toBe(false); // 根（默认焦点）
    svc.focusedNodeId = model.root.children[0]!.id;
    expect(svc.isNodeFocused()).toBe(true);
    svc.focusedNodeId = 'nonexistent';
    expect(svc.isNodeFocused()).toBe(false);
    svc.dispose();
  });

  it('setFocusedNodeColor 落盘自身键；getFocusedLineColor 沿父链继承', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a', [spec('deep')])]));
    const a = model.root.children[0]!;
    // 一级分支色落盘于 a（buildYTree 按位分配）
    expect(a.toJSON().lineColor).toBeDefined();
    // 深层节点读色继承父链
    svc.focusedNodeId = a.children[0]!.id;
    expect(svc.getFocusedLineColor()).toBe(a.toJSON().lineColor);
    // 深层设置色 → 自身键落盘（分支主题语义）
    svc.setFocusedNodeColor('#123456');
    expect(a.children[0]!.toJSON().lineColor).toBe('#123456');
    expect(svc.getFocusedLineColor()).toBe('#123456');
    svc.dispose();
  });
});
