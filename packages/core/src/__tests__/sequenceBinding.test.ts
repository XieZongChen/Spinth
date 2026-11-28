// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceService } from '../widgets/sequence/sequenceService';
import { composeCascadeLookup } from '../widgets/sequence/sequenceCascade';
import { VmEngineService } from '../platform/vmEngine/vmEngineService';
import { SpatialIndex } from '../platform/spatial/spatialIndex';
import { ServiceRegistry, type Token } from '../platform/registry/serviceRegistry';
import { Tokens } from '../tokens';
import { WIDGET_RUNTIME } from '../widgetRuntime';
import { createEngineForTest } from './helpers/createEngineForTest';
import type { IBaseWidgetVm } from '../types';
import type { IRect } from '../common/geometry';

/**
 * 激活条绑定写入（specs/sequence-diagram §5.1 / §5.2 / §5.5，批次 3）：真 Y.Doc +
 * 真引擎 + 真 VM（LifelineVm / ActivationVm）下，reconcileActivations /
 * adoptActivationsByLanding / expandActivations / barsOf 的落库语义与撤销粒度。
 * 「拖拽」= selectorDragOps.commitDrag 的事务段（位移 + 绑定判定同事务，随后关窗）。
 *
 * 夹具：l1 轴 x = 300、轴段 y 136…700；l2 轴 x = 304（zOrder 更高）；条 10×80。
 */

type Doc = Record<string, unknown>;

const L1 = {
  id: 'l1',
  type: 'LIFELINE',
  zOrder: 'a1',
  label: '',
  x: 240,
  y: 100,
  width: 120,
  height: 600,
};
const L2 = {
  id: 'l2',
  type: 'LIFELINE',
  zOrder: 'a2',
  label: '',
  x: 244,
  y: 100,
  width: 120,
  height: 600,
};
const bar = (id: string, x: number, extra: Record<string, unknown> = {}): Doc => ({
  id,
  type: 'ACTIVATION',
  zOrder: 'a3',
  x,
  y: 300,
  width: 10,
  height: 80,
  ...extra,
});
/** 中心线落在 cx 的条 */
const barAt = (id: string, cx: number, extra: Record<string, unknown> = {}): Doc =>
  bar(id, cx - 5, extra);

let seqNo = 0;
const envs: Array<() => void> = [];
afterEach(() => {
  for (const dispose of envs.splice(0)) dispose();
});

async function makeEnv(widgets: Doc[]) {
  const { engine, history } = await createEngineForTest(`seq-binding-${++seqNo}`);
  const registry = new ServiceRegistry();
  registry.registerSingleton(Tokens.ViewportService, () => ({
    vpScale$: new BehaviorSubject(1),
  }));
  const vmTokens = new Map<string, Token<IBaseWidgetVm>>();
  for (const t of ['LIFELINE', 'ACTIVATION'] as const) {
    registry.register(WIDGET_RUNTIME[t].vmToken, WIDGET_RUNTIME[t].createVm);
    vmTokens.set(t, WIDGET_RUNTIME[t].vmToken);
  }
  const vmEngine = new VmEngineService(
    engine,
    registry,
    vmTokens,
    { addWidget() {}, removeWidget() {}, setZOrder() {} } as never,
    new SpatialIndex(),
  );
  vmEngine.initialize();
  const line = { drawHandlers: {}, drawPolicyProbe: null, reattach: vi.fn() };
  const seq = new SequenceService(
    {
      registerGlobalEventListener() {},
      vpScale$: new BehaviorSubject(1),
      cursorMode$: new BehaviorSubject('sequence'),
      editable$: new BehaviorSubject(true),
      setCursorMode() {},
    } as never,
    vmEngine,
    { handlers: {} } as never,
    line as never,
    { engine, history, selector: { setSelected() {} } } as never,
  );
  for (const w of widgets) engine.add(w as never);
  history.stopCapturing(); // 搭建与被测操作分成两步撤销

  const doc = (id: string): Doc => engine.getModelById(id)!.toJSON() as unknown as Doc;
  /** selectorDragOps.commitDrag 的事务段：位移 + 绑定判定（rectOf = 初值 + 位移的算术矩形） */
  const drag = (id: string, dx: number, dy: number) => {
    // 上一手势 / 搭建的写入已合批渲染（真实交互里两次手势之间必有一帧）
    for (const v of vmEngine.getAllVms()) v.flushUpdate();
    const vm = vmEngine.getVmById(id)!;
    const init = vm.getLocalRect();
    const rectOf = (x: string): IRect =>
      x === id
        ? { ...init, x: init.x + dx, y: init.y + dy }
        : (engine.getModelById(x)?.toJSON() as unknown as IRect);
    engine.transact(() => {
      vm.commitDrag(init, dx, dy);
      seq.reconcileActivations([id], rectOf);
    });
    history.stopCapturing();
  };
  const adopt = (ids: string[]) => {
    for (const v of vmEngine.getAllVms()) v.flushUpdate();
    engine.transact(() => seq.adoptActivationsByLanding(ids));
    history.stopCapturing();
  };
  envs.push(() => {
    seq.dispose();
    vmEngine.dispose();
    history.dispose();
    engine.dispose();
    registry.dispose();
  });
  return {
    engine,
    history,
    vmEngine,
    seq,
    line,
    doc,
    drag,
    adopt,
  };
}

