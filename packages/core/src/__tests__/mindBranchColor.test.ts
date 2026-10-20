// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
import { mindViewportStub } from './helpers/mindViewportStub';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { MindService } from '../widgets/mind/mindService';
import { EditingService } from '../platform/textEngine/editingService';
import {
  MindMapModel,
  buildYTree,
  BRANCH_COLORS,
  nextBranchColor,
  type IMindNodeSpec,
} from '../widgets/mind/mindMapModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';

/**
 * 拖拽搬移颜色规则回归（docs/11 §6：「移入根节点分配色、跨脑图强制重分配、
 * 移入普通节点清空继承新父」——2026-09-20 复审遗留②③收口）。
 */

function makeService(specTree: IMindNodeSpec) {
  const doc = new Y.Doc();
  const processor = new DataProcessor(doc);
  const model = new MindMapModel(processor);
  const yMap = doc.getMap<unknown>('mm');
  doc.transact(() => {
    yMap.set('id', 'mm-1');
    yMap.set('type', 'MIND_MAP');
    yMap.set('zOrder', 'a0');
    yMap.set('root', buildYTree(processor, specTree));
  });
  model.initializeY(yMap);
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  const vm = {
    type: 'MIND_MAP',
    id: 'mm-1',
    root: { x: 0, y: 0 },
    rects,
    getNodeRect: (id: string) => rects.get(id) ?? null,
    getNodeVm: (id: string) => (rects.has(id) ? { depth: 1, fontSize: 18 } : null),
    setNodeAlpha: () => {},
    setFocusedNode: () => {},
    hitNode: () => null,
  };
  const adds: Array<Record<string, unknown>> = [];
  const viewport = {
    registerGlobalEventListener: () => {},
    setCursorMode: () => {},
    cursorMode$: new BehaviorSubject('cursor'),
    curPos$: new BehaviorSubject<null>(null),
    optionLayer: { addChild: () => {} },
    vpScale$: new BehaviorSubject(1),
    ...mindViewportStub(),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 2000, height: 2000 }),
    toScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
  };
  const engine = {
    add: (d: Record<string, unknown>) => {
      adds.push(d);
      return 'mm-2';
    },
    removeByIds: () => {},
    genInitialOrder: () => 'a1',
    getModelById: (id: string) => (id === 'mm-1' ? model : null),
    transact: (fn: () => void) => fn(),
  };
  const vmEngine = {
    getVmById: (id: string) => (id === 'mm-1' ? vm : null),
    getAllVms: () => [vm as never],
    getVmByPoint: () => [],
  };
  const selector = { selected$: new BehaviorSubject<string[]>(['mm-1']), setSelected: () => {} };
  const svc = new MindService(
    viewport as never,
    engine as never,
    vmEngine as never,
    selector as never,
    { stopCapturing: () => {} } as never,
    new EditingService(
      viewport as never,
      engine as never,
      selector as never,
      { stopCapturing: () => {} } as never,
    ) as never,
  );
  return { svc, model, rects, adds };
}

const spec = (
  text: string,
  kids?: IMindNodeSpec[],
  direction?: 'left' | 'right',
): IMindNodeSpec => ({
  text,
  children: kids,
  direction,
});

/** 热区：根(0,0) A(100,100) C(300,100)，C 的子 C1(400,100)——点 C1 = asSibling(parent=C) */
function setRects(
  rootId: string,
  aId: string,
  cId: string,
  c1Id: string,
  rects: Map<string, { x: number; y: number; width: number; height: number }>,
): void {
  rects.set(rootId, { x: 0, y: 0, width: 60, height: 26 });
  rects.set(aId, { x: 100, y: 100, width: 60, height: 24 });
  rects.set(cId, { x: 300, y: 100, width: 60, height: 24 });
  rects.set(c1Id, { x: 400, y: 100, width: 60, height: 24 });
}

