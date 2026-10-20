import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';

stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MindMapModel, buildYTree, type IMindNodeSpec } from '../widgets/mind/mindMapModel';
import { MindMapVm } from '../widgets/mind/mindMapVm';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';

/** 纯数据层测试：MindMapModel 树构建 + MindMapVm 位置/包围盒（不依赖 BoardSDK） */
function makeMapModel(spec: IMindNodeSpec): {
  model: MindMapModel;
  doc: Y.Doc;
  processor: DataProcessor;
} {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const model = new MindMapModel(processor);
  // 直接挂 doc 顶级（游离 Y.Map 事务后会被 yjs 丢弃——4.1 同款坑）
  const yMap = doc.getMap<unknown>('mm');
  doc.transact(() => {
    yMap.set('id', 'mm-1');
    yMap.set('type', 'MIND_MAP');
    yMap.set('zOrder', 'a0');
    yMap.set('root', buildYTree(processor, spec));
  });
  (model as unknown as { yData: Y.Map<unknown> }).yData = yMap;
  return { model, doc, processor };
}

function spec(text: string, kids?: IMindNodeSpec[], direction?: 'left' | 'right'): IMindNodeSpec {
  return { text, children: kids, direction };
}

describe('MindMapModel + MindMapVm（docs/11 §2/§4）', () => {
  it('MindMapModel.root 递归构建；hasRoot 延迟判断', () => {
    const { model } = makeMapModel(spec('中心主题'));
    expect(model.hasRoot()).toBe(true);
    expect(model.root.toJSON().text).toBe('中心主题');
  });

  it('MindMapVm：attach 后节点渲染 + 布局收敛（根位置 (0,0)，右侧子偏移正值）', () => {
    const { model } = makeMapModel(spec('根', [spec('右1'), spec('右2', [spec('孙1')])]));
    const vm = new MindMapVm();
    vm.setModel(model as never);
    vm.render({ x: 100, y: 100 } as never, { x: 100, y: 100 } as never);
    // 微任务布局
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        const rootVm = (vm as unknown as { nodeVms: Map<string, { x: number; nodeWidth: number }> })
          .nodeVms;
        expect(rootVm.size).toBe(4);
        resolve();
      });
    });
  });

  it('syncTree 对齐：Vm 树节点数 = Model 树节点数', async () => {
    const { model } = makeMapModel(spec('根', [spec('a'), spec('b', [spec('c')])]));
    const vm = new MindMapVm();
    vm.setModel(model as never);
    vm.render({ x: 0, y: 0 } as never, { x: 0, y: 0 } as never);
    await new Promise((r) => setTimeout(r, 10)); // 微任务合批布局
    const internal = vm as unknown as { nodeVms: Map<string, unknown> };
    expect(internal.nodeVms.size).toBe(4);
    vm.dispose();
  });

  it('深层建子渲染（回归 2026-09 实测）：Tab 建孙节点后 Vm 树与 Model 树一致', async () => {
    const { model, doc, processor } = makeMapModel(spec('根', [spec('子')]));
    const vm = new MindMapVm();
    vm.setModel(model as never);
    vm.render({ x: 0, y: 0 } as never, { x: 0, y: 0 } as never);
    await new Promise((r) => setTimeout(r, 10));
    const internal = vm as unknown as { nodeVms: Map<string, unknown> };
    expect(internal.nodeVms.size).toBe(2);

    // 深层变化：往「子」的 yChildren push 孙节点——只订根的旧实现监听不到
    const child = model.root.children[0]!;
    doc.transact(() => child.yChildList.push([buildYTree(processor, spec('孙'))]));
    await new Promise((r) => setTimeout(r, 10));
    expect(internal.nodeVms.size).toBe(3);
    vm.dispose();
  });

  it('深层删子渲染：删除孙节点后 Vm 同步销毁', async () => {
    const { model, doc } = makeMapModel(spec('根', [spec('子', [spec('孙')])]));
    const vm = new MindMapVm();
    vm.setModel(model as never);
    vm.render({ x: 0, y: 0 } as never, { x: 0, y: 0 } as never);
    await new Promise((r) => setTimeout(r, 10));
    const internal = vm as unknown as { nodeVms: Map<string, unknown> };
    expect(internal.nodeVms.size).toBe(3);

    const child = model.root.children[0]!;
    doc.transact(() => child.yChildList.delete(0, 1));
    await new Promise((r) => setTimeout(r, 10));
    expect(internal.nodeVms.size).toBe(2);
    vm.dispose();
  });

  it('getBounds 语义 = 视觉包围盒（含左树负向偏移），选区框/框选/命中共用（2026-09 修正）', async () => {
    const { model } = makeMapModel(spec('根', [spec('左', [], 'left'), spec('右')]));
    const vm = new MindMapVm();
    vm.setModel(model as never);
    vm.render({ x: 0, y: 0 } as never, { x: 0, y: 0 } as never);
    await new Promise((r) => setTimeout(r, 10));
    const b = vm.getBounds();
    // 左树存在 → 包围盒左缘越过锚点（负 x）；根锚定在 (0,0)
    expect(b.x).toBeLessThan(0);
    expect(b.width).toBeGreaterThan(0);
    // 锚点平移后包围盒跟随（偏移相对锚点不变）
    vm.render({ x: 100, y: 100 } as never, { x: 100, y: 100 } as never);
    await new Promise((r) => setTimeout(r, 10));
    const b2 = vm.getBounds();
    expect(b2.x).toBe(100 + b.x);
    vm.dispose();
  });

  it('布局收敛后广播 onStateChanged$（选区框/ActionBar 重读几何的契约，回归 0×0 塌缩）', async () => {
    const { model } = makeMapModel(spec('根', [spec('子')]));
    const vm = new MindMapVm();
    const emissions: Array<Record<string, unknown>> = [];
    vm.onStateChanged$.subscribe((e) => emissions.push(e as unknown as Record<string, unknown>));
    vm.setModel(model as never);
    vm.render({ x: 0, y: 0 } as never, { x: 0, y: 0 } as never);
    await new Promise((r) => setTimeout(r, 10));
    // 布局微任务后至少一次广播；包围盒非 0（选区框重画即有正确尺寸）
    expect(emissions.length).toBeGreaterThanOrEqual(1);
    expect(vm.getBounds().width).toBeGreaterThan(0);
    vm.dispose();
  });
});
