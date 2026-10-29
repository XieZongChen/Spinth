import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import * as Y from 'yjs';
import { MindService } from '../widgets/mind/mindService';
import { EditingService } from '../platform/textEngine/editingService';
import { MindMapModel, branchColorAt, buildYTree, yTreeToSpec } from '../widgets/mind/mindMapModel';
import { DataProcessor } from '../platform/dataEngine/dataProcessor';
import { makeService, makeTreeService, spec } from './helpers/mindServiceFixture';

describe('MindService 方向键导航逻辑（docs/11 §7）', () => {
  it('navigate：无焦点时返回 false（不拦截）', () => {
    const svc = makeService();
    expect(svc.navigate('ArrowLeft')).toBe(false);
    svc.dispose();
  });

  it('方向语义：左树 ← 是子节点、→ 是父节点（右树相反）', () => {
    // 纯逻辑验证：isLeft 判断的对称性
    // 右树：ArrowRight → goChild、ArrowLeft → goParent
    // 左树：ArrowLeft → goChild、ArrowRight → goParent
    //（完整节点树导航走集成测试——这里验证逻辑骨架无异常）
    const svc = makeService();
    svc.focusedNodeId = null;
    expect(svc.navigate('ArrowUp')).toBe(false);
    svc.dispose();
  });
});

