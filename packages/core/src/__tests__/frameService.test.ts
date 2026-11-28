import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { FrameService } from '../widgets/frame/frameService';
import { FRAME_DEFAULT_SIZE } from '../widgets/frame/frameGeometry';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IVmEngineService,
} from '../types';

/**
 * FrameService 归属/级联/移出（specs/container-frame §4.1/§4.2/§4.5/§5.3）——
 * 编排桩（docs/15 三层）：引擎/选区/历史全桩，只验 FrameService 的编排语义。
 */

interface StubWidget {
  id: string;
  type: string;
  zOrder: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
  startNodeId?: string | null;
  endNodeId?: string | null;
}

const W = (
  id: string,
  type: string,
  z: string,
  rect: [number, number, number, number],
  extra: Partial<StubWidget> = {},
): StubWidget => ({
  id,
  type,
  zOrder: z,
  x: rect[0],
  y: rect[1],
  width: rect[2],
  height: rect[3],
  ...extra,
});

function makeEnv(widgets: StubWidget[], opts: { editable?: boolean; selected?: string[] } = {}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let transactCount = 0;
  const models = new Map(
    widgets.map((w) => [
      w.id,
      {
        toJSON: () => ({ ...w }),
        update: (patch: Record<string, unknown>) => {
          updates.push({ id: w.id, patch });
          Object.assign(w, patch);
        },
        updateRect: (patch: Partial<StubWidget>) => Object.assign(w, patch),
      },
    ]),
  );
  const engine = {
    getModelById: (id: string) => models.get(id),
    transact: (fn: () => void) => {
      transactCount++;
      fn();
    },
  };
  const vms = widgets.map((w) => ({ id: w.id, type: w.type }));
  const vmEngine = {
    getAllVms: () => vms,
    getVmById: (id: string) => vms.find((v) => v.id === id),
  };
  const selected$ = new BehaviorSubject<string[]>(opts.selected ?? []);
  const history = { stopCapturing: vi.fn() };
  const viewport = { editable$: new BehaviorSubject(opts.editable ?? true) };
  const svc = new FrameService(
    viewport as never,
    engine as unknown as IDataEngineService,
    vmEngine as unknown as IVmEngineService,
    { selected$ } as unknown as ISelectorService,
    history as unknown as IHistoryService,
    null,
  );
  return {
    svc,
    updates,
    history,
    selected$,
    viewport,
    widget: (id: string) => widgets.find((w) => w.id === id),
    get transactCount() {
      return transactCount;
    },
  };
}

describe('FrameService 创建工具（§4.1）', () => {
  it('createWidget：写 {type:FRAME, zOrder, color, rect}，缺省样式走 schema', () => {
    const added: Array<Record<string, unknown>> = [];
    const engine = {
      add: (w: Record<string, unknown>) => {
        added.push(w);
        return { id: String(w.id) };
      },
      genInitialOrder: () => 'a0',
    };
    const svc = new FrameService(
      {} as never,
      engine as never,
      {} as never,
      {} as never,
      {} as never,
      null,
    );
    (
      svc as unknown as { createWidget: (x: number, y: number, w: number, h: number) => string }
    ).createWidget(100, 50, 320, 220);
    expect(added[0]).toMatchObject({
      type: 'FRAME',
      zOrder: 'a0',
      color: '#ffffff',
      x: 100,
      y: 50,
      width: 320,
      height: 220,
    });
    expect('title' in added[0]!).toBe(false);
    expect(FRAME_DEFAULT_SIZE).toEqual({ width: 320, height: 220 });
  });
});

