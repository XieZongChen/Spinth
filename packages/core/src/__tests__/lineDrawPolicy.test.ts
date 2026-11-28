// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BehaviorSubject } from 'rxjs';
import { LineDrawSession } from '../widgets/line/lineDrawSession';
import {
  axisAnchorWithInset,
  MESSAGE_ASYNC_POLICY,
  MESSAGE_RETURN_POLICY,
  MESSAGE_SYNC_POLICY,
  type ILineDrawPolicy,
} from '../widgets/line/lineAxisAnchor';
import type { IRect } from '../common/geometry';
import type { JoinDir } from '../widgets/line/lineMathTypes';

/**
 * 消息拉线策略（specs/sequence-diagram §4.2–§4.4 / §4.6，批次 2）：
 * ① 策略缺省 = 原路径，普通件上的创建数据与此前逐字节相等、无 startPort 键；
 * ② 有策略：按下必须落在轴宿主上、草稿走非跟踪 origin 不入撤销栈、落定 = 非跟踪
 *    删草稿 + 跟踪事务建终线、落空取消零痕迹（撤销栈不变、慢拖也不复活草稿）；
 * ③ 自消息：同轴纵向 ≥ 8 落 ELBOWED 自环，< 8 取消。
 * 引擎桩用真 Yjs 文档 + 与 HistoryService 同配置的 UndoManager，captureTimeout 取 0
 * （不合并：每个被跟踪的事务各成一步撤销——fake timers 推进不了 yjs 读的时钟，
 * 取 0 比模拟「慢拖」更严：草稿若被跟踪，创建 / 移动 / 取消会各留一步）。
 * 夹具：生命线 A（轴 x=260）、B（轴 x=660），轴段都是 y 136…620；普通形状 S (800,100,120,80)。
 */

const AXES = { l1: 260, l2: 660 };
const SHAPE: IRect = { x: 800, y: 100, width: 120, height: 80 };