describe('MindService 建节点 + 焦点流（docs/11 §8，4.6 AddButtons 支撑）', () => {
  it('addChild(direction)：根下按入参分配侧向；不传默认右侧', () => {
    const { svc, model } = makeTreeService(spec('根'));
    svc.addChild('left');
    const last = model.root.children[model.root.children.length - 1]!;
    expect(last.toJSON().direction).toBe('left');
    // 建子后焦点移到新节点——回根再建（Tab 语义：焦点在哪就建谁的子）
    svc.focusedNodeId = model.root.id;
    svc.addChild();
    const last2 = model.root.children[model.root.children.length - 1]!;
    expect(last2.toJSON().direction).toBe('right');
    svc.dispose();
  });

  it('addChild：非根焦点下 direction 不落库（仅根的直接子节点有效）', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.focusedNodeId = model.root.children[0]!.id;
    svc.addChild('left');
    const child = model.root.children[0]!.children[0]!;
    expect(child.toJSON().direction).toBeUndefined();
    svc.dispose();
  });

  it('addChild：根层插入侧按既有设计三规则（子数≥3 时插少的一侧）', () => {
    // 3 个子：右、右、左 → 左侧少 → 新分支插左侧
    const { svc, model } = makeTreeService(
      spec('根', [
        spec('r1', undefined, 'right'),
        spec('r2', undefined, 'right'),
        spec('l1', undefined, 'left'),
      ]),
    );
    svc.focusedNodeId = model.root.id;
    svc.addChild();
    const added = model.root.children[model.root.children.length - 1]!;
    expect(added.toJSON().direction).toBe('left');
    svc.dispose();
  });

  it('addChild：子数 < 3 时即使已有左子也插右侧（规则二优先）', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('l1', undefined, 'left')]));
    svc.focusedNodeId = model.root.id;
    svc.addChild();
    const added = model.root.children[model.root.children.length - 1]!;
    expect(added.toJSON().direction).toBe('right');
    svc.dispose();
  });

  it('addSibling：根节点上 Enter 退化为建子节点（既有设计 isRoot → insertMindChild）', () => {
    const { svc, model } = makeTreeService(spec('根'));
    svc.focusedNodeId = model.root.id;
    svc.addSibling();
    expect(model.root.children.length).toBe(1);
    expect(svc.focusedNodeId).toBe(model.root.children[0]!.id);
    svc.dispose();
  });

  it('新节点带默认文案「子节点 N」（N = 父当前子数 + 1，既有设计同款）', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a'), spec('b')]));
    svc.focusedNodeId = model.root.id;
    svc.addChild();
    expect(model.root.children[2]!.toJSON().text).toBe('子节点 3');
    // 建同级同样按父的子数递增（焦点已在新节点上）
    svc.addSibling();
    expect(model.root.children[3]!.toJSON().text).toBe('子节点 4');
    svc.dispose();
  });

  it('建子后 focusChanged$ 发射且焦点落新节点', () => {
    const { svc, model } = makeTreeService(spec('根'));
    let fired = 0;
    const sub = svc.focusChanged$.subscribe(() => fired++);
    svc.addChild();
    expect(fired).toBe(1);
    expect(svc.focusedNodeId).toBe(model.root.children[0]!.id);
    sub.unsubscribe();
    svc.dispose();
  });

  it('deleteFocused：删该侧最后一个一级分支 → 焦点回根（不跳到另一侧）', () => {
    const { svc, model } = makeTreeService(
      spec('根', [spec('L', undefined, 'left'), spec('R', undefined, 'right')]),
    );
    const l = model.root.children[0]!;
    svc.focusedNodeId = l.id;
    svc.deleteFocused();
    expect(model.root.children.map((c) => c.id)).toEqual([model.root.children[0]!.id]); // 只剩 R
    expect(svc.focusedNodeId).toBe(model.root.id);
    svc.dispose();
  });

  it('deleteFocused：优先同侧后兄弟，末位则前兄弟', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a'), spec('b'), spec('c')]));
    const [a, b, c] = [model.root.children[0]!, model.root.children[1]!, model.root.children[2]!];
    svc.focusedNodeId = b.id;
    svc.deleteFocused();
    expect(svc.focusedNodeId).toBe(c.id);
    svc.focusedNodeId = model.root.children[model.root.children.length - 1]!.id; // 原 c
    svc.deleteFocused();
    expect(svc.focusedNodeId).toBe(a.id);
    svc.dispose();
  });

  it('deleteFocused：兄弟全删完 → 焦点递归到父', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('p', [spec('c1')]), spec('q')]));
    const p = model.root.children[0]!;
    const c1 = p.children[0]!;
    svc.focusedNodeId = c1.id;
    svc.deleteFocused();
    expect(svc.focusedNodeId).toBe(p.id);
    svc.dispose();
  });

  it('getFocusedState：方向沿父链继承（左树深层 → left）+ 世界 rect = map root + 节点局部 rect', () => {
    // 根 → L(left) → S → SS（SS 与 S 均无 direction 键）
    const { svc, model } = makeTreeService(
      spec('根', [spec('L', [spec('S', [spec('SS')])], 'left')]),
    );
    const s = model.root.children[0]!.children[0]!;
    const ss = s.children[0]!;
    svc.focusedNodeId = ss.id;
    const st = svc.getFocusedState()!;
    expect(st.direction).toBe('left');
    expect(st.isRoot).toBe(false);
    expect(st.mapId).toBe('mm-1');
    // vm 桩：root (100,50) + rect (10,20,80,30)
    expect(st.worldRect).toEqual({ x: 110, y: 70, width: 80, height: 30 });
    svc.dispose();
  });

  it('navigate 方向继承修复：左树两层以下 → 是父节点（旧实现只看一层 parent 会判成右树）', () => {
    const { svc, model } = makeTreeService(
      spec('根', [spec('L', [spec('S', [spec('SS')])], 'left')]),
    );
    const s = model.root.children[0]!.children[0]!;
    const ss = s.children[0]!;
    svc.focusedNodeId = ss.id;
    // 左树：ArrowRight = 向父 → 焦点应移到 S（旧实现误判右树 → goChild 不动）
    svc.navigate('ArrowRight');
    expect(svc.focusedNodeId).toBe(s.id);
    svc.dispose();
  });

  it('根焦点：↓/↑ 无兄弟不动作，←/→ 分别落到左右子树（既有设计 moveChildren(side)）', () => {
    const { svc, model } = makeTreeService(
      spec('根', [spec('L', undefined, 'left'), spec('R', undefined, 'right')]),
    );
    const [l, r] = [model.root.children[0]!, model.root.children[1]!];
    svc.focusedNodeId = model.root.id;
    expect(svc.navigate('ArrowDown')).toBe(true);
    expect(svc.focusedNodeId).toBe(model.root.id); // 根无兄弟，焦点不动
    svc.navigate('ArrowLeft');
    expect(svc.focusedNodeId).toBe(l.id);
    svc.focusedNodeId = model.root.id;
    svc.navigate('ArrowRight');
    expect(svc.focusedNodeId).toBe(r.id);
    svc.dispose();
  });

  it('↑↓ 同侧扫描 + 到边界上溯叔节点下钻（既有设计 getNearestSibling）', () => {
    const { svc, model } = makeTreeService(
      spec('根', [spec('p1', [spec('p1a'), spec('p1b')]), spec('p2', [spec('p2a')])]),
    );
    const p1 = model.root.children[0]!;
    const [p1a, p1b] = [p1.children[0]!, p1.children[1]!];
    const p2a = model.root.children[1]!.children[0]!;
    svc.focusedNodeId = p1b.id;
    svc.navigate('ArrowDown'); // 同父无后兄弟 → 上溯叔节点 p2 → 下钻其首子
    expect(svc.focusedNodeId).toBe(p2a.id);
    svc.navigate('ArrowUp'); // 反向：叔节点 p1 → 其末子
    expect(svc.focusedNodeId).toBe(p1b.id);
    svc.navigate('ArrowUp');
    expect(svc.focusedNodeId).toBe(p1a.id);
    svc.dispose();
  });

  it('方向键在脑图焦点下被消费（返回 true）——不落回 1px 微移', () => {
    const { svc, model } = makeTreeService(spec('根', [spec('a')]));
    svc.focusedNodeId = model.root.children[0]!.id;
    expect(svc.navigate('ArrowUp')).toBe(true); // 无兄弟也消费
    expect(svc.navigate('ArrowLeft')).toBe(true);
    expect(svc.navigate('KeyA')).toBe(false); // 非方向键不消费
    svc.dispose();
  });

  it('焦点视窗跟随：节点在安全区内不动，超出左/右/下边才按对齐规则平移', () => {
    const { svc, model, nodeRect, pans } = makeTreeService(spec('根', [spec('a')]));
    const a = model.root.children[0]!;
    // 节点世界 rect = vm.root(100,50) + nodeRect；安全区 x∈[10,790]、y∈[10,504]
    nodeRect.x = 10; // → 屏幕 [110,190] × [70,100]：完全在内
    svc.focusedNodeId = a.id;
    svc.addSibling(); // 触发 emitFocus（焦点落新节点）
    expect(pans.length).toBe(0);

    // 节点跑到右侧安全区外 → 负向平移（右边缘对齐）
    pans.length = 0;
    nodeRect.x = 900; // 屏幕右边缘 = 100+900+80 = 1080 > 790
    svc.focusedNodeId = a.id;
    svc.addSibling();
    expect(pans.length).toBe(1);
    expect(pans[0]!.dx).toBeLessThan(0);
    expect(pans[0]!.dy).toBe(0);

    // 节点跑到下方安全区外（底部让位 96）→ 负向 y 平移
    pans.length = 0;
    nodeRect.x = 10;
    nodeRect.y = 600; // 屏幕下边缘 = 50+600+30 = 680 > 504
    svc.focusedNodeId = a.id;
    svc.addSibling();
    expect(pans.length).toBe(1);
    expect(pans[0]!.dy).toBeLessThan(0);
    svc.dispose();
  });
});