describe('isFrame / childIds / expandForCascade（§6.4）', () => {
  it('childIds：按 zOrder 升序；锚定线运行时排除（I2）；FRAME/树不入', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 400, 300]),
      W('c2', 'SHAPE', 'a3', [10, 40, 50, 50], { parentId: 'f1' }),
      W('c1', 'SHAPE', 'a1', [10, 40, 50, 50], { parentId: 'f1' }),
      W('anchored', 'LINE', 'a2', [10, 40, 60, 60], { parentId: 'f1', startNodeId: 'x' }),
      W('freeline', 'LINE', 'a4', [10, 40, 60, 60], { parentId: 'f1' }),
      W('orphan', 'SHAPE', 'a5', [10, 40, 50, 50], { parentId: 'gone' }),
    ]);
    expect(env.svc.isFrame('f1')).toBe(true);
    expect(env.svc.isFrame('c1')).toBe(false);
    expect(env.svc.childIds('f1')).toEqual(['c1', 'c2', 'freeline']);
    // 孤儿父（gone 非活容器）不会被级联触达：expandForCascade 只对 isFrame 展开
    expect(env.svc.isFrame('gone')).toBe(false);
    expect(env.svc.expandForCascade(['orphan'])).toEqual(['orphan']);
  });

  it('expandForCascade：容器并入子元素、去重保序；非容器原样', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 400, 300]),
      W('c1', 'SHAPE', 'a1', [10, 40, 50, 50], { parentId: 'f1' }),
      W('c2', 'SHAPE', 'a2', [100, 40, 50, 50], { parentId: 'f1' }),
    ]);
    expect(env.svc.expandForCascade(['f1', 'c1'])).toEqual(['f1', 'c1', 'c2']);
    expect(env.svc.expandForCascade(['c1'])).toEqual(['c1']);
  });
});

