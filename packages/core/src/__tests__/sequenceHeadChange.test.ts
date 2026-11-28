// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceService } from '../widgets/sequence/sequenceService';
import { LineAnchorFollow } from '../widgets/line/lineAnchorFollow';
import { VmEngineService } from '../platform/vmEngine/vmEngineService';
import { SpatialIndex } from '../platform/spatial/spatialIndex';
import { ServiceRegistry, type Token } from '../platform/registry/serviceRegistry';
import { Tokens } from '../tokens';
import { WIDGET_RUNTIME } from '../widgetRuntime';
import { createEngineForTest } from './helpers/createEngineForTest';
import { updateSelectedStyle } from '../styleCommands';
import { axisPortFor } from '../widgets/line/lineAxisAnchor';
import { LINE_END_GAP } from '../widgets/line/linePath';
import type { IBaseWidgetVm } from '../types';

/**
 * 切换头部样式后的锚定消息（specs/sequence-diagram §7.2 末行，批次 4）：真 Y.Doc +
 * 真引擎 + 真 VM（LifelineVm / LineVm）+ 真 LineAnchorFollow。轴顶随头区高移动
 * （box 36 → actor 72）；updateSelectedStyle 在写入 head 的同一事务内重写锚定在
 * 这条生命线上的消息端口并重路由——消息高度不变（加长保高度同款，§4.7）；一步撤销
 * 同时回 head / 端口 / points。
 *
 * 夹具：l1 (240,100,120,600) 轴 x = 300、轴段 y 136…700；l2 (640,100,120,600) 轴 x = 700。
 */

type Doc = Record<string, unknown>;

const AXIS = { top: 136, bottom: 700 };
const X1 = 300;
const X2 = 700;

const lifeline = (id: string, x: number, z: string): Doc => ({
  id,
  type: 'LIFELINE',
  zOrder: z,
  label: '',
  x: x - 60,
  y: 100,
  width: 120,
  height: 600,
});

/** l1 → l2 的水平消息：两端锚在轴上，端口 = 该高度在各自轴上的比例；端点让出线端
 *  留隙（起点在轴右 5 → 落在轴左 5，终点在轴左 5 → 落在轴右 5，与落定消息同式） */
const message = (id: string, y: number, z: string): Doc => ({
  id,
  type: 'LINE',
  zOrder: z,
  startNodeId: 'l1',
  endNodeId: 'l2',
  startJoin: 'right',
  endJoin: 'left',
  startPort: axisPortFor({ x: X1, ...AXIS }, y),
  endPort: axisPortFor({ x: X2, ...AXIS }, y),
  points: [
    [X1 - LINE_END_GAP, y],
    [X2 + LINE_END_GAP, y],
  ],
  color: '#4b5563',
  strokeWidth: 2,
  startArrow: 'none',
  endArrow: 'solid',
  lineType: 'STRAIGHT',
  dashed: false,
  text: '',
  textRatio: 0.5,
});

let seqNo = 0;
const envs: Array<() => void> = [];
afterEach(() => {
  for (const dispose of envs.splice(0)) dispose();
});