/** barHalfAt：某条生命线在某高度上的激活条半宽（缺省恒 0 = 无条）——草稿终点的条边让位 */
function makeHarness(
  policy?: ILineDrawPolicy,
  barHalfAt?: (lifelineId: string, y: number) => number,
) {
  const yDoc = new Y.Doc();
  const yWidgets = yDoc.getArray<Y.Map<unknown>>();
  const undo = new Y.UndoManager(yWidgets, { ignoreRemoteMapChanges: true, captureTimeout: 0 });
  const order: string[] = [];
  const transactOrigins: unknown[] = [];
  const yOf = (id: string) =>
    yWidgets.toArray().find((m) => m.get('id') === id) as Y.Map<unknown> | undefined;
  const engine = {
    genInitialOrder: () => 'a0',
    add: vi.fn((data: Record<string, unknown>) => {
      yDoc.transact(() => {
        const yMap = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(data)) yMap.set(k, v);
        yWidgets.push([yMap]);
      });
      order.push(`add:${String(data.id)}`);
      return { id: data.id as string };
    }),
    removeByIds: vi.fn((ids: string[]) => {
      yDoc.transact(() => {
        for (const id of ids) {
          const i = yWidgets.toArray().findIndex((m) => m.get('id') === id);
          if (i >= 0) yWidgets.delete(i, 1);
        }
      });
      order.push(`remove:${ids.join(',')}`);
    }),
    getModelById: (id: string | null) => {
      const yMap = id ? yOf(id) : undefined;
      if (!yMap) return undefined;
      return {
        toJSON: () => Object.fromEntries(Object.entries(yMap.toJSON())) as Record<string, unknown>,
        update: (patch: Record<string, unknown>) =>
          yDoc.transact(() => {
            for (const [k, v] of Object.entries(patch)) yMap.set(k, v);
          }),
      };
    },
    transact: vi.fn((fn: () => void, origin?: unknown) => {
      transactOrigins.push(origin);
      return yDoc.transact(fn, origin);
    }),
  };
  const lifeline = (id: string, x: number) => {
    const rect = { x: x - 60, y: 100, width: 120, height: 520 };
    const axis = { x, top: 136, bottom: 620 };
    return {
      id,
      type: 'LIFELINE' as const,
      getBounds: () => rect,
      getLocalRect: () => rect,
      getHostGeom: () => ({ rect, rotation: 0 }),
      isRouteObstacle: () => false,
      getAxisAnchor: () => axis,
      getAnchorPoint: (join: JoinDir, t = 0.5) =>
        axisAnchorWithInset(
          axis,
          join,
          t,
          barHalfAt?.(id, axis.top + (axis.bottom - axis.top) * t) ?? 0,
        ),
    };
  };
  const shape = {
    id: 's1',
    type: 'SHAPE' as const,
    getBounds: () => SHAPE,
    getHostGeom: () => ({ rect: SHAPE, rotation: 0 }),
    isRouteObstacle: () => false,
  };
  const vms: Array<ReturnType<typeof lifeline> | typeof shape> = [
    lifeline('l1', AXES.l1),
    lifeline('l2', AXES.l2),
    shape,
  ];
  const onAxis = (p: { x: number; y: number }) =>
    vms.filter(
      (v) =>
        v.type === 'LIFELINE' &&
        Math.abs(p.x - v.getAxisAnchor().x) <= 6 &&
        p.y >= 136 &&
        p.y <= 620,
    );
  const insideShape = (p: { x: number; y: number }) =>
    p.x >= SHAPE.x &&
    p.x <= SHAPE.x + SHAPE.width &&
    p.y >= SHAPE.y &&
    p.y <= SHAPE.y + SHAPE.height;
  const vmEngine = {
    getAllVms: () => vms,
    // 草稿 / 终线的 vm：applyMove 经 previewRoute 画预览（真实链路由 vmEngine 同步建）
    getVmById: (id: string) =>
      vms.find((v) => v.id === id) ??
      (yOf(id)
        ? {
            id,
            type: 'LINE',
            previewRoute: () => {},
            getHostGeom: () => ({ rect: { x: 0, y: 0, width: 0, height: 0 }, rotation: 0 }),
          }
        : undefined),
    getVmByPoint: (p: { x: number; y: number }) =>
      insideShape(p) ? [shape, ...onAxis(p)] : onAxis(p),
    getVmsInRect: () => [],
  };
  const setSelected = vi.fn((ids: string[]) => order.push(`select:${ids[0] ?? ''}`));
  const host = {
    overlay: null,
    getDefaultLineType: () => 'ELBOWED' as const,
    getDefaultStrokeWidth: () => 2,
    gridSnapOn: () => false,
    onSettled: () => order.push('onSettled'),
    getDrawPolicy: policy ? () => policy : undefined,
  };
  const session = new LineDrawSession(
    {
      vpScale$: new BehaviorSubject(1),
      clientToWorld: (x: number, y: number) => ({ x, y }),
    } as never,
    engine as never,
    vmEngine as never,
    { setSelected } as never,
    { stopCapturing: () => order.push('stopCapturing') } as never,
    host as never,
  );
  const evt = (x: number, y: number): never =>
    ({
      world: { x, y, clone: () => ({ x, y }) },
      screen: { x, y },
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      raw: { x, y },
    }) as never;
  const ids = () => yWidgets.toArray().map((m) => m.get('id'));
  /** 一次完整的消息手势（move 经节流定时器落草稿，再松手落定） */
  const draw = (from: [number, number], to: [number, number]): void => {
    session.pointerDown(evt(from[0], from[1]));
    session.pointerMove(evt(to[0], to[1]));
    vi.advanceTimersByTime(34);
    session.pointerUp(evt(to[0], to[1]));
  };
  /** 先做一步可撤销的普通创建，作为「撤销栈基线」 */
  const baseline = (): void => {
    engine.add({ id: 'pre', type: 'SHAPE', x: 0, y: 0, width: 10, height: 10 });
    order.length = 0;
  };
  return {
    session,
    engine,
    undo,
    order,
    transactOrigins,
    setSelected,
    evt,
    ids,
    draw,
    baseline,
    yWidgets,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('策略缺省：原路径（S8 逐字节不变）', () => {
  it('普通件上拉线：engine.add 直调（不包事务）、创建数据无 startPort 键', () => {
    const h = makeHarness();
    h.session.pointerDown(h.evt(905, 105)); // 形状 S 内、靠顶边
    expect(h.engine.transact).not.toHaveBeenCalled();
    expect(h.engine.add).toHaveBeenCalledTimes(1);
    const data = h.engine.add.mock.calls[0]![0] as Record<string, unknown>;
    expect(data).toEqual({
      id: expect.any(String),
      type: 'LINE',
      zOrder: 'a0',
      points: [
        [860, 100],
        [860, 100],
      ],
      startNodeId: 's1',
      endNodeId: null,
      startJoin: 'top',
      endJoin: null,
      color: '#4b5563',
      strokeWidth: 2,
      startArrow: 'none',
      endArrow: 'arrow',
      lineType: 'ELBOWED',
    });
    expect('startPort' in data).toBe(false);
  });

  it('轴宿主上拉线（无策略）：按指针侧选边、写显式 4 位小数端口；线型仍是会话默认', () => {
    const h = makeHarness();
    h.session.pointerDown(h.evt(262, 300));
    expect(h.engine.transact).not.toHaveBeenCalled();
    const data = h.engine.add.mock.calls[0]![0] as Record<string, unknown>;
    expect(data).toMatchObject({
      startNodeId: 'l1',
      startJoin: 'right',
      startPort: 0.3388,
      lineType: 'ELBOWED',
      endArrow: 'arrow',
    });
    expect(data.points).toEqual([
      [255, 299.98],
      [255, 299.98],
    ]);
  });
});

describe('有策略：按下、草稿与落定', () => {
  it('按下在轴上 → 草稿经非跟踪事务建立：带 startPort 与预设样式，不入撤销栈', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.session.pointerDown(h.evt(262, 300));
    expect(h.transactOrigins).toEqual(['sequence-draft']);
    expect(h.engine.add.mock.calls[0]![0]).toMatchObject({
      type: 'LINE',
      startNodeId: 'l1',
      startJoin: 'right',
      startPort: 0.3388,
      lineType: 'ELBOWED',
      startArrow: 'none',
      endArrow: 'solid',
      dashed: false,
      // 消息标签在线上方（§4.3 / §4.9）：预设随草稿写入，落定时透传到终线
      textSide: 'above',
    });
    expect(h.undo.undoStack.length).toBe(0);
  });

  it('起点不在轴上（普通形状 / 空白）→ 不建线，零写入', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.session.pointerDown(h.evt(905, 105));
    h.session.pointerUp(h.evt(905, 105));
    h.session.pointerDown(h.evt(1200, 800));
    h.session.pointerUp(h.evt(1200, 800));
    expect(h.engine.add).not.toHaveBeenCalled();
    expect(h.engine.transact).not.toHaveBeenCalled();
  });

  it('拖到另一条轴：草稿终点钳到起点高度，预览为两点直线', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.session.pointerDown(h.evt(262, 300));
    const draftId = h.ids()[0] as string;
    h.session.pointerMove(h.evt(662, 350)); // 指针比起点低 50——高度仍锁定
    vi.advanceTimersByTime(34);
    expect(h.engine.getModelById(draftId)!.toJSON()).toMatchObject({
      endNodeId: 'l2',
      points: [
        [255, 299.98],
        [665, 299.98],
      ],
    });
    h.session.pointerUp(h.evt(662, 350));
  });

  it('草稿终点经宿主锚点单源（条边让位）：终点高度上有激活条 → 草稿终点停在条边', () => {
    // l2 轴上、终点高度处有半宽 5 的条：锚点 x = 轴 + (5 − 留隙 5) = 轴（无条是 665）
    const h = makeHarness(MESSAGE_SYNC_POLICY, (id, y) =>
      id === 'l2' && Math.abs(y - 299.98) < 0.01 ? 5 : 0,
    );
    h.session.pointerDown(h.evt(262, 300));
    const draftId = h.ids()[0] as string;
    h.session.pointerMove(h.evt(662, 350));
    vi.advanceTimersByTime(34);
    expect(h.engine.getModelById(draftId)!.toJSON()).toMatchObject({
      endNodeId: 'l2',
      points: [
        [255, 299.98],
        [660, 299.98],
      ],
    });
    h.session.pointerUp(h.evt(662, 350));
  });

  it('落定在另一条轴：非跟踪删草稿 → 跟踪建终线（STRAIGHT、join 归一、两端端口）→ 重排 → 收窗 → 选中新线', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.draw([262, 300], [662, 350]);
    const draftId = (h.engine.add.mock.calls[0]![0] as { id: string }).id;
    const final = h.engine.add.mock.calls[1]![0] as Record<string, unknown>;
    expect(h.order).toEqual([
      `add:${draftId}`,
      `remove:${draftId}`,
      `add:${final.id}`,
      'onSettled',
      'stopCapturing',
      `select:${final.id}`,
    ]);
    expect(final).toMatchObject({
      startNodeId: 'l1',
      endNodeId: 'l2',
      startJoin: 'right',
      endJoin: 'left',
      startPort: 0.3388,
      endPort: 0.3388,
      lineType: 'STRAIGHT',
      startArrow: 'none',
      endArrow: 'solid',
      textSide: 'above',
      points: [
        [255, 299.98],
        [665, 299.98],
      ],
    });
    expect(h.ids()).toEqual([final.id]);
    expect(h.setSelected).toHaveBeenCalledWith([final.id]);
  });

  it('从右往左画：join 按方向归一（起点 left、终点 right）', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.draw([658, 200], [258, 250]);
    const final = h.engine.add.mock.calls[1]![0] as Record<string, unknown>;
    expect(final).toMatchObject({ startJoin: 'left', endJoin: 'right' });
    expect(final.points).toEqual([
      [665, 199.98],
      [255, 199.98],
    ]);
  });

  it('返回 / 异步预设落库：虚线 + 开放箭头 + 标签在线上方', () => {
    const ret = makeHarness(MESSAGE_RETURN_POLICY);
    ret.draw([262, 300], [662, 350]);
    expect(ret.engine.add.mock.calls[1]![0]).toMatchObject({
      dashed: true,
      endArrow: 'arrow',
      textSide: 'above',
    });
    const async = makeHarness(MESSAGE_ASYNC_POLICY);
    async.draw([262, 300], [662, 350]);
    expect(async.engine.add.mock.calls[1]![0]).toMatchObject({
      dashed: false,
      endArrow: 'arrow',
      textSide: 'above',
    });
  });

  it('一步撤销 = 建出这条消息；撤销后草稿不复活，重做恢复', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.draw([262, 300], [662, 350]);
    // 草稿的创建与逐帧移动都不是撤销步：栈里只有终线这一步
    expect(h.undo.undoStack.length).toBe(1);
    h.undo.undo();
    expect(h.ids()).toEqual([]);
    h.undo.redo();
    expect(h.ids()).toHaveLength(1);
  });
});