type Env = Awaited<ReturnType<typeof makeEnv>>;

/** 纯容器 + 激活条的复合查找（等价组合根的 sdk.cascade，这里没有容器语义） */
function compose(env: Env) {
  const frame = {
    isFrame: () => false,
    childIds: () => [] as string[],
    expandForCascade: (ids: string[]) => ids,
    reconcileParents: () => {},
    adoptByLanding: () => {},
    computeLayerClamps: () => [] as Array<{ id: string; zOrder: string }>,
    createMarqueeFrameFilter: () => null,
  };
  return composeCascadeLookup(frame, env.seq);
}

describe('绑定写入：拖放（§5.1 / §5.2）', () => {
  it('拖入：贴合轴即绑定并归中；与移动同一事务——一步 undo 位置与绑定一起回', async () => {
    const env = await makeEnv([L1, barAt('b1', 400)]);
    env.drag('b1', -105, 0); // 中心线落到 295：距轴 5，容差内
    expect(env.doc('b1')).toMatchObject({ x: 295, y: 300, lifelineId: 'l1' });
    expect(env.seq.expandActivations(['l1'])).toEqual(['b1']);
    env.history.undo();
    expect(env.doc('b1')).toMatchObject({ x: 395, y: 300 });
    expect(env.doc('b1').lifelineId).toBeUndefined(); // 解绑写 undefined（groupId / parentId 清除同款）
  });

  it('拖出：中心线离开容差即解绑；拖回容差内复绑并归中', async () => {
    const env = await makeEnv([L1, barAt('b1', 300, { lifelineId: 'l1' })]);
    env.drag('b1', 40, 0);
    expect(env.doc('b1')).toMatchObject({ x: 335 });
    expect(env.doc('b1').lifelineId).toBeUndefined(); // 解绑写 undefined（groupId / parentId 清除同款）
    expect(env.seq.expandActivations(['l1'])).toEqual([]);
    env.drag('b1', -37, 0); // 中心线 303：距轴 3
    expect(env.doc('b1')).toMatchObject({ x: 295, lifelineId: 'l1' });
  });

  it('沿轴纵向拖：绑定不变、x 不动；微移（← 3px）被归中抵消——净位移为零', async () => {
    const env = await makeEnv([L1, barAt('b1', 300, { lifelineId: 'l1' })]);
    env.drag('b1', 0, 50);
    expect(env.doc('b1')).toMatchObject({ x: 295, y: 350, lifelineId: 'l1' });
    env.drag('b1', 3, 0);
    expect(env.doc('b1')).toMatchObject({ x: 295, y: 350, lifelineId: 'l1' });
  });

  it('多条生命线命中：取 zOrder 最上者', async () => {
    const env = await makeEnv([L1, L2, barAt('b1', 302)]); // 距 l1 轴 2、距 l2 轴 2
    env.drag('b1', 1, 0);
    expect(env.doc('b1').lifelineId).toBe('l2');
    expect(env.doc('b1').x).toBe(299); // l2 轴 304 − 5
  });

  it('选区里不是激活条的件不触发绑定判定（同批拖动生命线与普通件零写）', async () => {
    const env = await makeEnv([L1, barAt('b1', 300, { lifelineId: 'l1' })]);
    const before = env.doc('b1');
    env.engine.transact(() =>
      env.seq.reconcileActivations(['l1'], () => ({ x: 0, y: 0, width: 0, height: 0 })),
    );
    expect(env.doc('b1')).toEqual(before);
  });
});