async function makeEnv(widgets: Doc[]) {
  const { engine, history } = await createEngineForTest(`seq-head-${++seqNo}`);
  const registry = new ServiceRegistry();
  registry.registerSingleton(Tokens.ViewportService, () => ({
    vpScale$: new BehaviorSubject(1),
  }));
  const vmTokens = new Map<string, Token<IBaseWidgetVm>>();
  for (const t of ['LIFELINE', 'LINE'] as const) {
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
  const follow = new LineAnchorFollow(engine, vmEngine, {
    selected$: new BehaviorSubject<string[]>([]),
  } as never);
  const reattach = vi.fn((id: string, geom: never) => follow.reattach(id, geom));
  const line = { drawHandlers: {}, drawPolicyProbe: null, reattach };
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
  for (const v of vmEngine.getAllVms()) v.flushUpdate();

  const doc = (id: string): Doc => engine.getModelById(id)!.toJSON() as unknown as Doc;
  /** ActionBar「头部样式」= updateSelectedStyle({ head })，选区 = ids */
  const setHead = (ids: string[], head: 'box' | 'actor'): void => {
    updateSelectedStyle(
      {
        selector: { selected$: { value: ids } },
        viewport: { editable$: { value: true } },
        engine,
        history,
        sequence: seq,
      } as never,
      { head },
    );
  };
  envs.push(() => {
    seq.dispose();
    follow.dispose?.();
    vmEngine.dispose();
    history.dispose();
    engine.dispose();
    registry.dispose();
  });
  return { engine, history, vmEngine, seq, doc, setHead, reattach };
}

describe('切换头部样式：锚定消息保高度（specs/sequence-diagram §7.2）', () => {
  it('box → actor：其上消息高度逐值不变（端口按新轴重写）、不在这条生命线上的端不动', async () => {
    const env = await makeEnv([
      lifeline('l1', X1, 'a1'),
      lifeline('l2', X2, 'a2'),
      message('m1', 300, 'a3'),
      message('m2', 500, 'a4'),
    ]);
    const before = { m1: env.doc('m1'), m2: env.doc('m2') };
    expect(before.m1.startPort).toBe(0.2908); // (300 − 136) / 564

    env.setHead(['l1'], 'actor');

    expect(env.doc('l1').head).toBe('actor');
    for (const id of ['m1', 'm2'] as const) {
      const after = env.doc(id);
      // 起点端：端口 = 同一高度在 actor 轴（顶 172、长 528）上的比例
      const y = (before[id].points as Array<[number, number]>)[0]![1];
      expect(after.startPort).toBe(axisPortFor({ x: X1, top: 172, bottom: AXIS.bottom }, y));
      // 终点端不在 l1 上：端口原样
      expect(after.endPort).toBe(before[id].endPort);
      // 端点：y 逐值不变（4 位小数端口还原，误差 < 0.05）、x 不动（让出线端留隙）
      const pts = after.points as Array<[number, number]>;
      expect(Math.abs(pts[0]![1] - y)).toBeLessThan(0.05);
      expect(Math.abs(pts[1]![1] - y)).toBeLessThan(0.05);
      expect(pts[0]![0]).toBe(X1 - LINE_END_GAP);
      expect(pts[1]![0]).toBe(X2 + LINE_END_GAP);
    }
    // 急刻重路由只针对头部样式变了的宿主
    expect(env.reattach).toHaveBeenCalledTimes(1);
    expect(env.reattach.mock.calls[0]![0]).toBe('l1');
  });

  it('落在旧轴顶下方那条带里（136…172）的消息钳到新轴顶', async () => {
    const env = await makeEnv([
      lifeline('l1', X1, 'a1'),
      lifeline('l2', X2, 'a2'),
      message('m1', 150, 'a3'),
    ]);
    env.setHead(['l1'], 'actor');
    const after = env.doc('m1');
    expect(after.startPort).toBe(0);
    expect((after.points as Array<[number, number]>)[0]![1]).toBe(172);
  });

  it('一步撤销同时回 head / 端口 / points；重做一起回来', async () => {
    const env = await makeEnv([
      lifeline('l1', X1, 'a1'),
      lifeline('l2', X2, 'a2'),
      message('m1', 300, 'a3'),
    ]);
    const before = { l1: env.doc('l1'), m1: env.doc('m1') };
    env.setHead(['l1'], 'actor');
    const actor = { l1: env.doc('l1'), m1: env.doc('m1') };
    expect(actor.l1.head).toBe('actor');
    expect(actor.m1.startPort).not.toBe(before.m1.startPort);

    env.history.undo();
    expect(env.doc('l1')).toEqual(before.l1); // head 键回到不存在
    expect('head' in env.doc('l1')).toBe(false);
    expect(env.doc('m1')).toEqual(before.m1);

    env.history.redo();
    expect(env.doc('l1')).toEqual(actor.l1);
    expect(env.doc('m1')).toEqual(actor.m1);
  });

  it('actor → box 切回：端口与端点回到原值；重复点选当前项零写入、不重路由', async () => {
    const env = await makeEnv([
      lifeline('l1', X1, 'a1'),
      lifeline('l2', X2, 'a2'),
      message('m1', 300, 'a3'),
    ]);
    const before = env.doc('m1');
    env.setHead(['l1'], 'actor');
    env.setHead(['l1'], 'box');
    const back = env.doc('m1');
    expect(back.startPort).toBe(before.startPort);
    expect(Math.abs((back.points as Array<[number, number]>)[0]![1] - 300)).toBeLessThan(0.05);
    expect(env.doc('l1').head).toBe('box');

    // 同值：onHeadChanged 不触发——两次切换共重路由两次，再多点一次不增加
    const calls = env.reattach.mock.calls.length;
    env.setHead(['l1'], 'box');
    expect(env.reattach.mock.calls.length).toBe(calls);
  });

  it('选中集里的非生命线：head 被 schema strip，不触发重算', async () => {
    const env = await makeEnv([
      lifeline('l1', X1, 'a1'),
      lifeline('l2', X2, 'a2'),
      message('m1', 300, 'a3'),
    ]);
    const before = env.doc('m1');
    env.setHead(['m1'], 'actor');
    expect('head' in env.doc('m1')).toBe(false);
    expect(env.doc('m1')).toEqual(before);
    expect(env.reattach).not.toHaveBeenCalled();
  });
});