describe('有策略：落空取消', () => {
  it('松手在空白：模型与撤销栈都不变，不选中、不收窗', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.baseline();
    expect(h.undo.undoStack.length).toBe(1);
    h.draw([262, 300], [1200, 800]);
    expect(h.ids()).toEqual(['pre']);
    expect(h.undo.undoStack.length).toBe(1);
    expect(h.setSelected).not.toHaveBeenCalled();
    expect(h.order).not.toContain('stopCapturing');
  });

  it('草稿的创建 / 移动 / 取消各自成一个事务时撤销栈仍不变——草稿从未入栈，撤销不会把它复活', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.baseline();
    h.session.pointerDown(h.evt(262, 300));
    vi.advanceTimersByTime(34);
    h.session.pointerMove(h.evt(1200, 800));
    h.session.pointerUp(h.evt(1200, 800));
    expect(h.ids()).toEqual(['pre']);
    expect(h.undo.undoStack.length).toBe(1);
    // 草稿若入过栈（创建一步、取消删除一步），这一步撤销会把已取消的草稿复活成悬空线
    h.undo.undo();
    expect(h.ids()).toEqual([]);
  });

  it('松手在普通形状上同样取消', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.draw([262, 300], [905, 140]);
    expect(h.ids()).toEqual([]);
    expect(h.undo.undoStack.length).toBe(0);
  });
});