describe('move 颜色规则（docs/11 §6，复审遗留②）', () => {
  it('移入普通节点：lineColor 清空（继承新父分支色）——曾透传保留旧色', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('C', [spec('C1')])]));
    const a = model.root.children[0]!;
    const c = model.root.children[1]!;
    const c1 = c.children[0]!;
    setRects(model.root.id, a.id, c.id, c1.id, rects);
    expect(a.toJSON().lineColor).toBeDefined(); // 原一级分支带色

    svc.startDrag('mm-1', a.id, { x: 0, y: 0 });
    svc.dragMove({ x: 410, y: 105 }); // C1 热区 → asSibling(parent=C)
    expect(svc.dragEnd({ x: 410, y: 105 })).toBe('moved');
    const moved = c.children.find((n) => n.toJSON().text === 'A')!;
    expect(moved.toJSON().lineColor).toBeUndefined(); // 清空——继承 C 的分支色
    expect(moved.getLineColor(c.toJSON().lineColor!)).toBe(c.toJSON().lineColor);
    svc.dispose();
  });

  it('移入根节点：分配未占用分支色', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('C')]));
    const a = model.root.children[0]!;
    setRects(model.root.id, a.id, 'none1', 'none2', rects);
    // 先把 C 挪走再拖 A 回根：A 换位后应得未占用色
    svc.startDrag('mm-1', a.id, { x: 0, y: 0 });
    svc.dragMove({ x: 30, y: 13 }); // 根本体 → asChild(root)
    expect(svc.dragEnd({ x: 30, y: 13 })).toBe('moved');
    const colors = model.root.children.map((n) => n.toJSON().lineColor);
    expect(new Set(colors).size).toBe(colors.length); // 全互异（不撞）
    for (const c2 of colors) expect(BRANCH_COLORS).toContain(c2);
    svc.dispose();
  });

  it('同图移入根：保留自身原色（既有设计 move Rule 1.1：带色且同图不重分配）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('C')]));
    const a = model.root.children[0]!;
    const own = a.toJSON().lineColor!;
    expect(own).toBeDefined();
    setRects(model.root.id, a.id, 'none1', 'none2', rects);
    svc.startDrag('mm-1', a.id, { x: 0, y: 0 });
    svc.dragMove({ x: 30, y: 13 }); // 根本体 → 作为根的一级分支重排
    expect(svc.dragEnd({ x: 30, y: 13 })).toBe('moved');
    const moved = model.root.children.find((c) => c.toJSON().text === 'A')!;
    expect(moved.toJSON().lineColor).toBe(own); // 同图内换位不改色
    svc.dispose();
  });

  it('拖出成新图：spec 剥离分支色（跨脑图强制重分配）', () => {
    const { svc, model, rects, adds } = makeService(spec('根', [spec('A', [spec('子')])]));
    const a = model.root.children[0]!;
    setRects(model.root.id, a.id, 'none1', 'none2', rects);
    svc.startDrag('mm-1', a.id, { x: 0, y: 0 });
    svc.dragMove({ x: 800, y: 800 }); // 空白
    expect(svc.dragEnd({ x: 800, y: 800 })).toBe('new-map');
    expect(adds.length).toBe(1);
    const rootSpec = adds[0]!.root as IMindNodeSpec;
    expect(rootSpec.lineColor).toBeUndefined(); // 新图根不带拖来色
    // 原二级「子」升为一级分支——由 buildYTree 按位分配（children 交给建树路径）
    svc.dispose();
  });
});

describe('根层取色撞色规避（复审遗留③）', () => {
  it('nextBranchColor：中间插入位被占用时取第一个未占用色', () => {
    const used = new Set([BRANCH_COLORS[0], BRANCH_COLORS[2]]);
    expect(nextBranchColor(used, 2)).toBe(BRANCH_COLORS[3]!); // 位 2 已占 → 顺延
    expect(nextBranchColor(used, 1)).toBe(BRANCH_COLORS[1]!); // 位 1 空闲 → 按位
    const all = new Set([...BRANCH_COLORS]);
    expect(BRANCH_COLORS).toContain(nextBranchColor(all, 0)); // 全占用循环复用
  });

  it('删中间分支后再建子：不与末尾既有分支撞色', () => {
    const { svc, model } = makeService(spec('根'));
    svc.focusedNodeId = model.root.id;
    svc.addChild(); // 色板[0]
    svc.focusedNodeId = model.root.id;
    svc.addChild(); // 色板[1]
    // 删第一个（色[0] 空出），再建 → 得色[0] 而非按位 length=1 的色[1]（已占）
    svc.focusedNodeId = model.root.children[0]!.id;
    svc.deleteFocused();
    svc.focusedNodeId = model.root.id;
    svc.addChild();
    const colors = model.root.children.map((n) => n.toJSON().lineColor);
    expect(new Set(colors).size).toBe(colors.length);
    svc.dispose();
  });
});
