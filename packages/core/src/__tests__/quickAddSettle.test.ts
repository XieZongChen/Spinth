import { describe, expect, it, vi } from 'vitest';
import { LineQuickAdd } from '../widgets/line/lineQuickAdd';
import { LineAnchorFollow } from '../widgets/line/lineAnchorFollow';
import type { IRect } from '../common/geometry';

/**
 * quick-add 点击落定重排（2026-11 用户实测「同方向两节点删其一连线扭曲」）：
 * quickAddConnectedShape 此前不触发 reattachAll——同边两线停在 t=0.5，删除
 * 目标形状时 respreadLines 才第一次物化 0.4/0.6 分配，幸存线跳槽重路由扭结。
 * 这里锁定：① onSettled 在 line.update 之后、stopCapturing 之前调用（重排
 * 并入创建捕获窗 = 单撤销单元，connect/create 两分支）；② 真实 LineAnchorFollow
 * 集成下两次同边 quick-add 即物化 0.4/0.6，随后删除目标形状幸存线 samePoints
 * 零写、悬空线按「解绑保持原位」契约不动。
 */

const A_RECT: IRect = { x: 100, y: 100, width: 120, height: 80 };

function statefulLineModel(initial: Record<string, unknown>) {
  const store = { data: { ...initial } };
  const model = {
    toJSON: () => store.data,
    update: vi.fn((patch: Record<string, unknown>) => {
      store.data = { ...store.data, ...patch };
    }),
  };
  return { model, store };
}

function shapeVm(id: string, rect: IRect) {
  return {
    id,
    type: 'SHAPE',
    getBounds: () => ({ ...rect }),
    getHostGeom: () => ({ rect: { ...rect }, rotation: 0 }),
    // bbox 边插值（与基类默认实现同式——specs/flowchart-closeout §7.1）
    getAnchorPoint: (join: 'top' | 'right' | 'bottom' | 'left', t = 0.5) =>
      join === 'right'
        ? { x: rect.x + rect.width, y: rect.y + t * rect.height }
        : join === 'left'
          ? { x: rect.x, y: rect.y + t * rect.height }
          : join === 'top'
            ? { x: rect.x + t * rect.width, y: rect.y }
            : { x: rect.x + t * rect.width, y: rect.y + rect.height },
  };
}

interface IBench {
  qa: LineQuickAdd;
  follow: LineAnchorFollow;
  lines: Map<string, ReturnType<typeof statefulLineModel>>;
  addedShapes: string[];
  order: string[];
  engine: unknown;
  vmEngine: unknown;
}

function makeBench(): IBench {
  const lines = new Map<string, ReturnType<typeof statefulLineModel>>();
  const shapeVms = new Map<string, ReturnType<typeof shapeVm>>();
  const addedShapes: string[] = [];
  const order: string[] = [];
  shapeVms.set('A', shapeVm('A', A_RECT));

  const engine = {
    getModelById: (id: string) => lines.get(id)?.model,
    genInitialOrder: () => 1,
    // 落新形状即注册 vm（真实链路 vmEngine 同步建 vm——reattachAll 当轮可读）
    add: (data: Record<string, unknown>) => {
      const id = data.id as string;
      shapeVms.set(
        id,
        shapeVm(id, {
          x: data.x as number,
          y: data.y as number,
          width: data.width as number,
          height: data.height as number,
        }),
      );
      addedShapes.push(id);
      return { id };
    },
  };
  const vmEngine = {
    getVmById: (id: string) => shapeVms.get(id) ?? null,
    getAllVms: () => [
      ...shapeVms.values(),
      ...[...lines.keys()].map((id) => ({ id, type: 'LINE' })),
    ],
    getVmsInRect: (r: IRect) =>
      [...shapeVms.values()].filter((v) => {
        const b = v.getBounds();
        return (
          b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y
        );
      }),
  };
  const selector = {
    setSelected: (ids: string[]) => {
      order.push(`setSelected:${ids[0]}`);
    },
  };
  const history = {
    stopCapturing: () => {
      order.push('stopCapturing');
    },
  };
  const follow = new LineAnchorFollow(
    engine as never,
    vmEngine as never,
    { selected$: { value: [] } } as never,
  );
  const host = {
    beginSession: () => {},
    endSession: () => {},
    throttledMove: () => {},
    settle: () => {},
    hideOverlays: () => {},
    getStartAnchor: () => ({ nodeId: 'A', join: 'right' as const, point: { x: 220, y: 140 } }),
    getDefaultLineType: () => 'ELBOWED' as const,
    getDefaultStrokeWidth: () => 2,
    getDefaultShapeType: () => 'rect' as const,
    onSettled: () => {
      order.push('onSettled');
      follow.reattachAll();
    },
  };
  const qa = new LineQuickAdd(
    { vpScale$: { value: 1 }, worldToClient: (p: { x: number; y: number }) => ({ ...p }) } as never,
    engine as never,
    vmEngine as never,
    selector as never,
    history as never,
    host,
  );
  return { qa, follow, lines, addedShapes, order, engine, vmEngine };
}