describe('reconcileParents 归属判定与写入（§2.4/§4.2）', () => {
  it('拖出完全离开 → 清父；相交不全含 → 不写', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 100, 100]),
      W('s1', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }),
    ]);
    // 完全离开（s1 拖到 200,200）
    env.svc.reconcileParents(['s1'], (id) =>
      id === 's1' ? { x: 200, y: 200, width: 50, height: 50 } : env.widget(id)!,
    );
    expect(env.updates).toEqual([{ id: 's1', patch: { parentId: undefined } }]);
    // 相交但不全含（跨界）→ 零写
    env.updates.length = 0;
    Object.assign(env.widget('s1')!, { x: 80, y: 80 });
    env.svc.reconcileParents(['s1'], (id) =>
      id === 's1' ? { x: 80, y: 80, width: 50, height: 50 } : env.widget(id)!,
    );
    expect(env.updates).toEqual([]);
  });

  it('拖入全含 → 设父；FRAME 自身与锚定线不归属（I1/I2 写侧拒绝）', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('s1', 'SHAPE', 'a1', [500, 500, 50, 50]),
      W('f2', 'FRAME', 'a2', [400, 400, 500, 500]),
      W('ln', 'LINE', 'a3', [10, 10, 60, 60], { startNodeId: 's1' }),
      W('freeline', 'LINE', 'a4', [10, 10, 60, 60]),
    ]);
    // 外部形状拖进 f2：设父 + f2 钳到子之下（f2 'a2' > s1 'a1' 倒置 → 钳制写）
    env.svc.reconcileParents(['s1'], (id) =>
      id === 's1' ? { x: 450, y: 450, width: 50, height: 50 } : env.widget(id)!,
    );
    const parentWrite = env.updates.find((u) => u.id === 's1')!;
    expect(parentWrite.patch).toEqual({ parentId: 'f2' });
    const clampWrite = env.updates.find((u) => u.id === 'f2');
    expect(clampWrite).toBeDefined();
    expect((clampWrite!.patch.zOrder as string) < 'a1').toBe(true); // I3：容器压回子之下
    // 容器自身 / 锚定线：零写
    env.updates.length = 0;
    env.svc.reconcileParents(['f2', 'ln'], (id) => env.widget(id)!);
    expect(env.updates).toEqual([]);
    // 自由线：线不随拖拽 / 微移平移（LineVm.commitDrag 空操作），rectOf 给的是
    // 「初值 + 位移」的虚拟位置——旧实现按它判定，把没动的线收进容器。连线一律
    // 不参与落点判定（即使虚拟位置完全落在容器内）
    env.svc.reconcileParents(['freeline'], (id) =>
      id === 'freeline' ? { x: 450, y: 450, width: 60, height: 60 } : env.widget(id)!,
    );
    expect(env.updates).toEqual([]);
  });

  it('LIFELINE 不归属：完全落进容器也零写（schema 无 parentId，specs/sequence-diagram S5）', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('lf', 'LIFELINE', 'a1', [500, 500, 120, 520]),
    ]);
    env.svc.reconcileParents(['lf'], () => ({ x: 50, y: 20, width: 120, height: 200 }));
    expect(env.updates).toEqual([]);
    // 创建 / 粘贴落点路径同拒
    env.svc.adoptByLanding(['lf']);
    expect(env.updates).toEqual([]);
  });

  it('ACTIVATION 同样不归属（S5：绑定归生命线，不归容器）——拖放 / 创建 / 粘贴落点三路零写', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('lf', 'LIFELINE', 'a1', [500, 500, 120, 520]),
      W('bar', 'ACTIVATION', 'a2', [495, 600, 10, 80], { parentId: undefined }),
    ]);
    env.svc.reconcileParents(['bar'], () => ({ x: 140, y: 100, width: 10, height: 80 }));
    expect(env.updates).toEqual([]);
    env.svc.adoptByLanding(['bar']);
    env.svc.adoptOnCreate('bar');
    expect(env.updates).toEqual([]);
  });

  it('连线不参与落点判定：带 parentId 的自由线按虚拟位置「完全离开」也不清父', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('freeline', 'LINE', 'a1', [10, 10, 60, 60], { parentId: 'f1' }),
    ]);
    env.svc.reconcileParents(['freeline'], (id) =>
      id === 'freeline' ? { x: 900, y: 900, width: 60, height: 60 } : env.widget(id)!,
    );
    expect(env.updates).toEqual([]);
  });

  it('REVIEW 返工（P1）：拖入归属后容器必须在子之下——先内容后画容器的场景', () => {
    // 场景：先有形状（zOrder 低）、后画泳道（zOrder 高、白底盖住形状）、
    // 再把形状拖进泳道——parentId 写入的同时容器必须钳到形状之下，
    // 否则形状被容器底色盖住「看不见」（数据在、可命中）
    const env = makeEnv([
      W('s1', 'SHAPE', 'a0', [500, 100, 50, 50]),
      W('f1', 'FRAME', 'a1', [100, 100, 400, 300]), // zOrder 高于 s1（后画）
    ]);
    env.svc.reconcileParents(['s1'], (id) =>
      id === 's1' ? { x: 150, y: 150, width: 50, height: 50 } : env.widget(id)!,
    );
    expect(env.updates.some((u) => u.id === 's1' && u.patch.parentId === 'f1')).toBe(true);
    const clamp = env.updates.find((u) => u.id === 'f1');
    expect(clamp, '归属写入必须同事务钳制容器 zOrder').toBeDefined();
    expect((clamp!.patch.zOrder as string) < 'a0').toBe(true); // f1 压到 s1 之下
    // 钳制不切撤销窗（I6）：归属 + 钳制留在调用方的事务内，由调用方收口
    expect(env.history.stopCapturing).not.toHaveBeenCalled();
  });

  it('清父分支零钳制写（脱离容器不动 zOrder）', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a1', [0, 0, 100, 100]), // 容器本来倒置（高于子）
      W('s1', 'SHAPE', 'a0', [10, 10, 50, 50], { parentId: 'f1' }),
    ]);
    // 完全拖出 → 清父；不触发钳制（与该容器已无父子关系）
    env.svc.reconcileParents(['s1'], (id) =>
      id === 's1' ? { x: 500, y: 500, width: 50, height: 50 } : env.widget(id)!,
    );
    expect(env.updates).toEqual([{ id: 's1', patch: { parentId: undefined } }]);
  });

  it('父也在移动集：parentRect 走 rectOf（含位移），不读 model 旧值', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 100, 100]),
      W('s1', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }),
    ]);
    // 容器与子一起拖 +200：模型还停旧位（事务内未刷新），rectOf 才是真相
    env.svc.reconcileParents(['s1'], (id) => {
      const w = env.widget(id)!;
      return { x: w.x + 200, y: w.y + 200, width: w.width, height: w.height };
    });
    // 仍全含于（移动后的）父 → null 零写
    expect(env.updates).toEqual([]);
  });

  it('adoptOnCreate：创建即归属；只读宿主不写', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('s1', 'SHAPE', 'a1', [10, 10, 50, 50]),
    ]);
    env.svc.adoptOnCreate('s1');
    expect(env.updates).toEqual([{ id: 's1', patch: { parentId: 'f1' } }]);
    env.viewport.editable$.next(false);
    env.updates.length = 0;
    env.svc.adoptOnCreate('s1');
    expect(env.updates).toEqual([]); // 只读早退
  });

  it('adoptOnCreate：已有父的件不重判（审查三轮 P2 红探针）——即使完全在父容器外', () => {
    // 「缩小容器」会让子元素完全落在父框外而仍持有 parentId（缩放不重判）；
    // 粘贴/恢复带着这个 parentId 重建模型时，创建路径不得按 rule 3 清父
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [200, 0, 100, 300]), // f1: 200..300
      W('c2', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }), // 框外
    ]);
    env.svc.adoptOnCreate('c2');
    expect(env.updates).toEqual([]); // 曾写 { parentId: undefined }
    // 父指向尚不存在的容器（程序化批量建件 [子, 容器] 序：子先建）同样不动
    const env2 = makeEnv([
      W('c3', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'not-yet' }),
      W('f9', 'FRAME', 'a2', [0, 0, 300, 300]), // 别的容器全含它——不得改挂
    ]);
    env2.svc.adoptOnCreate('c3');
    expect(env2.updates).toEqual([]);
  });

  it('adoptOnCreate：画笔与自由线不参与——模型矩形是占位值，按矩形判会被盖住左上角的容器误收', () => {
    // PEN / LINE 落笔即建件：建件数据不含矩形，模型矩形取默认 {0,0,100,100}，
    // 与 points 的实际位置无关。占位矩形落在左上角容器内 → 曾被收走
    // （E2E container C-17：别处画的笔画成了该容器的子元素）
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('pen1', 'PEN', 'a1', [0, 0, 100, 100]), // points 实际在别处
      W('ln1', 'LINE', 'a2', [0, 0, 100, 100], { startNodeId: null, endNodeId: null }),
    ]);
    env.svc.adoptOnCreate('pen1');
    env.svc.adoptOnCreate('ln1');
    expect(env.updates).toEqual([]);
    // 对照：同位置的形状照常归属（守卫只挡这两类）
    const env2 = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('s1', 'SHAPE', 'a1', [10, 10, 50, 50]),
    ]);
    env2.svc.adoptOnCreate('s1');
    expect(env2.updates).toEqual([{ id: 's1', patch: { parentId: 'f1' } }]);
  });
});