describe('分支色着色（2026-09 样式审查：色板曾只定义未消费）', () => {
  it('根下建子按插入位分配分支色；深层建子不落 lineColor（继承）', () => {
    const h = makeTreeService(spec('根'));
    h.svc.addChild('right');
    const first = h.model.root.children[0]!;
    expect(first.toJSON().lineColor).toBe(branchColorAt(0));
    // 焦点已移到新子：再建子 = 深层，不落 lineColor（渲染走父链继承）
    h.svc.addChild('right');
    const deep = first.children[0]!;
    expect(deep.toJSON().lineColor).toBeUndefined();
  });

  it('根层建同级 = 新的一级分支，按插入位取色', () => {
    const h = makeTreeService(spec('根'));
    h.svc.addChild('right'); // 一级分支 0
    h.svc.addSibling(); // 在分支 0 之后插入 = 一级分支 1
    expect(h.model.root.children[0]!.toJSON().lineColor).toBe(branchColorAt(0));
    expect(h.model.root.children[1]!.toJSON().lineColor).toBe(branchColorAt(1));
  });

  it('yTreeToSpec 透传 lineColor（拖拽搬移不丢色）', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    doc.getMap('t').set('x', m); // 挂进 doc：游离 Y.Map 的 transact 会被丢弃
    doc.transact(() => {
      m.set('id', 'mn-x');
      m.set('text', '带色节点');
      m.set('lineColor', '#e0559c');
    });
    expect(yTreeToSpec(m).lineColor).toBe('#e0559c');
  });
});