/** 注册一条 quick-add 草稿线（startJoin=right、终点待落定） */
function addDraft(bench: IBench, id: string): void {
  bench.lines.set(
    id,
    statefulLineModel({
      id,
      lineType: 'ELBOWED',
      startNodeId: 'A',
      startJoin: 'right',
      endNodeId: null,
      endJoin: null,
      pinned: false,
      points: [
        [220, 140],
        [220, 140],
      ],
    }),
  );
}

describe('quick-add 点击落定 onSettled（顺序：update → 重排 → 单撤销收口）', () => {
  it('create 分支：onSettled 在 line.update 之后、stopCapturing 之前恰好一次', () => {
    const bench = makeBench();
    addDraft(bench, 'L1');
    bench.qa.quickAddConnectedShape('L1');
    expect(bench.addedShapes).toHaveLength(1); // 走 create（方向空闲）
    const l1 = bench.lines.get('L1')!;
    expect(l1.model.update).toHaveBeenCalledTimes(1); // 只有 quickAdd 自身写
    // n=1 → 0.5 槽与 plan 路由同值 → reattachAll samePoints 零写（无幻影事务）
    expect(bench.order).toEqual([
      'onSettled',
      'stopCapturing',
      'setSelected:' + bench.addedShapes[0],
    ]);
    expect((l1.store.data.points as Array<[number, number]>)[0]).toEqual([220, 140]);
  });

  it('connect 分支（落位被无连线孤立元素占）：onSettled 同样先于 stopCapturing', () => {
    // 占位元素 = 正对落位（中心 330,140），无任何连线 → plan 走 connect；
    // 本用例单独搭小 bench（含占位形状）
    const occupied: IRect = { x: 270, y: 100, width: 120, height: 80 };
    const lines = new Map<string, ReturnType<typeof statefulLineModel>>();
    const shapeVms = new Map<string, ReturnType<typeof shapeVm>>([
      ['A', shapeVm('A', A_RECT)],
      ['occupier', shapeVm('occupier', occupied)],
    ]);
    const order: string[] = [];
    const engine = { getModelById: (id: string) => lines.get(id)?.model, genInitialOrder: () => 1 };
    const vmEngine = {
      getVmById: (id: string) => shapeVms.get(id) ?? null,
      getAllVms: () => [
        ...shapeVms.values(),
        ...[...lines.keys()].map((id) => ({ id, type: 'LINE' })),
      ],
      getVmsInRect: (r: IRect) =>
        [...shapeVms.values()].filter((v) => {
          const b = v.getBounds();
          return (
            b.x < r.x + r.width &&
            b.x + b.width > r.x &&
            b.y < r.y + r.height &&
            b.y + b.height > r.y
          );
        }),
    };
    lines.set(
      'L1',
      statefulLineModel({
        id: 'L1',
        lineType: 'ELBOWED',
        startNodeId: 'A',
        startJoin: 'right',
        endNodeId: null,
        endJoin: null,
        pinned: false,
        points: [
          [220, 140],
          [220, 140],
        ],
      }),
    );
    const l1 = lines.get('L1')!;
    const host = {
      getStartAnchor: () => ({ nodeId: 'A', join: 'right' as const, point: { x: 220, y: 140 } }),
      getDefaultLineType: () => 'ELBOWED' as const,
      getDefaultStrokeWidth: () => 2,
      getDefaultShapeType: () => 'rect' as const,
      onSettled: () => {
        order.push('onSettled');
        // 重排时连线两端锚定已写入（update 先于 onSettled 的实证）
        const data = l1.store.data as { endNodeId: string | null };
        if (data.endNodeId === 'occupier') order.push('anchored');
      },
    };
    const qa = new LineQuickAdd(
      {
        vpScale$: { value: 1 },
        worldToClient: (p: { x: number; y: number }) => ({ ...p }),
      } as never,
      engine as never,
      vmEngine as never,
      { setSelected: (ids: string[]) => order.push(`setSelected:${ids[0]}`) } as never,
      { stopCapturing: () => order.push('stopCapturing') } as never,
      host as never,
    );
    qa.quickAddConnectedShape('L1');
    expect(l1.store.data.endNodeId).toBe('occupier');
    expect(order).toEqual(['onSettled', 'anchored', 'stopCapturing', 'setSelected:L1']);
  });
});