describe('adoptByLanding（自动归属的落点判定，§4.2/§4.7）', () => {
  it('无父件完全落进容器 → 设父；跨出边界 → 不写（与拖放落点同款全含判据）', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [500, 0, 300, 300]), // 500..800
      W('in', 'SHAPE', 'a1', [520, 20, 50, 50]),
      W('edge', 'SHAPE', 'a2', [780, 20, 50, 50]), // 780..830：跨出右边界
    ]);
    env.svc.adoptByLanding(['in', 'edge']);
    expect(env.updates).toEqual([{ id: 'in', patch: { parentId: 'f1' } }]);
  });

  it('已带 parentId 的件不动——即使完全在父容器外（粘贴「容器 + 框外子」的副本）', () => {
    // 交给三态判据会按「完全离开」清父，副本与原件分叉（审查三轮 P2）
    const env = makeEnv([
      W('f2', 'FRAME', 'a0', [0, 0, 300, 300]), // 另一个容器全含它——也不得改挂
      W('c2', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }), // f1 不在（批内父已映射）
      W('c3', 'SHAPE', 'a2', [10, 100, 50, 50], { parentId: 'f2' }),
    ]);
    env.svc.adoptByLanding(['c2', 'c3']);
    expect(env.updates).toEqual([]);
  });

  it('容器 / 画笔 / 连线不参与', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('f2', 'FRAME', 'a1', [10, 10, 100, 100]), // 容器不归属（单层）
      W('pen1', 'PEN', 'a2', [0, 0, 100, 100]), // 模型矩形是占位值
      W('ln1', 'LINE', 'a3', [0, 0, 100, 100], { startNodeId: null, endNodeId: null }),
    ]);
    env.svc.adoptByLanding(['f2', 'pen1', 'ln1']);
    expect(env.updates).toEqual([]);
  });
});