describe('有策略：自消息', () => {
  it('同轴纵向拖 ≥ 8：保留 ELBOWED、4 点环朝按下侧、两端端口 = 按下 / 松手高度', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.draw([262, 200], [262, 260]); // 轴右侧按下
    const final = h.engine.add.mock.calls[1]![0] as Record<string, unknown>;
    expect(final).toMatchObject({
      startNodeId: 'l1',
      endNodeId: 'l1',
      startJoin: 'right',
      endJoin: 'right',
      startPort: 0.1322,
      endPort: 0.2562,
      lineType: 'ELBOWED',
    });
    expect(final.points).toEqual([
      [255, 199.98],
      [285, 199.98],
      [285, 260],
      [255, 260],
    ]);
    expect(h.undo.undoStack.length).toBe(1);
  });

  it('左侧按下：环朝左', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.draw([258, 200], [258, 260]);
    const final = h.engine.add.mock.calls[1]![0] as Record<string, unknown>;
    expect(final).toMatchObject({ startJoin: 'left', endJoin: 'left' });
    expect(final.points).toEqual([
      [265, 199.98],
      [235, 199.98],
      [235, 260],
      [265, 260],
    ]);
  });

  it('纵向间距 < 8：不画环，落定取消（零痕迹）', () => {
    const h = makeHarness(MESSAGE_SYNC_POLICY);
    h.baseline();
    h.draw([262, 200], [262, 205]);
    expect(h.ids()).toEqual(['pre']);
    expect(h.undo.undoStack.length).toBe(1);
    expect(h.setSelected).not.toHaveBeenCalled();
  });
});