describe('quick-add 同边两线 + 删除目标形状（用户场景单测化）', () => {
  it('第二次 quick-add 即物化 0.4/0.6；删除后幸存线 samePoints 零写、悬空线原位', () => {
    const bench = makeBench();
    const ptsOf = (m: ReturnType<typeof statefulLineModel>) =>
      m.store.data.points as Array<[number, number]>;

    // 第一次：方向空闲 → 正对创建，n=1 → 0.5 槽零重排写
    addDraft(bench, 'L1');
    bench.qa.quickAddConnectedShape('L1');
    const s1 = bench.addedShapes[0]!;
    const l1 = bench.lines.get('L1')!;
    expect(ptsOf(l1)[0]).toEqual([220, 140]); // t=0.5（A 右边中点）

    // 第二次：同边分支 → 交替错开；onSettled → reattachAll 物化 0.4/0.6
    addDraft(bench, 'L2');
    bench.qa.quickAddConnectedShape('L2');
    const l2 = bench.lines.get('L2')!;
    // L1 < L2 字典序 → L1 拿 0.4（y=100+0.4×80=132）、L2 拿 0.6（y=148）
    expect(ptsOf(l1)[0]).toEqual([220, 132]);
    expect(ptsOf(l2)[0]).toEqual([220, 148]);
    const l1Calls = l1.model.update.mock.calls.length;
    const l2Calls = l2.model.update.mock.calls.length;
    expect(l1Calls).toBe(2); // quickAdd 写 + 重排让位写
    expect(l2Calls).toBe(2);

    // 删除 S1（L1 的终点）→ L1 解绑悬空（跳过重写、points 原位）；L2 组内
    // 悬空端仍计数 → 槽位不变 → samePoints 零写——不再跳槽重路由扭结
    const l1PointsBefore = (l1.store.data.points as number[][]).map((p) => [...p]);
    const l2PointsBefore = (l2.store.data.points as number[][]).map((p) => [...p]);
    bench.follow.unbindFrom([s1]);
    expect(l1.store.data.endNodeId).toBeNull();
    expect(l1.store.data.points).toEqual(l1PointsBefore);
    expect(l2.store.data.points).toEqual(l2PointsBefore);
    expect(l1.model.update.mock.calls.length).toBe(l1Calls + 1); // 仅解绑 patch 一次
    expect(l2.model.update.mock.calls.length).toBe(l2Calls); // 零重排写（幸存线不扭）
  });
});