describe('AddButtons 槽位避让（2026-09 样式审查：左右按钮曾压住同侧子树）', () => {
  it('槽位边 = 焦点节点本体左右边（既有设计 mindAddBtn 定位，不扩到后代最远端）', () => {
    const doc = new Y.Doc();
    const processor = new DataProcessor(doc);
    const model = new MindMapModel(processor);
    const yMap = doc.getMap<unknown>('mm');
    doc.transact(() => {
      yMap.set('id', 'mm-1');
      yMap.set('type', 'MIND_MAP');
      yMap.set('zOrder', 'a0');
      yMap.set(
        'root',
        buildYTree(
          processor,
          spec('根', [spec('a', undefined, 'right'), spec('b', undefined, 'right')]),
        ),
      );
    });
    model.initializeY(yMap);

    // 节点布局（容器局部坐标）：根 (10,20,80,30)，a (260,10,80,30)，b (420,60,80,30)
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
    const vmStub = {
      type: 'MIND_MAP',
      id: 'mm-1',
      root: { x: 100, y: 50 },
      getNodeRect: (id: string) => rects[id] ?? { x: 0, y: 0, width: 0, height: 0 },
      getNodeVm: () => ({ depth: 1, fontSize: 18 }),
      hitNode: () => null,
      setFocusedNode: () => {},
    };
    const viewport = {
      registerGlobalEventListener: () => {},
      setCursorMode: () => {},
      cursorMode$: new BehaviorSubject('cursor'),
      curPos$: new BehaviorSubject<null>(null),
      optionLayer: { addChild: () => {} },
      vpScale$: new BehaviorSubject(1),
    };
    const engine = {
      add: () => {},
      removeByIds: () => {},
      genInitialOrder: () => 'a1',
      getModelById: () => model,
      transact: (fn: () => void) => fn(),
    };
    const vmEngine = { getVmById: () => vmStub, getVmByPoint: () => [] };
    const selector = {
      selected$: new BehaviorSubject<string[]>(['mm-1']),
      setSelected: () => {},
    };
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

    // 文本 → id（id 随机生成，测试里按文本建索引）
    const byText: Record<string, string> = {};
    const walk = (n: { id: string; toJSON(): { text: string; children?: unknown[] } }): void => {
      byText[n.toJSON().text] = n.id;
    };
    walk(model.root);
    for (const c of model.root.children) walk(c);
    rects[byText['根']!] = { x: 10, y: 20, width: 80, height: 30 };
    rects[byText['a']!] = { x: 260, y: 10, width: 80, height: 30 };
    rects[byText['b']!] = { x: 420, y: 60, width: 80, height: 30 };

    const st = svc.getFocusedState();
    expect(st).not.toBeNull();
    // 焦点在根：槽位 = 根本体左右边（世界坐标 = vm.root.x + 节点局部 rect.x）
    // ——不再扩到同侧后代最远端（那会把根节点的按钮推到整棵树两端）
    expect(st!.slotLeft).toBe(100 + 10);
    expect(st!.slotRight).toBe(100 + 10 + 80);
    expect(st!.worldRect).toEqual({ x: 110, y: 70, width: 80, height: 30 });
  });
});