describe('随行：展开与查询（§5.3 / §5.4 / §5.5）', () => {
  it('expandActivations：生命线 → 其绑定的条（zOrder 升序）；未绑定的条与无关 id 不并入', async () => {
    const env = await makeEnv([
      L1,
      barAt('bHigh', 300, { lifelineId: 'l1', zOrder: 'a5' }),
      barAt('bLow', 300, { lifelineId: 'l1', zOrder: 'a2' }),
      barAt('free', 380),
    ]);
    expect(env.seq.expandActivations(['l1'])).toEqual(['bLow', 'bHigh']);
    expect(env.seq.expandActivations(['free'])).toEqual([]);
    expect(env.seq.expandActivations([])).toEqual([]);
  });

  it('barsOf：只给绑定在该生命线上的条，矩形预览敏感（拖拽预览随 root 走）', async () => {
    const env = await makeEnv([L1, barAt('b1', 300, { lifelineId: 'l1' }), barAt('free', 380)]);
    expect(env.seq.barsOf('l1')).toEqual([{ x: 295, y: 300, width: 10, height: 80 }]);
    const vm = env.vmEngine.getVmById('b1')!;
    vm.flushUpdate(); // 首帧渲染后世界矩形才跟 root 的预览走
    vm.applyDragPreview(vm.getLocalRect(), 0, 30);
    expect(env.seq.barsOf('l1')).toEqual([{ x: 295, y: 330, width: 10, height: 80 }]);
    expect(env.seq.barsOf('nobody')).toEqual([]);
  });

  it('删生命线经复合查找连带删条；删条后 barsOf 即空，undo 复活时绑定仍在、redo 可用', async () => {
    const env = await makeEnv([L1, L2, barAt('b1', 300, { lifelineId: 'l1' })]);
    const cascade = compose(env);
    expect(cascade.expandForCascade(['l1'])).toEqual(['l1', 'b1']);
    env.engine.removeByIds(cascade.expandForCascade(['l1']));
    expect(env.engine.getModelById('b1')).toBeUndefined();

    const env2 = await makeEnv([L1, barAt('b1', 300, { lifelineId: 'l1' })]);
    env2.engine.removeByIds(['b1']);
    env2.history.stopCapturing();
    expect(env2.seq.barsOf('l1')).toEqual([]);
    env2.history.undo();
    expect(env2.doc('b1').lifelineId).toBe('l1');
    expect(env2.seq.expandActivations(['l1'])).toEqual(['b1']);
    expect(env2.history.canRedo$.value).toBe(true);
    env2.history.redo();
    expect(env2.engine.getModelById('b1')).toBeUndefined();
  });
});

describe('粘贴收尾：落点重绑（§5.4）', () => {
  it('无绑定的副本落在轴上 → 绑定并归中，同事务重路由宿主（条边让位）', async () => {
    const env = await makeEnv([L1, barAt('copy', 303)]);
    env.adopt(['copy']);
    expect(env.doc('copy')).toMatchObject({ x: 295, lifelineId: 'l1' });
    expect(env.line.reattach).toHaveBeenCalledTimes(1);
    const [hostId, geom] = env.line.reattach.mock.calls[0]! as [string, { rect: IRect }];
    expect(hostId).toBe('l1');
    expect(geom.rect).toMatchObject({ x: 240, y: 100, width: 120, height: 600 }); // 模型矩形算术
    env.history.undo();
    expect(env.doc('copy')).toMatchObject({ x: 298 });
    expect(env.doc('copy').lifelineId).toBeUndefined();
  });

  it('已绑定的副本与不在轴上的副本都不动（孤儿值也不改写）', async () => {
    const env = await makeEnv([
      L1,
      barAt('bound', 300, { lifelineId: 'l9' }), // 孤儿绑定：批外宿主
      barAt('off', 380),
    ]);
    const before = [env.doc('bound'), env.doc('off')];
    env.adopt(['bound', 'off', 'l1']);
    expect([env.doc('bound'), env.doc('off')]).toEqual(before);
    expect(env.line.reattach).not.toHaveBeenCalled();
  });
});