describe('computeLayerClamps / detachSelection（I3/§4.8/§5.3）', () => {
  it('computeLayerClamps：变更后表中容器在子之上 → 返回钳制写入（多容器顺序）', () => {
    const env = makeEnv([
      W('x', 'SHAPE', 'a0', [0, 0, 10, 10]),
      W('c1', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }),
      W('c2', 'SHAPE', 'a2', [10, 10, 50, 50], { parentId: 'f2' }),
      W('f1', 'FRAME', 'a3', [0, 0, 300, 300]),
      W('f2', 'FRAME', 'a4', [500, 0, 300, 300]),
    ]);
    // 图层「置顶 f1/f2」后的变更后表：两容器都被抬到全部子之上
    // （fractional-indexing 合法键：generateKeyBetween 序列）
    const gk = (prev: string) => {
      // 生成 prev 之后的合法键（顺序单调即可——本测试只需字典序语义）
      return prev + '5';
    };
    const f1Top = gk('a2'); // > a2
    const f2Top = gk(f1Top); // > f1Top
    const post = [
      { id: 'x', zOrder: 'a0' },
      { id: 'c1', zOrder: 'a1' },
      { id: 'c2', zOrder: 'a2' },
      { id: 'f1', zOrder: f1Top },
      { id: 'f2', zOrder: f2Top },
    ];
    const clamps = env.svc.computeLayerClamps(post);
    const byId = new Map(clamps.map((c) => [c.id, c.zOrder]));
    expect(byId.get('f1')).toBeDefined();
    expect(byId.get('f1')! < 'a1').toBe(true); // f1 压回 c1 之下
    expect(byId.get('f2')).toBeDefined();
    expect(byId.get('f2')! < 'a2').toBe(true); // f2 压回 c2 之下
  });

  it('computeLayerClamps：无需钳制返回空数组', () => {
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('c1', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }),
    ]);
    expect(
      env.svc.computeLayerClamps([
        { id: 'f1', zOrder: 'a0' },
        { id: 'c1', zOrder: 'a1' },
      ]),
    ).toEqual([]);
  });
  it('设父钳制：容器已在全部子之下时零钳制写（只写 parentId）', () => {
    // 归属钳制的唯一生产入口是 reconcileParents 的设父分支（独立钳制入口已删——
    // 图层命令走 computeLayerClamps，粘贴靠容器先入批无需事后钳制）
    const env = makeEnv([
      W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
      W('s1', 'SHAPE', 'a1', [500, 500, 50, 50]),
    ]);
    env.svc.reconcileParents(['s1'], (id) =>
      id === 's1' ? { x: 10, y: 10, width: 50, height: 50 } : env.widget(id)!,
    );
    expect(env.updates).toEqual([{ id: 's1', patch: { parentId: 'f1' } }]);
  });

  it('detachSelection：选中集中有父的清父（单事务）；无父零动作', () => {
    const env = makeEnv(
      [
        W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
        W('c1', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }),
        W('c2', 'SHAPE', 'a2', [100, 10, 50, 50], { parentId: 'f1' }),
      ],
      { selected: ['c1', 'c2'] },
    );
    expect(env.svc.canDetachSelection()).toBe(true);
    env.svc.detachSelection();
    expect(env.updates).toEqual([
      { id: 'c1', patch: { parentId: undefined } },
      { id: 'c2', patch: { parentId: undefined } },
    ]);
    expect(env.transactCount).toBe(1); // 单事务一步 undo
    env.updates.length = 0;
    expect(env.svc.canDetachSelection()).toBe(false);
    env.svc.detachSelection();
    expect(env.updates).toEqual([]);
  });

  it('detachSelection：只读早退', () => {
    const env = makeEnv(
      [
        W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
        W('c1', 'SHAPE', 'a1', [10, 10, 50, 50], { parentId: 'f1' }),
      ],
      { selected: ['c1'], editable: false },
    );
    expect(env.svc.canDetachSelection()).toBe(false);
    env.svc.detachSelection();
    expect(env.updates).toEqual([]);
  });

  it('detachSelection：锚定线拒绝（I2 写侧）——清 stale 字段只产出无意义 undo 项', () => {
    const env = makeEnv(
      [
        W('f1', 'FRAME', 'a0', [0, 0, 300, 300]),
        W('anchored', 'LINE', 'a1', [10, 10, 60, 60], {
          parentId: 'f1', // 自由期归属后转锚定的 stale 字段
          startNodeId: 'host',
        }),
      ],
      { selected: ['anchored'] },
    );
    expect(env.svc.canDetachSelection()).toBe(false); // 惰性数据：不可移出
    env.svc.detachSelection();
    expect(env.updates).toEqual([]); // 零写零事务
  });
});
